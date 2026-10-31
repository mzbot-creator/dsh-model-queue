/**
 * The "Model Queue" page body, rendered inside Plugins → Model Queue.
 *
 * It draws five things: whether the queue can serve a request right now, the
 * ordered member list with live cooldowns, each member's *complete model
 * configuration* (images, context window, output cap, reasoning levels) with an
 * inline editor for the parts the user wants to change, the failure that last
 * put a member into cooldown, and the controls that change all of it.
 *
 * The configuration shown is never invented by this page: every row arrives
 * with what dsh itself resolved for that model (`resolved`), what it resolved
 * when the row was added (`snapshot`, used while a route is offline), the row's
 * own `overrides`, and the `effective` result the queue actually dispatches
 * with. That is what makes a queued model behave exactly like a model dsh was
 * configured with directly, instead of merely sharing its name.
 *
 * @module dsh-model-queue/client/Section
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { QUEUE_ROUTE } from '../contract.ts'
import { isKnownConfig as isKnown } from '../model-config.ts'
import type {
  CatalogModel,
  CatalogView,
  ModelConfig,
  ModelModality,
  QueueEntryView,
  QueueView,
} from '../contract.ts'

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
  legend: { margin: 0, display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '6px 14px', alignItems: 'baseline' } as const,
  legendTerm: { fontSize: 12.5, fontWeight: 600, margin: 0 } as const,
  legendBody: { fontSize: 12.5, margin: 0, opacity: 0.78, lineHeight: 1.55 } as const,
  row: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' } as const,
  member: {
    padding: '8px 10px',
    borderRadius: 8,
    border: '1px solid var(--dsw-alias-border-secondary, rgba(128,128,128,0.2))',
    marginBottom: 6,
  } as const,
  memberTop: { display: 'flex', alignItems: 'center', gap: 10 } as const,
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
  meta: { fontSize: 11.5, opacity: 0.62, lineHeight: 1.7 } as const,
  caps: { display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 } as const,
  cap: {
    fontSize: 11,
    padding: '1px 7px',
    borderRadius: 5,
    background: 'var(--dsw-alias-bg-layer-2, rgba(128,128,128,0.12))',
    whiteSpace: 'nowrap',
  } as const,
  capMuted: {
    fontSize: 11,
    padding: '1px 7px',
    borderRadius: 5,
    background: 'transparent',
    border: '1px dashed var(--dsw-alias-border-secondary, rgba(128,128,128,0.35))',
    whiteSpace: 'nowrap',
  } as const,
  editor: {
    marginTop: 10,
    paddingTop: 10,
    borderTop: '1px dashed var(--dsw-alias-border-secondary, rgba(128,128,128,0.3))',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  } as const,
  field: { display: 'flex', flexDirection: 'column', gap: 3 } as const,
  label: { fontSize: 12, fontWeight: 500 } as const,
  fieldHint: { fontSize: 11.5, opacity: 0.6, lineHeight: 1.55 } as const,
  button: {
    fontSize: 12,
    padding: '4px 10px',
    borderRadius: 6,
    border: '1px solid var(--dsw-alias-border-secondary, rgba(128,128,128,0.3))',
    background: 'var(--dsw-alias-bg-elevated, #fff)',
    cursor: 'pointer',
  } as const,
  buttonDisabled: { opacity: 0.45, cursor: 'default' } as const,
  input: {
    fontSize: 12.5,
    padding: '4px 8px',
    borderRadius: 6,
    border: '1px solid var(--dsw-alias-border-secondary, rgba(128,128,128,0.3))',
    background: 'var(--dsw-alias-bg-elevated, #fff)',
    width: 150,
  } as const,
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
    // Configuration vocabulary.
    capsTitle: '模型配置',
    capsIntro: '下面每一项都是这一行存下来的配置，加入时从 dsh 的解析结果复制；“队列路由最终生效”是队列对外公布、实际派发时使用的值。',
    routeTitle: '队列路由对外公布的配置',
    legendImage: '读图',
    legendImageBody: '该模型能不能接收图片。加入时按 dsh 的解析结果填入；改成“不支持图片”后，队列不会再把图片派发给它，这个成员也会让队列路由的读图能力跟着收紧。',
    legendContext: '上下文窗口',
    legendContextBody: '一次请求里输入加输出最多能用多少 token。它的值来自 dsh 的声明并存在这一行里；调小之后队列会按这个更保守的值对外公布窗口，避免宿主编排出这个成员接不住的请求。',
    legendOutput: '单次输出上限',
    legendOutputBody: '一次回复最多能生成多少 token。它的值来自 dsh 的声明并存在这一行里；调小之后，派发给这个成员的请求如果要求更大的输出，会被自动下调到这个值。',
    legendReasoning: '推理等级',
    legendReasoningBody: '该模型自己的推理档位（例如 Low / Medium / High）。选定一档后，队列派发到这个成员时就用它。会话/选择器传来的档位一律被丢弃，不会下发到成员。',
    legendFollow: '每一行存的是一份完整配置，加入时从 dsh 复制。dsh 里的模型声明改了，点一次 Re-sync from dsh 即可把这些值整体刷新，不必删除重加。',
    routeHint: '队列在模型选择器里只出现一个 "Model Queue"。它对外公布的读图能力、上下文窗口和输出上限按所有成员的“共同可用范围”计算：读图要求每个成员都支持，上下文与输出取最小成员的值。推理等级例外：队列不使用档位（派发时直接丢弃），因此固定公布 dsh 的全部档位，选择器里选哪一档都不影响实际行为。',
    capImage: '读图',
    capImageYes: '支持',
    capImageNo: '不支持',
    capContext: '上下文',
    capOutput: '单次输出上限',
    capReasoning: '推理等级',
    capReasoningIgnored: '已忽略（任意档位都接受）',
    capDefault: '默认',
    capUnknown: '未知（路由未响应）',
    capNotDeclared: '未声明',
    edit: '修改配置',
    collapse: '收起',
    apply: '保存修改',
    synced: '已从 dsh 同步',
    syncNow: '从 dsh 重新同步',
    syncHint: '插件平时不自动跟随 dsh。dsh 里改了上下文窗口、输出上限、读图能力或推理等级后，点这里把每一行的配置整体重新读一遍；读不到的行保持原样。',
    fieldImage: '读图能力',
    fieldImageHint: '这个模型能否接收图片。加入时按 dsh 的声明填入，之后以这里的值为准。',
    fieldContext: '上下文窗口（token）',
    fieldContextHint: '一次请求里输入 + 输出最多能用多少 token。调小可用于让队列对外公布更保守的上限。',
    fieldOutput: '单次输出上限（token）',
    fieldOutputHint: '一次回复最多生成多少 token。队列派发到该成员时，超过这个值的 maxTokens 会被下调到该值。',
    fieldReasoning: '模型推理等级',
    fieldReasoningHint: '这个模型自己的推理强度，可选 {value}。选定后，队列派发到这个成员时就用这一档——会话里选了什么都会被丢弃。',
    fieldReasoningNone: '该模型没有声明推理等级',
    imageOn: '支持图片',
    imageOff: '不支持图片',
    reasoningNoDefault: '不指定（用模型自己的默认档）',
    undefinedValue: '未声明',
    modelsCount: '个模型',
    previewTitle: '将加入的模型',
    previewHint: '加入后会把 dsh 的完整配置复制到这一行：读图 {image}，上下文 {context}，单次输出 {output}，推理等级 {reasoning}。之后可以逐项修改。',
    resolveFailed: '该模型暂时无法从 dsh 解析完整配置：{reason}',
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
    capsTitle: 'Model configuration',
    capsIntro: 'Every value below is the configuration stored on this row, copied from what dsh resolved when the row was added. "Queue route effective" is the value the queue advertises and actually dispatches with.',
    routeTitle: 'What the queue route advertises',
    legendImage: 'Image support',
    legendImageBody: 'Whether this model can receive images. Filled from what dsh resolved when the row was added; set it to text only and the queue stops sending images to this member, which also narrows what the queue route advertises.',
    legendContext: 'Context window',
    legendContextBody: 'How many tokens one request may use for input plus output. The value comes from the dsh declaration and is stored on the row; lowering it makes the queue advertise the smaller window, so the harness never plans a request this member cannot serve.',
    legendOutput: 'Output cap',
    legendOutputBody: 'How many tokens one reply may generate. The value comes from the dsh declaration and is stored on the row; once lowered, a request that asks for more output is reduced to this value when it is dispatched to this member.',
    legendReasoning: 'Reasoning level',
    legendReasoningBody: 'The reasoning efforts this model offers (for example Low / Medium / High). Once you pick one, it is used whenever the queue dispatches to this member. A level named by the session or the picker is always dropped, never forwarded.',
    legendFollow: 'Each row stores one complete configuration, copied from dsh when the row is added. When a model declaration in dsh changes, one click on Re-sync from dsh refreshes these values without re-adding the row.',
    routeHint: 'The queue appears as one "Model Queue" in the picker. The image support, context window and output cap it advertises are the intersection of its members: images require every member to accept them, context and output use the smallest member. Reasoning is the exception: the route does not use a level (a dispatch drops it), so it always advertises every level dsh knows — whichever one the picker shows has no effect.',
    capImage: 'Images',
    capImageYes: 'yes',
    capImageNo: 'no',
    capContext: 'context',
    capOutput: 'output cap',
    capReasoning: 'reasoning',
    capReasoningIgnored: 'ignored (any level accepted)',
    capDefault: 'default',
    capUnknown: 'unknown (route did not answer)',
    capNotDeclared: 'not declared',
    edit: 'Edit configuration',
    collapse: 'Collapse',
    apply: 'Save changes',
    synced: 'Synced from dsh',
    syncNow: 'Re-sync from dsh',
    syncHint: 'The plugin does not follow dsh on its own. After changing a context window, output cap, image support or reasoning level in dsh, click here to re-read every row; a row that cannot be read keeps its stored configuration.',
    fieldImage: 'Image support',
    fieldImageHint: 'Whether this model can receive images. Filled from the dsh declaration when the row is added; this value wins afterwards.',
    fieldContext: 'Context window (tokens)',
    fieldContextHint: 'How many tokens one request may use for input plus output. Lowering it makes the queue advertise a more conservative window.',
    fieldOutput: 'Output cap (tokens)',
    fieldOutputHint: 'How many tokens one reply may generate. When a request is dispatched to this member, a larger maxTokens is lowered to this value.',
    fieldReasoning: 'Reasoning level',
    fieldReasoningHint: 'The reasoning effort this model offers, one of {value}. Once chosen, the queue uses it whenever it dispatches to this member — a level named by the session is dropped.',
    fieldReasoningNone: 'This model declares no reasoning levels',
    imageOn: 'Images supported',
    imageOff: 'Text only',
    reasoningNoDefault: 'Not pinned (use the model\'s own default)',
    undefinedValue: 'not declared',
    modelsCount: 'model(s)',
    previewTitle: 'Model to add',
    previewHint: 'Adding the row copies the full dsh configuration onto it: images {image}, context {context}, output {output}, reasoning {reasoning}. You can change any of these afterwards.',
    resolveFailed: 'dsh could not resolve the full configuration for this model: {reason}',
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

/**
 * Format a token count the way model cards usually do: `1M`, `200K`, `8192`.
 * @param value - token count, when the model declares one.
 * @param fallback - text used when the value is absent.
 * @returns the display string.
 */
function tokens(value: number | undefined, fallback: string): string {
  if (value === undefined) return fallback
  if (value >= 1_000_000) {
    const millions = value / 1_000_000
    return `${Number.isInteger(millions) ? String(millions) : millions.toFixed(1)}M`
  }
  if (value >= 1_000) {
    const thousands = value / 1_000
    return `${Number.isInteger(thousands) ? String(thousands) : thousands.toFixed(1)}K`
  }
  return String(value)
}

/** Whether a configuration accepts images. */
function acceptsImages(config: ModelConfig): boolean {
  return config.inputModalities.includes('image')
}

/** The display name of one reasoning level, falling back to its id. */
function effortName(config: ModelConfig, id: string): string {
  return config.reasoning?.efforts.find(effort => effort.id === id)?.name ?? id
}

/** Format the reasoning levels of a configuration as one short phrase. */
function reasoningSummary(config: ModelConfig, t: Strings): string {
  const reasoning = config.reasoning
  if (reasoning === undefined || reasoning.efforts.length === 0) return t.capNotDeclared
  const levels = reasoning.efforts.map(effort => effort.name).join(' / ')
  if (reasoning.defaultEffort === undefined) return levels
  return `${levels} (${t.capDefault} ${effortName(config, reasoning.defaultEffort)})`
}

/** Format one configuration as the compact badge line shown per row. */
function CapBadges(props: {
  readonly config: ModelConfig
  readonly unknown: boolean
  readonly t: Strings
  /** Replaces the reasoning text; the route advertises a set it never uses. */
  readonly reasoningText?: string
}) {
  const { config, unknown, t, reasoningText } = props
  const unknownText = t.capUnknown
  return (
    <div style={styles.caps}>
      <span style={styles.cap}>
        {t.capImage}: {unknown && config.inputModalities.length === 0
          ? unknownText
          : acceptsImages(config) ? t.capImageYes : t.capImageNo}
      </span>
      <span style={styles.cap}>
        {t.capContext}: {tokens(config.contextWindow, unknown ? unknownText : t.capNotDeclared)}
      </span>
      <span style={styles.cap}>
        {t.capOutput}: {tokens(config.maxTokens, unknown ? unknownText : t.capNotDeclared)}
      </span>
      <span style={styles.cap}>
        {t.capReasoning}: {unknown && config.reasoning === undefined
          ? unknownText
          : reasoningText ?? reasoningSummary(config, t)}
      </span>
    </div>
  )
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
 * @returns the latest view, the model catalog, a reload function, and the last transport error.
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
 * @param props - injected config form and locale.
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

  /**
   * Send the whole queue back. Each row travels with its complete configuration,
   * so an unrelated reorder never drops a value the user set.
   */
  const writeEntries = useCallback(async (
    entries: readonly { id?: string, provider: string, model: string, label?: string, config?: ModelConfig }[],
  ) => {
    await post('/entries', { entries })
  }, [post])

  /** The rows as they are stored, each with its configuration, ready to be reordered. */
  const rowsOf = useCallback((entries: readonly QueueEntryView[]) => entries.map(entry => ({
    id: entry.id,
    provider: entry.provider,
    model: entry.model,
    label: entry.label,
    config: entry.config,
  })), [])

  const move = useCallback(async (index: number, delta: number) => {
    if (view === null) return
    const next = rowsOf(view.entries)
    const target = index + delta
    if (target < 0 || target >= next.length) return
    const [moved] = next.splice(index, 1)
    if (moved === undefined) return
    next.splice(target, 0, moved)
    await writeEntries(next)
  }, [view, rowsOf, writeEntries])

  const remove = useCallback(async (id: string) => {
    if (view === null) return
    await writeEntries(rowsOf(view.entries).filter(row => row.id !== id))
  }, [view, rowsOf, writeEntries])

  const saveConfig = useCallback(async (id: string, config: ModelConfig) => {
    if (view === null) return
    await writeEntries(rowsOf(view.entries).map(row => row.id === id ? { ...row, config } : row))
  }, [view, rowsOf, writeEntries])

  const append = useCallback(async () => {
    if (view === null || pick === '') return
    const [provider, ...rest] = pick.split('\u0000')
    const model = rest.join('\u0000')
    if (provider === undefined || model === '') return
    await writeEntries([...rowsOf(view.entries), { provider, model }])
    setPick('')
  }, [view, pick, rowsOf, writeEntries])

  const syncFromDsh = useCallback(async () => {
    const ok = await post('/sync')
    if (ok) setMessage(t.synced)
  }, [post, t.synced])

  const cooldownMinutes = useMemo(
    () => Math.round((config.value?.cooldownMs ?? 3_600_000) / 60_000),
    [config.value?.cooldownMs],
  )

  const picked = useMemo((): CatalogModel | undefined => {
    if (pick === '' || catalog === null) return undefined
    return catalog.models.find(model => `${model.provider}\u0000${model.model}` === pick)
  }, [pick, catalog])

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
        {view === null ? null : (
          <div style={{ marginTop: 12 }}>
            <div style={{ ...styles.label, marginBottom: 4 }}>{t.routeTitle}</div>
            <p style={{ ...styles.fieldHint, margin: '0 0 6px' }}>{t.routeHint}</p>
            <CapBadges
              config={view.route}
              unknown={view.entries.length === 0}
              reasoningText={t.capReasoningIgnored}
              t={t}
            />
          </div>
        )}
      </section>

      <section style={styles.card}>
        <div style={styles.header}>
          <h3 style={styles.title}>{t.members}</h3>
          <span style={{ flex: 1 }} />
          <Action label={t.syncNow} disabled={busy} title={t.syncHint} onClick={() => { void syncFromDsh() }} />
        </div>
        <p style={{ ...styles.hint, marginBottom: 10 }}>{t.syncHint}</p>
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
                    onSave={config => { void saveConfig(entry.id, config) }}
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

        {picked === undefined ? null : (
          <div style={{ marginTop: 10 }}>
            <div style={{ ...styles.label, marginBottom: 4 }}>{t.previewTitle}</div>
            <CapBadges config={picked.config} unknown={!picked.resolved} t={t} />
            {picked.resolved ? null : (
              <p style={{ ...styles.fieldHint, marginTop: 6, color: '#b7791f' }}>
                {t.resolveFailed.replace('{reason}', picked.resolveError ?? t.capUnknown)}
              </p>
            )}
            <p style={{ ...styles.fieldHint, marginTop: 6 }}>
              {t.previewHint
                .replace('{image}', acceptsImages(picked.config) ? t.capImageYes : t.capImageNo)
                .replace('{context}', tokens(picked.config.contextWindow, t.capNotDeclared))
                .replace('{output}', tokens(picked.config.maxTokens, t.capNotDeclared))
                .replace('{reasoning}', reasoningSummary(picked.config, t))}
            </p>
          </div>
        )}
      </section>

      <section style={styles.card}>
        <div style={styles.header}><h3 style={styles.title}>{t.capsTitle}</h3></div>
        <p style={styles.hint}>{t.capsIntro}</p>
        <dl style={styles.legend}>
          <dt style={styles.legendTerm}>{t.legendImage}</dt>
          <dd style={styles.legendBody}>{t.legendImageBody}</dd>
          <dt style={styles.legendTerm}>{t.legendContext}</dt>
          <dd style={styles.legendBody}>{t.legendContextBody}</dd>
          <dt style={styles.legendTerm}>{t.legendOutput}</dt>
          <dd style={styles.legendBody}>{t.legendOutputBody}</dd>
          <dt style={styles.legendTerm}>{t.legendReasoning}</dt>
          <dd style={styles.legendBody}>{t.legendReasoningBody}</dd>
        </dl>
        <p style={{ ...styles.hint, marginTop: 10 }}>{t.legendFollow}</p>
      </section>

      <section style={styles.card}>
        <div style={styles.header}><h3 style={styles.title}>{t.cooldownTitle}</h3></div>
        <p style={styles.hint}>{t.cooldownHint}</p>
        <div style={styles.row}>
          <input
            type='number'
            min={0}
            style={{ ...styles.input, width: 90 }}
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

/** One row of the member list, with its configuration and inline editor. */
function Member(props: {
  readonly entry: QueueEntryView
  readonly index: number
  readonly head: boolean
  readonly busy: boolean
  readonly t: Strings
  readonly onUp: () => void
  readonly onDown: () => void
  readonly onRemove: () => void
  readonly onSave: (config: ModelConfig) => void
}) {
  const { entry, index, head, busy, t } = props
  const cooling = entry.remainingMs > 0
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<ModelConfig>(entry.config)

  // Opening the editor starts from what is stored, not from a stale draft the
  // last row mutation left behind.
  const open = (): void => {
    setDraft(entry.config)
    setEditing(true)
  }

  return (
    <div style={styles.member}>
      <div style={styles.memberTop}>
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
        <Action
          label={editing ? t.collapse : t.edit}
          disabled={busy}
          onClick={() => { if (editing) setEditing(false); else open() }}
        />
      </div>

      <CapBadges config={entry.config} unknown={!isKnown(entry.config)} t={t} />

      {editing ? (
        <Editor
          t={t}
          draft={draft}
          busy={busy}
          onChange={setDraft}
          onApply={() => { props.onSave(draft); setEditing(false) }}
        />
      ) : null}
    </div>
  )
}

/** The per-row configuration editor: four fields, each explaining what it does. */
function Editor(props: {
  readonly t: Strings
  readonly draft: ModelConfig
  readonly busy: boolean
  readonly onChange: (next: ModelConfig) => void
  readonly onApply: () => void
}) {
  const { t, draft, busy, onChange, onApply } = props
  const efforts = draft.reasoning?.efforts ?? []
  const imageChoice = draft.inputModalities.includes('image') ? 'on' : 'off'

  return (
    <div style={styles.editor}>
      <div style={styles.field}>
        <label style={styles.label}>{t.fieldImage}</label>
        <select
          style={styles.select}
          value={imageChoice}
          disabled={busy}
          onChange={(event) => {
            const value = event.target.value
            const next: { -readonly [K in keyof ModelConfig]: ModelConfig[K] } = { ...draft }
            next.inputModalities = (value === 'on' ? ['text', 'image'] : ['text']) as readonly ModelModality[]
            onChange(next)
          }}
        >
          <option value='on'>{t.imageOn}</option>
          <option value='off'>{t.imageOff}</option>
        </select>
        <span style={styles.fieldHint}>{t.fieldImageHint}</span>
      </div>

      <div style={styles.field}>
        <label style={styles.label}>{t.fieldContext}</label>
        <input
          type='number'
          min={1}
          placeholder={t.undefinedValue}
          style={styles.input}
          value={draft.contextWindow === undefined ? '' : String(draft.contextWindow)}
          disabled={busy}
          onChange={(event) => {
            const next: { -readonly [K in keyof ModelConfig]: ModelConfig[K] } = { ...draft }
            const raw = event.target.value.trim()
            if (raw === '') delete next.contextWindow
            else {
              const value = Number(raw)
              if (!Number.isSafeInteger(value) || value <= 0) return
              next.contextWindow = value
            }
            onChange(next)
          }}
        />
        <span style={styles.fieldHint}>{t.fieldContextHint}</span>
      </div>

      <div style={styles.field}>
        <label style={styles.label}>{t.fieldOutput}</label>
        <input
          type='number'
          min={1}
          placeholder={t.undefinedValue}
          style={styles.input}
          value={draft.maxTokens === undefined ? '' : String(draft.maxTokens)}
          disabled={busy}
          onChange={(event) => {
            const next: { -readonly [K in keyof ModelConfig]: ModelConfig[K] } = { ...draft }
            const raw = event.target.value.trim()
            if (raw === '') delete next.maxTokens
            else {
              const value = Number(raw)
              if (!Number.isSafeInteger(value) || value <= 0) return
              next.maxTokens = value
            }
            onChange(next)
          }}
        />
        <span style={styles.fieldHint}>{t.fieldOutputHint}</span>
      </div>

      <div style={styles.field}>
        <label style={styles.label}>{t.fieldReasoning}</label>
        {efforts.length === 0
          ? <span style={{ ...styles.meta }}>{t.fieldReasoningNone}</span>
          : (
              <>
                <select
                  style={styles.select}
                  value={draft.reasoning?.defaultEffort ?? ''}
                  disabled={busy}
                  onChange={(event) => {
                    const next: { -readonly [K in keyof ModelConfig]: ModelConfig[K] } = { ...draft }
                    if (draft.reasoning !== undefined) {
                      const reasoning: { -readonly [K in keyof typeof draft.reasoning]: NonNullable<typeof draft.reasoning>[K] } = { ...draft.reasoning }
                      if (event.target.value === '') delete reasoning.defaultEffort
                      else reasoning.defaultEffort = event.target.value
                      next.reasoning = reasoning
                    }
                    onChange(next)
                  }}
                >
                  <option value=''>{t.reasoningNoDefault}</option>
                  {efforts.map(effort => (
                    <option key={effort.id} value={effort.id}>
                      {effort.name}{effort.description === undefined ? '' : ` — ${effort.description}`}
                    </option>
                  ))}
                </select>
                <span style={styles.fieldHint}>
                  {t.fieldReasoningHint.replace('{value}', efforts.map(effort => effort.name).join(' / '))}
                </span>
              </>
            )}
      </div>

      <div style={styles.row}>
        <Action label={t.apply} disabled={busy} onClick={onApply} />
      </div>
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
