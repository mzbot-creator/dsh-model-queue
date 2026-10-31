/**
 * Capability-reading tests: dsh is read when a row is added or the user syncs,
 * and the answer then stands.
 *
 * The harness gates `read_image` on the route's `inputModalities`, so a queue
 * route that forgot its members between two requests would refuse images for no
 * visible reason. These tests pin that the value has no expiry, that a failed
 * re-read does not erase it, and that nothing refreshes on its own.
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

/** A host whose `llm` answers (or refuses) on demand, counting each read. */
function fakeCtx(answer: () => ModelConfig, reads: { n: number }) {
  return {
    llm: {
      resolveModelInfo: async (provider: string, model: string) => {
        reads.n += 1
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
async function manager(entries: QueueEntry[], answer: () => ModelConfig, clock = { t: 1_000 }) {
  const store = fakeStore(entries)
  const reads = { n: 0 }
  const built = new QueueManager(fakeCtx(answer, reads), store as never, () => clock.t)
  await built.start()
  return { manager: built, store, reads, clock }
}

test('a resolved configuration never expires', async () => {
  const { manager: queue, clock } = await manager([entry('a')], imageConfig)
  await queue.resolveConfig('od', 'a')
  assert.deepEqual(queue.routeFacts().inputModalities, ['text', 'image'])

  clock.t += 24 * 60 * 60 * 1000 // a day later
  assert.deepEqual(queue.routeFacts().inputModalities, ['text', 'image'],
    'dsh is not re-read on a clock, so the answer stands')
})

test('nothing reads dsh after boot without a user action', async () => {
  const { manager: queue, reads } = await manager([entry('a')], imageConfig)
  await queue.view()
  await queue.catalog()
  await new Promise(resolve => setTimeout(resolve, 50))

  assert.equal(reads.n, 0, 'boot and page reads must not resolve queued members')
  assert.deepEqual(queue.routeFacts().inputModalities, ['text'],
    'with nothing read yet, the route stays conservative')
})

test('the stored snapshot answers before anything is read', async () => {
  const { manager: queue } = await manager([entry('a', imageConfig())], imageConfig)
  assert.deepEqual(queue.routeFacts().inputModalities, ['text', 'image'],
    'the document is the route\'s memory across a restart')
})

test('a failed re-read keeps the last known capabilities', async () => {
  let answering = true
  const answer = (): ModelConfig => {
    if (!answering) throw new Error('provider temporarily unavailable')
    return imageConfig()
  }
  const { manager: queue } = await manager([entry('a')], answer)
  await queue.resolveConfig('od', 'a')

  answering = false
  await queue.syncConfigs() // the user asked to sync, and the provider is down

  assert.deepEqual(queue.routeFacts().inputModalities, ['text', 'image'],
    'a dead provider must not demote a member the queue already knows')
})

test('syncing records the resolved configuration in the document', async () => {
  const { manager: queue, store } = await manager([entry('a')], imageConfig)
  await queue.syncConfigs()

  assert.deepEqual(store.current().entries[0]?.snapshot, imageConfig())
  assert.equal(store.commits(), 1)
})

test('a second sync with unchanged facts writes nothing', async () => {
  const { manager: queue, store } = await manager([entry('a')], imageConfig)
  await queue.syncConfigs()
  await queue.syncConfigs()

  assert.equal(store.commits(), 1, 'an unchanged snapshot must not rewrite the document')
})

test('a row with no facts at all stays conservative', async () => {
  const answer = (): ModelConfig => { throw new Error('unknown model') }
  const { manager: queue } = await manager([entry('a')], answer)
  await queue.syncConfigs()

  assert.deepEqual(queue.routeFacts().inputModalities, ['text'],
    'knowing nothing must never claim images')
})

test('a row migrated from a version 1 document is read once at boot', async () => {
  // Version 1 carried no snapshot, so the row loads as UNKNOWN_CONFIG.
  const { manager: queue, store, reads } = await manager([entry('a')], imageConfig)
  assert.deepEqual(queue.routeFacts().inputModalities, ['text'], 'nothing read yet')

  await queue.readUnresolvedRows()

  assert.equal(reads.n, 1, 'the unread row is resolved exactly once')
  assert.deepEqual(store.current().entries[0]?.snapshot, imageConfig(), 'and the document now remembers it')
  assert.deepEqual(queue.routeFacts().inputModalities, ['text', 'image'])
})

test('a second boot does not re-read a row that already has a configuration', async () => {
  const { manager: queue, reads } = await manager([entry('a', imageConfig())], imageConfig)
  await queue.readUnresolvedRows()

  assert.equal(reads.n, 0, 'a stored configuration means the row was already read')
})
