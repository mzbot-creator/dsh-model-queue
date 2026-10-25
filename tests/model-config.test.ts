/**
 * The queue route advertises one set of capabilities for every member, so these
 * tests pin the intersection rules: an optimistic aggregate would let the loop
 * admit a request that a rotation then cannot serve.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { aggregateRouteConfig, applyOverrides, parseOverrides } from '../src/model-config.ts'
import type { ModelConfig } from '../src/contract.ts'

/** A configuration with a text+image multimodal model and a full capability set. */
const multimodal: ModelConfig = {
  inputModalities: ['text', 'image'],
  contextWindow: 1_000_000,
  maxTokens: 128_000,
  reasoning: {
    efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }],
    defaultEffort: 'high',
  },
}

/** A smaller text-only model, so every aggregate field has something to shrink. */
const textOnly: ModelConfig = {
  inputModalities: ['text'],
  contextWindow: 262_000,
  maxTokens: 32_000,
  reasoning: { efforts: [{ id: 'low', name: 'Low' }] },
}

test('an empty queue advertises text only and no capacities', () => {
  assert.deepEqual(aggregateRouteConfig([]), { inputModalities: ['text'] })
})

test('a single member is advertised exactly as dsh reports it', () => {
  assert.deepEqual(aggregateRouteConfig([multimodal]), multimodal)
})

test('images require every member to accept them', () => {
  assert.deepEqual(aggregateRouteConfig([multimodal, textOnly]).inputModalities, ['text'])
  assert.deepEqual(aggregateRouteConfig([multimodal, multimodal]).inputModalities, ['text', 'image'])
})

test('the window and the output cap take the smallest member', () => {
  const route = aggregateRouteConfig([multimodal, textOnly])
  assert.equal(route.contextWindow, 262_000)
  assert.equal(route.maxTokens, 32_000)
})

test('only reasoning levels every member offers survive', () => {
  const route = aggregateRouteConfig([multimodal, textOnly])
  assert.deepEqual(route.reasoning?.efforts.map(effort => effort.id), ['low'])
  // `high` was multimodal's default and textOnly does not offer it, so the
  // aggregate cannot claim a default the rotation might not honour.
  assert.equal(route.reasoning?.defaultEffort, undefined)
})

test('a shared default effort is kept', () => {
  const route = aggregateRouteConfig([multimodal, { ...textOnly, reasoning: { efforts: multimodal.reasoning?.efforts ?? [], defaultEffort: 'high' } }])
  assert.equal(route.reasoning?.defaultEffort, 'high')
})

test('a member with no reasoning at all removes the advertised levels', () => {
  const route = aggregateRouteConfig([multimodal, { inputModalities: ['text'], contextWindow: 1000 }])
  assert.equal(route.reasoning, undefined)
})

test('an unknown member makes the whole route conservative', () => {
  const route = aggregateRouteConfig([multimodal, { inputModalities: [] }])
  assert.deepEqual(route.inputModalities, ['text'])
  assert.equal(route.reasoning, undefined)
})

test('overrides narrow a member without touching the others', () => {
  assert.deepEqual(applyOverrides(multimodal, { contextWindow: 500_000 }), { ...multimodal, contextWindow: 500_000 })
  assert.deepEqual(
    applyOverrides(multimodal, { inputModalities: ['text'] }).inputModalities,
    ['text'],
  )
})

test('an override naming a level the model lacks is dropped', () => {
  // Forwarding it would make every request on that member fail with
  // UNSUPPORTED_REASONING_EFFORT, which is worse than ignoring the edit.
  assert.equal(applyOverrides(textOnly, { reasoningEffort: 'high' }).reasoning?.defaultEffort, undefined)
  assert.equal(applyOverrides(textOnly, { reasoningEffort: 'low' }).reasoning?.defaultEffort, 'low')
})

test('overrides round-trip through the wire parser', () => {
  const parsed = parseOverrides({ inputModalities: ['text'], contextWindow: 1024, maxTokens: 512, reasoningEffort: 'high' })
  assert.deepEqual(parsed, { inputModalities: ['text'], contextWindow: 1024, maxTokens: 512, reasoningEffort: 'high' })
  assert.deepEqual(parseOverrides(undefined), {})
  assert.deepEqual(parseOverrides({}), {})
})

test('a malformed override is refused rather than silently dropped', () => {
  assert.throws(() => parseOverrides({ contextWindow: -1 }), /positive whole number/)
  assert.throws(() => parseOverrides({ contextWindow: 1.5 }), /positive whole number/)
  assert.throws(() => parseOverrides({ inputModalities: ['audio'] }), /must be "text" or "image"/)
  assert.throws(() => parseOverrides({ inputModalities: [] }), /at least one modality/)
  assert.throws(() => parseOverrides('nope'), /must be an object/)
})
