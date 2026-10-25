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
    snapshot: { inputModalities: ['text'], contextWindow: 200_000, maxTokens: 8_192 },
    overrides: {},
    cooldownUntil: 0,
    failures: 0,
  }
}

/** Scripted inner streams, keyed by `provider/model`. */
type Script = (options: GenerateOptions) => StreamChunk[]

/**
 * A manager stand-in that records what the adapter asked of it.
 */
function fakeManager(scripts: Record<string, Script>, initial: QueueEntry[]) {
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
    supportsEffort: () => false,
    /** The fake has no registry to resolve against, so the row's snapshot is the whole truth. */
    effectiveConfig: (item: QueueEntry) => ({
      ...item.snapshot,
      ...item.overrides.contextWindow === undefined ? {} : { contextWindow: item.overrides.contextWindow },
      ...item.overrides.maxTokens === undefined ? {} : { maxTokens: item.overrides.maxTokens },
    }),
    defaultEffort: () => undefined,
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
