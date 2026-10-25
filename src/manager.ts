/**
 * Queue ownership: loading, mutating and projecting the shared queue.
 *
 * One instance per host. Every mutation is serialized through a promise chain,
 * so two sessions rotating at the same moment cannot interleave a read and a
 * write and lose one of the rotations. Subscribers are notified after the state
 * is durable, never before.
 *
 * The manager is also the one place that knows how a member is *configured*:
 * it resolves each member through the same `ctx.llm.resolveModelInfo()` the
 * harness uses for a direct route, layers the row's overrides on the result,
 * and aggregates them into the facts the queue route advertises. That makes a
 * queued model indistinguishable from a directly configured one at the picker.
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
import type {
  CatalogModel,
  CatalogView,
  ModelConfig,
  ModelConfigOverrides,
  ModelModality,
  QueueEntryView,
  QueueView,
} from './contract.ts'
import { PROVIDER_ID, QUEUE_MODEL_ID } from './contract.ts'
import { UNKNOWN_CONFIG, aggregateRouteConfig, applyOverrides, configFromListing, configFromResolved } from './model-config.ts'

/** What the queue route advertises to the loop, derived from the current members. */
export interface RouteFacts {
  readonly inputModalities: readonly ModelModality[]
  readonly contextWindow: number
  readonly defaultMaxTokens?: number | undefined
  readonly reasoning?: ModelConfig['reasoning']
}

/** Fallback context window when no member could be resolved; conservative on purpose. */
const FALLBACK_CONTEXT_WINDOW = 128_000

/** How long a resolved-model result stays usable before it is resolved again. */
const MODEL_FACTS_TTL_MS = 30_000

/** One cached member resolution. */
interface CachedFacts {
  readonly expiresAt: number
  /** The resolved facts, or `undefined` when the route refused to resolve the model. */
  readonly value: ModelConfig | undefined
  /** Why the resolution failed, for the catalog's diagnostics. */
  readonly error?: string
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
   *
   * A row that arrives without a snapshot is resolved against its route first,
   * so the queue never stores a row it knows nothing about while the route is
   * answering. A reorder (an id that still names the same model) keeps the
   * stored snapshot and overrides, so moving a row never silently resets it.
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
    const byId = new Map(this.state().entries.map(entry => [entry.id, entry]))
    const resolved = await Promise.all(entries.map(async (entry): Promise<EntryRequest> => {
      const existing = entry.id === undefined ? undefined : byId.get(entry.id)
      if (existing !== undefined && existing.provider === entry.provider && existing.model === entry.model) {
        // A reorder carries no snapshot; the stored one stays authoritative, and
        // a resolve here would only cost a round trip.
        return entry
      }
      if (entry.snapshot !== undefined) return entry
      const config = await this.resolveConfig(entry.provider, entry.model)
      return { ...entry, snapshot: config ?? UNKNOWN_CONFIG }
    }))
    const ids = entries.map(() => randomUUID())
    return this.enqueue(state => setEntries(state, resolved, ids))
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
   * Re-read every member's configuration and store what the route reports.
   *
   * This is the "sync" half of the feature: a model reconfigured in dsh's own
   * settings (a new context window, a new reasoning level, image support) is
   * picked up by the queue without the user re-adding the row. Overrides are
   * left alone — they are the user's explicit intent, not a cache.
   * @returns whether any row's snapshot changed.
   */
  async syncConfigs(): Promise<boolean> {
    const state = this.state()
    const updates = new Map<string, ModelConfig>()
    await Promise.all(state.entries.map(async (entry) => {
      const config = await this.resolveConfig(entry.provider, entry.model)
      if (config !== undefined) updates.set(entry.id, config)
    }))
    if (updates.size === 0) return false
    let changed = false
    await this.enqueue((current) => {
      const entries = current.entries.map((entry) => {
        const config = updates.get(entry.id)
        if (config === undefined) return entry
        changed = true
        return { ...entry, snapshot: config }
      })
      return changed ? { ...current, revision: current.revision + 1, entries } : current
    })
    return changed
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
    const entries: QueueEntryView[] = state.entries.map((entry) => {
      const resolved = this.memberFacts(entry.provider, entry.model)
      return {
        id: entry.id,
        provider: entry.provider,
        model: entry.model,
        label: entry.label,
        cooldownUntil: entry.cooldownUntil,
        remainingMs: Math.max(0, entry.cooldownUntil - now),
        failures: entry.failures,
        ...entry.lastFailure === undefined ? {} : { lastFailure: entry.lastFailure },
        ...resolved === undefined ? {} : { resolved },
        snapshot: entry.snapshot,
        overrides: entry.overrides,
        effective: applyOverrides(resolved ?? entry.snapshot, entry.overrides),
      }
    })
    return {
      revision: state.revision,
      cooldownMs: state.cooldownMs,
      now,
      provider: PROVIDER_ID,
      model: QUEUE_MODEL_ID,
      entries,
      head: selection.kind === 'entry' ? selection.entry.id : null,
      exhausted: selection.kind === 'exhausted',
      route: this.routeConfig(),
      ...selection.kind !== 'exhausted' || selection.failure === undefined
        ? {}
        : { failure: selection.failure },
    }
  }

  /**
   * List every model the host can currently route to, with the complete
   * configuration each one resolves to.
   *
   * The queue route itself is excluded: queueing the queue would recurse. Each
   * model is resolved rather than merely listed, because the picker has to show
   * the same capacities dsh shows for that model.
   * @returns the catalog, with per-provider failures instead of a global one.
   */
  async catalog(): Promise<CatalogView> {
    const models: CatalogModel[] = []
    const failures: { provider: string, message: string }[] = []
    for (const provider of this.llm.listProviders()) {
      if (provider.id === PROVIDER_ID) continue
      let listed: Awaited<ReturnType<Context['llm']['listModels']>>
      try {
        listed = await this.llm.listModels(provider.id)
      } catch (error: unknown) {
        failures.push({
          provider: provider.id,
          message: error instanceof Error ? error.message : String(error),
        })
        continue
      }
      for (const model of listed) {
        const config = await this.resolveConfig(provider.id, model.id)
        models.push({
          provider: provider.id,
          providerName: provider.name,
          model: model.id,
          name: model.name,
          ...model.description === undefined ? {} : { description: model.description },
          config: config ?? configFromListing(model),
          resolved: config !== undefined,
          ...config !== undefined
            ? {}
            : { resolveError: this.facts.get(`${provider.id}\u0000${model.id}`)?.error ?? 'the route did not answer' },
        })
      }
    }
    return { models, failures }
  }

  /**
   * Resolve one member's complete configuration, using the cache when it is
   * still fresh.
   * @param provider - member provider route.
   * @param model - member model id.
   * @returns the resolved facts, or `undefined` when the route refused.
   */
  private memberFacts(provider: string, model: string): ModelConfig | undefined {
    const cached = this.facts.get(`${provider}\u0000${model}`)
    if (cached !== undefined && cached.expiresAt > this.clock()) return cached.value
    return undefined
  }

  /**
   * Resolve and cache one member's complete configuration.
   *
   * A route that cannot answer is cached as "unknown" for the same short TTL,
   * so a page load does not hammer a dead provider while still recovering
   * quickly once it returns.
   * @param provider - member provider route.
   * @param model - member model id.
   * @returns the facts, or `undefined` when resolution failed.
   */
  async resolveConfig(provider: string, model: string): Promise<ModelConfig | undefined> {
    const key = `${provider}\u0000${model}`
    try {
      const info = await this.llm.resolveModelInfo(provider, model)
      const value = configFromResolved(info)
      this.facts.set(key, { expiresAt: this.clock() + MODEL_FACTS_TTL_MS, value })
      return value
    } catch (error: unknown) {
      this.facts.set(key, {
        expiresAt: this.clock() + MODEL_FACTS_TTL_MS,
        value: undefined,
        error: error instanceof Error ? error.message : String(error),
      })
      return undefined
    }
  }

  /**
   * Warm the capability cache for every member, so the first request does not
   * have to wait for a cold lookup.
   * @returns when every member has been attempted.
   */
  async warmFacts(): Promise<void> {
    await Promise.all(this.state().entries.map(entry => this.resolveConfig(entry.provider, entry.model)))
  }

  /**
   * The effective configuration of one member: its overrides over its facts.
   * @param entry - the member.
   * @returns the configuration a dispatch through this member uses.
   */
  effectiveConfig(entry: QueueEntry): ModelConfig {
    return applyOverrides(this.memberFacts(entry.provider, entry.model) ?? entry.snapshot, entry.overrides)
  }

  /**
   * Whether a member accepts one reasoning effort.
   * @param entry - the member.
   * @param effort - the effort the queue route was asked for.
   * @returns `true` when the member's effective configuration offers it.
   */
  supportsEffort(entry: QueueEntry, effort: string): boolean {
    return this.effectiveConfig(entry).reasoning?.efforts.some(level => level.id === effort) ?? false
  }

  /**
   * The reasoning level a member should use when the caller named none.
   *
   * Order: the row's own override, then the model's declared default. A model
   * with no reasoning support returns `undefined`, which is what the adapter
   * needs in order to leave the request untouched.
   * @param entry - the member.
   * @returns the effort id, when one applies.
   */
  defaultEffort(entry: QueueEntry): string | undefined {
    return this.effectiveConfig(entry).reasoning?.defaultEffort
  }

  /**
   * Read one member's overrides.
   * @param entry - the member.
   * @returns the overrides.
   */
  overridesOf(entry: QueueEntry): ModelConfigOverrides {
    return entry.overrides
  }

  /**
   * Aggregate the members' effective configurations into the facts the queue
   * route advertises.
   *
   * The aggregation itself lives in `model-config`, where it is a pure function
   * of the members' configurations and can be tested without a registry; this
   * method only supplies the per-member inputs. The effective configuration
   * already falls back to the snapshot a row captured, so a cold resolve cache
   * (a fresh boot, a page load before any request) still aggregates what dsh
   * last said instead of advertising nothing at all.
   * @returns the advertised configuration.
   */
  routeConfig(): ModelConfig {
    return aggregateRouteConfig(this.state().entries.map(entry => this.effectiveConfig(entry)))
  }

  /**
   * The same aggregation in the shape the adapter advertises, keeping the
   * fallback window so the route is never context-less.
   * @returns the advertised facts.
   */
  routeFacts(): RouteFacts {
    const config = this.routeConfig()
    return {
      inputModalities: config.inputModalities,
      contextWindow: config.contextWindow ?? FALLBACK_CONTEXT_WINDOW,
      ...config.maxTokens === undefined ? {} : { defaultMaxTokens: config.maxTokens },
      ...config.reasoning === undefined ? {} : { reasoning: config.reasoning },
    }
  }

  /**
   * Refresh the capability caches for every member whose facts are missing or
   * have expired, leaving the fresh ones alone.
   *
   * The browser polls the queue view, and a view cannot describe a row whose
   * facts it does not have. Re-resolving every member on every poll would hammer
   * the providers, so this only pays for the entries that actually went stale.
   * @returns when the stale members have been attempted.
   */
  async ensureFacts(): Promise<void> {
    await Promise.all(this.state().entries.map(entry => this.memberFacts(entry.provider, entry.model) === undefined
      ? this.resolveConfig(entry.provider, entry.model)
      : undefined))
  }

  /**
   * Refresh the reasoning-effort and capability caches for every member.
   * @returns when the refresh finished.
   */
  async refreshFacts(): Promise<void> {
    await this.warmFacts()
  }
}
