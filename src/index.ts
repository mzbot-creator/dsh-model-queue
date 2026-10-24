/**
 * Host entry point: owns the queue document, registers the queue route and the
 * browser API.
 *
 * The plugin is inert until at least one model is queued: an empty queue would
 * otherwise offer a model choice that can only fail. The route stays registered
 * either way, so the settings page can always add the first member.
 *
 * @module dsh-model-queue
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { QueueAdapter } from './adapter.ts'
import { QueueManager } from './manager.ts'
import { registerRoutes } from './routes.ts'
import { QueueStore, normalizeCooldown, queuePathIn } from './store.ts'
import { DEFAULT_COOLDOWN_MS, MAX_COOLDOWN_MS, selectEntry } from './queue.ts'
import { PROFILE_ENTRY_ID, PROVIDER_ID, QUEUE_MODEL_ID } from './contract.ts'

export { QUEUE_MODEL_ID, PROVIDER_ID, PROFILE_ENTRY_ID, PACKAGE_NAME } from './contract.ts'
export { QueueAdapter } from './adapter.ts'
export { QueueManager } from './manager.ts'
export { QueueStore, parseDocument, queuePathIn } from './store.ts'
export * from './queue.ts'
export { classifyFailure } from './classify.ts'
export type { CatalogView, QueueEntryView, QueueView } from './contract.ts'

/** Loader row id; the profile entry whose config form edits these fields. */
export const name = 'model-queue'

/**
 * Services this plugin needs before it can activate.
 *
 * Only `llm`: the queue must work in every profile that can call a model,
 * including headless ones with no browser. The authenticated `/api` channel the
 * settings page talks to is a *later* dependency, injected below — a surface
 * without a Connection service simply gets a queue with no page.
 */
export const inject = ['llm']

/** Plugin configuration; every field is volatile so a settings edit applies without a restart. */
export interface Config {
  /** Whether the queue route is offered at all. */
  readonly enabled: boolean
  /** Cooldown applied to an entry that fails, in milliseconds. */
  readonly cooldownMs: number
  /** Whether an empty queue still advertises the route (it will fail every request). */
  readonly offerWhenEmpty: boolean
}

/** Validated configuration. A volatile field reads through the Loader, so the runtime shape is wider than {@link Config}. */
export const Config = z.object({
  enabled: z.boolean().default(true).volatile().description('关闭后队列路由会从模型选择器撤回，已排队的模型保持不变'),
  cooldownMs: z.natural()
    .min(0)
    .max(MAX_COOLDOWN_MS)
    .default(DEFAULT_COOLDOWN_MS)
    .volatile()
    .description('某个模型失败后进入冷却的时长（毫秒）；默认 1 小时。0 表示仍然轮换到队尾，但不等待'),
  offerWhenEmpty: z.boolean().default(false).volatile().description('队列为空时是否仍然把 "Model Queue" 提供给会话（默认关闭，避免选到一个只会失败的路由）'),
})

/**
 * Read one volatile field through the Loader's live reference.
 * @param value - plain value or `{ get() }` wrapper supplied by the Loader.
 * @param fallback - value used when the field is absent.
 * @returns the current value.
 */
function live<T>(value: T | { get(): T } | undefined, fallback: T): T {
  if (value === undefined) return fallback
  if (typeof value === 'object' && value !== null && 'get' in value && typeof value.get === 'function') {
    return value.get()
  }
  return value as T
}

/**
 * Mount the plugin for one composition entry.
 * @param ctx - host context carrying `llm`.
 * @param raw - composition-entry config, or the Loader's live references.
 */
export async function apply(ctx: Context, raw?: Partial<Config> | Record<string, unknown>): Promise<void> {
  const config = (raw ?? {}) as Record<string, unknown>
  const readEnabled = (): boolean => live(config.enabled as boolean | { get(): boolean } | undefined, true)
  const readCooldown = (): number => {
    try {
      return normalizeCooldown(live(config.cooldownMs as number | { get(): number } | undefined, DEFAULT_COOLDOWN_MS))
    } catch (error: unknown) {
      ctx.logger('model-queue').warn(
        `invalid cooldownMs (${error instanceof Error ? error.message : String(error)}); using the default instead`,
      )
      return DEFAULT_COOLDOWN_MS
    }
  }
  const readOfferWhenEmpty = (): boolean => live(config.offerWhenEmpty as boolean | { get(): boolean } | undefined, false)

  const logger = ctx.logger('model-queue')
  const home = resolveDshHome()
  const store = new QueueStore(queuePathIn(home), logger)
  const manager = new QueueManager(ctx, store, () => Date.now())
  await manager.start()
  await manager.refreshFacts()

  // The document does not carry the cooldown: it is plugin configuration, and a
  // settings edit must apply without rewriting the queued order.
  if (manager.state().cooldownMs !== readCooldown()) {
    await manager.setCooldown(readCooldown())
  }

  logger.info(`model-queue: loaded ${manager.state().entries.length} model(s) from ${store.file}`)

  // Capability facts and reasoning efforts are read through the same cached
  // path the adapter uses, so a warm route never blocks the first request.
  ctx.effect(() => {
    const dispose = manager.subscribe(() => {
      void manager.refreshFacts()
    })
    return () => { dispose() }
  }, 'model-queue: capability refresh')

  const adapter = new QueueAdapter(manager, logger)
  const registration = ctx.llm.registerAdapter([PROVIDER_ID], adapter)

  // The route is withdrawn while the queue is empty (unless the user insists):
  // offering a model that cannot answer is worse than offering none.
  const syncRoute = (): void => {
    const entries = manager.state().entries.length
    const offered = readEnabled() && (entries > 0 || readOfferWhenEmpty())
    const current = ctx.llm.listProviders().some(provider => provider.id === PROVIDER_ID)
    if (offered === current) return
    registration.replace(offered ? [PROVIDER_ID] : [])
    logger.info(offered
      ? `model-queue: offering route "${PROVIDER_ID}/${QUEUE_MODEL_ID}" for ${entries} queued model(s)`
      : 'model-queue: route withdrawn (disabled or empty queue)')
  }
  syncRoute()

  ctx.effect(() => {
    const disposeState = manager.subscribe(syncRoute)
    return () => { disposeState() }
  }, 'model-queue: route visibility')

  // A settings edit lands as a new composition entry; watch the live values so
  // enabling the plugin or changing the cooldown takes effect in place.
  const timer = setInterval(() => {
    const next = readCooldown()
    if (next !== manager.cooldownMs()) {
      void manager.setCooldown(next).then(syncRoute, (error: unknown) => {
        logger.warn(`model-queue: could not apply cooldownMs (${error instanceof Error ? error.message : String(error)})`)
      })
    } else {
      syncRoute()
    }
  }, 1000)
  ctx.effect(() => () => { clearInterval(timer) }, 'model-queue: config watch')

  // Routes live behind their own injection: absence of a browser surface must
  // not delay (or fail) the queue itself.
  ctx.inject(['connection'], (connectionCtx) => {
    registerRoutes(connectionCtx, manager)
  })

  // An empty queue with nothing to offer would fail every request; say so once at
  // boot instead of letting the first session discover it.
  if (manager.state().entries.length === 0) {
    logger.info('model-queue: no models queued yet; open Plugins → Model Queue to add some')
  } else if (selectEntry(manager.state(), Date.now()).kind === 'exhausted') {
    logger.info('model-queue: every queued model is still cooling down')
  }
}
