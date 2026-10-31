/**
 * Durable queue persistence.
 *
 * The queue must survive a host restart and be shared by every session and
 * browser, so it lives in one JSON document under the harness home. Writes are
 * atomic (write-temp-then-rename) because a half-written queue would silently
 * lose the user's order; reads tolerate a missing file, and a corrupt file is
 * quarantined instead of crashing the host.
 *
 * @module dsh-model-queue/store
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { DEFAULT_COOLDOWN_MS, EMPTY_QUEUE, MAX_COOLDOWN_MS } from './queue.ts'
import type { QueueEntry, QueueFailure, QueueState } from './queue.ts'
import type { ModelConfig, ModelConfigOverrides } from './contract.ts'
import { UNKNOWN_CONFIG, applyOverrides, parseOverrides, parseStoredConfig } from './model-config.ts'

/**
 * On-disk document version.
 *
 * Version 2 gave each entry a `snapshot` (what dsh reported) plus a sparse
 * `overrides` delta, and the effective configuration was the delta layered over
 * the snapshot. That layering made "not overridden" a state the page had to
 * show — the "follow dsh" option — which is a concept the queue does not want:
 * a member either accepts images or it does not.
 *
 * Version 3 therefore stores one complete configuration per entry. A version 2
 * document is migrated on read by applying its overrides to its snapshot, so an
 * existing queue survives the upgrade instead of being quarantined; a version 1
 * document (no configuration at all) loads as unread rows, as before.
 */
const FORMAT_VERSION = 3

/** A version 2 document: one complete configuration per row, stored sparsely. */
const OVERRIDES_FORMAT_VERSION = 2

/** The oldest version whose document this build can still read. */
const LEGACY_FORMAT_VERSION = 1

/** Maximum accepted entries, so a hostile or buggy client cannot grow the file without bound. */
export const MAX_ENTRIES = 64

/** Field length caps for values that reach the UI and the log. */
const MAX_IDENTIFIER = 200
const MAX_LABEL = 200

/** The document actually written to disk. */
interface StoredDocument {
  readonly version: number
  readonly revision: number
  readonly cooldownMs: number
  readonly entries: readonly QueueEntry[]
}

/**
 * Read one string field with a cap.
 * @param value - candidate value.
 * @param field - field name for diagnostics.
 * @param max - maximum accepted length.
 * @returns the value.
 * @throws {Error} when the value is not a non-empty bounded string.
 */
function requiredString(value: unknown, field: string, max = MAX_IDENTIFIER): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) {
    throw new Error(`${field} must be a non-empty string of at most ${max} characters`)
  }
  return value
}

/**
 * Validate one stored failure record.
 * @param value - candidate value.
 * @returns the record, or `undefined` when it is absent.
 * @throws {Error} when a present record is malformed.
 */
function optionalFailure(value: unknown): QueueFailure | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'object') throw new Error('lastFailure must be an object')
  const record = value as Record<string, unknown>
  const at = record.at
  if (typeof at !== 'number' || !Number.isFinite(at) || at < 0) {
    throw new Error('lastFailure.at must be a non-negative epoch millisecond value')
  }
  return {
    code: requiredString(record.code, 'lastFailure.code', 100),
    message: requiredString(record.message, 'lastFailure.message', 4000),
    at,
  }
}

/**
 * Validate one stored queue entry.
 * @param value - candidate value.
 * @param version - the document version the entry came from.
 * @returns the entry.
 * @throws {Error} when the entry is malformed.
 */
export function parseEntry(value: unknown, version: number = FORMAT_VERSION): QueueEntry {
  if (typeof value !== 'object' || value === null) throw new Error('each entry must be an object')
  const record = value as Record<string, unknown>
  const cooldownUntil = record.cooldownUntil ?? 0
  const failures = record.failures ?? 0
  if (typeof cooldownUntil !== 'number' || !Number.isFinite(cooldownUntil) || cooldownUntil < 0) {
    throw new Error('entry.cooldownUntil must be a non-negative epoch millisecond value')
  }
  if (typeof failures !== 'number' || !Number.isSafeInteger(failures) || failures < 0) {
    throw new Error('entry.failures must be a non-negative integer')
  }
  const lastFailure = optionalFailure(record.lastFailure)
  return {
    id: requiredString(record.id, 'entry.id'),
    provider: requiredString(record.provider, 'entry.provider'),
    model: requiredString(record.model, 'entry.model'),
    label: requiredString(record.label, 'entry.label', MAX_LABEL),
    config: readEntryConfig(record, version),
    cooldownUntil,
    ...lastFailure === undefined ? {} : { lastFailure },
    failures,
  }
}

/**
 * Read one entry's configuration, migrating a version 2 row on the way.
 *
 * A version 3 row carries the complete value directly. A version 2 row carries
 * a snapshot plus a sparse overrides delta, so the two are folded together here
 * — once, at load — instead of being layered on every read; that folding is
 * exactly what makes "not overridden" stop being a state the page can show.
 * @param record - the stored entry.
 * @param version - the document version the entry came from.
 * @returns the configuration to store.
 */
function readEntryConfig(record: Record<string, unknown>, version: number): ModelConfig {
  if (version !== OVERRIDES_FORMAT_VERSION) return parseStoredConfig(record.config) ?? UNKNOWN_CONFIG
  const snapshot = parseStoredConfig(record.snapshot) ?? UNKNOWN_CONFIG
  return applyOverrides(snapshot, parseStoredOverrides(record.overrides))
}

/**
 * Read a stored override record, rejecting values the routes would also reject.
 * @param value - candidate value from a version 2 document.
 * @returns the accepted overrides; empty when absent or unusable.
 */
function parseStoredOverrides(value: unknown): ModelConfigOverrides {
  try {
    return parseOverrides(value)
  } catch {
    // A hand-edited document must not take the whole queue down; the row falls
    // back to whatever its snapshot says, which is the safe default.
    return {}
  }
}

/**
 * Parse one whole document, rejecting anything this build cannot trust.
 * @param value - parsed JSON value.
 * @returns the queue state.
 * @throws {Error} when the document is malformed.
 */
export function parseDocument(value: unknown): QueueState {
  if (typeof value !== 'object' || value === null) throw new Error('the queue document must be an object')
  const record = value as Record<string, unknown>
  const version = record.version
  if (version !== FORMAT_VERSION && version !== OVERRIDES_FORMAT_VERSION && version !== LEGACY_FORMAT_VERSION) {
    throw new Error(`unsupported queue document version ${String(version)}; expected ${FORMAT_VERSION}`)
  }
  const revision = record.revision ?? 0
  if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0) {
    throw new Error('revision must be a non-negative integer')
  }
  const cooldownMs = record.cooldownMs ?? DEFAULT_COOLDOWN_MS
  if (typeof cooldownMs !== 'number' || !Number.isFinite(cooldownMs) || cooldownMs < 0) {
    throw new Error('cooldownMs must be a finite non-negative number')
  }
  if (!Array.isArray(record.entries)) throw new Error('entries must be an array')
  if (record.entries.length > MAX_ENTRIES) throw new Error(`entries may hold at most ${MAX_ENTRIES} models`)
  const entries = record.entries.map(entry => parseEntry(entry, version))
  const ids = new Set(entries.map(entry => entry.id))
  if (ids.size !== entries.length) throw new Error('entry ids must be unique')
  return { revision, cooldownMs: Math.min(cooldownMs, MAX_COOLDOWN_MS), entries }
}

/**
 * Normalize one cooldown value into the accepted range.
 * @param value - configured cooldown in milliseconds.
 * @returns the bounded cooldown.
 * @throws {Error} when the value is not a finite non-negative number.
 */
export function normalizeCooldown(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > MAX_COOLDOWN_MS) {
    throw new Error(`cooldownMs must be a finite number from 0 through ${MAX_COOLDOWN_MS}`)
  }
  return value
}

/**
 * The stored document plus the serialized state.
 */
export interface PersistedQueue {
  readonly state: QueueState
}

/**
 * One queue document on disk, with atomic replacement and quarantine on corruption.
 */
export class QueueStore {
  /** The queue is read once at activation and written after each accepted mutation. */
  private state: QueueState = EMPTY_QUEUE

  /** Serializes writes so two mutations cannot interleave their file renames. */
  private writeChain: Promise<void> = Promise.resolve()

  private readonly path: string

  private readonly logger: { warn(message: string): void }

  /**
   * @param path - absolute path of the JSON document.
   * @param logger - reporter for a corrupt document, so the user learns why their queue reset.
   */
  constructor(path: string, logger: { warn(message: string): void }) {
    this.path = path
    this.logger = logger
  }

  /**
   * The absolute path this store owns.
   * @returns the document path.
   */
  get file(): string {
    return this.path
  }

  /**
   * Load the document, treating absence as an empty queue.
   * @returns the loaded state.
   */
  async load(): Promise<QueueState> {
    let text: string
    try {
      text = await readFile(this.path, 'utf8')
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.state = EMPTY_QUEUE
        return this.state
      }
      throw error
    }
    try {
      this.state = parseDocument(JSON.parse(text) as unknown)
    } catch (error: unknown) {
      // Quarantine rather than overwrite: the damaged file is the only copy of
      // the user's order, and a bug in this plugin must not destroy it silently.
      const quarantine = `${this.path}.corrupt-${Date.now()}`
      try {
        await rename(this.path, quarantine)
      } catch {
        /* best effort: reporting the parse failure matters more than the rename */
      }
      this.logger.warn(
        `model-queue: the queue document could not be read (${error instanceof Error ? error.message : String(error)}); `
        + `starting from an empty queue. The previous file was kept at ${quarantine}.`,
      )
      this.state = EMPTY_QUEUE
    }
    return this.state
  }

  /**
   * Read the current state.
   * @returns the queue state.
   */
  current(): QueueState {
    return this.state
  }

  /**
   * Replace the state and persist it.
   *
   * Persistence is serialized and awaited by the caller, so an answer sent to
   * the browser never claims a state that has not reached the disk.
   * @param next - the new state.
   * @returns when the new state is durable.
   */
  async commit(next: QueueState): Promise<void> {
    this.state = next
    const document: StoredDocument = {
      version: FORMAT_VERSION,
      revision: next.revision,
      cooldownMs: next.cooldownMs,
      entries: next.entries,
    }
    const text = `${JSON.stringify(document, null, 2)}\n`
    const write = this.writeChain.then(async () => {
      await mkdir(dirname(this.path), { recursive: true })
      const temporary = `${this.path}.tmp-${process.pid}-${Date.now()}`
      await writeFile(temporary, text, { encoding: 'utf8', mode: 0o600 })
      await rename(temporary, this.path)
    })
    // A rejected write must not poison the chain for the next mutation; the
    // caller still observes the rejection.
    this.writeChain = write.catch(() => {})
    await write
  }
}

/**
 * Resolve the queue document path inside the harness home.
 * @param home - resolved harness home.
 * @returns the absolute path of the queue document.
 */
export function queuePathIn(home: string): string {
  return join(home, 'model-queue', 'queue.json')
}
