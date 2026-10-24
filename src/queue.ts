/**
 * The queue state machine: one ordered list of model entries, shared by every
 * session and every browser of this host.
 *
 * Everything here is a pure function of (state, action, now), so the host
 * service, the tests and the UI projection agree without sharing a clock or a
 * lock. Nothing in this module reads `Date.now()` on its own.
 *
 * @module dsh-model-queue/queue
 */

/** One model in the queue: a provider route plus a model id on that route. */
export interface QueueEntry {
  /** Stable local id. Survives rotation; never reused. */
  readonly id: string
  /** Provider route name registered with the host's `ctx.llm`. */
  readonly provider: string
  /** Exact model id passed as `GenerateOptions.model`. */
  readonly model: string
  /** Label captured when the entry was added, so the queue still reads well when a route is offline. */
  readonly label: string
  /** Epoch milliseconds before which the queue will not select this entry; `0` means ready. */
  readonly cooldownUntil: number
  /** Why the entry last entered cooldown; absent for an entry that never failed. */
  readonly lastFailure?: QueueFailure | undefined
  /** How many times this entry has been rotated to the tail since it was added. */
  readonly failures: number
}

/** The failure that sent an entry to the tail. */
export interface QueueFailure {
  /** Stable machine code from the LLM failure (`RATE_LIMIT`, `QUOTA`, ...). */
  readonly code: string
  /** Human-readable reason, shown verbatim in the UI. */
  readonly message: string
  /** Epoch milliseconds when the failure was observed. */
  readonly at: number
}

/** The persisted queue document. */
export interface QueueState {
  /** Monotonic revision, bumped on every accepted mutation. */
  readonly revision: number
  /** Entries in priority order; the head is tried first. */
  readonly entries: readonly QueueEntry[]
  /** Cooldown applied to an entry that fails, in milliseconds. `0` still rotates, without waiting. */
  readonly cooldownMs: number
}

/** One entry requested by the queue editor. */
export interface EntryRequest {
  /** Existing entry id when the row came from the current queue. */
  readonly id?: string
  /** Provider route. */
  readonly provider: string
  /** Exact model id. */
  readonly model: string
  /** Optional display label; defaults to `provider/model`. */
  readonly label?: string
}

/** Result of asking the queue which entry a request should start from. */
export type Selection =
  | { readonly kind: 'entry'; readonly entry: QueueEntry }
  | {
    /** Every entry is cooling down; `failure` is the most recent reason. */
    readonly kind: 'exhausted'
    /** The latest failure among cooling entries, if any entry has ever failed. */
    readonly failure: QueueFailure | undefined
    /** Earliest moment any entry becomes selectable again. */
    readonly retryAt: number | undefined
  }
  | { readonly kind: 'empty' }

/** Default cooldown: one hour, as specified. */
export const DEFAULT_COOLDOWN_MS = 60 * 60 * 1000

/** Cooldown cap: one year. Finite, so a queued entry is never permanently dead. */
export const MAX_COOLDOWN_MS = 365 * 24 * 60 * 60 * 1000

/** The document written to disk when nothing has been configured yet. */
export const EMPTY_QUEUE: QueueState = Object.freeze({
  revision: 0,
  entries: Object.freeze([]) as readonly QueueEntry[],
  cooldownMs: DEFAULT_COOLDOWN_MS,
})

/**
 * Read the selection point of one state.
 *
 * An entry is selectable when its cooldown has elapsed (`cooldownUntil <= now`).
 * The head of the list is tried first, so the first selectable entry in list
 * order wins — that is what makes a rotation visible: a failed entry moves to
 * the tail, so the next request naturally starts from the following entry.
 * @param state - current queue state.
 * @param now - epoch milliseconds used to decide cooldown expiry.
 * @returns the entry to try, why nothing can be tried, or that the queue is empty.
 */
export function selectEntry(state: QueueState, now: number): Selection {
  if (state.entries.length === 0) return { kind: 'empty' }
  for (const entry of state.entries) {
    if (entry.cooldownUntil <= now) return { kind: 'entry', entry }
  }
  let latest: QueueFailure | undefined
  let retryAt: number | undefined
  for (const entry of state.entries) {
    if (entry.lastFailure !== undefined && (latest === undefined || entry.lastFailure.at > latest.at)) {
      latest = entry.lastFailure
    }
    if (retryAt === undefined || entry.cooldownUntil < retryAt) retryAt = entry.cooldownUntil
  }
  return { kind: 'exhausted', failure: latest, retryAt }
}

/**
 * Rotate a failed entry to the tail and start its cooldown.
 *
 * Rotation is keyed by entry id, not position: a concurrent request may have
 * rotated a different entry in between, and the failure must still apply to the
 * entry that actually failed. An entry that already recorded this failure (or a
 * later one) is not rotated twice, so the reason and cooldown start stay
 * truthful when two callers race on the same attempt.
 * @param state - current queue state.
 * @param id - id of the entry that failed.
 * @param failure - the reason, without its timestamp.
 * @param now - epoch milliseconds of the failure.
 * @returns the next state; the same object when nothing changed.
 */
export function rotateFailed(
  state: QueueState,
  id: string,
  failure: Omit<QueueFailure, 'at'>,
  now: number,
): QueueState {
  const index = state.entries.findIndex(entry => entry.id === id)
  if (index < 0) return state
  const entry = state.entries[index] as QueueEntry
  if (entry.lastFailure !== undefined && entry.lastFailure.at >= now) return state
  const rotated: QueueEntry = {
    ...entry,
    cooldownUntil: now + state.cooldownMs,
    lastFailure: { code: failure.code, message: failure.message, at: now },
    failures: entry.failures + 1,
  }
  const entries = [...state.entries]
  entries.splice(index, 1)
  // A zero cooldown still moves the entry to the tail, so rotation stays an
  // ordered operation even when the user disables waiting.
  entries.push(rotated)
  return { ...state, revision: state.revision + 1, entries }
}

/**
 * Mark an entry as used successfully without moving it.
 *
 * A success proves the entry is healthy, so it leaves cooldown and forgets its
 * last failure. It does not reorder the queue: the user's order is the order,
 * and silently promoting an entry would make the list jump under them.
 * @param state - current queue state.
 * @param id - id of the entry that succeeded.
 * @returns the next state; the same object when nothing changed.
 */
export function markSucceeded(state: QueueState, id: string): QueueState {
  const index = state.entries.findIndex(entry => entry.id === id)
  if (index < 0) return state
  const entry = state.entries[index] as QueueEntry
  if (entry.cooldownUntil === 0 && entry.lastFailure === undefined) return state
  const entries = [...state.entries]
  entries[index] = { ...entry, cooldownUntil: 0, lastFailure: undefined }
  return { ...state, revision: state.revision + 1, entries }
}

/**
 * Replace the queue with a user-supplied ordered list.
 *
 * Entries are matched by id where possible so a reorder keeps cooldown and
 * failure history. Ids the caller omits are removed; new rows are assigned the
 * supplied ids and start ready.
 * @param state - current queue state.
 * @param next - the requested entries in the requested order.
 * @param ids - ids assigned to entries that do not carry one yet.
 * @returns the next state; the same object when the list is unchanged.
 */
export function setEntries(
  state: QueueState,
  next: readonly EntryRequest[],
  ids: readonly string[],
): QueueState {
  const byId = new Map(state.entries.map(entry => [entry.id, entry]))
  const entries: QueueEntry[] = []
  const seen = new Set<string>()
  next.forEach((wanted, index) => {
    const id = wanted.id !== undefined && wanted.id !== '' ? wanted.id : ids[index]
    if (id === undefined || seen.has(id)) return
    seen.add(id)
    const existing = byId.get(id)
    // A row that omits the label keeps the one the entry already carries: the
    // UI sends only ids and order for a reorder, and a default label would be a
    // silent downgrade of a stored display name.
    const label = wanted.label !== undefined && wanted.label !== ''
      ? wanted.label
      : existing?.label ?? `${wanted.provider}/${wanted.model}`
    if (existing !== undefined && existing.provider === wanted.provider && existing.model === wanted.model) {
      entries.push({ ...existing, label })
      return
    }
    entries.push({
      id,
      provider: wanted.provider,
      model: wanted.model,
      label,
      cooldownUntil: existing?.cooldownUntil ?? 0,
      ...existing?.lastFailure === undefined ? {} : { lastFailure: existing.lastFailure },
      failures: existing?.failures ?? 0,
    })
  })
  if (sameEntries(state.entries, entries)) return state
  return { ...state, revision: state.revision + 1, entries }
}

/**
 * Change the cooldown applied to future failures.
 * @param state - current queue state.
 * @param cooldownMs - duration in milliseconds, already validated.
 * @returns the next state; the same object when the value is unchanged.
 */
export function setCooldown(state: QueueState, cooldownMs: number): QueueState {
  if (state.cooldownMs === cooldownMs) return state
  return { ...state, revision: state.revision + 1, cooldownMs }
}

/**
 * Clear every cooldown, keeping order and failure counts.
 * @param state - current queue state.
 * @returns the next state; the same object when nothing was cooling down.
 */
export function clearCooldowns(state: QueueState): QueueState {
  if (state.entries.every(entry => entry.cooldownUntil === 0)) return state
  return {
    ...state,
    revision: state.revision + 1,
    entries: state.entries.map(entry => ({ ...entry, cooldownUntil: 0 })),
  }
}

/**
 * Compare two entry lists for structural equality.
 * @param left - first list.
 * @param right - second list.
 * @returns whether both lists carry the same entries in the same order and state.
 */
function sameEntries(left: readonly QueueEntry[], right: readonly QueueEntry[]): boolean {
  if (left.length !== right.length) return false
  return left.every((entry, index) => {
    const other = right[index]
    return other !== undefined
      && entry.id === other.id
      && entry.provider === other.provider
      && entry.model === other.model
      && entry.label === other.label
      && entry.cooldownUntil === other.cooldownUntil
      && entry.failures === other.failures
      && entry.lastFailure?.at === other.lastFailure?.at
      && entry.lastFailure?.code === other.lastFailure?.code
      && entry.lastFailure?.message === other.lastFailure?.message
  })
}
