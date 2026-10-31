/**
 * Stable identifiers and the wire vocabulary shared by the host and the Web
 * client. Both faces import these declarations, so a field cannot mean two
 * different things in the queue API and its UI.
 *
 * The model vocabulary mirrors the harness's own (`LlmResolvedModelInfo`) on
 * purpose: a queue member must be configured with the same facts the harness
 * would report for a direct route, so the two are interchangeable at the picker.
 *
 * @module dsh-model-queue/contract
 */

/** npm package name; also the client-bundle id and the plugin page key. */
export const PACKAGE_NAME = 'dsh-model-queue'

/** Loader row id in `cordis.patch.yml`; also the profile entry id. */
export const PROFILE_ENTRY_ID = 'model-queue'

/** Provider route this plugin registers with the host LLM registry. */
export const PROVIDER_ID = 'dsh-model-queue'

/** The one model id that route advertises. */
export const QUEUE_MODEL_ID = 'queue'

/** Provider and model label shown in the model picker. */
export const QUEUE_MODEL_NAME = 'Model Queue'

/** Root path of the browser-facing API, below the host's `/api` channel. */
export const QUEUE_ROUTE = '/api/dsh-model-queue'

/** Request modalities a model may accept; the same two the harness itself uses. */
export type ModelModality = 'text' | 'image'

/**
 * One reasoning level a model offers.
 *
 * `id` is the value the harness sends as `GenerateOptions.reasoningEffort`;
 * `name` is what the picker shows.
 */
export interface ModelReasoningEffort {
  readonly id: string
  readonly name: string
  readonly description?: string
}

/** The reasoning levels one model offers, least to greatest effort. */
export interface ModelReasoning {
  readonly efforts: readonly ModelReasoningEffort[]
  /** The level the adapter applies when a caller names none; absent means the provider's own default. */
  readonly defaultEffort?: string
}

/**
 * Every reasoning level the harness vocabulary defines, least to greatest.
 *
 * The queue route advertises this whole set instead of the intersection of its
 * members. The route does not *use* a level: a dispatch drops whatever level
 * the caller named and lets each member run on its own (or on the level its row
 * pins). Advertising the full set is therefore the honest, stable answer, and
 * it is also the safe one — the harness rejects a call whose level the route
 * does not offer, so a route that narrowed its set would fail a request that
 * still carries a level some earlier selection stored.
 */
export const ROUTE_REASONING_EFFORTS: readonly ModelReasoningEffort[] = Object.freeze([
  { id: 'off', name: 'Off' },
  { id: 'minimal', name: 'Minimal' },
  { id: 'low', name: 'Low' },
  { id: 'medium', name: 'Medium' },
  { id: 'high', name: 'High' },
  { id: 'xhigh', name: 'Xhigh' },
  { id: 'max', name: 'Max' },
])

/**
 * The complete configuration of one model, exactly as the harness resolves it.
 *
 * This is deliberately the harness's own vocabulary rather than a private copy:
 * the queue must advertise what `ctx.llm.resolveModelInfo()` reported, or the
 * session would plan a request against facts the member does not have.
 */
export interface ModelConfig {
  /** Accepted request modalities: whether the model can read images. */
  readonly inputModalities: readonly ModelModality[]
  /** Maximum combined request and response tokens, when the model declares one. */
  readonly contextWindow?: number
  /** Per-request output cap, when the model declares one. */
  readonly maxTokens?: number
  /** Selectable reasoning levels, when the model declares any. */
  readonly reasoning?: ModelReasoning
}

/**
 * A sparse configuration delta, used only to read a version 2 document.
 *
 * Version 3 stores one complete {@link ModelConfig} per row instead: a member's
 * configuration is copied from dsh once and then stands, so nothing is layered
 * at read time any more. This type survives solely so an existing queue can be
 * migrated instead of quarantined.
 */
export interface ModelConfigOverrides {
  /** Replace the model's own modality list (for example to stop sending images to it). */
  readonly inputModalities?: readonly ModelModality[]
  /** Replace the context window the queue advertises for this member. */
  readonly contextWindow?: number
  /** Replace the per-request output cap. */
  readonly maxTokens?: number
  /** The reasoning level this member should use when the caller names none it accepts. */
  readonly reasoningEffort?: string
}

/** One queue member as the browser sees it. */
export interface QueueEntryView {
  readonly id: string
  readonly provider: string
  readonly model: string
  readonly label: string
  /** Epoch milliseconds; `0` means ready. */
  readonly cooldownUntil: number
  /** Milliseconds left in cooldown at the moment the view was produced; `0` when ready. */
  readonly remainingMs: number
  readonly failures: number
  readonly lastFailure?: {
    readonly code: string
    readonly message: string
    readonly at: number
  }
  /**
   * The configuration this member is dispatched with.
   *
   * One complete value, copied from dsh when the row was added and replaced
   * wholesale when the user edits it or syncs. There is no layering and no
   * "follow dsh" state: image support is either on or off.
   */
  readonly config: ModelConfig
}

/** The whole observable queue, plus whether a request would succeed right now. */
export interface QueueView {
  readonly revision: number
  readonly cooldownMs: number
  /** Host clock at view generation, so a browser can render countdowns without trusting its own clock. */
  readonly now: number
  readonly provider: string
  readonly model: string
  readonly entries: readonly QueueEntryView[]
  /** Id of the entry a request would start from now; `null` while every entry cools down. */
  readonly head: string | null
  /** Whether every configured entry is currently cooling down. */
  readonly exhausted: boolean
  /** The facts the queue route advertises to the harness, aggregated over every member. */
  readonly route: ModelConfig
  /** Why the queue cannot serve a request right now, when it cannot. */
  readonly failure?: {
    readonly code: string
    readonly message: string
    readonly at: number
  }
}

/** One model the host can route to, offered to the queue editor. */
export interface CatalogModel {
  readonly provider: string
  readonly providerName: string
  readonly model: string
  readonly name: string
  readonly description?: string
  /**
   * The complete configuration the harness resolves for this model.
   *
   * Resolution needs the provider to answer, so a route that is configured but
   * currently unreachable contributes the model with `resolved: false` and a
   * `config` holding only what the catalog itself stated.
   */
  readonly config: ModelConfig
  /** Whether {@link CatalogModel.config} came from a full model resolution rather than the bare listing. */
  readonly resolved: boolean
  /** Why the full resolution failed, when it did. */
  readonly resolveError?: string
}

/** The routable catalog, with per-provider diagnostics instead of a hard failure. */
export interface CatalogView {
  readonly models: readonly CatalogModel[]
  readonly failures: readonly { readonly provider: string, readonly message: string }[]
}

/** One row of the entries mutation, with the configuration to store for it. */
export interface EntryRequestView {
  readonly id?: string
  readonly provider: string
  readonly model: string
  readonly label?: string
  /** The complete configuration to store for this row; omitted on a reorder keeps the stored one. */
  readonly config?: ModelConfig
}

/** Body of the entries mutation. */
export interface SetEntriesRequest {
  readonly entries: readonly EntryRequestView[]
}

/** Body of the cooldown mutation. */
export interface SetCooldownRequest {
  readonly cooldownMs: number
}

/** Error envelope every route answers with on a rejected request. */
export interface QueueApiError {
  readonly error: {
    readonly code: string
    readonly message: string
  }
}
