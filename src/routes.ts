/**
 * The browser-facing API.
 *
 * Three routes under the host's authenticated `/api` channel: read the queue,
 * replace it, and clear cooldowns. They are exact Fetch routes rather than a
 * Remote namespace, so this plugin needs no generated Typert artifacts and no
 * host build step — the same shape other third-party plugins use.
 *
 * Every route is same-origin checked and answers a JSON envelope, so a rejected
 * mutation names its cause instead of failing as an opaque 500.
 *
 * @module dsh-model-queue/routes
 */

import type { Context } from '@deepseek-ai/cordis'
import type { QueueManager } from './manager.ts'
import { MAX_ENTRIES } from './store.ts'
import { QUEUE_ROUTE } from './contract.ts'
import type { CatalogView, QueueApiError, QueueView } from './contract.ts'

/** The subset of `ctx.connection` these routes use. */
interface ConnectionLike {
  fetch: {
    register(route: {
      readonly path: string
      readonly methods: readonly ('GET' | 'HEAD' | 'POST')[]
      readonly requestBody: 'buffered' | 'streaming'
      readonly fetch: (request: Request) => Promise<Response>
    }): () => Promise<void>
  }
}

/** Serialize one value as a JSON response. */
function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

/** Serialize one rejected request. */
function fail(status: number, code: string, message: string): Response {
  const body: QueueApiError = { error: { code, message } }
  return json(body, status)
}

/**
 * Read a JSON body, rejecting a body that is not an object.
 * @param request - incoming request.
 * @returns the parsed object.
 * @throws {Error} when the body is absent, unparsable, or not an object.
 */
async function readBody(request: Request): Promise<Record<string, unknown>> {
  let text: string
  try {
    text = await request.text()
  } catch {
    throw new Error('the request body could not be read')
  }
  if (text.trim() === '') return {}
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new Error('the request body is not valid JSON')
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('the request body must be a JSON object')
  }
  return value as Record<string, unknown>
}

/**
 * Whether a request came from this page.
 *
 * The host already authenticated the caller and rejected cross-site requests;
 * this check is the second half of the same rule, so a page on another origin
 * cannot mutate a queue with a borrowed cookie.
 * @param request - incoming request.
 * @returns whether the `Origin` header, when present, matches `Host`.
 */
function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin')
  if (origin === null) return true
  const host = request.headers.get('host')
  if (host === null) return true
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

/**
 * Register the queue API on the host's authenticated channel.
 * @param ctx - host context; must carry `connection` for the routes to exist.
 * @param manager - queue owner.
 * @returns the disposer removing every route.
 */
export function registerRoutes(ctx: Context, manager: QueueManager): () => Promise<void> {
  const connection = ctx.get('connection') as ConnectionLike | undefined
  if (connection === undefined) {
    ctx.logger('model-queue').warn('no connection service; the queue page will not be able to read or edit the queue')
    return async () => {}
  }

  const register = (
    path: string,
    methods: readonly ('GET' | 'HEAD' | 'POST')[],
    handler: (request: Request) => Promise<Response>,
  ): void => {
    ctx.effect(
      () => connection.fetch.register({
        path,
        methods,
        requestBody: 'buffered',
        fetch: async (request: Request): Promise<Response> => {
          if (!sameOrigin(request)) return fail(403, 'cross-origin', 'cross-origin request rejected')
          try {
            return await handler(request)
          } catch (error: unknown) {
            return fail(400, 'rejected', error instanceof Error ? error.message : String(error))
          }
        },
      }),
      `model-queue: route ${path}`,
    )
  }

  register(`${QUEUE_ROUTE}/state`, ['GET'], async () => json(manager.view() satisfies QueueView))

  register(`${QUEUE_ROUTE}/catalog`, ['GET'], async () => {
    const catalog: CatalogView = await manager.catalog()
    return json(catalog)
  })

  register(`${QUEUE_ROUTE}/entries`, ['POST'], async (request) => {
    const body = await readBody(request)
    const entries = body.entries
    if (!Array.isArray(entries)) return fail(400, 'invalid-entries', '`entries` must be an array')
    if (entries.length > MAX_ENTRIES) {
      return fail(400, 'too-many-entries', `a queue may hold at most ${MAX_ENTRIES} models`)
    }
    const normalized = entries.map((value, index) => {
      if (typeof value !== 'object' || value === null) {
        throw new Error(`entry ${index} must be an object`)
      }
      const row = value as Record<string, unknown>
      const provider = row.provider
      const model = row.model
      const id = row.id
      const label = row.label
      if (typeof provider !== 'string' || provider === '') throw new Error(`entry ${index} needs a provider`)
      if (typeof model !== 'string' || model === '') throw new Error(`entry ${index} needs a model`)
      if (id !== undefined && typeof id !== 'string') throw new Error(`entry ${index} has an invalid id`)
      if (label !== undefined && typeof label !== 'string') throw new Error(`entry ${index} has an invalid label`)
      return {
        provider,
        model,
        ...id === undefined ? {} : { id },
        ...label === undefined ? {} : { label },
      }
    })
    await manager.setEntries(normalized)
    return json(manager.view())
  })

  register(`${QUEUE_ROUTE}/cooldown`, ['POST'], async (request) => {
    const body = await readBody(request)
    const cooldownMs = body.cooldownMs
    if (typeof cooldownMs !== 'number') return fail(400, 'invalid-cooldown', '`cooldownMs` must be a number')
    await manager.setCooldown(cooldownMs)
    return json(manager.view())
  })

  register(`${QUEUE_ROUTE}/reset`, ['POST'], async () => {
    await manager.clearCooldowns()
    return json(manager.view())
  })

  return async () => {
    // Routes are registered as fiber effects, so disposal removes them; there is
    // nothing left to await here.
  }
}
