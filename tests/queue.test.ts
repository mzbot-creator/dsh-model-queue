/**
 * Queue state-machine tests: the rotation, cooldown, exhaustion and ordering
 * rules the requirement is written in terms of.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  clearCooldowns,
  markSucceeded,
  rotateFailed,
  selectEntry,
  setCooldown,
  setEntries,
} from '../src/queue.ts'
import type { QueueEntry, QueueState } from '../src/queue.ts'
import { UNKNOWN_CONFIG } from '../src/model-config.ts'

const HOUR = 60 * 60 * 1000

/** Build one ready entry. */
function entry(id: string, cooldownUntil = 0, failures = 0): QueueEntry {
  return { id, provider: 'p', model: id, label: id, snapshot: UNKNOWN_CONFIG, overrides: {}, cooldownUntil, failures }
}

/** Build a state over the given entries. */
function state(...entries: QueueEntry[]): QueueState {
  return { revision: 0, entries, cooldownMs: HOUR }
}

test('the head of the queue is selected first', () => {
  const selection = selectEntry(state(entry('a'), entry('b'), entry('c')), 1000)
  assert.equal(selection.kind, 'entry')
  assert.equal(selection.kind === 'entry' ? selection.entry.id : undefined, 'a')
})

test('an empty queue reports empty', () => {
  assert.equal(selectEntry(state(), 0).kind, 'empty')
})

test('a failed entry rotates to the tail with a cooldown', () => {
  const before = state(entry('a'), entry('b'), entry('c'))
  const after = rotateFailed(before, 'a', { code: 'RATE_LIMIT', message: 'slow down' }, 1000)
  assert.deepEqual(after.entries.map(item => item.id), ['b', 'c', 'a'])
  const rotated = after.entries.at(-1)
  assert.equal(rotated?.cooldownUntil, 1000 + HOUR)
  assert.equal(rotated?.failures, 1)
  assert.equal(rotated?.lastFailure?.code, 'RATE_LIMIT')
  assert.equal(rotated?.lastFailure?.message, 'slow down')
  assert.equal(rotated?.lastFailure?.at, 1000)
  assert.equal(after.revision, 1)
  // The very next request starts from the new head.
  const selection = selectEntry(after, 1000)
  assert.equal(selection.kind === 'entry' ? selection.entry.id : undefined, 'b')
})

test('rotation is keyed by id, not by position', () => {
  const before = state(entry('a'), entry('b'), entry('c'))
  // Another request already rotated b while this one was in flight.
  const concurrent = rotateFailed(before, 'b', { code: 'SERVER', message: 'boom' }, 500)
  const after = rotateFailed(concurrent, 'a', { code: 'QUOTA', message: 'no credit' }, 1000)
  assert.deepEqual(after.entries.map(item => item.id), ['c', 'b', 'a'])
  assert.equal(after.entries.at(-1)?.lastFailure?.code, 'QUOTA')
})

test('rotating an entry that is no longer queued is a no-op', () => {
  const before = state(entry('a'))
  const after = rotateFailed(before, 'gone', { code: 'QUOTA', message: 'x' }, 1000)
  assert.equal(after, before)
})

test('the same failure is not applied twice to one entry', () => {
  const once = rotateFailed(state(entry('a'), entry('b')), 'a', { code: 'QUOTA', message: 'x' }, 1000)
  const twice = rotateFailed(once, 'a', { code: 'QUOTA', message: 'x' }, 1000)
  assert.equal(twice, once)
})

test('a cooling entry is skipped in favour of a ready one behind it', () => {
  const cooling = entry('a', 2000)
  const selection = selectEntry(state(cooling, entry('b')), 1000)
  assert.equal(selection.kind === 'entry' ? selection.entry.id : undefined, 'b')
})

test('an elapsed cooldown makes the entry selectable again', () => {
  const selection = selectEntry(state(entry('a', 1000)), 1000)
  assert.equal(selection.kind === 'entry' ? selection.entry.id : undefined, 'a')
})

test('a fully cooling queue is exhausted and reports the latest failure', () => {
  const first = rotateFailed(state(entry('a'), entry('b')), 'a', { code: 'QUOTA', message: 'first' }, 1000)
  const second = rotateFailed(first, 'b', { code: 'TRANSPORT', message: 'second' }, 2000)
  const selection = selectEntry(second, 3000)
  assert.equal(selection.kind, 'exhausted')
  if (selection.kind !== 'exhausted') return
  // The reason the user sees is the last failure, as specified.
  assert.equal(selection.failure?.message, 'second')
  assert.equal(selection.failure?.code, 'TRANSPORT')
  assert.equal(selection.retryAt, 1000 + HOUR)
})

test('a zero cooldown still rotates, so ordering stays defined', () => {
  const zero = setCooldown(state(entry('a'), entry('b')), 0)
  const after = rotateFailed(zero, 'a', { code: 'QUOTA', message: 'x' }, 1000)
  assert.deepEqual(after.entries.map(item => item.id), ['b', 'a'])
  assert.equal(after.entries.at(-1)?.cooldownUntil, 1000)
  // Immediately selectable again — the queue is not exhausted by a zero cooldown.
  const selection = selectEntry(after, 1000)
  assert.equal(selection.kind === 'entry' ? selection.entry.id : undefined, 'b')
})

test('a success clears the cooldown without reordering', () => {
  const cooled = rotateFailed(state(entry('a'), entry('b')), 'a', { code: 'QUOTA', message: 'x' }, 1000)
  const healed = markSucceeded(cooled, 'a')
  assert.deepEqual(healed.entries.map(item => item.id), ['b', 'a'])
  assert.equal(healed.entries.at(-1)?.cooldownUntil, 0)
  assert.equal(healed.entries.at(-1)?.lastFailure, undefined)
  // The failure count is history, not current health.
  assert.equal(healed.entries.at(-1)?.failures, 1)
})

test('a success on a healthy entry does not bump the revision', () => {
  const before = state(entry('a'))
  assert.equal(markSucceeded(before, 'a'), before)
})

test('reordering keeps ids, cooldowns and failure history', () => {
  const cooled = rotateFailed(state(entry('a'), entry('b')), 'a', { code: 'QUOTA', message: 'x' }, 1000)
  const reordered = setEntries(cooled, [
    { id: 'b', provider: 'p', model: 'b' },
    { id: 'a', provider: 'p', model: 'a' },
  ], [])
  assert.deepEqual(reordered.entries.map(item => item.id), ['b', 'a'])
  assert.equal(reordered.entries[1]?.cooldownUntil, 1000 + HOUR)
  assert.equal(reordered.entries[1]?.failures, 1)
})

test('a new entry gets a fresh id, joins ready, and an omitted entry is removed', () => {
  const before = rotateFailed(state(entry('a'), entry('b')), 'a', { code: 'QUOTA', message: 'x' }, 1000)
  const after = setEntries(before, [
    { id: 'b', provider: 'p', model: 'b' },
    { provider: 'q', model: 'c' },
  ], ['unused', 'generated'])
  assert.deepEqual(after.entries.map(item => item.id), ['b', 'generated'])
  assert.equal(after.entries[1]?.provider, 'q')
  assert.equal(after.entries[1]?.cooldownUntil, 0)
  assert.equal(after.entries[1]?.label, 'q/c')
})

test('an unchanged list does not bump the revision', () => {
  const before = state(entry('a'))
  assert.equal(setEntries(before, [{ id: 'a', provider: 'p', model: 'a' }], []), before)
})

test('clearing cooldowns keeps order and makes every entry ready', () => {
  const first = rotateFailed(state(entry('a'), entry('b')), 'a', { code: 'QUOTA', message: 'x' }, 1000)
  const second = rotateFailed(first, 'b', { code: 'QUOTA', message: 'y' }, 1000)
  const cleared = clearCooldowns(second)
  assert.deepEqual(cleared.entries.map(item => item.id), ['a', 'b'])
  assert.ok(cleared.entries.every(item => item.cooldownUntil === 0))
  assert.equal(selectEntry(cleared, 1000).kind, 'entry')
})

test('changing the cooldown applies to the next failure only', () => {
  const changed = setCooldown(state(entry('a', 5000)), 10)
  assert.equal(changed.cooldownMs, 10)
  assert.equal(changed.entries[0]?.cooldownUntil, 5000)
  const after = rotateFailed(changed, 'a', { code: 'QUOTA', message: 'x' }, 1000)
  assert.equal(after.entries[0]?.cooldownUntil, 1010)
})
