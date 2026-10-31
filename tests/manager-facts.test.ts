/**
 * Capability-cache tests: a lapsed TTL must never withdraw what dsh declared.
 *
 * The harness gates `read_image` on the route's `inputModalities`, so a queue
 * route that forgot its members between two polls would refuse images for no
 * visible reason. These tests pin the three ways that could happen: expiry, a
 * failed re-resolve, and a restart with an unreachable provider.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { QueueManager } from '../src/manager.ts'
import { UNKNOWN_CONFIG } from '../src/model-config.ts'
import type { ModelConfig } from '../src/contract.ts'
import type { QueueEntry, QueueState } from '../src/queue.ts'

/** The facts dsh reports for an image-capable member. */
function imageConfig(): ModelConfig {
  return {
    inputModalities: ['text', 'image'],
    contextWindow: 1_048_000,
    maxTokens: 128_000,
  }
}

/** One queued row, snapshot included. */
function entry(id: string, snapshot: ModelConfig = UNKNOWN_CONFIG): QueueEntry {
  return {
    id,
    provider: 'od',
    model: id,
    label: id,
    snapshot,
    overrides: {},
    cooldownUntil: 0,
    failures: 0,
  }
}

/** In-memory document that records every commit, standing in for `QueueStore`. */
function fakeStore(entries: QueueEntry[]): {
  current(): QueueState
  commits(): number
  load(): Promise<QueueState>
  commit(next: QueueState): Promise<void>
} {
  let state: QueueState = { revision: 0, cooldownMs: 3_600_000, entries }
  let written = 0
  return {
    load: async () => state,
    current: () => state,
    commits: () => written,
    commit: async (next) => { state = next; written += 1 },
  }
}

/** A host whose `llm` answers (or refuses) on demand. */
function fakeCtx(answer: () => ModelConfig) {
  return {
    llm: {
      resolveModelInfo: async (provider: string, model: string) => {
        const config = answer()
        return {
          provider,
          id: model,
          name: model,
          inputModalities: [...config.inputModalities],
          ...config.contextWindow === undefined ? {} : { context: { contextWindow: config.contextWindow } },
          ...config.maxTokens === undefined ? {} : { defaultMaxTokens: config.maxTokens },
        }
      },
      listProviders: () => [],
    },
    logger: () => ({ info() {}, warn() {} }),
  } as never
}

/** Build a manager over the given rows and clock. */
async function manager(entries: QueueEntry[], answer: () => ModelConfig, clock: { t: number }) {
  const store = fakeStore(entries)
  const built = new QueueManager(fakeCtx(answer), store as never, () => clock.t)
  await built.start()
  return { manager: built, store }
}

test('a lapsed capability cache keeps advertising images', async () => {
  const clock = { t: 1_000 }
  const { manager: queue } = await manager([entry('a')], imageConfig, clock)
  await queue.warmFacts()
  assert.deepEqual(queue.routeFacts().inputModalities, ['text', 'image'])

  clock.t += 31_000 // one TTL later, nobody has polled the page
  assert.deepEqual(queue.routeFacts().inputModalities, ['text', 'image'],
    'an expired cache must still answer with what dsh last declared')
})

test('a failed re-resolve keeps the last known capabilities', async () => {
  const clock = { t: 1_000 }
  let answering = true
  const answer = (): ModelConfig => {
    if (!answering) throw new Error('provider temporarily unavailable')
    return imageConfig()
  }
  const { manager: queue } = await manager([entry('a')], answer, clock)
  await queue.warmFacts()

  clock.t += 31_000
  answering = false
  await queue.ensureFacts() // the stale member is re-resolved and refuses

  assert.deepEqual(queue.routeFacts().inputModalities, ['text', 'image'],
    'a dead provider must not demote a member the queue already knows')
})

test('warming records the resolved configuration in the document', async () => {
  const clock = { t: 1_000 }
  const { manager: queue, store } = await manager([entry('a')], imageConfig, clock)
  await queue.warmFacts()

  assert.deepEqual(store.current().entries[0]?.snapshot, imageConfig())
  assert.equal(store.commits(), 1)
})

test('a second warm with unchanged facts writes nothing', async () => {
  const clock = { t: 1_000 }
  const { manager: queue, store } = await manager([entry('a')], imageConfig, clock)
  await queue.warmFacts()
  await queue.warmFacts()

  assert.equal(store.commits(), 1, 'an unchanged snapshot must not rewrite the document')
})

test('a restart with an unreachable provider still advertises the stored snapshot', async () => {
  const clock = { t: 1_000 }
  const answer = (): ModelConfig => { throw new Error('provider not ready yet') }
  // The row inherited its snapshot from the previous run.
  const { manager: queue } = await manager([entry('a', imageConfig())], answer, clock)
  await queue.warmFacts()

  assert.deepEqual(queue.routeFacts().inputModalities, ['text', 'image'],
    'the document is the route\'s memory across a restart')
})

test('a row with no facts at all stays conservative', async () => {
  const clock = { t: 1_000 }
  const answer = (): ModelConfig => { throw new Error('unknown model') }
  const { manager: queue } = await manager([entry('a')], answer, clock)
  await queue.warmFacts()

  assert.deepEqual(queue.routeFacts().inputModalities, ['text'],
    'knowing nothing must never claim images')
})
