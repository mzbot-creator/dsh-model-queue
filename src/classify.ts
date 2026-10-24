/**
 * Which provider failures rotate the queue, and which must fail the request.
 *
 * The rule: a queue rotation is a statement about a *model route* being
 * temporarily unusable, so only failures that could plausibly clear on another
 * model rotate. A request-shaped failure (context too long, unsupported content,
 * a bad option) would fail identically on every member, so rotating would cool
 * down every model for an hour and blame models for the caller's mistake.
 *
 * @module dsh-model-queue/classify
 */

/** What the queue should do with one failed attempt. */
export type FailureDisposition =
  /** The entry is unavailable right now: rotate it and record a cooldown. */
  | 'rotate'
  /** The request itself cannot succeed on any member: fail without touching the queue. */
  | 'fail'

/**
 * Codes that describe the request rather than the route.
 *
 * Everything else — quota exhaustion, rate limits, upstream 5xx, transport
 * errors, timeouts, empty responses, missing or malformed credentials, a
 * provider route that is no longer registered — is treated as a route failure
 * and rotates. That default is deliberate: an unrecognized code is far more
 * likely to be a new provider-side failure than a new request-shape error, and
 * a wrongly-rotated entry recovers by itself once its cooldown expires.
 */
const REQUEST_FAILURES: ReadonlySet<string> = new Set([
  'ABORTED',
  'CONTEXT_WINDOW_EXCEEDED',
  'IMAGE_OFFLOAD_REQUIRED',
  'INVALID_PREPARED_CALL',
  'INVALID_REQUEST',
  'INVALID_MODEL_CONTEXT',
  'INVALID_MODEL_INFO',
  'INVALID_MODEL_MAX_TOKENS',
  'INVALID_MODEL_REASONING',
  'UNSUPPORTED_CONTENT',
  'UNSUPPORTED_OPTION',
  'UNSUPPORTED_REASONING_EFFORT',
  'UNKNOWN_MODEL',
])

/**
 * Decide what one failure means for the queue.
 * @param code - stable failure code from the inner adapter.
 * @returns whether to rotate the failed entry or fail the request.
 */
export function classifyFailure(code: string): FailureDisposition {
  return REQUEST_FAILURES.has(code) ? 'fail' : 'rotate'
}
