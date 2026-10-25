/**
 * The `dsh-model-queue` provider adapter.
 *
 * The harness picks a model per session; this plugin needs one *route* whose
 * behavior is the queue. The adapter therefore registers a single provider
 * (`PROVIDER_ID`) and, for every dispatch, asks the queue which member serves
 * the request, then re-dispatches that same request to the real
 * provider/model through `ctx.llm.stream()`.
 *
 * One request walks the queue: when a member fails for a route-shaped reason,
 * the member rotates to the tail (recording its failure and cooldown) and the
 * same request continues with whatever the queue now selects — that is what
 * "rotate to the next model" means. The request fails only when nothing is
 * selectable, and then it reports the last provider's own reason, so the user
 * sees why the *last* attempt failed rather than a generic queue error.
 *
 * @module dsh-model-queue/adapter
 */

import { LlmAdapter, LlmError } from '@deepseek-ai/dsh-llm'
import type {
  GenerateOptions,
  LlmModelInfo,
  LlmProviderInfo,
  LlmResolvedModelInfo,
  StreamChunk,
} from '@deepseek-ai/dsh-llm'
import type { ReasoningEffortId } from '@deepseek-ai/dsh-llm/brand'
import type { QueueManager } from './manager.ts'
import { classifyFailure } from './classify.ts'
import { PROVIDER_ID, QUEUE_MODEL_ID, QUEUE_MODEL_NAME } from './contract.ts'
import type { QueueEntry } from './queue.ts'

/**
 * Whether one chunk carries something a session can keep.
 *
 * Text and reasoning only count when non-empty; a tool call counts as soon as
 * it is announced, because the tool itself is the content.
 * @param chunk - one stream chunk that is not a terminal `finish`.
 * @returns whether the chunk carries visible content.
 */
function hasVisibleContent(chunk: StreamChunk): boolean {
  switch (chunk.type) {
    case 'text-delta':
    case 'reasoning-delta':
      return chunk.text.length > 0
    case 'tool-call-delta':
      return true
    case 'block-end':
      return chunk.block.type === 'tool-call'
        || (chunk.block.type === 'text' && chunk.block.text.length > 0)
        || (chunk.block.type === 'reasoning' && chunk.block.text.length > 0)
    default:
      return false
  }
}

/** One failed attempt, as the next loop iteration reports it. */
interface AttemptFailure {
  readonly code: string
  readonly message: string
}

/**
 * How one attempt ended.
 */
type AttemptResult =
  | { readonly kind: 'ok' }
  | { readonly kind: 'aborted' }
  | { readonly kind: 'failed', readonly code: string, readonly message: string }

/**
 * Model metadata advertised for the queue route.
 *
 * The queue routes to whatever its members advertised, so the union is the only
 * honest answer: text always, images only when every member accepts them. The
 * context window is deliberately the smallest member's — an optimistic value
 * would let the loop admit a request one member cannot serve, and a rotation
 * would then fail for a reason the user cannot act on.
 * @param manager - queue owner.
 * @returns metadata for the queue route.
 */
function queueModelInfo(manager: QueueManager): LlmResolvedModelInfo {
  const facts = manager.routeFacts()
  const reasoning = facts.reasoning === undefined
    ? undefined
    : {
        efforts: facts.reasoning.efforts.map(effort => ({
          id: effort.id as ReasoningEffortId,
          name: effort.name,
          ...effort.description === undefined ? {} : { description: effort.description },
        })),
        ...facts.reasoning.defaultEffort === undefined
          ? {}
          : { defaultEffort: facts.reasoning.defaultEffort as ReasoningEffortId },
      }
  return {
    provider: PROVIDER_ID,
    id: QUEUE_MODEL_ID,
    name: QUEUE_MODEL_NAME,
    description: 'Tries the queue head first; a failed model rotates to the tail with a cooldown.',
    inputModalities: facts.inputModalities,
    context: { contextWindow: facts.contextWindow },
    ...facts.defaultMaxTokens === undefined ? {} : { defaultMaxTokens: facts.defaultMaxTokens },
    // The route offers exactly the levels every member can serve. A member that
    // lacks a level the caller named falls back to its own default instead of
    // failing the request, because the level the picker offered came from the
    // route, not from that member.
    ...reasoning === undefined ? {} : { reasoning },
    systemPromptUpdate: 'in-history',
    toolUpdate: 'in-history',
  }
}

/**
 * The single adapter this plugin registers.
 */
export class QueueAdapter extends LlmAdapter {
  private readonly manager: QueueManager

  private readonly logger: { info(message: string): void, warn(message: string): void }

  /**
   * @param manager - queue owner, consulted on every call.
   * @param logger - diagnostics for rotations and exhausted queues.
   */
  constructor(manager: QueueManager, logger: { info(message: string): void, warn(message: string): void }) {
    super()
    this.manager = manager
    this.logger = logger
  }

  /**
   * Describe the one queue route.
   * @param provider - route name; always {@link PROVIDER_ID}.
   * @returns display metadata.
   */
  override providerInfo(provider: string): LlmProviderInfo {
    return { id: provider, name: QUEUE_MODEL_NAME }
  }

  /**
   * Advertise exactly one model: the queue itself.
   *
   * The picker then shows one stable choice. Members are chosen inside the
   * queue, which is the whole point — a session should not have to know which
   * provider answers.
   * @returns the single queue model.
   */
  override listModels(): Promise<readonly LlmModelInfo[]> {
    return Promise.resolve([{
      provider: PROVIDER_ID,
      id: QUEUE_MODEL_ID,
      name: QUEUE_MODEL_NAME,
      description: 'Tries the queue head first; failures rotate to the tail.',
    }])
  }

  /**
   * Resolve the queue model's capabilities from the current members.
   * @param provider - route name.
   * @param model - requested model id; only the queue id is served.
   * @returns metadata for the queue route.
   */
  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    if (model !== QUEUE_MODEL_ID) {
      return Promise.reject(new LlmError(
        `provider "${provider}" serves only "${QUEUE_MODEL_ID}", not "${model}"`,
        'UNKNOWN_MODEL',
      ))
    }
    return Promise.resolve(queueModelInfo(this.manager))
  }

  /**
   * Serve one queued request, walking the queue until a member succeeds.
   *
   * Termination: every failure either rotates its entry to the tail or ends the
   * request. The loop additionally remembers which entries it already tried, so
   * a zero cooldown (rotation without waiting) cannot spin forever on the same
   * member.
   * @param options - the request the loop built.
   * @returns chunks from the member that answered, or one terminal failure.
   */
  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const tried = new Set<string>()
    let lastFailure: AttemptFailure | undefined

    while (true) {
      if (options.signal?.aborted === true) {
        yield { type: 'finish', reason: { kind: 'aborted', failure: { code: 'ABORTED', message: 'The request was cancelled.' } } }
        return
      }

      const selection = this.manager.select()
      if (selection.kind === 'empty') {
        yield {
          type: 'finish',
          reason: {
            kind: 'error',
            failure: {
              code: 'NO_MODEL',
              message: 'The model queue is empty: add at least one model in Plugins → Model Queue.',
            },
          },
        }
        return
      }
      if (selection.kind === 'exhausted') {
        // Requirement 5: when every model is cooling down the task fails with the
        // *last request's* reason, not with a generic queue error.
        const reason = lastFailure ?? selection.failure
        yield {
          type: 'finish',
          reason: {
            kind: 'error',
            failure: reason === undefined
              ? { code: 'QUEUE_EXHAUSTED', message: 'Every model in the queue is cooling down after a failure.' }
              : { code: reason.code, message: reason.message },
          },
        }
        return
      }

      const entry = selection.entry
      if (tried.has(entry.id)) {
        // The queue came back to a member this request already burned through
        // (possible with a zero cooldown). Nothing else is left to try.
        const reason = lastFailure
        yield {
          type: 'finish',
          reason: {
            kind: 'error',
            failure: reason === undefined
              ? { code: 'QUEUE_EXHAUSTED', message: 'No model in the queue could serve this request.' }
              : { code: reason.code, message: reason.message },
          },
        }
        return
      }
      tried.add(entry.id)

      const attempt = yield * this.attempt(options, entry)
      if (attempt.kind === 'aborted') return
      if (attempt.kind === 'ok') {
        await this.manager.recordSuccess(entry)
        return
      }

      lastFailure = { code: attempt.code, message: attempt.message }
      const outcome = await this.manager.recordFailure(entry, lastFailure, options.signal)
      if (outcome === 'ignored') {
        // A request-shaped failure would repeat on every member; reporting it
        // once is the honest answer.
        yield {
          type: 'finish',
          reason: { kind: 'error', failure: { code: attempt.code, message: attempt.message } },
        }
        return
      }
      this.logger.warn(
        `model-queue: ${entry.provider}/${entry.model} failed (${attempt.code}: ${attempt.message}); `
        + (outcome === 'exhausted'
          ? 'every model is now cooling down.'
          : `rotated to the tail with a ${Math.round(this.manager.cooldownMs() / 1000)}s cooldown.`),
      )
      // Continue with whatever the queue selects next.
    }
  }

  /**
   * Dispatch one attempt and report how it ended.
   *
   * Successful output streams through to the caller as it arrives, so a
   * rotation never delays visible text; the terminal chunk is inspected before
   * it is forwarded, so a failed attempt's partial output never reaches the
   * session (the loop would persist it and then continue on a half turn).
   * @param options - the original request.
   * @param provider - member provider route.
   * @param model - member model id.
   * @returns how the attempt ended.
   */
  private async * attempt(
    options: GenerateOptions,
    entry: QueueEntry,
  ): AsyncGenerator<StreamChunk, AttemptResult> {
    const provider = entry.provider
    const model = entry.model
    const inner: GenerateOptions = {
      ...options,
      provider,
      model,
      ...this.requestControls(entry, options),
    }
    let failure: AttemptFailure | undefined
    let aborted = false
    let produced = false
    try {
      for await (const chunk of this.manager.llm.stream(inner)) {
        if (chunk.type === 'finish') {
          if (chunk.reason.kind === 'error') {
            failure = { code: chunk.reason.failure.code, message: chunk.reason.failure.message }
            break
          }
          if (chunk.reason.kind === 'aborted') {
            aborted = true
            yield chunk
            return { kind: 'aborted' }
          }
        } else if (hasVisibleContent(chunk)) {
          // Only real content counts: a provider that stops without emitting a
          // block produced nothing usable, and the queue must rotate instead of
          // ending the turn silently.
          produced = true
        }
        if (failure === undefined) yield chunk
      }
    } catch (error: unknown) {
      failure = {
        code: (error as { code?: string }).code ?? 'UNKNOWN',
        message: error instanceof Error ? error.message : String(error),
      }
    }
    if (aborted) return { kind: 'aborted' }
    if (failure !== undefined) return { kind: 'failed', ...failure }
    if (produced) return { kind: 'ok' }
    // A stream that ended without any content is as unusable as a reported
    // failure; treating it as success would end the turn with nothing.
    return { kind: 'failed', code: 'EMPTY_RESPONSE', message: `${provider}/${model} produced no content.` }
  }

  /**
   * Translate the route-level request into one member's own controls.
   *
   * Both controls exist because the queue advertises the *intersection* of its
   * members: a level or a cap the picker showed may still be one this member
   * cannot serve. Rather than failing the request on a value the user picked
   * from the queue's own menu, the member falls back to its declared default.
   * @param entry - the member the request is being dispatched to.
   * @param options - the request the loop built for the queue route.
   * @returns the fields to override on the inner request.
   */
  private requestControls(
    entry: QueueEntry,
    options: GenerateOptions,
  ): { reasoningEffort?: ReasoningEffortId, maxTokens?: number } {
    const controls: { reasoningEffort?: ReasoningEffortId, maxTokens?: number } = {}
    const requested = options.reasoningEffort
    if (requested !== undefined) {
      if (this.manager.supportsEffort(entry, requested)) {
        controls.reasoningEffort = requested
      } else {
        const fallback = this.manager.defaultEffort(entry)
        if (fallback !== undefined) controls.reasoningEffort = fallback as ReasoningEffortId
      }
    }
    const cap = this.manager.effectiveConfig(entry).maxTokens
    if (cap !== undefined && options.maxTokens !== undefined && options.maxTokens > cap) {
      controls.maxTokens = cap
    }
    return controls
  }
}

/** Re-exported for tests that assert on the classification the loop above relies on. */
export { classifyFailure }
