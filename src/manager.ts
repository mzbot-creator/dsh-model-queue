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
import { selectEntry, rotateFailed, markSucceeded, setEntries, setCooldown, clearCooldowns, sameConfig } from './queue.ts'
import type { EntryRequest, QueueEntry, QueueState, Selection } from './queue.ts'
import { classifyFailure } from './classify.ts'
import { normalizeCooldown } from './store.ts'
import type { QueueStore } from './store.ts'
import type {
  CatalogModel,
  CatalogView,
  ModelConfig,
  ModelModality,
  QueueEntryView,
  QueueView,
} from './contract.ts'
import { PROVIDER_ID, QUEUE_MODEL_ID, ROUTE_REASONING_EFFORTS } from './contract.ts'
import { UNKNOWN_CONFIG, aggregateRouteConfig, configFromListing, configFromResolved, isKnownConfig } from './model-config.ts'

/** What the queue route advertises to the loop, derived from the current members. */
export interface RouteFacts {
  readonly inputModalities: readonly ModelModality[]
  readonly contextWindow: number
  readonly defaultMaxTokens?: number | undefined
  readonly reasoning?: ModelConfig['reasoning']
}

/** Fallback context window when no member could be resolved; conservative on purpose. */
const FALLBACK_CONTEXT_WINDOW = 128_000

/**
 * One member resolution.
 *
 * A member's configuration is read from dsh at exactly two moments: when the row
 * is added, and when the user asks the page to sync. Nothing re-reads it on a
 * clock, because a model that has been configured does not change what it can
 * accept — and a background refresh that only runs while the page is open is
 * worse than none, since it makes the route's claims depend on who is looking.
 *
 * The answer is copied into the row itself and stands until the user syncs. The
 * queue holds no separate cache: the document is the memory, so a restart, a
 * page load and a request all see the same value, and there is no second copy
 * that could disagree with it.
 */
interface ResolvedFacts {
  /** The resolved facts, or `undefined` when the route never answered. */
  readonly value: ModelConfig | undefined
  /** Why the last resolution failed, for the catalog's diagnostics. */
  readonly error?: string
}

/** The mutable queue service the rest of the plugin talks to. */
export class QueueManager {
  /** Why the last resolution of `provider\u0000model` failed, for catalog diagnostics. */
  private readonly resolveErrors = new Map<string, string>()

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
   * A row that arrives without a configuration is resolved against its route
   * first, so the queue never stores a row it knows nothing about while the route
   * is answering. A reorder (an id that still names the same model) keeps the
   * stored configuration, so moving a row never silently resets it.
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
        // A reorder carries no configuration; the stored one stays authoritative,
        // and a resolve here would only cost a round trip.
        return entry
      }
      if (entry.config !== undefined) return entry
      const config = await this.resolveConfig(entry.provider, entry.model)
      return { ...entry, config: config ?? UNKNOWN_CONFIG }
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
   * This is the only path that refreshes capabilities after a row exists: the
   * plugin never polls dsh on its own, so a model reconfigured in dsh's own
   * settings is picked up when the user says so. The new value replaces the
   * row's configuration whole — the row is a copy of dsh's declaration, not a
   * delta from it, so there is nothing of the user's to preserve on top.
   * @returns whether any row's configuration changed.
   */
  async syncConfigs(): Promise<boolean> {
    const state = this.state()
    const updates = new Map<string, ModelConfig>()
    await Promise.all(state.entries.map(async (entry) => {
      const config = await this.resolveConfig(entry.provider, entry.model)
      if (config !== undefined) updates.set(entry.id, config)
    }))
    return this.persistConfigs(updates)
  }

  /**
   * Read the rows that carry no configuration at all.
   *
   * A row added through the page is resolved on the way in, but a row that
   * predates the configuration field (a document migrated from version 1) loaded
   * as an empty configuration. That is not a stale value to refresh on a clock —
   * it is a row nothing has ever been read for, and leaving it empty would make
   * the route advertise text-only until the user notices and presses sync. One
   * read per unread row, at boot, is the whole of it.
   * @returns when every unread row has been attempted.
   */
  async readUnresolvedRows(): Promise<void> {
    const unread = this.state().entries.filter(entry => !isKnownConfig(entry.config))
    if (unread.length === 0) return
    const updates = new Map<string, ModelConfig>()
    await Promise.all(unread.map(async (entry) => {
      const config = await this.resolveConfig(entry.provider, entry.model)
      if (config !== undefined) updates.set(entry.id, config)
    }))
    await this.persistConfigs(updates)
  }

  /**
   * Write resolved configurations into their rows.
   *
   * The stored configuration is the route's memory across a restart: with it, a
   * boot that cannot reach a provider still advertises what dsh last declared,
   * instead of withdrawing capabilities (images first) until someone opens the
   * plugin page. Only rows whose configuration actually differs are written, so
   * a routine refresh costs no disk traffic.
   * @param updates - resolved configurations keyed by entry id.
   * @returns whether the document changed.
   */
  private async persistConfigs(updates: ReadonlyMap<string, ModelConfig>): Promise<boolean> {
    if (updates.size === 0) return false
    let changed = false
    await this.enqueue((current) => {
      const entries = current.entries.map((entry) => {
        const config = updates.get(entry.id)
        if (config === undefined || sameConfig(entry.config, config)) return entry
        changed = true
        return { ...entry, config }
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
      return {
        id: entry.id,
        provider: entry.provider,
        model: entry.model,
        label: entry.label,
        cooldownUntil: entry.cooldownUntil,
        remainingMs: Math.max(0, entry.cooldownUntil - now),
        failures: entry.failures,
        ...entry.lastFailure === undefined ? {} : { lastFailure: entry.lastFailure },
        config: entry.config,
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
            : { resolveError: this.resolveErrors.get(`${provider.id}\u0000${model.id}`) ?? 'the route did not answer' },
        })
      }
    }
    return { models, failures }
  }

  /**
   * Read one member's complete configuration from dsh.
   *
   * Called when a row is added and when the user asks to sync — never on a timer.
   * This is a one-shot read: the answer is returned to the caller, which stores
   * it in the row. Nothing is cached here, because the row *is* the cache, and a
   * second copy could disagree with what the page shows.
   * @param provider - member provider route.
   * @param model - member model id.
   * @returns the resolved facts, or `undefined` when this resolution failed.
   */
  async resolveConfig(provider: string, model: string): Promise<ModelConfig | undefined> {
    const key = `${provider}\u0000${model}`
    try {
      const info = await this.llm.resolveModelInfo(provider, model)
      this.resolveErrors.delete(key)
      return configFromResolved(info)
    } catch (error: unknown) {
      this.resolveErrors.set(key, error instanceof Error ? error.message : String(error))
      return undefined
    }
  }

  /**
   * The configuration one member is dispatched with.
   * @param entry - the member.
   * @returns its stored configuration.
   */
  effectiveConfig(entry: QueueEntry): ModelConfig {
    return entry.config
  }

  /**
   * Whether a member accepts one reasoning effort.
   * @param entry - the member.
   * @param effort - the row-level level the adapter is about to forward.
   * @returns `true` when the member's configuration offers it.
   */
  supportsEffort(entry: QueueEntry, effort: string): boolean {
    return entry.config.reasoning?.efforts.some(level => level.id === effort) ?? false
  }

  /**
   * The reasoning level a member runs on when the caller names none it accepts.
   * @param entry - the member.
   * @returns the level id, or `undefined` when the member pins none.
   */
  defaultEffortOf(entry: QueueEntry): string | undefined {
    return entry.config.reasoning?.defaultEffort
  }

  /**
   * Aggregate the members' configurations into the facts the queue route
   * advertises.
   *
   * The aggregation itself lives in `model-config`, where it is a pure function
   * of the members' configurations and can be tested without a registry; this
   * method only supplies the per-member inputs. Each member's configuration is
   * stored, so a boot, a page load before any request and a cold provider all
   * aggregate what dsh last said instead of advertising nothing at all.
   *
   * Reasoning levels are the one exception: the adapter strips the level a call
   * names, so the route advertises the harness's whole vocabulary rather than
   * the members' intersection. The intersection would be a claim the route does
   * not honour — and a dangerous one, since the harness refuses a call whose
   * level the resolved model omits.
   * @returns the advertised configuration.
   */
  routeConfig(): ModelConfig {
    const aggregate = aggregateRouteConfig(this.state().entries.map(entry => this.effectiveConfig(entry)))
    return {
      ...aggregate,
      reasoning: { efforts: [...ROUTE_REASONING_EFFORTS] },
    }
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

}
