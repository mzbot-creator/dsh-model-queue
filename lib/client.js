window.__ModuleLoader__.load({ id: "dsh-model-queue", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/index.tsx
var index_exports = {};
__export(index_exports, {
  ModelQueueSection: () => ModelQueueSection,
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(index_exports);

// src/contract.ts
var PACKAGE_NAME = "dsh-model-queue";
var PROFILE_ENTRY_ID = "model-queue";
var QUEUE_ROUTE = "/api/dsh-model-queue";

// src/client/Section.tsx
var import_react = require("react");
var import_jsx_runtime = require("react/jsx-runtime");
var POLL_MS = 5e3;
var styles = {
  page: { display: "flex", flexDirection: "column", gap: 18, padding: "4px 0 24px" },
  card: {
    border: "1px solid var(--dsw-alias-border-secondary, rgba(128,128,128,0.25))",
    borderRadius: 10,
    padding: "14px 16px"
  },
  header: { display: "flex", alignItems: "center", gap: 10, marginBottom: 10 },
  title: { fontSize: 14, fontWeight: 600, margin: 0 },
  hint: { fontSize: 12.5, opacity: 0.68, margin: "0 0 12px", lineHeight: 1.6 },
  row: { display: "flex", alignItems: "center", gap: 10 },
  member: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "8px 10px",
    borderRadius: 8,
    border: "1px solid var(--dsw-alias-border-secondary, rgba(128,128,128,0.2))",
    marginBottom: 6
  },
  index: {
    flex: "none",
    width: 22,
    height: 22,
    borderRadius: 999,
    display: "grid",
    placeItems: "center",
    fontSize: 11.5,
    fontWeight: 600,
    background: "var(--dsw-alias-bg-layer-2, rgba(128,128,128,0.12))"
  },
  name: { fontSize: 13, fontWeight: 500 },
  meta: { fontSize: 11.5, opacity: 0.62 },
  button: {
    fontSize: 12,
    padding: "4px 10px",
    borderRadius: 6,
    border: "1px solid var(--dsw-alias-border-secondary, rgba(128,128,128,0.3))",
    background: "var(--dsw-alias-bg-elevated, #fff)",
    cursor: "pointer"
  },
  buttonDisabled: { opacity: 0.45, cursor: "default" },
  select: {
    fontSize: 12.5,
    padding: "4px 8px",
    borderRadius: 6,
    border: "1px solid var(--dsw-alias-border-secondary, rgba(128,128,128,0.3))",
    background: "var(--dsw-alias-bg-elevated, #fff)"
  },
  badge: {
    fontSize: 11,
    padding: "1px 8px",
    borderRadius: 999,
    background: "var(--dsw-alias-bg-layer-2, rgba(128,128,128,0.12))"
  }
};
var TEXT = {
  zh: {
    status: "\u5F53\u524D\u72B6\u6001",
    ready: "\u53EF\u4EE5\u8BF7\u6C42",
    exhausted: "\u5168\u90E8\u51B7\u5374\u4E2D",
    empty: "\u961F\u5217\u4E3A\u7A7A",
    head: "\u961F\u9996",
    members: "\u961F\u5217\u987A\u5E8F\uFF08\u4ECE\u4E0A\u5230\u4E0B\u4F9D\u6B21\u5C1D\u8BD5\uFF09",
    noMembers: "\u8FD8\u6CA1\u6709\u6A21\u578B\u3002\u4ECE\u4E0B\u9762\u7684\u5217\u8868\u91CC\u9009\u4E00\u4E2A\u52A0\u8FDB\u6765\u3002",
    cooldown: "\u51B7\u5374\u5269\u4F59",
    readyNow: "\u5C31\u7EEA",
    failures: "\u5931\u8D25",
    lastFailure: "\u4E0A\u6B21\u5931\u8D25",
    moveUp: "\u4E0A\u79FB",
    moveDown: "\u4E0B\u79FB",
    remove: "\u79FB\u9664",
    add: "\u6DFB\u52A0\u6A21\u578B",
    addButton: "\u52A0\u5230\u961F\u5C3E",
    cooldownTitle: "\u51B7\u5374\u65F6\u957F",
    cooldownHint: "\u67D0\u4E2A\u6A21\u578B\u5931\u8D25\u540E\uFF0C\u5B83\u4F1A\u79FB\u5230\u961F\u5C3E\u5E76\u5728\u8FD9\u6BB5\u65F6\u95F4\u5185\u4E0D\u518D\u88AB\u9009\u4E2D\u3002",
    reset: "\u7ACB\u5373\u89E3\u9664\u5168\u90E8\u51B7\u5374",
    resetHint: "\u53EA\u6E05\u9664\u51B7\u5374\uFF0C\u4E0D\u6539\u53D8\u987A\u5E8F\u3002",
    enabled: "\u542F\u7528\u961F\u5217\u8DEF\u7531",
    enabledHint: '\u5173\u95ED\u540E "Model Queue" \u4F1A\u4ECE\u6A21\u578B\u9009\u62E9\u5668\u91CC\u6D88\u5931\uFF0C\u5DF2\u6392\u961F\u7684\u6A21\u578B\u4FDD\u6301\u4E0D\u53D8\u3002',
    offerWhenEmpty: "\u961F\u5217\u4E3A\u7A7A\u65F6\u4E5F\u63D0\u4F9B\u8DEF\u7531",
    offerWhenEmptyHint: "\u9ED8\u8BA4\u5173\u95ED\uFF1A\u7A7A\u961F\u5217\u53EA\u4F1A\u8BA9\u8BF7\u6C42\u5931\u8D25\u3002",
    minute: "\u5206\u949F",
    hour: "\u5C0F\u65F6",
    saving: "\u4FDD\u5B58\u4E2D\u2026",
    saveFailed: "\u4FDD\u5B58\u5931\u8D25",
    loadFailed: "\u8BFB\u53D6\u961F\u5217\u5931\u8D25",
    apiMissing: "\u961F\u5217\u63A5\u53E3\u4E0D\u53EF\u7528\uFF08\u63D2\u4EF6\u672A\u5728\u672C\u673A Web \u5BBF\u4E3B\u4E0A\u542F\u7528\uFF1F\uFF09",
    catalogEmpty: "\u6CA1\u6709\u53EF\u6DFB\u52A0\u7684\u6A21\u578B\u3002",
    exhaustedReason: "\u6700\u540E\u4E00\u6B21\u5931\u8D25"
  },
  en: {
    status: "Status",
    ready: "Ready",
    exhausted: "All cooling down",
    empty: "Queue is empty",
    head: "Head",
    members: "Queue order (tried top to bottom)",
    noMembers: "No models yet. Pick one below to add it.",
    cooldown: "Cooldown left",
    readyNow: "ready",
    failures: "failures",
    lastFailure: "Last failure",
    moveUp: "Up",
    moveDown: "Down",
    remove: "Remove",
    add: "Add a model",
    addButton: "Add to tail",
    cooldownTitle: "Cooldown",
    cooldownHint: "A failed model moves to the tail and is not selected again for this long.",
    reset: "Clear every cooldown",
    resetHint: "Clears cooldowns only; the order is unchanged.",
    enabled: "Offer the queue route",
    enabledHint: 'Turning this off hides "Model Queue" from the model picker; queued models stay as they are.',
    offerWhenEmpty: "Offer the route even when empty",
    offerWhenEmptyHint: "Off by default: an empty queue can only fail.",
    minute: "min",
    hour: "h",
    saving: "Saving\u2026",
    saveFailed: "Save failed",
    loadFailed: "Could not read the queue",
    apiMissing: "The queue API is unavailable (is the plugin enabled on this host?)",
    catalogEmpty: "No models available to add.",
    exhaustedReason: "Last failure"
  }
};
function textOf(locale) {
  return locale.toLowerCase().startsWith("zh") ? TEXT.zh : TEXT.en;
}
function duration(ms, t) {
  const minutes = Math.ceil(ms / 6e4);
  if (minutes < 60) return `${String(minutes)}${t.minute}`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${String(hours)}${t.hour}` : `${String(hours)}${t.hour} ${String(rest)}${t.minute}`;
}
function Action(props) {
  const disabled = props.disabled === true;
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
    "button",
    {
      type: "button",
      title: props.title,
      disabled,
      onClick: props.onClick,
      style: { ...styles.button, ...disabled ? styles.buttonDisabled : {} },
      children: props.label
    }
  );
}
function useQueueView() {
  const [view, setView] = (0, import_react.useState)(null);
  const [catalog, setCatalog] = (0, import_react.useState)(null);
  const [error, setError] = (0, import_react.useState)(null);
  const [nonce, setNonce] = (0, import_react.useState)(0);
  const load = (0, import_react.useCallback)(async (isCancelled) => {
    try {
      const response = await fetch(`${QUEUE_ROUTE}/state`, { headers: { accept: "application/json" } });
      if (isCancelled()) return;
      if (!response.ok) {
        setError(`${String(response.status)} ${response.statusText}`);
        return;
      }
      setView(await response.json());
      setError(null);
    } catch (cause) {
      if (!isCancelled()) setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);
  const loadCatalog = (0, import_react.useCallback)(async (isCancelled) => {
    try {
      const response = await fetch(`${QUEUE_ROUTE}/catalog`, { headers: { accept: "application/json" } });
      if (isCancelled() || !response.ok) return;
      setCatalog(await response.json());
    } catch {
    }
  }, []);
  (0, import_react.useEffect)(() => {
    let cancelled = false;
    const isCancelled = () => cancelled;
    void load(isCancelled);
    void loadCatalog(isCancelled);
    const timer = setInterval(() => {
      void load(isCancelled);
    }, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [load, loadCatalog, nonce]);
  const reload = (0, import_react.useCallback)(() => {
    setNonce((value) => value + 1);
  }, []);
  return { view, catalog, error, reload };
}
function ModelQueueSection(props) {
  const t = textOf(props.locale());
  const { view, catalog, error, reload } = useQueueView();
  const [busy, setBusy] = (0, import_react.useState)(false);
  const [message, setMessage] = (0, import_react.useState)(null);
  const [pick, setPick] = (0, import_react.useState)("");
  const config = useSyncExternalStoreCompat(props.config);
  const post = (0, import_react.useCallback)(async (path, body) => {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`${QUEUE_ROUTE}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body ?? {})
      });
      if (!response.ok) {
        const detail = await response.text();
        setMessage(`${t.saveFailed}: ${detail.slice(0, 200)}`);
        return false;
      }
      reload();
      return true;
    } catch (cause) {
      setMessage(`${t.saveFailed}: ${cause instanceof Error ? cause.message : String(cause)}`);
      return false;
    } finally {
      setBusy(false);
    }
  }, [reload, t]);
  const writeEntries = (0, import_react.useCallback)(async (entries) => {
    await post("/entries", { entries });
  }, [post]);
  const move = (0, import_react.useCallback)(async (index, delta) => {
    if (view === null) return;
    const next = view.entries.map((entry) => ({
      id: entry.id,
      provider: entry.provider,
      model: entry.model,
      label: entry.label
    }));
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    const [moved] = next.splice(index, 1);
    if (moved === void 0) return;
    next.splice(target, 0, moved);
    await writeEntries(next);
  }, [view, writeEntries]);
  const remove = (0, import_react.useCallback)(async (id) => {
    if (view === null) return;
    await writeEntries(view.entries.filter((entry) => entry.id !== id).map((entry) => ({ id: entry.id, provider: entry.provider, model: entry.model, label: entry.label })));
  }, [view, writeEntries]);
  const append = (0, import_react.useCallback)(async () => {
    if (view === null || pick === "") return;
    const [provider, ...rest] = pick.split("\0");
    const model = rest.join("\0");
    if (provider === void 0 || model === "") return;
    await writeEntries([
      ...view.entries.map((entry) => ({ id: entry.id, provider: entry.provider, model: entry.model, label: entry.label })),
      { provider, model }
    ]);
    setPick("");
  }, [view, pick, writeEntries]);
  const cooldownMinutes = (0, import_react.useMemo)(
    () => Math.round((config.value?.cooldownMs ?? 36e5) / 6e4),
    [config.value?.cooldownMs]
  );
  const status = view === null ? t.apiMissing : view.entries.length === 0 ? t.empty : view.exhausted ? t.exhausted : t.ready;
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.page, children: [
    error === null ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { ...styles.card, borderColor: "#c98", fontSize: 12.5 }, children: [
      t.loadFailed,
      ": ",
      error
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { style: styles.card, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.header, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { style: styles.title, children: t.status }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: {
          ...styles.badge,
          color: view?.exhausted === true ? "#b7791f" : view === null ? void 0 : "#1f9d63"
        }, children: status })
      ] }),
      view === null || view.entries.length === 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.meta, children: [
        t.head,
        ": ",
        view.entries.find((entry) => entry.id === view.head)?.label ?? "\u2014"
      ] }),
      view?.exhausted === true && view.failure !== void 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { ...styles.meta, marginTop: 8 }, children: [
        t.exhaustedReason,
        ": ",
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("code", { children: view.failure.code }),
        " \u2014 ",
        view.failure.message
      ] }) : null
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { style: styles.card, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: styles.header, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { style: styles.title, children: t.members }) }),
      view === null || view.entries.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: styles.hint, children: t.noMembers }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { children: view.entries.map((entry, index) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        Member,
        {
          entry,
          index,
          head: entry.id === view.head,
          busy,
          t,
          onUp: () => {
            void move(index, -1);
          },
          onDown: () => {
            void move(index, 1);
          },
          onRemove: () => {
            void remove(entry.id);
          }
        },
        entry.id
      )) }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { ...styles.row, marginTop: 12 }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
          "select",
          {
            style: { ...styles.select, minWidth: 240 },
            value: pick,
            disabled: busy,
            onChange: (event) => {
              setPick(event.target.value);
            },
            "aria-label": t.add,
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "", children: catalog === null || catalog.models.length === 0 ? t.catalogEmpty : t.add }),
              catalog?.models.map((model) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("option", { value: `${model.provider}\0${model.model}`, children: [
                model.providerName,
                " \xB7 ",
                model.name
              ] }, `${model.provider}\0${model.model}`))
            ]
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Action, { label: t.addButton, disabled: busy || pick === "", onClick: () => {
          void append();
        } })
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { style: styles.card, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: styles.header, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { style: styles.title, children: t.cooldownTitle }) }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: styles.hint, children: t.cooldownHint }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.row, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "input",
          {
            type: "number",
            min: 0,
            style: { ...styles.select, width: 90 },
            value: cooldownMinutes,
            disabled: busy || config.writable !== true,
            onChange: (event) => {
              const minutes = Number(event.target.value);
              if (!Number.isFinite(minutes) || minutes < 0) return;
              void props.config.set("cooldownMs", Math.round(minutes * 6e4));
            }
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: styles.meta, children: t.minute }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { flex: 1 } }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Action, { label: t.reset, disabled: busy, onClick: () => {
          void post("/reset");
        } })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: { ...styles.hint, marginTop: 8 }, children: t.resetHint })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { style: styles.card, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: styles.row, children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { style: { ...styles.row, fontSize: 13 }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "input",
          {
            type: "checkbox",
            checked: config.value?.enabled !== false,
            disabled: busy || config.writable !== true,
            onChange: (event) => {
              void props.config.set("enabled", event.target.checked);
            }
          }
        ),
        t.enabled
      ] }) }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: { ...styles.hint, marginTop: 6 }, children: t.enabledHint }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { ...styles.row, marginTop: 10 }, children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { style: { ...styles.row, fontSize: 13 }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "input",
          {
            type: "checkbox",
            checked: config.value?.offerWhenEmpty === true,
            disabled: busy || config.writable !== true,
            onChange: (event) => {
              void props.config.set("offerWhenEmpty", event.target.checked);
            }
          }
        ),
        t.offerWhenEmpty
      ] }) }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: { ...styles.hint, marginTop: 6 }, children: t.offerWhenEmptyHint })
    ] }),
    message === null ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { ...styles.card, fontSize: 12.5 }, children: message })
  ] });
}
function Member(props) {
  const { entry, index, head, busy, t } = props;
  const cooling = entry.remainingMs > 0;
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.member, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: styles.index, children: index + 1 }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { flex: 1, minWidth: 0 }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.name, children: [
        entry.label,
        head ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { ...styles.badge, marginLeft: 8, color: "#1f9d63" }, children: t.head }) : null,
        cooling ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: { ...styles.badge, marginLeft: 8, color: "#b7791f" }, children: [
          t.cooldown,
          " ",
          duration(entry.remainingMs, t)
        ] }) : null
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.meta, children: [
        entry.provider,
        " \xB7 ",
        entry.model,
        " \xB7 ",
        cooling ? `${t.failures} ${String(entry.failures)}` : t.readyNow,
        entry.lastFailure === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
          " \xB7 ",
          t.lastFailure,
          ": ",
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("code", { children: entry.lastFailure.code }),
          " ",
          entry.lastFailure.message.slice(0, 120)
        ] })
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Action, { label: "\u2191", title: t.moveUp, disabled: busy || index === 0, onClick: props.onUp }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Action, { label: "\u2193", title: t.moveDown, disabled: busy, onClick: props.onDown }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Action, { label: t.remove, disabled: busy, onClick: props.onRemove })
  ] });
}
function useSyncExternalStoreCompat(form) {
  const [snapshot, setSnapshot] = (0, import_react.useState)(() => form.getSnapshot());
  (0, import_react.useEffect)(() => {
    setSnapshot(form.getSnapshot());
    return form.subscribe(() => {
      setSnapshot(form.getSnapshot());
    });
  }, [form]);
  return { value: snapshot.value, writable: snapshot.writable };
}

// src/client/index.tsx
var LOCALE_NAMESPACE = "dsh-model-queue";
var en = {
  title: "Model Queue",
  summary: "One ordered list of models: the head answers first, and a failed model rotates to the tail."
};
var zh = {
  title: "\u6A21\u578B\u961F\u5217",
  summary: "\u4E00\u4E2A\u6709\u5E8F\u7684\u6A21\u578B\u5217\u8868\uFF1A\u961F\u9996\u4F18\u5148\uFF0C\u5931\u8D25\u7684\u6A21\u578B\u79FB\u5230\u961F\u5C3E\u5E76\u51B7\u5374\u3002"
};
var inject = ["slots", "configForms", "locale"];
function apply(ctx) {
  ctx.effect(() => ctx.locale.register(LOCALE_NAMESPACE, { en, zh }), "dsh-model-queue: locale");
  const form = ctx.configForms.get(PROFILE_ENTRY_ID);
  const injected = () => ({
    config: {
      getSnapshot: () => {
        const snapshot = form.getSnapshot();
        return {
          status: snapshot.status,
          value: snapshot.value,
          writable: snapshot.writable
        };
      },
      subscribe: (listener) => form.subscribe(listener),
      set: (field, value) => form.set(field, value)
    },
    locale: () => ctx.locale.getSnapshot().active
  });
  ctx.effect(
    () => ctx.slots.inject("plugins.bundle.config", () => ctx.slots.register({
      name: "plugins.bundle.config",
      key: PACKAGE_NAME,
      locale: LOCALE_NAMESPACE,
      inject: injected
    }, ModelQueueSection)),
    "dsh-model-queue: queue page"
  );
}

return module.exports; } });
