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

/** A queue row's explicit departures from what the harness reports. */
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
  /** What the harness currently reports for this model; absent when the route cannot be resolved. */
  readonly resolved?: ModelConfig
  /** What the harness reported when the row was added, shown when the route is currently offline. */
  readonly snapshot?: ModelConfig
  /** The row's explicit overrides. */
  readonly overrides: ModelConfigOverrides
  /** The configuration the queue actually uses: overrides applied over the resolved facts. */
  readonly effective: ModelConfig
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

/** One row of the entries mutation, with its configuration overrides. */
export interface EntryRequestView {
  readonly id?: string
  readonly provider: string
  readonly model: string
  readonly label?: string
  readonly overrides?: ModelConfigOverrides
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
