/**
 * Failure classification tests: which provider failures rotate the queue and
 * which must fail the request without blaming a model.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyFailure } from '../src/classify.ts'

test('an exhausted quota rotates to the next model', () => {
  assert.equal(classifyFailure('QUOTA'), 'rotate')
})

test('rate limiting rotates', () => {
  assert.equal(classifyFailure('RATE_LIMIT'), 'rotate')
})

test('an upstream server error rotates', () => {
  assert.equal(classifyFailure('SERVER'), 'rotate')
})

test('a transport failure rotates', () => {
  assert.equal(classifyFailure('TRANSPORT'), 'rotate')
})

test('a timeout rotates', () => {
  assert.equal(classifyFailure('TIMEOUT'), 'rotate')
})

test('an empty response rotates', () => {
  assert.equal(classifyFailure('EMPTY_RESPONSE'), 'rotate')
})

test('a missing or malformed credential rotates, because another member may be configured', () => {
  assert.equal(classifyFailure('MISSING_CREDENTIAL'), 'rotate')
  assert.equal(classifyFailure('INVALID_CREDENTIAL'), 'rotate')
})

test('an unregistered route rotates, because the other members are still usable', () => {
  assert.equal(classifyFailure('NO_ADAPTER'), 'rotate')
})

test('an unknown code rotates, since a new provider failure is more likely than a new request-shape error', () => {
  assert.equal(classifyFailure('SOMETHING_NEW'), 'rotate')
})

test('a context-window overflow fails the request instead of cooling the whole queue', () => {
  assert.equal(classifyFailure('CONTEXT_WINDOW_EXCEEDED'), 'fail')
})

test('cancellation fails the request without touching the queue', () => {
  assert.equal(classifyFailure('ABORTED'), 'fail')
})

test('an unsupported option fails the request', () => {
  assert.equal(classifyFailure('UNSUPPORTED_OPTION'), 'fail')
})

test('an unsupported reasoning effort fails the request', () => {
  assert.equal(classifyFailure('UNSUPPORTED_REASONING_EFFORT'), 'fail')
})
