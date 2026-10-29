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
  LlmFailure,
  LlmModelInfo,
  LlmProviderInfo,
  LlmResolvedModelInfo,
  StreamChunk,
} from '@deepseek-ai/dsh-llm'
import type { ReasoningEffortId } from '@deepseek-ai/dsh-llm/brand'
import type { QueueManager } from './manager.ts'
import { classifyFailure } from './classify.ts'
import { PROVIDER_ID, QUEUE_MODEL_ID, QUEUE_MODEL_NAME, ROUTE_REASONING_EFFORTS } from './contract.ts'
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

/** One failed attempt's complete provider facts, forwarded unchanged. */
type AttemptFailure = LlmFailure

/**
 * How one attempt ended.
 */
type AttemptResult =
  | { readonly kind: 'ok' }
  | { readonly kind: 'aborted' }
  | { readonly kind: 'failed', readonly failure: LlmFailure }

/**
 * Detach the provider facts from a thrown value.
 *
 * A member's adapter normally reports failure through its terminal chunk, but a
 * thrown `LlmError` carries the same facts on `.failure` — including
 * `offloadImages`, which the image-offload recovery needs. Anything else is an
 * unrecognized throw and keeps the old code/message-only shape.
 * @param error - the thrown value.
 * @returns the failure facts to forward.
 */
function failureOf(error: unknown): LlmFailure {
  const carried = (error as { failure?: Partial<LlmFailure> } | null)?.failure
  if (carried !== undefined && typeof carried.code === 'string' && carried.code.length > 0
    && typeof carried.message === 'string' && carried.message.length > 0) {
    return carried as LlmFailure
  }
  return {
    code: (error as { code?: string }).code ?? 'UNKNOWN',
    message: error instanceof Error ? error.message : String(error),
  }
}

/**
 * Model metadata advertised for the queue route.
 *
 * The queue routes to whatever its members advertised, so capabilities are the
 * members' common ground: text always, images only when every member accepts
 * them. The context window is deliberately the smallest member's — an optimistic
 * value would let the loop admit a request one member cannot serve, and a
 * rotation would then fail for a reason the user cannot act on.
 *
 * Reasoning levels are the exception. The route does not spend one: a dispatch
 * strips the level the caller named (see {@link QueueAdapter}), so advertising
 * the members' intersection would be a lie *and* a hazard. The harness refuses a
 * call whose level the route does not list, so a route that narrowed its set —
 * because one member lacks `max`, or because a member's facts went stale — would
 * kill an otherwise fine request over a value the queue ignores anyway. The full
 * harness vocabulary is the only stable answer, and it is the truthful one: any
 * level is accepted, and the members decide what they actually run.
 * @param manager - queue owner.
 * @returns metadata for the queue route.
 */
function queueModelInfo(manager: QueueManager): LlmResolvedModelInfo {
  const facts = manager.routeFacts()
  return {
    provider: PROVIDER_ID,
    id: QUEUE_MODEL_ID,
    name: QUEUE_MODEL_NAME,
    description: 'Tries the queue head first; a failed model rotates to the tail with a cooldown.',
    inputModalities: facts.inputModalities,
    context: { contextWindow: facts.contextWindow },
    ...facts.defaultMaxTokens === undefined ? {} : { defaultMaxTokens: facts.defaultMaxTokens },
    reasoning: {
      efforts: ROUTE_REASONING_EFFORTS.map(effort => ({
        id: effort.id as ReasoningEffortId,
        name: effort.name,
      })),
    },
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
        const reason = lastFailure ?? (selection.failure === undefined
          ? undefined
          : { code: selection.failure.code, message: selection.failure.message })
        yield {
          type: 'finish',
          reason: {
            kind: 'error',
            failure: reason === undefined
              ? { code: 'QUEUE_EXHAUSTED', message: 'Every model in the queue is cooling down after a failure.' }
              : reason,
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
              : reason,
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

      // Forward the member's complete failure facts, not just code and message:
      // `offloadImages` is what lets `dsh-compaction-image-offload` retry the
      // same step, and `status`/`providerRetryAfterMs` drive the loop's own retry
      // policy. Rebuilding a two-field object here silently disabled both.
      lastFailure = attempt.failure
      const outcome = await this.manager.recordFailure(entry, attempt.failure, options.signal)
      if (outcome === 'ignored') {
        // A request-shaped failure would repeat on every member; reporting it
        // once is the honest answer.
        yield { type: 'finish', reason: { kind: 'error', failure: attempt.failure } }
        return
      }
      this.logger.warn(
        `model-queue: ${entry.provider}/${entry.model} failed (${attempt.failure.code}: ${attempt.failure.message}); `
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
   * @param entry - the member this attempt dispatches to.
   * @returns how the attempt ended.
   */
  private async * attempt(
    options: GenerateOptions,
    entry: QueueEntry,
  ): AsyncGenerator<StreamChunk, AttemptResult> {
    const provider = entry.provider
    const model = entry.model
    // The caller's level is dropped here, not forwarded: see `requestControls`.
    const { reasoningEffort: callerEffort, ...rest } = options
    void callerEffort
    const inner: GenerateOptions = {
      ...rest,
      provider,
      model,
      ...this.requestControls(entry, options.maxTokens),
    }
    let failure: AttemptFailure | undefined
    let aborted = false
    let produced = false
    try {
      for await (const chunk of this.manager.llm.stream(inner)) {
        if (chunk.type === 'finish') {
          if (chunk.reason.kind === 'error') {
            // Keep the provider's whole failure record: `offloadImages`,
            // `status`, `providerRetryAfterMs` and `requestId` are all consumed
            // downstream (`dsh-compaction-image-offload`, retry policy).
            failure = chunk.reason.failure
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
      failure = failureOf(error)
    }
    if (aborted) return { kind: 'aborted' }
    if (failure !== undefined) return { kind: 'failed', failure }
    if (produced) return { kind: 'ok' }
    // A stream that ended without any content is as unusable as a reported
    // failure; treating it as success would end the turn with nothing.
    return { kind: 'failed', failure: { code: 'EMPTY_RESPONSE', message: `${provider}/${model} produced no content.` } }
  }

  /**
   * Translate the route-level request into one member's own controls.
   *
   * The reasoning level the caller named is **ignored**, by design: the queue
   * route advertises the full harness vocabulary so that no stored selection can
   * ever be refused, and each member then runs on its own level instead of a
   * level borrowed from whichever model the picker showed. A row's own
   * `reasoningEffort` override still applies — that one is the member's explicit
   * configuration, not a value inherited from the call.
   * The output cap is the other control: the queue advertises the smallest
   * member's cap, so a request the route admitted may still exceed this member.
   * @param entry - the member the request is being dispatched to.
   * @param maxTokens - the cap the caller asked for, when it asked for one.
   * @returns the fields to override on the inner request.
   */
  private requestControls(
    entry: QueueEntry,
    maxTokens: number | undefined,
  ): { reasoningEffort?: ReasoningEffortId, maxTokens?: number } {
    const controls: { reasoningEffort?: ReasoningEffortId, maxTokens?: number } = {}
    const pinned = this.manager.overridesOf(entry).reasoningEffort
    if (pinned !== undefined && this.manager.supportsEffort(entry, pinned)) {
      controls.reasoningEffort = pinned as ReasoningEffortId
    }
    const cap = this.manager.effectiveConfig(entry).maxTokens
    if (cap !== undefined && maxTokens !== undefined && maxTokens > cap) {
      controls.maxTokens = cap
    }
    return controls
  }
}

/** Re-exported for tests that assert on the classification the loop above relies on. */
export { classifyFailure }
