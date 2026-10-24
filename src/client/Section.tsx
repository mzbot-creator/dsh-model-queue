/**
 * The "Model Queue" page body, rendered inside Plugins → Model Queue.
 *
 * It draws four things: whether the queue can serve a request right now, the
 * ordered member list with live cooldowns, the failure that last put a member
 * into cooldown, and the controls that change all of it. Everything it shows
 * comes from the host's queue API, so two browsers watching the same host agree
 * without any client-side state of their own.
 *
 * @module dsh-model-queue/client/Section
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { QUEUE_ROUTE } from '../contract.ts'
import type { CatalogModel, CatalogView, QueueEntryView, QueueView } from '../contract.ts'

/** How often the page re-reads the queue while it is open, in milliseconds. */
const POLL_MS = 5_000

/** The subset of the plugin's own config this page edits. */
export interface ModelQueueConfig {
  readonly enabled: boolean
  readonly cooldownMs: number
  readonly offerWhenEmpty: boolean
}

/** Props injected into the page by the registering plugin. */
export interface ModelQueueSectionInjected {
  /** Reads and writes the profile entry's own configuration. */
  readonly config: {
    getSnapshot(): { status: string, value: ModelQueueConfig | undefined, writable: boolean }
    subscribe(listener: () => void): () => void
    set(field: string, value: unknown): Promise<boolean>
  }
  /** Active UI language, so the page matches the rest of the shell. */
  readonly locale: () => string
}

const styles = {
  page: { display: 'flex', flexDirection: 'column', gap: 18, padding: '4px 0 24px' } as const,
  card: {
    border: '1px solid var(--dsw-alias-border-secondary, rgba(128,128,128,0.25))',
    borderRadius: 10,
    padding: '14px 16px',
  } as const,
  header: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 } as const,
  title: { fontSize: 14, fontWeight: 600, margin: 0 } as const,
  hint: { fontSize: 12.5, opacity: 0.68, margin: '0 0 12px', lineHeight: 1.6 } as const,
  row: { display: 'flex', alignItems: 'center', gap: 10 } as const,
  member: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '8px 10px',
    borderRadius: 8,
    border: '1px solid var(--dsw-alias-border-secondary, rgba(128,128,128,0.2))',
    marginBottom: 6,
  } as const,
  index: {
    flex: 'none',
    width: 22,
    height: 22,
    borderRadius: 999,
    display: 'grid',
    placeItems: 'center',
    fontSize: 11.5,
    fontWeight: 600,
    background: 'var(--dsw-alias-bg-layer-2, rgba(128,128,128,0.12))',
  } as const,
  name: { fontSize: 13, fontWeight: 500 } as const,
  meta: { fontSize: 11.5, opacity: 0.62 } as const,
  button: {
    fontSize: 12,
    padding: '4px 10px',
    borderRadius: 6,
    border: '1px solid var(--dsw-alias-border-secondary, rgba(128,128,128,0.3))',
    background: 'var(--dsw-alias-bg-elevated, #fff)',
    cursor: 'pointer',
  } as const,
  buttonDisabled: { opacity: 0.45, cursor: 'default' } as const,
  select: {
    fontSize: 12.5,
    padding: '4px 8px',
    borderRadius: 6,
    border: '1px solid var(--dsw-alias-border-secondary, rgba(128,128,128,0.3))',
    background: 'var(--dsw-alias-bg-elevated, #fff)',
  } as const,
  badge: {
    fontSize: 11,
    padding: '1px 8px',
    borderRadius: 999,
    background: 'var(--dsw-alias-bg-layer-2, rgba(128,128,128,0.12))',
  } as const,
}

/** Text in both languages; the page picks one by the shell's locale. */
const TEXT = {
  zh: {
    status: '当前状态',
    ready: '可以请求',
    exhausted: '全部冷却中',
    empty: '队列为空',
    head: '队首',
    members: '队列顺序（从上到下依次尝试）',
    noMembers: '还没有模型。从下面的列表里选一个加进来。',
    cooldown: '冷却剩余',
    readyNow: '就绪',
    failures: '失败',
    lastFailure: '上次失败',
    moveUp: '上移',
    moveDown: '下移',
    remove: '移除',
    add: '添加模型',
    addButton: '加到队尾',
    cooldownTitle: '冷却时长',
    cooldownHint: '某个模型失败后，它会移到队尾并在这段时间内不再被选中。',
    reset: '立即解除全部冷却',
    resetHint: '只清除冷却，不改变顺序。',
    enabled: '启用队列路由',
    enabledHint: '关闭后 "Model Queue" 会从模型选择器里消失，已排队的模型保持不变。',
    offerWhenEmpty: '队列为空时也提供路由',
    offerWhenEmptyHint: '默认关闭：空队列只会让请求失败。',
    minute: '分钟',
    hour: '小时',
    saving: '保存中…',
    saveFailed: '保存失败',
    loadFailed: '读取队列失败',
    apiMissing: '队列接口不可用（插件未在本机 Web 宿主上启用？）',
    catalogEmpty: '没有可添加的模型。',
    exhaustedReason: '最后一次失败',
  },
  en: {
    status: 'Status',
    ready: 'Ready',
    exhausted: 'All cooling down',
    empty: 'Queue is empty',
    head: 'Head',
    members: 'Queue order (tried top to bottom)',
    noMembers: 'No models yet. Pick one below to add it.',
    cooldown: 'Cooldown left',
    readyNow: 'ready',
    failures: 'failures',
    lastFailure: 'Last failure',
    moveUp: 'Up',
    moveDown: 'Down',
    remove: 'Remove',
    add: 'Add a model',
    addButton: 'Add to tail',
    cooldownTitle: 'Cooldown',
    cooldownHint: 'A failed model moves to the tail and is not selected again for this long.',
    reset: 'Clear every cooldown',
    resetHint: 'Clears cooldowns only; the order is unchanged.',
    enabled: 'Offer the queue route',
    enabledHint: 'Turning this off hides "Model Queue" from the model picker; queued models stay as they are.',
    offerWhenEmpty: 'Offer the route even when empty',
    offerWhenEmptyHint: 'Off by default: an empty queue can only fail.',
    minute: 'min',
    hour: 'h',
    saving: 'Saving…',
    saveFailed: 'Save failed',
    loadFailed: 'Could not read the queue',
    apiMissing: 'The queue API is unavailable (is the plugin enabled on this host?)',
    catalogEmpty: 'No models available to add.',
    exhaustedReason: 'Last failure',
  },
} as const

/** One language's strings. */
type Strings = { [K in keyof typeof TEXT.zh]: string }

/** Read one language's strings. */
function textOf(locale: string): Strings {
  return (locale.toLowerCase().startsWith('zh') ? TEXT.zh : TEXT.en) as Strings
}

/** Format a duration as `1h 2m` / `3m`. */
function duration(ms: number, t: Strings): string {
  const minutes = Math.ceil(ms / 60_000)
  if (minutes < 60) return `${String(minutes)}${t.minute}`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${String(hours)}${t.hour}` : `${String(hours)}${t.hour} ${String(rest)}${t.minute}`
}

/** One click target that looks like a button and cannot fire while disabled. */
function Action(props: {
  readonly label: string
  readonly onClick: () => void
  readonly disabled?: boolean
  readonly title?: string
}) {
  const disabled = props.disabled === true
  return (
    <button
      type="button"
      title={props.title}
      disabled={disabled}
      onClick={props.onClick}
      style={{ ...styles.button, ...disabled ? styles.buttonDisabled : {} }}
    >
      {props.label}
    </button>
  )
}

/**
 * Read the queue once and keep it fresh while the page is mounted.
 * @returns the latest view, a reload function, and the last transport error.
 */
function useQueueView(): {
  view: QueueView | null
  catalog: CatalogView | null
  error: string | null
  reload: () => void
} {
  const [view, setView] = useState<QueueView | null>(null)
  const [catalog, setCatalog] = useState<CatalogView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)

  const load = useCallback(async (isCancelled: () => boolean) => {
    try {
      const response = await fetch(`${QUEUE_ROUTE}/state`, { headers: { accept: 'application/json' } })
      if (isCancelled()) return
      if (!response.ok) {
        setError(`${String(response.status)} ${response.statusText}`)
        return
      }
      setView(await response.json() as QueueView)
      setError(null)
    } catch (cause: unknown) {
      if (!isCancelled()) setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [])

  const loadCatalog = useCallback(async (isCancelled: () => boolean) => {
    try {
      const response = await fetch(`${QUEUE_ROUTE}/catalog`, { headers: { accept: 'application/json' } })
      if (isCancelled() || !response.ok) return
      setCatalog(await response.json() as CatalogView)
    } catch {
      /* the queue list is still usable; the add control simply has no options */
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const isCancelled = (): boolean => cancelled
    void load(isCancelled)
    void loadCatalog(isCancelled)
    const timer = setInterval(() => { void load(isCancelled) }, POLL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
    // `nonce` re-runs the effect after a mutation asked for a fresh read.
  }, [load, loadCatalog, nonce])

  const reload = useCallback(() => { setNonce(value => value + 1) }, [])
  return { view, catalog, error, reload }
}

/**
 * The page body.
 * @param props - injected config form, locale, and translation hook.
 * @returns the rendered page.
 */
export function ModelQueueSection(props: ModelQueueSectionInjected) {
  const t = textOf(props.locale())
  const { view, catalog, error, reload } = useQueueView()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [pick, setPick] = useState('')

  // The config form is an external store: subscribe so an edit made elsewhere
  // (another tab, the settings form) is reflected here.
  const config = useSyncExternalStoreCompat(props.config)

  const post = useCallback(async (path: string, body?: unknown): Promise<boolean> => {
    setBusy(true)
    setMessage(null)
    try {
      const response = await fetch(`${QUEUE_ROUTE}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      })
      if (!response.ok) {
        const detail = await response.text()
        setMessage(`${t.saveFailed}: ${detail.slice(0, 200)}`)
        return false
      }
      reload()
      return true
    } catch (cause: unknown) {
      setMessage(`${t.saveFailed}: ${cause instanceof Error ? cause.message : String(cause)}`)
      return false
    } finally {
      setBusy(false)
    }
  }, [reload, t])

  const writeEntries = useCallback(async (entries: readonly { id?: string, provider: string, model: string, label?: string }[]) => {
    await post('/entries', { entries })
  }, [post])

  const move = useCallback(async (index: number, delta: number) => {
    if (view === null) return
    const next = view.entries.map(entry => ({
      id: entry.id,
      provider: entry.provider,
      model: entry.model,
      label: entry.label,
    }))
    const target = index + delta
    if (target < 0 || target >= next.length) return
    const [moved] = next.splice(index, 1)
    if (moved === undefined) return
    next.splice(target, 0, moved)
    await writeEntries(next)
  }, [view, writeEntries])

  const remove = useCallback(async (id: string) => {
    if (view === null) return
    await writeEntries(view.entries
      .filter(entry => entry.id !== id)
      .map(entry => ({ id: entry.id, provider: entry.provider, model: entry.model, label: entry.label })))
  }, [view, writeEntries])

  const append = useCallback(async () => {
    if (view === null || pick === '') return
    const [provider, ...rest] = pick.split('\u0000')
    const model = rest.join('\u0000')
    if (provider === undefined || model === '') return
    await writeEntries([
      ...view.entries.map(entry => ({ id: entry.id, provider: entry.provider, model: entry.model, label: entry.label })),
      { provider, model },
    ])
    setPick('')
  }, [view, pick, writeEntries])

  const cooldownMinutes = useMemo(
    () => Math.round((config.value?.cooldownMs ?? 3_600_000) / 60_000),
    [config.value?.cooldownMs],
  )

  const status = view === null
    ? t.apiMissing
    : view.entries.length === 0
      ? t.empty
      : view.exhausted ? t.exhausted : t.ready

  return (
    <div style={styles.page}>
      {error === null ? null : (
        <div style={{ ...styles.card, borderColor: '#c98', fontSize: 12.5 }}>{t.loadFailed}: {error}</div>
      )}

      <section style={styles.card}>
        <div style={styles.header}>
          <h3 style={styles.title}>{t.status}</h3>
          <span style={{
            ...styles.badge,
            color: view?.exhausted === true ? '#b7791f' : view === null ? undefined : '#1f9d63',
          }}>{status}</span>
        </div>
        {view === null || view.entries.length === 0 ? null : (
          <div style={styles.meta}>
            {t.head}: {view.entries.find(entry => entry.id === view.head)?.label ?? '—'}
          </div>
        )}
        {view?.exhausted === true && view.failure !== undefined ? (
          <div style={{ ...styles.meta, marginTop: 8 }}>
            {t.exhaustedReason}: <code>{view.failure.code}</code> — {view.failure.message}
          </div>
        ) : null}
      </section>

      <section style={styles.card}>
        <div style={styles.header}><h3 style={styles.title}>{t.members}</h3></div>
        {view === null || view.entries.length === 0
          ? <p style={styles.hint}>{t.noMembers}</p>
          : (
              <div>
                {view.entries.map((entry, index) => (
                  <Member
                    key={entry.id}
                    entry={entry}
                    index={index}
                    head={entry.id === view.head}
                    busy={busy}
                    t={t}
                    onUp={() => { void move(index, -1) }}
                    onDown={() => { void move(index, 1) }}
                    onRemove={() => { void remove(entry.id) }}
                  />
                ))}
              </div>
            )}

        <div style={{ ...styles.row, marginTop: 12 }}>
          <select
            style={{ ...styles.select, minWidth: 240 }}
            value={pick}
            disabled={busy}
            onChange={event => { setPick(event.target.value) }}
            aria-label={t.add}
          >
            <option value=''>{catalog === null || catalog.models.length === 0 ? t.catalogEmpty : t.add}</option>
            {catalog?.models.map(model => (
              <option key={`${model.provider}\u0000${model.model}`} value={`${model.provider}\u0000${model.model}`}>
                {model.providerName} · {model.name}
              </option>
            ))}
          </select>
          <Action label={t.addButton} disabled={busy || pick === ''} onClick={() => { void append() }} />
        </div>
      </section>

      <section style={styles.card}>
        <div style={styles.header}><h3 style={styles.title}>{t.cooldownTitle}</h3></div>
        <p style={styles.hint}>{t.cooldownHint}</p>
        <div style={styles.row}>
          <input
            type='number'
            min={0}
            style={{ ...styles.select, width: 90 }}
            value={cooldownMinutes}
            disabled={busy || config.writable !== true}
            onChange={(event) => {
              const minutes = Number(event.target.value)
              if (!Number.isFinite(minutes) || minutes < 0) return
              void props.config.set('cooldownMs', Math.round(minutes * 60_000))
            }}
          />
          <span style={styles.meta}>{t.minute}</span>
          <span style={{ flex: 1 }} />
          <Action label={t.reset} disabled={busy} onClick={() => { void post('/reset') }} />
        </div>
        <p style={{ ...styles.hint, marginTop: 8 }}>{t.resetHint}</p>
      </section>

      <section style={styles.card}>
        <div style={styles.row}>
          <label style={{ ...styles.row, fontSize: 13 }}>
            <input
              type='checkbox'
              checked={config.value?.enabled !== false}
              disabled={busy || config.writable !== true}
              onChange={(event) => { void props.config.set('enabled', event.target.checked) }}
            />
            {t.enabled}
          </label>
        </div>
        <p style={{ ...styles.hint, marginTop: 6 }}>{t.enabledHint}</p>
        <div style={{ ...styles.row, marginTop: 10 }}>
          <label style={{ ...styles.row, fontSize: 13 }}>
            <input
              type='checkbox'
              checked={config.value?.offerWhenEmpty === true}
              disabled={busy || config.writable !== true}
              onChange={(event) => { void props.config.set('offerWhenEmpty', event.target.checked) }}
            />
            {t.offerWhenEmpty}
          </label>
        </div>
        <p style={{ ...styles.hint, marginTop: 6 }}>{t.offerWhenEmptyHint}</p>
      </section>

      {message === null ? null : <div style={{ ...styles.card, fontSize: 12.5 }}>{message}</div>}
    </div>
  )
}

/** One row of the member list. */
function Member(props: {
  readonly entry: QueueEntryView
  readonly index: number
  readonly head: boolean
  readonly busy: boolean
  readonly t: Strings
  readonly onUp: () => void
  readonly onDown: () => void
  readonly onRemove: () => void
}) {
  const { entry, index, head, busy, t } = props
  const cooling = entry.remainingMs > 0
  return (
    <div style={styles.member}>
      <span style={styles.index}>{index + 1}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={styles.name}>
          {entry.label}
          {head ? <span style={{ ...styles.badge, marginLeft: 8, color: '#1f9d63' }}>{t.head}</span> : null}
          {cooling ? <span style={{ ...styles.badge, marginLeft: 8, color: '#b7791f' }}>{t.cooldown} {duration(entry.remainingMs, t)}</span> : null}
        </div>
        <div style={styles.meta}>
          {entry.provider} · {entry.model}
          {' · '}{cooling ? `${t.failures} ${String(entry.failures)}` : t.readyNow}
          {entry.lastFailure === undefined ? null : (
            <>
              {' · '}{t.lastFailure}: <code>{entry.lastFailure.code}</code> {entry.lastFailure.message.slice(0, 120)}
            </>
          )}
        </div>
      </div>
      <Action label='↑' title={t.moveUp} disabled={busy || index === 0} onClick={props.onUp} />
      <Action label='↓' title={t.moveDown} disabled={busy} onClick={props.onDown} />
      <Action label={t.remove} disabled={busy} onClick={props.onRemove} />
    </div>
  )
}

/**
 * `useSyncExternalStore` over the injected config form.
 *
 * The host's form already exposes a stable snapshot and a subscriber, so this
 * is the whole adapter — no React state of our own, and no re-render unless the
 * form actually changed.
 * @param form - the injected config form.
 * @returns the current snapshot.
 */
function useSyncExternalStoreCompat(form: ModelQueueSectionInjected['config']): {
  value: ModelQueueConfig | undefined
  writable: boolean
} {
  const [snapshot, setSnapshot] = useState(() => form.getSnapshot())
  useEffect(() => {
    setSnapshot(form.getSnapshot())
    return form.subscribe(() => { setSnapshot(form.getSnapshot()) })
  }, [form])
  return { value: snapshot.value, writable: snapshot.writable }
}
