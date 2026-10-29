/**
 * The model-config vocabulary: turning what the harness resolves into the
 * plugin's own record, applying a row's overrides, and validating whatever a
 * browser sends back.
 *
 * Everything here is pure, so the host, the routes and the tests agree on what
 * "this row is configured as" means without a live registry in hand.
 *
 * @module dsh-model-queue/model-config
 */

import type { LlmResolvedModelInfo } from '@deepseek-ai/dsh-llm'
import type {
  ModelConfig,
  ModelConfigOverrides,
  ModelModality,
  ModelReasoning,
  ModelReasoningEffort,
} from './contract.ts'

/** Field caps for values that reach the UI, the log and the JSON document. */
const MAX_EFFORT_ID = 200
const MAX_EFFORT_NAME = 200
const MAX_MODALITIES = 4

/** The configuration of a model nothing is known about. */
export const UNKNOWN_CONFIG: ModelConfig = Object.freeze({ inputModalities: [] as readonly ModelModality[] })

/**
 * Detach and normalize the modalities a route declared.
 *
 * The harness treats an absent list as "unknown", and every request carries
 * text, so text is added when a route names capabilities at all but forgets it.
 * @param value - modalities as reported, possibly absent or containing unknowns.
 * @returns a fresh, de-duplicated list.
 */
function normalizeModalities(value: readonly string[] | undefined): readonly ModelModality[] {
  if (value === undefined) return []
  const out: ModelModality[] = []
  for (const entry of value) {
    if (entry !== 'text' && entry !== 'image') continue
    if (!out.includes(entry)) out.push(entry)
  }
  if (out.length > 0 && !out.includes('text')) out.unshift('text')
  return out
}

/**
 * Detach the reasoning levels a route declared.
 * @param reasoning - the resolved reasoning block, when the model has one.
 * @returns a fresh level list, or `undefined` when the model offers no choice.
 */
function normalizeReasoning(reasoning: LlmResolvedModelInfo['reasoning']): ModelReasoning | undefined {
  if (reasoning === undefined || reasoning.efforts.length === 0) return undefined
  const efforts: ModelReasoningEffort[] = reasoning.efforts.map(effort => ({
    id: effort.id,
    name: effort.name,
    ...effort.description === undefined ? {} : { description: effort.description },
  }))
  return {
    efforts,
    ...reasoning.defaultEffort === undefined ? {} : { defaultEffort: reasoning.defaultEffort },
  }
}

/**
 * Read one model's complete configuration out of what the harness resolved.
 * @param info - the result of `ctx.llm.resolveModelInfo()`.
 * @returns the plugin's detached record of the same facts.
 */
export function configFromResolved(info: LlmResolvedModelInfo): ModelConfig {
  const reasoning = normalizeReasoning(info.reasoning)
  return {
    inputModalities: normalizeModalities(info.inputModalities),
    ...info.context === undefined ? {} : { contextWindow: info.context.contextWindow },
    ...info.defaultMaxTokens === undefined ? {} : { maxTokens: info.defaultMaxTokens },
    ...reasoning === undefined ? {} : { reasoning },
  }
}

/**
 * The configuration a bare catalog listing can state, when full resolution is
 * impossible. A listing carries a name and modalities but no capacities.
 * @param info - one entry from `ctx.llm.listModels()`.
 * @returns the minimal configuration it declares.
 */
export function configFromListing(info: { readonly inputModalities?: readonly string[] }): ModelConfig {
  return { inputModalities: normalizeModalities(info.inputModalities) }
}

/**
 * Whether a value is a usable capacity: a positive safe integer.
 * @param value - candidate value.
 * @returns whether the harness would accept it as a window or an output cap.
 */
export function isCapacity(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

/**
 * Apply one row's overrides over the facts its route reported.
 *
 * The result is what the queue advertises and what a dispatch is planned
 * against, so it is also what the user sees under "effective". An override that
 * names a reasoning level the model does not offer is dropped rather than
 * forwarded: forwarding it would make every request on that member fail with
 * `UNSUPPORTED_REASONING_EFFORT`.
 * @param base - the resolved facts, or the empty configuration when unknown.
 * @param overrides - the row's explicit departures.
 * @returns the effective configuration.
 */
export function applyOverrides(base: ModelConfig, overrides: ModelConfigOverrides): ModelConfig {
  const inputModalities = overrides.inputModalities === undefined
    ? base.inputModalities
    : normalizeModalities(overrides.inputModalities)
  const contextWindow = overrides.contextWindow ?? base.contextWindow
  const maxTokens = overrides.maxTokens ?? base.maxTokens
  const reasoning = base.reasoning === undefined
    ? undefined
    : overrides.reasoningEffort !== undefined
      && base.reasoning.efforts.some(effort => effort.id === overrides.reasoningEffort)
      // The override is the default this member uses; it never removes the
      // levels the model offers, because a caller may still name one.
      ? { ...base.reasoning, defaultEffort: overrides.reasoningEffort }
      : base.reasoning
  return {
    inputModalities,
    ...contextWindow === undefined ? {} : { contextWindow },
    ...maxTokens === undefined ? {} : { maxTokens },
    ...reasoning === undefined ? {} : { reasoning },
  }
}

/**
 * Read a bounded string, or `undefined` when the value is not usable.
 * @param value - candidate value.
 * @param max - maximum accepted length.
 * @returns the string, or `undefined`.
 */
function boundedString(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (trimmed === '' || trimmed.length > max) return undefined
  return trimmed
}

/**
 * Validate one optional-modality list from the wire.
 * @param value - candidate value.
 * @returns the list, or `undefined` when it is absent.
 * @throws {Error} when it is present but not a list of known modalities.
 */
function readModalities(value: unknown): readonly ModelModality[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw new Error('`inputModalities` must be an array')
  if (value.length > MAX_MODALITIES) throw new Error(`\`inputModalities\` may hold at most ${MAX_MODALITIES} entries`)
  const out: ModelModality[] = []
  for (const entry of value) {
    if (entry !== 'text' && entry !== 'image') {
      throw new Error(`\`inputModalities\` entries must be "text" or "image", not ${JSON.stringify(entry)}`)
    }
    if (!out.includes(entry)) out.push(entry)
  }
  if (out.length === 0) throw new Error('`inputModalities` must name at least one modality')
  return out
}

/**
 * Read one optional capacity from the wire.
 * @param value - candidate value.
 * @param field - field name for the error message.
 * @returns the capacity, or `undefined` when absent.
 * @throws {Error} when it is present but not a positive safe integer.
 */
function readCapacity(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined
  if (!isCapacity(value)) throw new Error(`\`${field}\` must be a positive whole number of tokens`)
  return value
}

/**
 * Validate the overrides of one entries row, dropping nothing silently.
 * @param value - candidate value from the request body.
 * @returns the accepted overrides; an empty object when none were sent.
 * @throws {Error} naming the first field the harness would refuse.
 */
export function parseOverrides(value: unknown): ModelConfigOverrides {
  if (value === undefined || value === null) return {}
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('`overrides` must be an object')
  const record = value as Record<string, unknown>
  const inputModalities = readModalities(record.inputModalities)
  const contextWindow = readCapacity(record.contextWindow, 'contextWindow')
  const maxTokens = readCapacity(record.maxTokens, 'maxTokens')
  const reasoningEffort = record.reasoningEffort === undefined
    ? undefined
    : boundedString(record.reasoningEffort, MAX_EFFORT_ID)
  if (record.reasoningEffort !== undefined && reasoningEffort === undefined) {
    throw new Error(`\`reasoningEffort\` must be a non-empty string of at most ${MAX_EFFORT_ID} characters`)
  }
  return {
    ...inputModalities === undefined ? {} : { inputModalities },
    ...contextWindow === undefined ? {} : { contextWindow },
    ...maxTokens === undefined ? {} : { maxTokens },
    ...reasoningEffort === undefined ? {} : { reasoningEffort },
  }
}

/**
 * Whether a row carries any departure at all.
 * @param overrides - the row's overrides.
 * @returns whether at least one field is set.
 */
export function hasOverrides(overrides: ModelConfigOverrides): boolean {
  return overrides.inputModalities !== undefined
    || overrides.contextWindow !== undefined
    || overrides.maxTokens !== undefined
    || overrides.reasoningEffort !== undefined
}

/**
 * Validate one already-resolved configuration read back from the document.
 *
 * The document is written by this plugin, but it lives on disk where a hand
 * edit or an older build can leave a shape the current build would not produce,
 * so every field is re-checked rather than trusted.
 * @param value - candidate value.
 * @returns the configuration, or `undefined` when it is not usable.
 */
export function parseStoredConfig(value: unknown): ModelConfig | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const inputModalities = Array.isArray(record.inputModalities)
    ? record.inputModalities.filter((entry): entry is ModelModality => entry === 'text' || entry === 'image')
    : []
  const contextWindow = isCapacity(record.contextWindow) ? record.contextWindow : undefined
  const maxTokens = isCapacity(record.maxTokens) ? record.maxTokens : undefined
  const reasoning = parseStoredReasoning(record.reasoning)
  return {
    inputModalities: normalizeModalities(inputModalities),
    ...contextWindow === undefined ? {} : { contextWindow },
    ...maxTokens === undefined ? {} : { maxTokens },
    ...reasoning === undefined ? {} : { reasoning },
  }
}

/**
 * Read a stored reasoning block back, dropping unusable efforts.
 * @param value - candidate value.
 * @returns the block, or `undefined` when no usable level is left.
 */
function parseStoredReasoning(value: unknown): ModelReasoning | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const raw = Array.isArray(record.efforts) ? record.efforts : []
  const seen = new Set<string>()
  const efforts: ModelReasoningEffort[] = []
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue
    const effort = entry as Record<string, unknown>
    const id = boundedString(effort.id, MAX_EFFORT_ID)
    const name = boundedString(effort.name, MAX_EFFORT_NAME)
    if (id === undefined || name === undefined || seen.has(id)) continue
    seen.add(id)
    const description = boundedString(effort.description, MAX_EFFORT_NAME)
    efforts.push({ id, name, ...description === undefined ? {} : { description } })
  }
  if (efforts.length === 0) return undefined
  const defaultEffort = boundedString(record.defaultEffort, MAX_EFFORT_ID)
  return {
    efforts,
    ...defaultEffort === undefined || !seen.has(defaultEffort) ? {} : { defaultEffort },
  }
}

/**
 * Aggregate the members' effective configurations into the facts the queue
 * route advertises.
 *
 * The queue appears in the picker as one model, so it has to publish a single
 * set of capabilities. Each one is the *intersection* of its members, because a
 * rotation may land on any of them:
 *
 * - images only when every member accepts them;
 * - the context window and output cap of the smallest member.
 *
 * A member nothing is known about (`UNKNOWN_CONFIG`) makes the whole route
 * conservative rather than optimistic, for the same reason.
 *
 * Reasoning levels are deliberately *not* aggregated here. The route ignores the
 * level a call names, so it advertises the harness vocabulary itself; the manager
 * attaches that set. Intersecting here would publish a set that narrows whenever
 * a member's facts go stale, and the harness refuses a call whose level the
 * resolved model omits — a failure over a value the route never uses.
 * @param configs - each member's effective configuration, in queue order.
 * @returns the advertised configuration; text-only and capacity-free when empty.
 */
export function aggregateRouteConfig(configs: readonly ModelConfig[]): ModelConfig {
  let contextWindow = Number.POSITIVE_INFINITY
  let maxTokens = Number.POSITIVE_INFINITY
  let images = configs.length > 0
  let known = 0
  for (const config of configs) {
    if (config.inputModalities.length === 0 && config.contextWindow === undefined) {
      images = false
      continue
    }
    known += 1
    contextWindow = Math.min(contextWindow, config.contextWindow ?? Number.POSITIVE_INFINITY)
    maxTokens = Math.min(maxTokens, config.maxTokens ?? Number.POSITIVE_INFINITY)
    if (!config.inputModalities.includes('image')) images = false
  }
  return {
    inputModalities: images && known > 0 ? ['text', 'image'] : ['text'],
    ...Number.isFinite(contextWindow) ? { contextWindow } : {},
    ...Number.isFinite(maxTokens) ? { maxTokens } : {},
  }
}
