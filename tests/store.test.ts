/**
 * Persistence tests: round-trip, quarantine on corruption, atomic replacement
 * under concurrent commits.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { QueueStore, parseDocument, queuePathIn } from '../src/store.ts'
import type { QueueState } from '../src/queue.ts'

/** Collect warnings so a test can assert the user was told. */
function recorder(): { warn(message: string): void, messages: string[] } {
  const messages: string[] = []
  return { messages, warn: (message: string) => { messages.push(message) } }
}

/** Build a small state. */
function sample(revision = 3): QueueState {
  return {
    revision,
    cooldownMs: 60_000,
    entries: [
      {
        id: 'a',
        provider: 'deepseek-official',
        model: 'deepseek-v4-flash',
        label: 'DeepSeek V4 Flash',
        config: {
          inputModalities: ['text', 'image'],
          contextWindow: 500_000,
          maxTokens: 65_536,
          reasoning: {
            efforts: [
              { id: 'low', name: 'Low' },
              { id: 'high', name: 'High' },
            ],
            defaultEffort: 'high',
          },
        },
        cooldownUntil: 1_700_000_000_000,
        failures: 2,
        lastFailure: { code: 'QUOTA', message: 'out of credit', at: 1_699_999_000_000 },
      },
      {
        id: 'b',
        provider: 'od3',
        model: 'deepseek-v4.1-flash',
        label: 'OD3 V4.1 Flash',
        config: { inputModalities: ['text'], contextWindow: 200_000 },
        cooldownUntil: 0,
        failures: 0,
      },
    ],
  }
}

test('the queue document path lives under the harness home', () => {
  assert.equal(queuePathIn('/home/u/.dsh'), '/home/u/.dsh/model-queue/queue.json')
})

test('a missing document loads as an empty queue', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mq-store-'))
  const store = new QueueStore(join(dir, 'queue.json'), recorder())
  const loaded = await store.load()
  assert.deepEqual(loaded.entries, [])
  assert.equal(loaded.revision, 0)
})

test('a written state round-trips', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mq-store-'))
  const path = join(dir, 'queue.json')
  const first = new QueueStore(path, recorder())
  await first.load()
  await first.commit(sample())

  const second = new QueueStore(path, recorder())
  const loaded = await second.load()
  assert.deepEqual(loaded, sample())
})

test('a corrupt document is quarantined rather than overwritten', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mq-store-'))
  const path = join(dir, 'queue.json')
  await writeFile(path, '{ not json', 'utf8')
  const log = recorder()
  const store = new QueueStore(path, log)
  const loaded = await store.load()
  assert.deepEqual(loaded.entries, [])
  assert.equal(log.messages.length, 1)
  assert.match(log.messages[0] ?? '', /could not be read/)
  const names = await readdir(dir)
  assert.ok(names.some(name => name.startsWith('queue.json.corrupt-')), `expected a quarantine file, saw ${names.join(', ')}`)
})

test('an unsupported version is refused', () => {
  assert.throws(() => parseDocument({ version: 99, revision: 0, entries: [] }), /unsupported queue document version/)
})

test('duplicate ids are refused', () => {
  assert.throws(() => parseDocument({
    version: 1,
    revision: 0,
    entries: [
      { id: 'x', provider: 'p', model: 'm', label: 'l', cooldownUntil: 0, failures: 0 },
      { id: 'x', provider: 'p', model: 'm', label: 'l', cooldownUntil: 0, failures: 0 },
    ],
  }), /ids must be unique/)
})

test('an over-long queue is refused', () => {
  const entries = Array.from({ length: 65 }, (_unused, index) => ({
    id: `e${index}`, provider: 'p', model: 'm', label: 'l', cooldownUntil: 0, failures: 0,
  }))
  assert.throws(() => parseDocument({ version: 1, revision: 0, entries }), /at most 64/)
})

test('concurrent commits all reach the disk, last one winning', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mq-store-'))
  const path = join(dir, 'queue.json')
  const store = new QueueStore(path, recorder())
  await store.load()
  await Promise.all([
    store.commit(sample(1)),
    store.commit(sample(2)),
    store.commit(sample(3)),
    store.commit(sample(4)),
  ])
  const text = await readFile(path, 'utf8')
  assert.equal((JSON.parse(text) as QueueState & { version: number }).revision, 4)
  // No temporary files survive a successful write.
  const names = await readdir(dir)
  assert.deepEqual(names, ['queue.json'])
})

test('a stored failure without a message is refused', () => {
  assert.throws(() => parseDocument({
    version: 1,
    revision: 0,
    entries: [{
      id: 'a', provider: 'p', model: 'm', label: 'l', cooldownUntil: 0, failures: 1,
      lastFailure: { code: 'QUOTA', at: 1 },
    }],
  }), /lastFailure.message/)
})

test('a version 2 document folds its snapshot and overrides into one configuration', () => {
  // Version 2 stored a snapshot plus a sparse delta the user had changed. The
  // delta is folded in exactly once, on load; after that the row carries one
  // complete configuration and there is nothing left to layer.
  const loaded = parseDocument({
    version: 2,
    revision: 7,
    cooldownMs: 60_000,
    entries: [
      {
        id: 'a',
        provider: 'od',
        model: 'flash',
        label: 'flash',
        snapshot: { inputModalities: ['text', 'image'], contextWindow: 1_048_000, maxTokens: 128_000 },
        overrides: { contextWindow: 500_000, reasoningEffort: 'high' },
        cooldownUntil: 0,
        failures: 0,
      },
    ],
  })
  assert.deepEqual(loaded.entries[0]?.config, {
    inputModalities: ['text', 'image'],
    contextWindow: 500_000,
    maxTokens: 128_000,
  })
})

test('a version 2 row with no overrides keeps its snapshot as the configuration', () => {
  const loaded = parseDocument({
    version: 2,
    revision: 7,
    entries: [
      {
        id: 'a',
        provider: 'od',
        model: 'flash',
        label: 'flash',
        snapshot: { inputModalities: ['text', 'image'], contextWindow: 1_048_000 },
        overrides: {},
        cooldownUntil: 0,
        failures: 0,
      },
    ],
  })
  assert.deepEqual(loaded.entries[0]?.config, { inputModalities: ['text', 'image'], contextWindow: 1_048_000 })
})

test('a configuration is written back as version 3', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mq-store-'))
  const path = join(dir, 'queue.json')
  const store = new QueueStore(path, recorder())
  await store.load()
  await store.commit(sample())
  const written = JSON.parse(await readFile(path, 'utf8')) as { version: number, entries: { config?: unknown }[] }
  assert.equal(written.version, 3)
  assert.ok(written.entries[0]?.config !== undefined, 'the row stores its configuration directly')
})
