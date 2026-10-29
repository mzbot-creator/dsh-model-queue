// src/index.ts
import z from "@deepseek-ai/schemastery";
import { resolveDshHome } from "@deepseek-ai/dsh-home-paths";

// src/adapter.ts
import { LlmAdapter, LlmError } from "@deepseek-ai/dsh-llm";

// src/classify.ts
var REQUEST_FAILURES = /* @__PURE__ */ new Set([
  "ABORTED",
  "CONTEXT_WINDOW_EXCEEDED",
  "IMAGE_OFFLOAD_REQUIRED",
  "INVALID_PREPARED_CALL",
  "INVALID_REQUEST",
  "INVALID_MODEL_CONTEXT",
  "INVALID_MODEL_INFO",
  "INVALID_MODEL_MAX_TOKENS",
  "INVALID_MODEL_REASONING",
  "UNSUPPORTED_CONTENT",
  "UNSUPPORTED_OPTION",
  "UNSUPPORTED_REASONING_EFFORT",
  "UNKNOWN_MODEL"
]);
function classifyFailure(code) {
  return REQUEST_FAILURES.has(code) ? "fail" : "rotate";
}

// src/contract.ts
var PACKAGE_NAME = "dsh-model-queue";
var PROFILE_ENTRY_ID = "model-queue";
var PROVIDER_ID = "dsh-model-queue";
var QUEUE_MODEL_ID = "queue";
var QUEUE_MODEL_NAME = "Model Queue";
var QUEUE_ROUTE = "/api/dsh-model-queue";
var ROUTE_REASONING_EFFORTS = Object.freeze([
  { id: "off", name: "Off" },
  { id: "minimal", name: "Minimal" },
  { id: "low", name: "Low" },
  { id: "medium", name: "Medium" },
  { id: "high", name: "High" },
  { id: "xhigh", name: "Xhigh" },
  { id: "max", name: "Max" }
]);

// src/adapter.ts
function hasVisibleContent(chunk) {
  switch (chunk.type) {
    case "text-delta":
    case "reasoning-delta":
      return chunk.text.length > 0;
    case "tool-call-delta":
      return true;
    case "block-end":
      return chunk.block.type === "tool-call" || chunk.block.type === "text" && chunk.block.text.length > 0 || chunk.block.type === "reasoning" && chunk.block.text.length > 0;
    default:
      return false;
  }
}
function failureOf(error) {
  const carried = error?.failure;
  if (carried !== void 0 && typeof carried.code === "string" && carried.code.length > 0 && typeof carried.message === "string" && carried.message.length > 0) {
    return carried;
  }
  return {
    code: error.code ?? "UNKNOWN",
    message: error instanceof Error ? error.message : String(error)
  };
}
function queueModelInfo(manager) {
  const facts = manager.routeFacts();
  return {
    provider: PROVIDER_ID,
    id: QUEUE_MODEL_ID,
    name: QUEUE_MODEL_NAME,
    description: "Tries the queue head first; a failed model rotates to the tail with a cooldown.",
    inputModalities: facts.inputModalities,
    context: { contextWindow: facts.contextWindow },
    ...facts.defaultMaxTokens === void 0 ? {} : { defaultMaxTokens: facts.defaultMaxTokens },
    reasoning: {
      efforts: ROUTE_REASONING_EFFORTS.map((effort) => ({
        id: effort.id,
        name: effort.name
      }))
    },
    systemPromptUpdate: "in-history",
    toolUpdate: "in-history"
  };
}
var QueueAdapter = class extends LlmAdapter {
  manager;
  logger;
  /**
   * @param manager - queue owner, consulted on every call.
   * @param logger - diagnostics for rotations and exhausted queues.
   */
  constructor(manager, logger) {
    super();
    this.manager = manager;
    this.logger = logger;
  }
  /**
   * Describe the one queue route.
   * @param provider - route name; always {@link PROVIDER_ID}.
   * @returns display metadata.
   */
  providerInfo(provider) {
    return { id: provider, name: QUEUE_MODEL_NAME };
  }
  /**
   * Advertise exactly one model: the queue itself.
   *
   * The picker then shows one stable choice. Members are chosen inside the
   * queue, which is the whole point — a session should not have to know which
   * provider answers.
   * @returns the single queue model.
   */
  listModels() {
    return Promise.resolve([{
      provider: PROVIDER_ID,
      id: QUEUE_MODEL_ID,
      name: QUEUE_MODEL_NAME,
      description: "Tries the queue head first; failures rotate to the tail."
    }]);
  }
  /**
   * Resolve the queue model's capabilities from the current members.
   * @param provider - route name.
   * @param model - requested model id; only the queue id is served.
   * @returns metadata for the queue route.
   */
  resolveModel(provider, model) {
    if (model !== QUEUE_MODEL_ID) {
      return Promise.reject(new LlmError(
        `provider "${provider}" serves only "${QUEUE_MODEL_ID}", not "${model}"`,
        "UNKNOWN_MODEL"
      ));
    }
    return Promise.resolve(queueModelInfo(this.manager));
  }
  /**
   * Serve one queued request, walking the queue until a member succeeds.
   *
   * Termination: every failure either rotates its entry to the tail or ends the
   * request. The loop additionally remembers which entries it already tried, so
   * a zero cooldown (rotation without waiting) cannot spin forever on the same
   * member.
   * @param options - the request the loop built.
   * @returns chunks from the member that answered, or one terminal failure.
   */
  async *stream(options) {
    const tried = /* @__PURE__ */ new Set();
    let lastFailure;
    while (true) {
      if (options.signal?.aborted === true) {
        yield { type: "finish", reason: { kind: "aborted", failure: { code: "ABORTED", message: "The request was cancelled." } } };
        return;
      }
      const selection = this.manager.select();
      if (selection.kind === "empty") {
        yield {
          type: "finish",
          reason: {
            kind: "error",
            failure: {
              code: "NO_MODEL",
              message: "The model queue is empty: add at least one model in Plugins \u2192 Model Queue."
            }
          }
        };
        return;
      }
      if (selection.kind === "exhausted") {
        const reason = lastFailure ?? (selection.failure === void 0 ? void 0 : { code: selection.failure.code, message: selection.failure.message });
        yield {
          type: "finish",
          reason: {
            kind: "error",
            failure: reason === void 0 ? { code: "QUEUE_EXHAUSTED", message: "Every model in the queue is cooling down after a failure." } : reason
          }
        };
        return;
      }
      const entry = selection.entry;
      if (tried.has(entry.id)) {
        const reason = lastFailure;
        yield {
          type: "finish",
          reason: {
            kind: "error",
            failure: reason === void 0 ? { code: "QUEUE_EXHAUSTED", message: "No model in the queue could serve this request." } : reason
          }
        };
        return;
      }
      tried.add(entry.id);
      const attempt = yield* this.attempt(options, entry);
      if (attempt.kind === "aborted") return;
      if (attempt.kind === "ok") {
        await this.manager.recordSuccess(entry);
        return;
      }
      lastFailure = attempt.failure;
      const outcome = await this.manager.recordFailure(entry, attempt.failure, options.signal);
      if (outcome === "ignored") {
        yield { type: "finish", reason: { kind: "error", failure: attempt.failure } };
        return;
      }
      this.logger.warn(
        `model-queue: ${entry.provider}/${entry.model} failed (${attempt.failure.code}: ${attempt.failure.message}); ` + (outcome === "exhausted" ? "every model is now cooling down." : `rotated to the tail with a ${Math.round(this.manager.cooldownMs() / 1e3)}s cooldown.`)
      );
    }
  }
  /**
   * Dispatch one attempt and report how it ended.
   *
   * Successful output streams through to the caller as it arrives, so a
   * rotation never delays visible text; the terminal chunk is inspected before
   * it is forwarded, so a failed attempt's partial output never reaches the
   * session (the loop would persist it and then continue on a half turn).
   * @param options - the original request.
   * @param entry - the member this attempt dispatches to.
   * @returns how the attempt ended.
   */
  async *attempt(options, entry) {
    const provider = entry.provider;
    const model = entry.model;
    const { reasoningEffort: callerEffort, ...rest } = options;
    void callerEffort;
    const inner = {
      ...rest,
      provider,
      model,
      ...this.requestControls(entry, options.maxTokens)
    };
    let failure;
    let aborted = false;
    let produced = false;
    try {
      for await (const chunk of this.manager.llm.stream(inner)) {
        if (chunk.type === "finish") {
          if (chunk.reason.kind === "error") {
            failure = chunk.reason.failure;
            break;
          }
          if (chunk.reason.kind === "aborted") {
            aborted = true;
            yield chunk;
            return { kind: "aborted" };
          }
        } else if (hasVisibleContent(chunk)) {
          produced = true;
        }
        if (failure === void 0) yield chunk;
      }
    } catch (error) {
      failure = failureOf(error);
    }
    if (aborted) return { kind: "aborted" };
    if (failure !== void 0) return { kind: "failed", failure };
    if (produced) return { kind: "ok" };
    return { kind: "failed", failure: { code: "EMPTY_RESPONSE", message: `${provider}/${model} produced no content.` } };
  }
  /**
   * Translate the route-level request into one member's own controls.
   *
   * The reasoning level the caller named is **ignored**, by design: the queue
   * route advertises the full harness vocabulary so that no stored selection can
   * ever be refused, and each member then runs on its own level instead of a
   * level borrowed from whichever model the picker showed. A row's own
   * `reasoningEffort` override still applies — that one is the member's explicit
   * configuration, not a value inherited from the call.
   * The output cap is the other control: the queue advertises the smallest
   * member's cap, so a request the route admitted may still exceed this member.
   * @param entry - the member the request is being dispatched to.
   * @param maxTokens - the cap the caller asked for, when it asked for one.
   * @returns the fields to override on the inner request.
   */
  requestControls(entry, maxTokens) {
    const controls = {};
    const pinned = this.manager.overridesOf(entry).reasoningEffort;
    if (pinned !== void 0 && this.manager.supportsEffort(entry, pinned)) {
      controls.reasoningEffort = pinned;
    }
    const cap = this.manager.effectiveConfig(entry).maxTokens;
    if (cap !== void 0 && maxTokens !== void 0 && maxTokens > cap) {
      controls.maxTokens = cap;
    }
    return controls;
  }
};

// src/manager.ts
import { randomUUID } from "node:crypto";

// src/model-config.ts
var MAX_EFFORT_ID = 200;
var MAX_EFFORT_NAME = 200;
var MAX_MODALITIES = 4;
var UNKNOWN_CONFIG = Object.freeze({ inputModalities: [] });
function normalizeModalities(value) {
  if (value === void 0) return [];
  const out = [];
  for (const entry of value) {
    if (entry !== "text" && entry !== "image") continue;
    if (!out.includes(entry)) out.push(entry);
  }
  if (out.length > 0 && !out.includes("text")) out.unshift("text");
  return out;
}
function normalizeReasoning(reasoning) {
  if (reasoning === void 0 || reasoning.efforts.length === 0) return void 0;
  const efforts = reasoning.efforts.map((effort) => ({
    id: effort.id,
    name: effort.name,
    ...effort.description === void 0 ? {} : { description: effort.description }
  }));
  return {
    efforts,
    ...reasoning.defaultEffort === void 0 ? {} : { defaultEffort: reasoning.defaultEffort }
  };
}
function configFromResolved(info) {
  const reasoning = normalizeReasoning(info.reasoning);
  return {
    inputModalities: normalizeModalities(info.inputModalities),
    ...info.context === void 0 ? {} : { contextWindow: info.context.contextWindow },
    ...info.defaultMaxTokens === void 0 ? {} : { maxTokens: info.defaultMaxTokens },
    ...reasoning === void 0 ? {} : { reasoning }
  };
}
function configFromListing(info) {
  return { inputModalities: normalizeModalities(info.inputModalities) };
}
function isCapacity(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
function applyOverrides(base, overrides) {
  const inputModalities = overrides.inputModalities === void 0 ? base.inputModalities : normalizeModalities(overrides.inputModalities);
  const contextWindow = overrides.contextWindow ?? base.contextWindow;
  const maxTokens = overrides.maxTokens ?? base.maxTokens;
  const reasoning = base.reasoning === void 0 ? void 0 : overrides.reasoningEffort !== void 0 && base.reasoning.efforts.some((effort) => effort.id === overrides.reasoningEffort) ? { ...base.reasoning, defaultEffort: overrides.reasoningEffort } : base.reasoning;
  return {
    inputModalities,
    ...contextWindow === void 0 ? {} : { contextWindow },
    ...maxTokens === void 0 ? {} : { maxTokens },
    ...reasoning === void 0 ? {} : { reasoning }
  };
}
function boundedString(value, max) {
  if (typeof value !== "string") return void 0;
  const trimmed = value.trim();
  if (trimmed === "" || trimmed.length > max) return void 0;
  return trimmed;
}
function readModalities(value) {
  if (value === void 0) return void 0;
  if (!Array.isArray(value)) throw new Error("`inputModalities` must be an array");
  if (value.length > MAX_MODALITIES) throw new Error(`\`inputModalities\` may hold at most ${MAX_MODALITIES} entries`);
  const out = [];
  for (const entry of value) {
    if (entry !== "text" && entry !== "image") {
      throw new Error(`\`inputModalities\` entries must be "text" or "image", not ${JSON.stringify(entry)}`);
    }
    if (!out.includes(entry)) out.push(entry);
  }
  if (out.length === 0) throw new Error("`inputModalities` must name at least one modality");
  return out;
}
function readCapacity(value, field) {
  if (value === void 0) return void 0;
  if (!isCapacity(value)) throw new Error(`\`${field}\` must be a positive whole number of tokens`);
  return value;
}
function parseOverrides(value) {
  if (value === void 0 || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) throw new Error("`overrides` must be an object");
  const record = value;
  const inputModalities = readModalities(record.inputModalities);
  const contextWindow = readCapacity(record.contextWindow, "contextWindow");
  const maxTokens = readCapacity(record.maxTokens, "maxTokens");
  const reasoningEffort = record.reasoningEffort === void 0 ? void 0 : boundedString(record.reasoningEffort, MAX_EFFORT_ID);
  if (record.reasoningEffort !== void 0 && reasoningEffort === void 0) {
    throw new Error(`\`reasoningEffort\` must be a non-empty string of at most ${MAX_EFFORT_ID} characters`);
  }
  return {
    ...inputModalities === void 0 ? {} : { inputModalities },
    ...contextWindow === void 0 ? {} : { contextWindow },
    ...maxTokens === void 0 ? {} : { maxTokens },
    ...reasoningEffort === void 0 ? {} : { reasoningEffort }
  };
}
function parseStoredConfig(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return void 0;
  const record = value;
  const inputModalities = Array.isArray(record.inputModalities) ? record.inputModalities.filter((entry) => entry === "text" || entry === "image") : [];
  const contextWindow = isCapacity(record.contextWindow) ? record.contextWindow : void 0;
  const maxTokens = isCapacity(record.maxTokens) ? record.maxTokens : void 0;
  const reasoning = parseStoredReasoning(record.reasoning);
  return {
    inputModalities: normalizeModalities(inputModalities),
    ...contextWindow === void 0 ? {} : { contextWindow },
    ...maxTokens === void 0 ? {} : { maxTokens },
    ...reasoning === void 0 ? {} : { reasoning }
  };
}
function parseStoredReasoning(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return void 0;
  const record = value;
  const raw = Array.isArray(record.efforts) ? record.efforts : [];
  const seen = /* @__PURE__ */ new Set();
  const efforts = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const effort = entry;
    const id = boundedString(effort.id, MAX_EFFORT_ID);
    const name2 = boundedString(effort.name, MAX_EFFORT_NAME);
    if (id === void 0 || name2 === void 0 || seen.has(id)) continue;
    seen.add(id);
    const description = boundedString(effort.description, MAX_EFFORT_NAME);
    efforts.push({ id, name: name2, ...description === void 0 ? {} : { description } });
  }
  if (efforts.length === 0) return void 0;
  const defaultEffort = boundedString(record.defaultEffort, MAX_EFFORT_ID);
  return {
    efforts,
    ...defaultEffort === void 0 || !seen.has(defaultEffort) ? {} : { defaultEffort }
  };
}
function aggregateRouteConfig(configs) {
  let contextWindow = Number.POSITIVE_INFINITY;
  let maxTokens = Number.POSITIVE_INFINITY;
  let images = configs.length > 0;
  let known = 0;
  for (const config of configs) {
    if (config.inputModalities.length === 0 && config.contextWindow === void 0) {
      images = false;
      continue;
    }
    known += 1;
    contextWindow = Math.min(contextWindow, config.contextWindow ?? Number.POSITIVE_INFINITY);
    maxTokens = Math.min(maxTokens, config.maxTokens ?? Number.POSITIVE_INFINITY);
    if (!config.inputModalities.includes("image")) images = false;
  }
  return {
    inputModalities: images && known > 0 ? ["text", "image"] : ["text"],
    ...Number.isFinite(contextWindow) ? { contextWindow } : {},
    ...Number.isFinite(maxTokens) ? { maxTokens } : {}
  };
}

// src/queue.ts
var DEFAULT_COOLDOWN_MS = 60 * 60 * 1e3;
var MAX_COOLDOWN_MS = 365 * 24 * 60 * 60 * 1e3;
var EMPTY_QUEUE = Object.freeze({
  revision: 0,
  entries: Object.freeze([]),
  cooldownMs: DEFAULT_COOLDOWN_MS
});
function selectEntry(state, now) {
  if (state.entries.length === 0) return { kind: "empty" };
  for (const entry of state.entries) {
    if (entry.cooldownUntil <= now) return { kind: "entry", entry };
  }
  let latest;
  let retryAt;
  for (const entry of state.entries) {
    if (entry.lastFailure !== void 0 && (latest === void 0 || entry.lastFailure.at > latest.at)) {
      latest = entry.lastFailure;
    }
    if (retryAt === void 0 || entry.cooldownUntil < retryAt) retryAt = entry.cooldownUntil;
  }
  return { kind: "exhausted", failure: latest, retryAt };
}
function rotateFailed(state, id, failure, now) {
  const index = state.entries.findIndex((entry2) => entry2.id === id);
  if (index < 0) return state;
  const entry = state.entries[index];
  if (entry.lastFailure !== void 0 && entry.lastFailure.at >= now) return state;
  const rotated = {
    ...entry,
    cooldownUntil: now + state.cooldownMs,
    lastFailure: { code: failure.code, message: failure.message, at: now },
    failures: entry.failures + 1
  };
  const entries = [...state.entries];
  entries.splice(index, 1);
  entries.push(rotated);
  return { ...state, revision: state.revision + 1, entries };
}
function markSucceeded(state, id) {
  const index = state.entries.findIndex((entry2) => entry2.id === id);
  if (index < 0) return state;
  const entry = state.entries[index];
  if (entry.cooldownUntil === 0 && entry.lastFailure === void 0) return state;
  const entries = [...state.entries];
  entries[index] = { ...entry, cooldownUntil: 0, lastFailure: void 0 };
  return { ...state, revision: state.revision + 1, entries };
}
function setEntries(state, next, ids) {
  const byId = new Map(state.entries.map((entry) => [entry.id, entry]));
  const entries = [];
  const seen = /* @__PURE__ */ new Set();
  next.forEach((wanted, index) => {
    const id = wanted.id !== void 0 && wanted.id !== "" ? wanted.id : ids[index];
    if (id === void 0 || seen.has(id)) return;
    seen.add(id);
    const existing = byId.get(id);
    const label = wanted.label !== void 0 && wanted.label !== "" ? wanted.label : existing?.label ?? `${wanted.provider}/${wanted.model}`;
    const sameModel = existing !== void 0 && existing.provider === wanted.provider && existing.model === wanted.model;
    const snapshot = sameModel ? wanted.snapshot ?? existing.snapshot : wanted.snapshot ?? UNKNOWN_CONFIG;
    const overrides = sameModel ? wanted.overrides ?? existing.overrides : wanted.overrides ?? {};
    if (sameModel) {
      entries.push({ ...existing, label, snapshot, overrides });
      return;
    }
    entries.push({
      id,
      provider: wanted.provider,
      model: wanted.model,
      label,
      snapshot,
      overrides,
      cooldownUntil: existing?.cooldownUntil ?? 0,
      ...existing?.lastFailure === void 0 ? {} : { lastFailure: existing.lastFailure },
      failures: existing?.failures ?? 0
    });
  });
  if (sameEntries(state.entries, entries)) return state;
  return { ...state, revision: state.revision + 1, entries };
}
function setCooldown(state, cooldownMs) {
  if (state.cooldownMs === cooldownMs) return state;
  return { ...state, revision: state.revision + 1, cooldownMs };
}
function clearCooldowns(state) {
  if (state.entries.every((entry) => entry.cooldownUntil === 0)) return state;
  return {
    ...state,
    revision: state.revision + 1,
    entries: state.entries.map((entry) => ({ ...entry, cooldownUntil: 0 }))
  };
}
function sameEntries(left, right) {
  if (left.length !== right.length) return false;
  return left.every((entry, index) => {
    const other = right[index];
    return other !== void 0 && entry.id === other.id && entry.provider === other.provider && entry.model === other.model && entry.label === other.label && sameConfig(entry.snapshot, other.snapshot) && sameOverrides(entry.overrides, other.overrides) && entry.cooldownUntil === other.cooldownUntil && entry.failures === other.failures && entry.lastFailure?.at === other.lastFailure?.at && entry.lastFailure?.code === other.lastFailure?.code && entry.lastFailure?.message === other.lastFailure?.message;
  });
}
function sameConfig(left, right) {
  if (left === right) return true;
  if (left === void 0 || right === void 0) return false;
  if (left.contextWindow !== right.contextWindow) return false;
  if (left.maxTokens !== right.maxTokens) return false;
  if (left.inputModalities.length !== right.inputModalities.length) return false;
  if (!left.inputModalities.every((modality, index) => right.inputModalities[index] === modality)) return false;
  const leftEfforts = left.reasoning?.efforts ?? [];
  const rightEfforts = right.reasoning?.efforts ?? [];
  if (leftEfforts.length !== rightEfforts.length) return false;
  if (left.reasoning?.defaultEffort !== right.reasoning?.defaultEffort) return false;
  return leftEfforts.every((effort, index) => {
    const other = rightEfforts[index];
    return other !== void 0 && effort.id === other.id && effort.name === other.name && effort.description === other.description;
  });
}
function sameOverrides(left, right) {
  if (left === right) return true;
  if (left.contextWindow !== right.contextWindow) return false;
  if (left.maxTokens !== right.maxTokens) return false;
  if (left.reasoningEffort !== right.reasoningEffort) return false;
  const leftModalities = left.inputModalities;
  const rightModalities = right.inputModalities;
  if (leftModalities === void 0 || rightModalities === void 0) return leftModalities === rightModalities;
  return leftModalities.length === rightModalities.length && leftModalities.every((modality, index) => rightModalities[index] === modality);
}

// src/store.ts
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
var FORMAT_VERSION = 2;
var LEGACY_FORMAT_VERSION = 1;
var MAX_ENTRIES = 64;
var MAX_IDENTIFIER = 200;
var MAX_LABEL = 200;
function requiredString(value, field, max = MAX_IDENTIFIER) {
  if (typeof value !== "string" || value.length === 0 || value.length > max) {
    throw new Error(`${field} must be a non-empty string of at most ${max} characters`);
  }
  return value;
}
function optionalFailure(value) {
  if (value === void 0 || value === null) return void 0;
  if (typeof value !== "object") throw new Error("lastFailure must be an object");
  const record = value;
  const at = record.at;
  if (typeof at !== "number" || !Number.isFinite(at) || at < 0) {
    throw new Error("lastFailure.at must be a non-negative epoch millisecond value");
  }
  return {
    code: requiredString(record.code, "lastFailure.code", 100),
    message: requiredString(record.message, "lastFailure.message", 4e3),
    at
  };
}
function parseEntry(value) {
  if (typeof value !== "object" || value === null) throw new Error("each entry must be an object");
  const record = value;
  const cooldownUntil = record.cooldownUntil ?? 0;
  const failures = record.failures ?? 0;
  if (typeof cooldownUntil !== "number" || !Number.isFinite(cooldownUntil) || cooldownUntil < 0) {
    throw new Error("entry.cooldownUntil must be a non-negative epoch millisecond value");
  }
  if (typeof failures !== "number" || !Number.isSafeInteger(failures) || failures < 0) {
    throw new Error("entry.failures must be a non-negative integer");
  }
  const lastFailure = optionalFailure(record.lastFailure);
  return {
    id: requiredString(record.id, "entry.id"),
    provider: requiredString(record.provider, "entry.provider"),
    model: requiredString(record.model, "entry.model"),
    label: requiredString(record.label, "entry.label", MAX_LABEL),
    snapshot: parseStoredConfig(record.snapshot) ?? UNKNOWN_CONFIG,
    overrides: parseStoredOverrides(record.overrides),
    cooldownUntil,
    ...lastFailure === void 0 ? {} : { lastFailure },
    failures
  };
}
function parseStoredOverrides(value) {
  try {
    return parseOverrides(value);
  } catch {
    return {};
  }
}
function parseDocument(value) {
  if (typeof value !== "object" || value === null) throw new Error("the queue document must be an object");
  const record = value;
  if (record.version !== FORMAT_VERSION && record.version !== LEGACY_FORMAT_VERSION) {
    throw new Error(`unsupported queue document version ${String(record.version)}; expected ${FORMAT_VERSION}`);
  }
  const revision = record.revision ?? 0;
  if (typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 0) {
    throw new Error("revision must be a non-negative integer");
  }
  const cooldownMs = record.cooldownMs ?? DEFAULT_COOLDOWN_MS;
  if (typeof cooldownMs !== "number" || !Number.isFinite(cooldownMs) || cooldownMs < 0) {
    throw new Error("cooldownMs must be a finite non-negative number");
  }
  if (!Array.isArray(record.entries)) throw new Error("entries must be an array");
  if (record.entries.length > MAX_ENTRIES) throw new Error(`entries may hold at most ${MAX_ENTRIES} models`);
  const entries = record.entries.map(parseEntry);
  const ids = new Set(entries.map((entry) => entry.id));
  if (ids.size !== entries.length) throw new Error("entry ids must be unique");
  return { revision, cooldownMs: Math.min(cooldownMs, MAX_COOLDOWN_MS), entries };
}
function normalizeCooldown(value) {
  if (!Number.isFinite(value) || value < 0 || value > MAX_COOLDOWN_MS) {
    throw new Error(`cooldownMs must be a finite number from 0 through ${MAX_COOLDOWN_MS}`);
  }
  return value;
}
var QueueStore = class {
  /** The queue is read once at activation and written after each accepted mutation. */
  state = EMPTY_QUEUE;
  /** Serializes writes so two mutations cannot interleave their file renames. */
  writeChain = Promise.resolve();
  path;
  logger;
  /**
   * @param path - absolute path of the JSON document.
   * @param logger - reporter for a corrupt document, so the user learns why their queue reset.
   */
  constructor(path, logger) {
    this.path = path;
    this.logger = logger;
  }
  /**
   * The absolute path this store owns.
   * @returns the document path.
   */
  get file() {
    return this.path;
  }
  /**
   * Load the document, treating absence as an empty queue.
   * @returns the loaded state.
   */
  async load() {
    let text;
    try {
      text = await readFile(this.path, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") {
        this.state = EMPTY_QUEUE;
        return this.state;
      }
      throw error;
    }
    try {
      this.state = parseDocument(JSON.parse(text));
    } catch (error) {
      const quarantine = `${this.path}.corrupt-${Date.now()}`;
      try {
        await rename(this.path, quarantine);
      } catch {
      }
      this.logger.warn(
        `model-queue: the queue document could not be read (${error instanceof Error ? error.message : String(error)}); starting from an empty queue. The previous file was kept at ${quarantine}.`
      );
      this.state = EMPTY_QUEUE;
    }
    return this.state;
  }
  /**
   * Read the current state.
   * @returns the queue state.
   */
  current() {
    return this.state;
  }
  /**
   * Replace the state and persist it.
   *
   * Persistence is serialized and awaited by the caller, so an answer sent to
   * the browser never claims a state that has not reached the disk.
   * @param next - the new state.
   * @returns when the new state is durable.
   */
  async commit(next) {
    this.state = next;
    const document = {
      version: FORMAT_VERSION,
      revision: next.revision,
      cooldownMs: next.cooldownMs,
      entries: next.entries
    };
    const text = `${JSON.stringify(document, null, 2)}
`;
    const write = this.writeChain.then(async () => {
      await mkdir(dirname(this.path), { recursive: true });
      const temporary = `${this.path}.tmp-${process.pid}-${Date.now()}`;
      await writeFile(temporary, text, { encoding: "utf8", mode: 384 });
      await rename(temporary, this.path);
    });
    this.writeChain = write.catch(() => {
    });
    await write;
  }
};
function queuePathIn(home) {
  return join(home, "model-queue", "queue.json");
}

// src/manager.ts
var FALLBACK_CONTEXT_WINDOW = 128e3;
var MODEL_FACTS_TTL_MS = 3e4;
var QueueManager = class {
  /** Cached capability facts per `provider\u0000model`. */
  facts = /* @__PURE__ */ new Map();
  /** Serializes every mutation so read-modify-write cannot lose an update. */
  chain = Promise.resolve();
  /** Notified after each committed state change. */
  listeners = /* @__PURE__ */ new Set();
  ctx;
  store;
  clock;
  /**
   * @param ctx - host context carrying `llm`.
   * @param store - durable document owner.
   * @param clock - epoch-millisecond source; injectable for tests.
   */
  constructor(ctx, store, clock = () => Date.now()) {
    this.ctx = ctx;
    this.store = store;
    this.clock = clock;
  }
  /** The host LLM registry, needed for capability lookup and dispatch. */
  get llm() {
    return this.ctx.llm;
  }
  /**
   * Load the persisted queue.
   * @returns when the state is available.
   */
  async start() {
    await this.store.load();
  }
  /**
   * Read the current state.
   * @returns the queue state.
   */
  state() {
    return this.store.current();
  }
  /**
   * The cooldown currently applied to failures.
   * @returns milliseconds.
   */
  cooldownMs() {
    return this.store.current().cooldownMs;
  }
  /**
   * Observe committed state changes.
   * @param listener - called after each commit.
   * @returns the disposer removing the listener.
   */
  subscribe(listener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  /** Notify every observer; failures in an observer cannot break a mutation. */
  publish() {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (error) {
        this.ctx.logger("model-queue").warn(`observer failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  /**
   * Run one mutation under the serialization chain.
   * @param mutate - state transformation; may return the same object to skip the write.
   * @returns the state after the operation.
   */
  enqueue(mutate) {
    const run = this.chain.then(async () => {
      const current = this.store.current();
      const next = await mutate(current);
      if (next !== current) {
        await this.store.commit(next);
        this.publish();
      }
      return next;
    });
    this.chain = run.catch(() => {
    });
    return run;
  }
  /**
   * Pick the entry one request should start from.
   * @returns the selection at the current clock.
   */
  select() {
    return selectEntry(this.state(), this.clock());
  }
  /**
   * Record one successful attempt: the entry leaves cooldown.
   * @param entry - the entry that served the request.
   * @returns when the state is durable.
   */
  async recordSuccess(entry) {
    await this.enqueue((state) => markSucceeded(state, entry.id));
  }
  /**
   * Record one failed attempt.
   *
   * A request-shaped failure (`classify.ts`) leaves the queue untouched: the
   * same request would fail on every member, and cooling down the whole queue
   * would misreport the cause.
   * @param entry - the entry that failed.
   * @param failure - the inner failure.
   * @param signal - caller cancellation, which also leaves the queue untouched.
   * @returns whether the entry rotated, and whether the queue is now exhausted.
   */
  async recordFailure(entry, failure, signal) {
    if (classifyFailure(failure.code) === "fail" || signal?.aborted === true) return "ignored";
    const state = await this.enqueue((current) => rotateFailed(current, entry.id, failure, this.clock()));
    return selectEntry(state, this.clock()).kind === "exhausted" ? "exhausted" : "rotated";
  }
  /**
   * Replace the queue with an ordered list from the UI.
   *
   * A row that arrives without a snapshot is resolved against its route first,
   * so the queue never stores a row it knows nothing about while the route is
   * answering. A reorder (an id that still names the same model) keeps the
   * stored snapshot and overrides, so moving a row never silently resets it.
   * @param entries - the requested entries.
   * @returns the committed state.
   * @throws {Error} when a row is not a usable provider/model pair.
   */
  async setEntries(entries) {
    if (entries.length > 64) throw new Error("the queue may hold at most 64 models");
    for (const entry of entries) {
      if (entry.provider.trim() === "" || entry.model.trim() === "") {
        throw new Error("every queue row needs a provider and a model");
      }
    }
    const byId = new Map(this.state().entries.map((entry) => [entry.id, entry]));
    const resolved = await Promise.all(entries.map(async (entry) => {
      const existing = entry.id === void 0 ? void 0 : byId.get(entry.id);
      if (existing !== void 0 && existing.provider === entry.provider && existing.model === entry.model) {
        return entry;
      }
      if (entry.snapshot !== void 0) return entry;
      const config = await this.resolveConfig(entry.provider, entry.model);
      return { ...entry, snapshot: config ?? UNKNOWN_CONFIG };
    }));
    const ids = entries.map(() => randomUUID());
    return this.enqueue((state) => setEntries(state, resolved, ids));
  }
  /**
   * Change the failure cooldown.
   * @param cooldownMs - requested cooldown.
   * @returns the committed state.
   * @throws {Error} when the value is out of range.
   */
  async setCooldown(cooldownMs) {
    const normalized = normalizeCooldown(cooldownMs);
    return this.enqueue((state) => setCooldown(state, normalized));
  }
  /**
   * Clear every cooldown so the queue can be tried again immediately.
   * @returns the committed state.
   */
  async clearCooldowns() {
    return this.enqueue((state) => clearCooldowns(state));
  }
  /**
   * Re-read every member's configuration and store what the route reports.
   *
   * This is the "sync" half of the feature: a model reconfigured in dsh's own
   * settings (a new context window, a new reasoning level, image support) is
   * picked up by the queue without the user re-adding the row. Overrides are
   * left alone — they are the user's explicit intent, not a cache.
   * @returns whether any row's snapshot changed.
   */
  async syncConfigs() {
    const state = this.state();
    const updates = /* @__PURE__ */ new Map();
    await Promise.all(state.entries.map(async (entry) => {
      const config = await this.resolveConfig(entry.provider, entry.model);
      if (config !== void 0) updates.set(entry.id, config);
    }));
    if (updates.size === 0) return false;
    let changed = false;
    await this.enqueue((current) => {
      const entries = current.entries.map((entry) => {
        const config = updates.get(entry.id);
        if (config === void 0) return entry;
        changed = true;
        return { ...entry, snapshot: config };
      });
      return changed ? { ...current, revision: current.revision + 1, entries } : current;
    });
    return changed;
  }
  /**
   * Project the state for one browser, with countdowns resolved against a
   * single host clock reading so a page cannot mix two instants.
   * @returns the wire view.
   */
  view() {
    const state = this.state();
    const now = this.clock();
    const selection = selectEntry(state, now);
    const entries = state.entries.map((entry) => {
      const resolved = this.memberFacts(entry.provider, entry.model);
      return {
        id: entry.id,
        provider: entry.provider,
        model: entry.model,
        label: entry.label,
        cooldownUntil: entry.cooldownUntil,
        remainingMs: Math.max(0, entry.cooldownUntil - now),
        failures: entry.failures,
        ...entry.lastFailure === void 0 ? {} : { lastFailure: entry.lastFailure },
        ...resolved === void 0 ? {} : { resolved },
        snapshot: entry.snapshot,
        overrides: entry.overrides,
        effective: applyOverrides(resolved ?? entry.snapshot, entry.overrides)
      };
    });
    return {
      revision: state.revision,
      cooldownMs: state.cooldownMs,
      now,
      provider: PROVIDER_ID,
      model: QUEUE_MODEL_ID,
      entries,
      head: selection.kind === "entry" ? selection.entry.id : null,
      exhausted: selection.kind === "exhausted",
      route: this.routeConfig(),
      ...selection.kind !== "exhausted" || selection.failure === void 0 ? {} : { failure: selection.failure }
    };
  }
  /**
   * List every model the host can currently route to, with the complete
   * configuration each one resolves to.
   *
   * The queue route itself is excluded: queueing the queue would recurse. Each
   * model is resolved rather than merely listed, because the picker has to show
   * the same capacities dsh shows for that model.
   * @returns the catalog, with per-provider failures instead of a global one.
   */
  async catalog() {
    const models = [];
    const failures = [];
    for (const provider of this.llm.listProviders()) {
      if (provider.id === PROVIDER_ID) continue;
      let listed;
      try {
        listed = await this.llm.listModels(provider.id);
      } catch (error) {
        failures.push({
          provider: provider.id,
          message: error instanceof Error ? error.message : String(error)
        });
        continue;
      }
      for (const model of listed) {
        const config = await this.resolveConfig(provider.id, model.id);
        models.push({
          provider: provider.id,
          providerName: provider.name,
          model: model.id,
          name: model.name,
          ...model.description === void 0 ? {} : { description: model.description },
          config: config ?? configFromListing(model),
          resolved: config !== void 0,
          ...config !== void 0 ? {} : { resolveError: this.facts.get(`${provider.id}\0${model.id}`)?.error ?? "the route did not answer" }
        });
      }
    }
    return { models, failures };
  }
  /**
   * Resolve one member's complete configuration, using the cache when it is
   * still fresh.
   * @param provider - member provider route.
   * @param model - member model id.
   * @returns the resolved facts, or `undefined` when the route refused.
   */
  memberFacts(provider, model) {
    const cached = this.facts.get(`${provider}\0${model}`);
    if (cached !== void 0 && cached.expiresAt > this.clock()) return cached.value;
    return void 0;
  }
  /**
   * Resolve and cache one member's complete configuration.
   *
   * A route that cannot answer is cached as "unknown" for the same short TTL,
   * so a page load does not hammer a dead provider while still recovering
   * quickly once it returns.
   * @param provider - member provider route.
   * @param model - member model id.
   * @returns the facts, or `undefined` when resolution failed.
   */
  async resolveConfig(provider, model) {
    const key = `${provider}\0${model}`;
    try {
      const info = await this.llm.resolveModelInfo(provider, model);
      const value = configFromResolved(info);
      this.facts.set(key, { expiresAt: this.clock() + MODEL_FACTS_TTL_MS, value });
      return value;
    } catch (error) {
      this.facts.set(key, {
        expiresAt: this.clock() + MODEL_FACTS_TTL_MS,
        value: void 0,
        error: error instanceof Error ? error.message : String(error)
      });
      return void 0;
    }
  }
  /**
   * Warm the capability cache for every member, so the first request does not
   * have to wait for a cold lookup.
   * @returns when every member has been attempted.
   */
  async warmFacts() {
    await Promise.all(this.state().entries.map((entry) => this.resolveConfig(entry.provider, entry.model)));
  }
  /**
   * The effective configuration of one member: its overrides over its facts.
   * @param entry - the member.
   * @returns the configuration a dispatch through this member uses.
   */
  effectiveConfig(entry) {
    return applyOverrides(this.memberFacts(entry.provider, entry.model) ?? entry.snapshot, entry.overrides);
  }
  /**
   * Whether a member accepts one reasoning effort.
   * @param entry - the member.
   * @param effort - the row-level level the adapter is about to forward.
   * @returns `true` when the member's effective configuration offers it.
   */
  supportsEffort(entry, effort) {
    return this.effectiveConfig(entry).reasoning?.efforts.some((level) => level.id === effort) ?? false;
  }
  /**
   * Read one member's overrides.
   * @param entry - the member.
   * @returns the overrides.
   */
  overridesOf(entry) {
    return entry.overrides;
  }
  /**
   * Aggregate the members' effective configurations into the facts the queue
   * route advertises.
   *
   * The aggregation itself lives in `model-config`, where it is a pure function
   * of the members' configurations and can be tested without a registry; this
   * method only supplies the per-member inputs. The effective configuration
   * already falls back to the snapshot a row captured, so a cold resolve cache
   * (a fresh boot, a page load before any request) still aggregates what dsh
   * last said instead of advertising nothing at all.
   *
   * Reasoning levels are the one exception: the adapter strips the level a call
   * names, so the route advertises the harness's whole vocabulary rather than
   * the members' intersection. The intersection would be a claim the route does
   * not honour — and a dangerous one, since the harness refuses a call whose
   * level the resolved model omits.
   * @returns the advertised configuration.
   */
  routeConfig() {
    const aggregate = aggregateRouteConfig(this.state().entries.map((entry) => this.effectiveConfig(entry)));
    return {
      ...aggregate,
      reasoning: { efforts: [...ROUTE_REASONING_EFFORTS] }
    };
  }
  /**
   * The same aggregation in the shape the adapter advertises, keeping the
   * fallback window so the route is never context-less.
   * @returns the advertised facts.
   */
  routeFacts() {
    const config = this.routeConfig();
    return {
      inputModalities: config.inputModalities,
      contextWindow: config.contextWindow ?? FALLBACK_CONTEXT_WINDOW,
      ...config.maxTokens === void 0 ? {} : { defaultMaxTokens: config.maxTokens },
      ...config.reasoning === void 0 ? {} : { reasoning: config.reasoning }
    };
  }
  /**
   * Refresh the capability caches for every member whose facts are missing or
   * have expired, leaving the fresh ones alone.
   *
   * The browser polls the queue view, and a view cannot describe a row whose
   * facts it does not have. Re-resolving every member on every poll would hammer
   * the providers, so this only pays for the entries that actually went stale.
   * @returns when the stale members have been attempted.
   */
  async ensureFacts() {
    await Promise.all(this.state().entries.map((entry) => this.memberFacts(entry.provider, entry.model) === void 0 ? this.resolveConfig(entry.provider, entry.model) : void 0));
  }
  /**
   * Refresh the reasoning-effort and capability caches for every member.
   * @returns when the refresh finished.
   */
  async refreshFacts() {
    await this.warmFacts();
  }
};

// src/routes.ts
function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}
function fail(status, code, message) {
  const body = { error: { code, message } };
  return json(body, status);
}
async function readBody(request) {
  let text;
  try {
    text = await request.text();
  } catch {
    throw new Error("the request body could not be read");
  }
  if (text.trim() === "") return {};
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("the request body is not valid JSON");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("the request body must be a JSON object");
  }
  return value;
}
function sameOrigin(request) {
  const origin = request.headers.get("origin");
  if (origin === null) return true;
  const host = request.headers.get("host");
  if (host === null) return true;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
function registerRoutes(ctx, manager) {
  const connection = ctx.get("connection");
  if (connection === void 0) {
    ctx.logger("model-queue").warn("no connection service; the queue page will not be able to read or edit the queue");
    return async () => {
    };
  }
  const register = (path, methods, handler) => {
    ctx.effect(
      () => connection.fetch.register({
        path,
        methods,
        requestBody: "buffered",
        fetch: async (request) => {
          if (!sameOrigin(request)) return fail(403, "cross-origin", "cross-origin request rejected");
          try {
            return await handler(request);
          } catch (error) {
            return fail(400, "rejected", error instanceof Error ? error.message : String(error));
          }
        }
      }),
      `model-queue: route ${path}`
    );
  };
  register(`${QUEUE_ROUTE}/state`, ["GET"], async () => {
    await manager.ensureFacts();
    return json(manager.view());
  });
  register(`${QUEUE_ROUTE}/catalog`, ["GET"], async () => {
    const catalog = await manager.catalog();
    return json(catalog);
  });
  register(`${QUEUE_ROUTE}/sync`, ["POST"], async () => {
    await manager.syncConfigs();
    return json(manager.view());
  });
  register(`${QUEUE_ROUTE}/entries`, ["POST"], async (request) => {
    const body = await readBody(request);
    const entries = body.entries;
    if (!Array.isArray(entries)) return fail(400, "invalid-entries", "`entries` must be an array");
    if (entries.length > MAX_ENTRIES) {
      return fail(400, "too-many-entries", `a queue may hold at most ${MAX_ENTRIES} models`);
    }
    const normalized = entries.map((value, index) => {
      if (typeof value !== "object" || value === null) {
        throw new Error(`entry ${index} must be an object`);
      }
      const row = value;
      const provider = row.provider;
      const model = row.model;
      const id = row.id;
      const label = row.label;
      if (typeof provider !== "string" || provider === "") throw new Error(`entry ${index} needs a provider`);
      if (typeof model !== "string" || model === "") throw new Error(`entry ${index} needs a model`);
      if (id !== void 0 && typeof id !== "string") throw new Error(`entry ${index} has an invalid id`);
      if (label !== void 0 && typeof label !== "string") throw new Error(`entry ${index} has an invalid label`);
      const snapshot = parseStoredConfig(row.snapshot);
      const overrides = parseOverrides(row.overrides);
      return {
        provider,
        model,
        ...id === void 0 ? {} : { id },
        ...label === void 0 ? {} : { label },
        ...snapshot === void 0 ? {} : { snapshot },
        // Forwarded even when empty: `{}` is the caller saying "follow dsh
        // again", which must be able to clear overrides a row already carries.
        // A caller that omits the key entirely (a bare reorder) keeps them, so
        // the distinction between absent and empty is load-bearing.
        ..."overrides" in row ? { overrides } : {}
      };
    });
    await manager.setEntries(normalized);
    return json(manager.view());
  });
  register(`${QUEUE_ROUTE}/cooldown`, ["POST"], async (request) => {
    const body = await readBody(request);
    const cooldownMs = body.cooldownMs;
    if (typeof cooldownMs !== "number") return fail(400, "invalid-cooldown", "`cooldownMs` must be a number");
    await manager.setCooldown(cooldownMs);
    return json(manager.view());
  });
  register(`${QUEUE_ROUTE}/reset`, ["POST"], async () => {
    await manager.clearCooldowns();
    return json(manager.view());
  });
  return async () => {
  };
}

// src/index.ts
var name = "model-queue";
var inject = ["llm"];
var Config = z.object({
  enabled: z.boolean().default(true).volatile().description("\u5173\u95ED\u540E\u961F\u5217\u8DEF\u7531\u4F1A\u4ECE\u6A21\u578B\u9009\u62E9\u5668\u64A4\u56DE\uFF0C\u5DF2\u6392\u961F\u7684\u6A21\u578B\u4FDD\u6301\u4E0D\u53D8"),
  cooldownMs: z.natural().min(0).max(MAX_COOLDOWN_MS).default(DEFAULT_COOLDOWN_MS).volatile().description("\u67D0\u4E2A\u6A21\u578B\u5931\u8D25\u540E\u8FDB\u5165\u51B7\u5374\u7684\u65F6\u957F\uFF08\u6BEB\u79D2\uFF09\uFF1B\u9ED8\u8BA4 1 \u5C0F\u65F6\u30020 \u8868\u793A\u4ECD\u7136\u8F6E\u6362\u5230\u961F\u5C3E\uFF0C\u4F46\u4E0D\u7B49\u5F85"),
  offerWhenEmpty: z.boolean().default(false).volatile().description('\u961F\u5217\u4E3A\u7A7A\u65F6\u662F\u5426\u4ECD\u7136\u628A "Model Queue" \u63D0\u4F9B\u7ED9\u4F1A\u8BDD\uFF08\u9ED8\u8BA4\u5173\u95ED\uFF0C\u907F\u514D\u9009\u5230\u4E00\u4E2A\u53EA\u4F1A\u5931\u8D25\u7684\u8DEF\u7531\uFF09')
});
function live(value, fallback) {
  if (value === void 0) return fallback;
  if (typeof value === "object" && value !== null && "get" in value && typeof value.get === "function") {
    return value.get();
  }
  return value;
}
async function apply(ctx, raw) {
  const config = raw ?? {};
  const readEnabled = () => live(config.enabled, true);
  const readCooldown = () => {
    try {
      return normalizeCooldown(live(config.cooldownMs, DEFAULT_COOLDOWN_MS));
    } catch (error) {
      ctx.logger("model-queue").warn(
        `invalid cooldownMs (${error instanceof Error ? error.message : String(error)}); using the default instead`
      );
      return DEFAULT_COOLDOWN_MS;
    }
  };
  const readOfferWhenEmpty = () => live(config.offerWhenEmpty, false);
  const logger = ctx.logger("model-queue");
  const home = resolveDshHome();
  const store = new QueueStore(queuePathIn(home), logger);
  const manager = new QueueManager(ctx, store, () => Date.now());
  await manager.start();
  await manager.refreshFacts();
  if (manager.state().cooldownMs !== readCooldown()) {
    await manager.setCooldown(readCooldown());
  }
  logger.info(`model-queue: loaded ${manager.state().entries.length} model(s) from ${store.file}`);
  ctx.effect(() => {
    const dispose = manager.subscribe(() => {
      void manager.refreshFacts();
    });
    return () => {
      dispose();
    };
  }, "model-queue: capability refresh");
  const adapter = new QueueAdapter(manager, logger);
  const registration = ctx.llm.registerAdapter([PROVIDER_ID], adapter);
  const syncRoute = () => {
    const entries = manager.state().entries.length;
    const offered = readEnabled() && (entries > 0 || readOfferWhenEmpty());
    const current = ctx.llm.listProviders().some((provider) => provider.id === PROVIDER_ID);
    if (offered === current) return;
    registration.replace(offered ? [PROVIDER_ID] : []);
    logger.info(offered ? `model-queue: offering route "${PROVIDER_ID}/${QUEUE_MODEL_ID}" for ${entries} queued model(s)` : "model-queue: route withdrawn (disabled or empty queue)");
  };
  syncRoute();
  ctx.effect(() => {
    const disposeState = manager.subscribe(syncRoute);
    return () => {
      disposeState();
    };
  }, "model-queue: route visibility");
  const timer = setInterval(() => {
    const next = readCooldown();
    if (next !== manager.cooldownMs()) {
      void manager.setCooldown(next).then(syncRoute, (error) => {
        logger.warn(`model-queue: could not apply cooldownMs (${error instanceof Error ? error.message : String(error)})`);
      });
    } else {
      syncRoute();
    }
  }, 1e3);
  ctx.effect(() => () => {
    clearInterval(timer);
  }, "model-queue: config watch");
  ctx.inject(["connection"], (connectionCtx) => {
    registerRoutes(connectionCtx, manager);
  });
  if (manager.state().entries.length === 0) {
    logger.info("model-queue: no models queued yet; open Plugins \u2192 Model Queue to add some");
  } else if (selectEntry(manager.state(), Date.now()).kind === "exhausted") {
    logger.info("model-queue: every queued model is still cooling down");
  }
}
export {
  Config,
  DEFAULT_COOLDOWN_MS,
  EMPTY_QUEUE,
  MAX_COOLDOWN_MS,
  PACKAGE_NAME,
  PROFILE_ENTRY_ID,
  PROVIDER_ID,
  QUEUE_MODEL_ID,
  QueueAdapter,
  QueueManager,
  QueueStore,
  apply,
  classifyFailure,
  clearCooldowns,
  inject,
  markSucceeded,
  name,
  parseDocument,
  queuePathIn,
  rotateFailed,
  sameConfig,
  sameOverrides,
  selectEntry,
  setCooldown,
  setEntries
};
