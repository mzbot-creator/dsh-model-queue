/**
 * Adapter tests: one request walks the queue, engine failures rotate, and the
 * terminal failure is the last provider's own reason.
 *
 * The fake manager and fake `llm` here are the two seams the adapter touches,
 * so these tests assert the walking behaviour without a real provider.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { QueueAdapter } from '../src/adapter.ts'
import { classifyFailure } from '../src/classify.ts'
import type { QueueEntry, QueueState, Selection } from '../src/queue.ts'
import type { QueueManager } from '../src/manager.ts'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'

/** Build one queue entry. */
function entry(id: string, provider = 'p', model = id): QueueEntry {
  return {
    id,
    provider,
    model,
    label: id,
    config: { inputModalities: ['text'], contextWindow: 200_000, maxTokens: 8_192 },
    cooldownUntil: 0,
    failures: 0,
  }
}

/** Scripted inner streams, keyed by `provider/model`. */
type Script = (options: GenerateOptions) => StreamChunk[]

/**
 * A manager stand-in that records what the adapter asked of it.
 * @param scripts - one scripted stream per `provider/model`.
 * @param initial - the queue's starting entries.
 * @param effort - how members answer the row-level effort check; absent means "never".
 */
function fakeManager(
  scripts: Record<string, Script>,
  initial: QueueEntry[],
  effort: { supports?: (effort: string) => boolean } = {},
) {
  let state: QueueState = { revision: 0, cooldownMs: 3_600_000, entries: [...initial] }
  const calls: string[] = []
  const rotations: { id: string, code: string }[] = []
  const successes: string[] = []

  const manager = {
    cooldownMs: () => state.cooldownMs,
    select: (): Selection => {
      if (state.entries.length === 0) return { kind: 'empty' }
      const head = state.entries.find(item => item.cooldownUntil === 0)
      return head === undefined ? { kind: 'exhausted', failure: undefined, retryAt: 0 } : { kind: 'entry', entry: head }
    },
    recordSuccess: async (item: QueueEntry) => {
      successes.push(item.id)
      state = {
        ...state,
        entries: state.entries.map(other => other.id === item.id ? { ...other, cooldownUntil: 0 } : other),
      }
    },
    recordFailure: async (item: QueueEntry, failure: { code: string, message: string }) => {
      // Mirror the real manager: request-shaped failures leave the queue alone.
      if (classifyFailure(failure.code) === 'fail') return 'ignored'
      rotations.push({ id: item.id, code: failure.code })
      // Rotate to the tail with a cooldown and remember the reason, like the real manager.
      const rotated: QueueEntry = {
        ...item,
        cooldownUntil: Date.now() + state.cooldownMs,
        failures: item.failures + 1,
        lastFailure: { code: failure.code, message: failure.message, at: Date.now() },
      }
      state = {
        ...state,
        revision: state.revision + 1,
        entries: [...state.entries.filter(other => other.id !== item.id), rotated],
      }
      // "Exhausted" means nothing selectable is left, which the fake computes the
      // same way `selectEntry` does.
      return state.entries.some(other => other.cooldownUntil === 0) ? 'rotated' : 'exhausted'
    },
    supportsEffort: (_item: QueueEntry, value: string) => effort.supports?.(value) ?? false,
    /** The row's stored configuration is the whole truth; the fake never reads dsh. */
    effectiveConfig: (item: QueueEntry) => item.config,
    defaultEffortOf: (item: QueueEntry) => item.config.reasoning?.defaultEffort,
    routeFacts: () => ({ inputModalities: ['text'], contextWindow: 100_000 }),
    llm: {
      stream: (options: GenerateOptions): AsyncIterable<StreamChunk> => {
        const key = `${options.provider}/${options.model}`
        calls.push(key)
        const script = scripts[key]
        const chunks: readonly StreamChunk[] = script === undefined
          ? [{ type: 'finish', reason: { kind: 'error', failure: { code: 'NO_ADAPTER', message: `no ${key}` } } }]
          : script(options)
        return (async function* () { for (const chunk of chunks) yield chunk })()
      },
    },
  }
  return {
    manager: manager as unknown as QueueManager,
    calls,
    rotations,
    successes,
    state: () => state,
  }
}

/** A successful one-block answer. */
const ok = (text: string): StreamChunk[] => [
  { type: 'block-start', index: 0, blockType: 'text' },
  { type: 'text-delta', index: 0, text },
  { type: 'block-end', index: 0, block: { type: 'text', text } },
  { type: 'finish', reason: { kind: 'stop' } },
]

/** A terminal failure. */
const fail = (code: string, message: string): StreamChunk[] => [
  { type: 'finish', reason: { kind: 'error', failure: { code, message } } },
]

/** Collect every chunk of one dispatch. */
async function collect(adapter: QueueAdapter, options: GenerateOptions): Promise<StreamChunk[]> {
  const out: StreamChunk[] = []
  for await (const chunk of adapter.stream(options)) out.push(chunk)
  return out
}

const request = (): GenerateOptions => ({ provider: 'dsh-model-queue', model: 'queue', messages: [] })

/** A logger that records nothing. */
const quiet = { info: () => {}, warn: () => {} }

test('the head of the queue answers a request', async () => {
  const fake = fakeManager({ 'p/a': () => ok('head') }, [entry('a', 'p'), entry('b', 'p')])
  const adapter = new QueueAdapter(fake.manager, quiet)
  const chunks = await collect(adapter, request())
  assert.deepEqual(fake.calls, ['p/a'])
  const last = chunks.at(-1)
  assert.equal(last?.type === 'finish' ? last.reason.kind : undefined, 'stop')
  assert.deepEqual(fake.successes, ['a'])
})

test('a failed head rotates and the same request continues with the next model', async () => {
  const fake = fakeManager({
    'p/a': () => fail('QUOTA', 'out of credit'),
    'p/b': () => ok('second'),
  }, [entry('a', 'p'), entry('b', 'p')])
  const adapter = new QueueAdapter(fake.manager, quiet)
  const chunks = await collect(adapter, request())
  assert.deepEqual(fake.calls, ['p/a', 'p/b'])
  assert.deepEqual(fake.rotations, [{ id: 'a', code: 'QUOTA' }])
  const finish = chunks.at(-1)
  assert.equal(finish?.type, 'finish')
  assert.equal(finish?.type === 'finish' ? finish.reason.kind : undefined, 'stop')
  // The failed attempt's own text must not leak into the answer.
  assert.ok(!JSON.stringify(chunks).includes('out of credit'))
})

test('every model failing reports the last provider reason, not a queue reason', async () => {
  const fake = fakeManager({
    'p/a': () => fail('RATE_LIMIT', 'first'),
    'p/b': () => fail('SERVER', 'second'),
  }, [entry('a', 'p'), entry('b', 'p')])
  const adapter = new QueueAdapter(fake.manager, quiet)
  const chunks = await collect(adapter, request())
  const finish = chunks.at(-1)
  assert.equal(finish?.type, 'finish')
  if (finish?.type !== 'finish' || finish.reason.kind !== 'error') {
    assert.fail('expected one terminal error')
    return
  }
  assert.equal(finish.reason.failure.code, 'SERVER')
  assert.equal(finish.reason.failure.message, 'second')
  assert.deepEqual(fake.calls, ['p/a', 'p/b'])
})

test('a request-shaped failure ends the request without rotating', async () => {
  const fake = fakeManager({
    'p/a': () => fail('CONTEXT_WINDOW_EXCEEDED', 'too long'),
    'p/b': () => ok('never reached'),
  }, [entry('a', 'p'), entry('b', 'p')])
  const adapter = new QueueAdapter(fake.manager, quiet)
  const chunks = await collect(adapter, request())
  assert.deepEqual(fake.calls, ['p/a'])
  assert.deepEqual(fake.rotations, [])
  const finish = chunks.at(-1)
  assert.equal(finish?.type === 'finish' && finish.reason.kind === 'error' ? finish.reason.failure.code : undefined, 'CONTEXT_WINDOW_EXCEEDED')
})

test('cancellation passes through without touching the queue', async () => {
  const fake = fakeManager({
    'p/a': () => [{ type: 'finish', reason: { kind: 'aborted', failure: { code: 'ABORTED', message: 'cancelled' } } }],
  }, [entry('a', 'p')])
  const adapter = new QueueAdapter(fake.manager, quiet)
  const chunks = await collect(adapter, request())
  assert.deepEqual(fake.rotations, [])
  const abortedLast = chunks.at(-1)
  assert.equal(abortedLast?.type === 'finish' ? abortedLast.reason.kind : undefined, 'aborted')
})

test('an empty queue fails with an actionable reason', async () => {
  const fake = fakeManager({}, [])
  const adapter = new QueueAdapter(fake.manager, quiet)
  const chunks = await collect(adapter, request())
  const finish = chunks.at(-1)
  assert.equal(finish?.type === 'finish' && finish.reason.kind === 'error' ? finish.reason.failure.code : undefined, 'NO_MODEL')
})

test('a stream with no content rotates instead of counting as success', async () => {
  const fake = fakeManager({
    'p/a': () => [{ type: 'finish', reason: { kind: 'stop' } }],
    'p/b': () => ok('real answer'),
  }, [entry('a', 'p'), entry('b', 'p')])
  const adapter = new QueueAdapter(fake.manager, quiet)
  const chunks = await collect(adapter, request())
  assert.deepEqual(fake.calls, ['p/a', 'p/b'])
  assert.equal(fake.rotations[0]?.code, 'EMPTY_RESPONSE')
  assert.ok(JSON.stringify(chunks).includes('real answer'))
})

test('a zero cooldown cannot make one request loop forever', async () => {
  // Every member fails and none cools down: the tried-set must stop the walk.
  const fake = fakeManager({ 'p/a': () => fail('QUOTA', 'x') }, [entry('a', 'p')])
  const adapter = new QueueAdapter(fake.manager, quiet)
  const chunks = await collect(adapter, request())
  assert.equal(chunks.at(-1)?.type, 'finish')
  assert.deepEqual(fake.calls, ['p/a'])
})

test('the queue advertises every reasoning level the harness knows', async () => {
  // A narrowed set is what made a stored `max` fail the request: the harness
  // refuses a level the resolved model does not list.
  const fake = fakeManager({}, [entry('a', 'p')])
  const adapter = new QueueAdapter(fake.manager, quiet)
  const info = await adapter.resolveModel('dsh-model-queue', 'queue')
  const ids = info.reasoning?.efforts.map(effort => effort.id) ?? []
  assert.deepEqual(ids, ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
  // No default: a level the call named is dropped, so the queue must not invent one.
  assert.equal(info.reasoning?.defaultEffort, undefined)
})

test('a caller-named reasoning level is dropped, not forwarded to the member', async () => {
  const seen: (string | undefined)[] = []
  const fake = fakeManager({
    'p/a': (options) => {
      seen.push(options.reasoningEffort)
      return ok('fine')
    },
  }, [entry('a', 'p')])
  const adapter = new QueueAdapter(fake.manager, quiet)
  const chunks = await collect(adapter, { ...request(), reasoningEffort: 'max' as never })
  assert.equal(chunks.at(-1)?.type === 'finish' ? chunks.at(-1)?.type : undefined, 'finish')
  assert.deepEqual(fake.calls, ['p/a'])
  // The member runs on its own default, whatever the picker showed for the queue.
  assert.deepEqual(seen, [undefined])
})

test("a member's own configured reasoning level still reaches it", async () => {
  const seen: (string | undefined)[] = []
  const pinned = { ...entry('a', 'p'), config: { ...entry('a', 'p').config, reasoning: { efforts: [{ id: 'low', name: 'Low' }], defaultEffort: 'low' } } }
  const fake = fakeManager({
    'p/a': (options) => {
      seen.push(options.reasoningEffort)
      return ok('fine')
    },
  }, [pinned], { supports: () => true })
  const adapter = new QueueAdapter(fake.manager, quiet)
  await collect(adapter, { ...request(), reasoningEffort: 'max' as never })
  // The row pins `low`; the caller's `max` is ignored either way.
  assert.deepEqual(seen, ['low'])
})

test('a configured level the member does not offer is not forwarded', async () => {
  const seen: (string | undefined)[] = []
  const pinned = { ...entry('a', 'p'), config: { ...entry('a', 'p').config, reasoning: { efforts: [{ id: 'low', name: 'Low' }], defaultEffort: 'low' } } }
  const fake = fakeManager({
    'p/a': (options) => {
      seen.push(options.reasoningEffort)
      return ok('fine')
    },
  }, [pinned], { supports: () => false })
  const adapter = new QueueAdapter(fake.manager, quiet)
  await collect(adapter, { ...request(), reasoningEffort: 'max' as never })
  // Forwarding it would fail the call with UNSUPPORTED_REASONING_EFFORT.
  assert.deepEqual(seen, [undefined])
})

test('the member failure keeps its full record, including offloadImages', async () => {
  // Rebuilding a code/message-only object here is what broke the image-offload
  // recovery: the recovery reads `offloadImages` and gave up without it.
  const fake = fakeManager({
    'p/a': () => [{
      type: 'finish',
      reason: {
        kind: 'error',
        failure: { code: 'IMAGE_OFFLOAD_REQUIRED', message: 'too big', offloadImages: 21, status: 413 },
      },
    }],
  }, [entry('a', 'p')])
  const adapter = new QueueAdapter(fake.manager, quiet)
  const chunks = await collect(adapter, request())
  const finish = chunks.at(-1)
  assert.equal(finish?.type, 'finish')
  if (finish?.type !== 'finish' || finish.reason.kind !== 'error') {
    assert.fail('expected one terminal error')
    return
  }
  assert.equal(finish.reason.failure.offloadImages, 21)
  assert.equal(finish.reason.failure.status, 413)
})

test('a thrown LlmError keeps its carried failure record', async () => {
  const fake = fakeManager({}, [entry('a', 'p')])
  const original = fake.manager.llm.stream
  ;(fake.manager as unknown as { llm: { stream: unknown } }).llm.stream = () => {
    throw Object.assign(new Error('boom'), {
      failure: { code: 'PROVIDER_OVERLOADED', message: 'busy', status: 503, providerRetryAfterMs: 1_000 },
    })
  }
  void original
  const adapter = new QueueAdapter(fake.manager, quiet)
  const chunks = await collect(adapter, request())
  const finish = chunks.at(-1)
  if (finish?.type !== 'finish' || finish.reason.kind !== 'error') {
    assert.fail('expected one terminal error')
    return
  }
  assert.equal(finish.reason.failure.providerRetryAfterMs, 1_000)
  assert.equal(finish.reason.failure.status, 503)
})

