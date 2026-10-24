/**
 * Browser half of the plugin: the "Model Queue" page under Plugins.
 *
 * The page edits the composition entry's own config through `configForms` (the
 * same Host validation every other settings surface uses) and reads/writes the
 * shared queue through the plugin's own authenticated `/api` routes. No queue
 * state lives in the browser: two tabs, two browsers and two sessions all read
 * the one document the Host owns.
 *
 * @module dsh-model-queue/client
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the shell's SlotMap merge (the 'plugins.bundle.config' entry).
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
// Type-only: pulls the slot registry Context merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import { PACKAGE_NAME, PROFILE_ENTRY_ID } from '../contract.ts'
import { ModelQueueSection } from './Section.tsx'
import type { ModelQueueConfig, ModelQueueSectionInjected } from './Section.tsx'

/** The locale namespace this page registers its strings under. */
const LOCALE_NAMESPACE = 'dsh-model-queue'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** This plugin's own page copy. */
    'dsh-model-queue': 'title' | 'summary'
  }
}

/** English strings; the shell falls back here for any language it does not have. */
const en = {
  title: 'Model Queue',
  summary: 'One ordered list of models: the head answers first, and a failed model rotates to the tail.',
}

/** Chinese strings. */
const zh = {
  title: '模型队列',
  summary: '一个有序的模型列表：队首优先，失败的模型移到队尾并冷却。',
}

/**
 * Required services. `slots` owns the plugin page; `configForms` owns the
 * entry's config transport; `locale` owns the strings.
 */
export const inject = ['slots', 'configForms', 'locale']

/**
 * Register the queue page for one client mount.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(LOCALE_NAMESPACE, { en, zh }), 'dsh-model-queue: locale')

  const form = ctx.configForms.get<ModelQueueConfig>(PROFILE_ENTRY_ID) as unknown as ConfigForm<ModelQueueConfig>

  const injected = (): ModelQueueSectionInjected => ({
    config: {
      getSnapshot: () => {
        const snapshot = form.getSnapshot()
        return {
          status: snapshot.status,
          value: snapshot.value,
          writable: snapshot.writable,
        }
      },
      subscribe: listener => form.subscribe(listener),
      set: (field, value) => form.set(field, value),
    },
    locale: () => ctx.locale.getSnapshot().active,
  })

  ctx.effect(
    () => ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
      name: 'plugins.bundle.config',
      key: PACKAGE_NAME,
      locale: LOCALE_NAMESPACE,
      inject: injected,
    }, ModelQueueSection)),
    'dsh-model-queue: queue page',
  )
}

export { ModelQueueSection } from './Section.tsx'
export type { ModelQueueConfig, ModelQueueSectionInjected } from './Section.tsx'
