/**
 * Stable identifiers and the wire vocabulary shared by the host and the Web
 * client. Both faces import these declarations, so a field cannot mean two
 * different things in the queue API and its UI.
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
}

/** The routable catalog, with per-provider diagnostics instead of a hard failure. */
export interface CatalogView {
  readonly models: readonly CatalogModel[]
  readonly failures: readonly { readonly provider: string, readonly message: string }[]
}

/** Body of the entries mutation. */
export interface SetEntriesRequest {
  readonly entries: readonly {
    readonly id?: string
    readonly provider: string
    readonly model: string
    readonly label?: string
  }[]
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
