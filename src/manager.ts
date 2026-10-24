/**
 * Queue ownership: loading, mutating and projecting the shared queue.
 *
 * One instance per host. Every mutation is serialized through a promise chain,
 * so two sessions rotating at the same moment cannot interleave a read and a
 * write and lose one of the rotations. Subscribers are notified after the state
 * is durable, never before.
 *
 * @module dsh-model-queue/manager
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { selectEntry, rotateFailed, markSucceeded, setEntries, setCooldown, clearCooldowns } from './queue.ts'
import type { EntryRequest, QueueEntry, QueueState, Selection } from './queue.ts'
import { classifyFailure } from './classify.ts'
import { normalizeCooldown } from './store.ts'
import type { QueueStore } from './store.ts'
import type { CatalogModel, CatalogView, QueueEntryView, QueueView } from './contract.ts'
import { PROVIDER_ID, QUEUE_MODEL_ID } from './contract.ts'

/** What the queue route advertises to the loop, derived from the current members. */
export interface RouteFacts {
  readonly inputModalities: readonly ('text' | 'image')[]
  readonly contextWindow: number
  readonly defaultMaxTokens?: number | undefined
}

/** Fallback context window when no member could be resolved; conservative on purpose. */
const FALLBACK_CONTEXT_WINDOW = 128_000

/** How long a resolved-model catalog entry stays usable before it is re-resolved. */
const MODEL_FACTS_TTL_MS = 30_000

/** One cached member capability lookup. */
interface CachedFacts {
  readonly expiresAt: number
  readonly value: RouteFacts | undefined
}

/** The mutable queue service the rest of the plugin talks to. */
export class QueueManager {
  /** Cached capability facts per `provider\u0000model`. */
  private readonly facts = new Map<string, CachedFacts>()

  /** Serializes every mutation so read-modify-write cannot lose an update. */
  private chain: Promise<unknown> = Promise.resolve()

  /** Notified after each committed state change. */
  private readonly listeners = new Set<() => void>()

  private readonly ctx: Context

  private readonly store: QueueStore

  private readonly clock: () => number

  /**
   * @param ctx - host context carrying `llm`.
   * @param store - durable document owner.
   * @param clock - epoch-millisecond source; injectable for tests.
   */
  constructor(ctx: Context, store: QueueStore, clock: () => number = () => Date.now()) {
    this.ctx = ctx
    this.store = store
    this.clock = clock
  }

  /** The host LLM registry, needed for capability lookup and dispatch. */
  get llm(): Context['llm'] {
    return this.ctx.llm
  }

  /**
   * Load the persisted queue.
   * @returns when the state is available.
   */
  async start(): Promise<void> {
    await this.store.load()
  }

  /**
   * Read the current state.
   * @returns the queue state.
   */
  state(): QueueState {
    return this.store.current()
  }

  /**
   * The cooldown currently applied to failures.
   * @returns milliseconds.
   */
  cooldownMs(): number {
    return this.store.current().cooldownMs
  }

  /**
   * Observe committed state changes.
   * @param listener - called after each commit.
   * @returns the disposer removing the listener.
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Notify every observer; failures in an observer cannot break a mutation. */
  private publish(): void {
    for (const listener of this.listeners) {
      try {
        listener()
      } catch (error: unknown) {
        this.ctx.logger('model-queue').warn(`observer failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }

  /**
   * Run one mutation under the serialization chain.
   * @param mutate - state transformation; may return the same object to skip the write.
   * @returns the state after the operation.
   */
  private enqueue(mutate: (state: QueueState) => QueueState | Promise<QueueState>): Promise<QueueState> {
    const run = this.chain.then(async () => {
      const current = this.store.current()
      const next = await mutate(current)
      if (next !== current) {
        await this.store.commit(next)
        this.publish()
      }
      return next
    })
    this.chain = run.catch(() => {})
    return run
  }

  /**
   * Pick the entry one request should start from.
   * @returns the selection at the current clock.
   */
  select(): Selection {
    return selectEntry(this.state(), this.clock())
  }

  /**
   * Record one successful attempt: the entry leaves cooldown.
   * @param entry - the entry that served the request.
   * @returns when the state is durable.
   */
  async recordSuccess(entry: QueueEntry): Promise<void> {
    await this.enqueue(state => markSucceeded(state, entry.id))
  }

  /**
   * Record one failed attempt.
   *
   * A request-shaped failure (`classify.ts`) leaves the queue untouched: the
   * same request would fail on every member, and cooling down the whole queue
   * would misreport the cause.
   * @param entry - the entry that failed.
   * @param failure - the inner failure.
   * @param signal - caller cancellation, which also leaves the queue untouched.
   * @returns whether the entry rotated, and whether the queue is now exhausted.
   */
  async recordFailure(
    entry: QueueEntry,
    failure: { code: string, message: string },
    signal?: AbortSignal,
  ): Promise<'rotated' | 'exhausted' | 'ignored'> {
    if (classifyFailure(failure.code) === 'fail' || signal?.aborted === true) return 'ignored'
    const state = await this.enqueue(current => rotateFailed(current, entry.id, failure, this.clock()))
    return selectEntry(state, this.clock()).kind === 'exhausted' ? 'exhausted' : 'rotated'
  }

  /**
   * Replace the queue with an ordered list from the UI.
   * @param entries - the requested entries.
   * @returns the committed state.
   * @throws {Error} when a row is not a usable provider/model pair.
   */
  async setEntries(entries: readonly EntryRequest[]): Promise<QueueState> {
    if (entries.length > 64) throw new Error('the queue may hold at most 64 models')
    for (const entry of entries) {
      if (entry.provider.trim() === '' || entry.model.trim() === '') {
        throw new Error('every queue row needs a provider and a model')
      }
    }
    const ids = entries.map(() => randomUUID())
    return this.enqueue(state => setEntries(state, entries, ids))
  }

  /**
   * Change the failure cooldown.
   * @param cooldownMs - requested cooldown.
   * @returns the committed state.
   * @throws {Error} when the value is out of range.
   */
  async setCooldown(cooldownMs: number): Promise<QueueState> {
    const normalized = normalizeCooldown(cooldownMs)
    return this.enqueue(state => setCooldown(state, normalized))
  }

  /**
   * Clear every cooldown so the queue can be tried again immediately.
   * @returns the committed state.
   */
  async clearCooldowns(): Promise<QueueState> {
    return this.enqueue(state => clearCooldowns(state))
  }

  /**
   * Project the state for one browser, with countdowns resolved against a
   * single host clock reading so a page cannot mix two instants.
   * @returns the wire view.
   */
  view(): QueueView {
    const state = this.state()
    const now = this.clock()
    const selection = selectEntry(state, now)
    const entries: QueueEntryView[] = state.entries.map(entry => ({
      id: entry.id,
      provider: entry.provider,
      model: entry.model,
      label: entry.label,
      cooldownUntil: entry.cooldownUntil,
      remainingMs: Math.max(0, entry.cooldownUntil - now),
      failures: entry.failures,
      ...entry.lastFailure === undefined ? {} : { lastFailure: entry.lastFailure },
    }))
    return {
      revision: state.revision,
      cooldownMs: state.cooldownMs,
      now,
      provider: PROVIDER_ID,
      model: QUEUE_MODEL_ID,
      entries,
      head: selection.kind === 'entry' ? selection.entry.id : null,
      exhausted: selection.kind === 'exhausted',
      ...selection.kind !== 'exhausted' || selection.failure === undefined
        ? {}
        : { failure: selection.failure },
    }
  }

  /**
   * List every model the host can currently route to, for the queue editor.
   *
   * The queue route itself is excluded: queueing the queue would recurse.
   * @returns the catalog, with per-provider failures instead of a global one.
   */
  async catalog(): Promise<CatalogView> {
    const models: CatalogModel[] = []
    const failures: { provider: string, message: string }[] = []
    for (const provider of this.llm.listProviders()) {
      if (provider.id === PROVIDER_ID) continue
      try {
        const listed = await this.llm.listModels(provider.id)
        for (const model of listed) {
          models.push({
            provider: provider.id,
            providerName: provider.name,
            model: model.id,
            name: model.name,
          })
        }
      } catch (error: unknown) {
        failures.push({
          provider: provider.id,
          message: error instanceof Error ? error.message : String(error),
        })
      }
    }
    return { models, failures }
  }

  /**
   * Resolve one member's capabilities, cached briefly.
   * @param provider - member provider route.
   * @param model - member model id.
   * @returns facts, or `undefined` when the route cannot serve the model.
   */
  private memberFacts(provider: string, model: string): RouteFacts | undefined {
    const key = `${provider}\u0000${model}`
    const cached = this.facts.get(key)
    if (cached !== undefined && cached.expiresAt > this.clock()) return cached.value
    return undefined
  }

  /**
   * Resolve and cache one member's capabilities.
   * @param provider - member provider route.
   * @param model - member model id.
   * @returns facts, or `undefined` when resolution failed.
   */
  private async loadMemberFacts(provider: string, model: string): Promise<RouteFacts | undefined> {
    const key = `${provider}\u0000${model}`
    try {
      const info = await this.llm.resolveModelInfo(provider, model)
      const value: RouteFacts = {
        inputModalities: info.inputModalities === undefined
          ? ['text']
          : info.inputModalities.filter((modality): modality is 'text' | 'image' => modality === 'text' || modality === 'image'),
        contextWindow: info.context?.contextWindow ?? FALLBACK_CONTEXT_WINDOW,
        ...info.defaultMaxTokens === undefined ? {} : { defaultMaxTokens: info.defaultMaxTokens },
      }
      this.facts.set(key, { expiresAt: this.clock() + MODEL_FACTS_TTL_MS, value })
      return value
    } catch {
      // A member that cannot be resolved must not make the queue route
      // unadvertisable: it simply contributes no capability facts.
      this.facts.set(key, { expiresAt: this.clock() + MODEL_FACTS_TTL_MS, value: undefined })
      return undefined
    }
  }

  /**
   * Warm the capability cache for every member, so the first request does not
   * have to wait for a cold lookup.
   * @returns when every member has been attempted.
   */
  async warmFacts(): Promise<void> {
    await Promise.all(this.state().entries.map(entry => this.loadMemberFacts(entry.provider, entry.model)))
  }

  /**
   * Whether a member accepts one reasoning effort.
   * @param provider - member provider route.
   * @param model - member model id.
   * @param effort - the effort the queue route was asked for.
   * @returns `true` when the member advertises it.
   */
  supportsEffort(provider: string, model: string, effort: string): boolean {
    const moderation = this.efforts.get(`${provider}\u0000${model}`)
    return moderation?.has(effort) ?? false
  }

  /** Reasoning efforts per member, refreshed with the same cadence as {@link RouteFacts}. */
  private readonly efforts = new Map<string, Set<string> | undefined>()

  /**
   * Aggregate member capabilities for the queue route.
   *
   * Text is always admitted; images only when *every* member accepts them, so a
   * rotation never hands an image to a text-only model. The context window is
   * the smallest member's for the same reason.
   * @returns the advertised facts.
   */
  routeFacts(): RouteFacts {
    const state = this.state()
    let contextWindow = Number.POSITIVE_INFINITY
    let defaultMaxTokens = Number.POSITIVE_INFINITY
    let images = state.entries.length > 0
    let resolved = 0
    for (const entry of state.entries) {
      const facts = this.memberFacts(entry.provider, entry.model)
      if (facts === undefined) {
        // Unknown member: assume the conservative answer rather than an
        // optimistic one, because a rotation may land on this entry.
        images = false
        continue
      }
      resolved += 1
      contextWindow = Math.min(contextWindow, facts.contextWindow)
      defaultMaxTokens = Math.min(defaultMaxTokens, facts.defaultMaxTokens ?? Number.POSITIVE_INFINITY)
      if (!facts.inputModalities.includes('image')) images = false
    }
    return {
      inputModalities: images && resolved > 0 ? ['text', 'image'] : ['text'],
      contextWindow: Number.isFinite(contextWindow) ? contextWindow : FALLBACK_CONTEXT_WINDOW,
      ...Number.isFinite(defaultMaxTokens) ? { defaultMaxTokens } : {},
    }
  }

  /**
   * Refresh the reasoning-effort and capability caches for every member.
   * @returns when the refresh finished.
   */
  async refreshFacts(): Promise<void> {
    const state = this.state()
    await Promise.all(state.entries.map(async (entry) => {
      const key = `${entry.provider}\u0000${entry.model}`
      await this.loadMemberFacts(entry.provider, entry.model)
      try {
        const info = await this.llm.resolveModelInfo(entry.provider, entry.model)
        this.efforts.set(key, info.reasoning === undefined
          ? undefined
          : new Set(info.reasoning.efforts.map(effort => effort.id)))
      } catch {
        this.efforts.set(key, undefined)
      }
    }))
  }
}
