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
var ROUTE_REASONING_EFFORTS = Object.freeze([
  { id: "off", name: "Off" },
  { id: "minimal", name: "Minimal" },
  { id: "low", name: "Low" },
  { id: "medium", name: "Medium" },
  { id: "high", name: "High" },
  { id: "xhigh", name: "Xhigh" },
  { id: "max", name: "Max" }
]);

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
  legend: { margin: 0, display: "grid", gridTemplateColumns: "max-content 1fr", gap: "6px 14px", alignItems: "baseline" },
  legendTerm: { fontSize: 12.5, fontWeight: 600, margin: 0 },
  legendBody: { fontSize: 12.5, margin: 0, opacity: 0.78, lineHeight: 1.55 },
  row: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" },
  member: {
    padding: "8px 10px",
    borderRadius: 8,
    border: "1px solid var(--dsw-alias-border-secondary, rgba(128,128,128,0.2))",
    marginBottom: 6
  },
  memberTop: { display: "flex", alignItems: "center", gap: 10 },
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
  meta: { fontSize: 11.5, opacity: 0.62, lineHeight: 1.7 },
  caps: { display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 },
  cap: {
    fontSize: 11,
    padding: "1px 7px",
    borderRadius: 5,
    background: "var(--dsw-alias-bg-layer-2, rgba(128,128,128,0.12))",
    whiteSpace: "nowrap"
  },
  capMuted: {
    fontSize: 11,
    padding: "1px 7px",
    borderRadius: 5,
    background: "transparent",
    border: "1px dashed var(--dsw-alias-border-secondary, rgba(128,128,128,0.35))",
    whiteSpace: "nowrap"
  },
  capEdited: {
    fontSize: 11,
    padding: "1px 7px",
    borderRadius: 5,
    background: "rgba(31,157,99,0.14)",
    color: "#1f9d63",
    whiteSpace: "nowrap"
  },
  editor: {
    marginTop: 10,
    paddingTop: 10,
    borderTop: "1px dashed var(--dsw-alias-border-secondary, rgba(128,128,128,0.3))",
    display: "flex",
    flexDirection: "column",
    gap: 10
  },
  field: { display: "flex", flexDirection: "column", gap: 3 },
  label: { fontSize: 12, fontWeight: 500 },
  fieldHint: { fontSize: 11.5, opacity: 0.6, lineHeight: 1.55 },
  button: {
    fontSize: 12,
    padding: "4px 10px",
    borderRadius: 6,
    border: "1px solid var(--dsw-alias-border-secondary, rgba(128,128,128,0.3))",
    background: "var(--dsw-alias-bg-elevated, #fff)",
    cursor: "pointer"
  },
  buttonDisabled: { opacity: 0.45, cursor: "default" },
  input: {
    fontSize: 12.5,
    padding: "4px 8px",
    borderRadius: 6,
    border: "1px solid var(--dsw-alias-border-secondary, rgba(128,128,128,0.3))",
    background: "var(--dsw-alias-bg-elevated, #fff)",
    width: 150
  },
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
    exhaustedReason: "\u6700\u540E\u4E00\u6B21\u5931\u8D25",
    // Configuration vocabulary.
    capsTitle: "\u6A21\u578B\u914D\u7F6E",
    capsIntro: "\u4E0B\u9762\u6BCF\u4E00\u9879\u90FD\u662F dsh \u4E3A\u8FD9\u4E2A\u6A21\u578B\u89E3\u6790\u51FA\u7684\u771F\u5B9E\u914D\u7F6E\uFF1B\u201C\u961F\u5217\u8DEF\u7531\u6700\u7EC8\u751F\u6548\u201D\u662F\u961F\u5217\u5BF9\u5916\u516C\u5E03\u3001\u5B9E\u9645\u6D3E\u53D1\u65F6\u4F7F\u7528\u7684\u503C\u3002\u9ED8\u8BA4\u5B8C\u5168\u6CBF\u7528 dsh \u7684\u914D\u7F6E\uFF0C\u53EA\u6709\u624B\u52A8\u4FEE\u6539\u8FC7\u7684\u9879\u624D\u4F1A\u4E0D\u540C\uFF08\u7EFF\u8272\u6807\u8BB0\uFF09\u3002",
    routeTitle: "\u961F\u5217\u8DEF\u7531\u5BF9\u5916\u516C\u5E03\u7684\u914D\u7F6E",
    legendImage: "\u8BFB\u56FE",
    legendImageBody: "\u8BE5\u6A21\u578B\u80FD\u4E0D\u80FD\u63A5\u6536\u56FE\u7247\u3002\u9ED8\u8BA4\u6CBF\u7528 dsh \u7684\u89E3\u6790\u7ED3\u679C\uFF1B\u6539\u6210\u201C\u4EC5\u6587\u672C\u201D\u540E\uFF0C\u961F\u5217\u4E0D\u4F1A\u518D\u628A\u56FE\u7247\u6D3E\u53D1\u7ED9\u5B83\uFF0C\u6539\u8FD9\u4E2A\u6210\u5458\u65F6\u961F\u5217\u8DEF\u7531\u7684\u8BFB\u56FE\u80FD\u529B\u4E5F\u4F1A\u8DDF\u7740\u6536\u7D27\u3002",
    legendContext: "\u4E0A\u4E0B\u6587\u7A97\u53E3",
    legendContextBody: "\u4E00\u6B21\u8BF7\u6C42\u91CC\u8F93\u5165\u52A0\u8F93\u51FA\u6700\u591A\u80FD\u7528\u591A\u5C11 token\u3002\u9ED8\u8BA4\u6CBF\u7528 dsh\uFF1B\u8C03\u5C0F\u4E4B\u540E\u961F\u5217\u4F1A\u6309\u8FD9\u4E2A\u66F4\u4FDD\u5B88\u7684\u503C\u5BF9\u5916\u516C\u5E03\u7A97\u53E3\uFF0C\u907F\u514D\u5BBF\u4E3B\u7F16\u6392\u51FA\u8FD9\u4E2A\u6210\u5458\u63A5\u4E0D\u4F4F\u7684\u8BF7\u6C42\u3002",
    legendOutput: "\u5355\u6B21\u8F93\u51FA\u4E0A\u9650",
    legendOutputBody: "\u4E00\u6B21\u56DE\u590D\u6700\u591A\u80FD\u751F\u6210\u591A\u5C11 token\u3002\u9ED8\u8BA4\u6CBF\u7528 dsh\uFF1B\u8C03\u5C0F\u4E4B\u540E\uFF0C\u6D3E\u53D1\u7ED9\u8FD9\u4E2A\u6210\u5458\u7684\u8BF7\u6C42\u5982\u679C\u8981\u6C42\u66F4\u5927\u7684\u8F93\u51FA\uFF0C\u4F1A\u88AB\u81EA\u52A8\u4E0B\u8C03\u5230\u8FD9\u4E2A\u503C\u3002",
    legendReasoning: "\u63A8\u7406\u7B49\u7EA7",
    legendReasoningBody: "\u8BE5\u6A21\u578B\u81EA\u5DF1\u7684\u63A8\u7406\u6863\u4F4D\uFF08\u4F8B\u5982 Low / Medium / High\uFF09\u3002\u9ED8\u8BA4\u6CBF\u7528 dsh \u7684\u9ED8\u8BA4\u6863\uFF1B\u9009\u5B9A\u4E00\u6863\u540E\uFF0C\u961F\u5217\u6D3E\u53D1\u5230\u8FD9\u4E2A\u6210\u5458\u65F6\u5C31\u7528\u5B83\u3002\u4F1A\u8BDD/\u9009\u62E9\u5668\u4F20\u6765\u7684\u6863\u4F4D\u4E00\u5F8B\u88AB\u4E22\u5F03\uFF0C\u4E0D\u4F1A\u4E0B\u53D1\u5230\u6210\u5458\u3002",
    legendFollow: "\u524D\u4E09\u9879\u90FD\u9ED8\u8BA4\u201C\u6CBF\u7528 dsh\u201D\uFF1Adsh \u91CC\u7684\u6A21\u578B\u58F0\u660E\u6539\u4E86\uFF0C\u70B9\u4E00\u6B21 Re-sync from dsh \u5373\u53EF\u540C\u6B65\uFF0C\u4E0D\u5FC5\u5220\u9664\u91CD\u52A0\u3002\u53EA\u6709\u4F60\u624B\u52A8\u6539\u8FC7\u7684\u9879\u4E0D\u540C\uFF0C\u5E76\u4F1A\u6807\u7EFF\u3002",
    routeHint: '\u961F\u5217\u5728\u6A21\u578B\u9009\u62E9\u5668\u91CC\u53EA\u51FA\u73B0\u4E00\u4E2A "Model Queue"\u3002\u5B83\u5BF9\u5916\u516C\u5E03\u7684\u8BFB\u56FE\u80FD\u529B\u3001\u4E0A\u4E0B\u6587\u7A97\u53E3\u548C\u8F93\u51FA\u4E0A\u9650\u6309\u6240\u6709\u6210\u5458\u7684\u201C\u5171\u540C\u53EF\u7528\u8303\u56F4\u201D\u8BA1\u7B97\uFF1A\u8BFB\u56FE\u8981\u6C42\u6BCF\u4E2A\u6210\u5458\u90FD\u652F\u6301\uFF0C\u4E0A\u4E0B\u6587\u4E0E\u8F93\u51FA\u53D6\u6700\u5C0F\u6210\u5458\u7684\u503C\u3002\u63A8\u7406\u7B49\u7EA7\u4F8B\u5916\uFF1A\u961F\u5217\u4E0D\u4F7F\u7528\u6863\u4F4D\uFF08\u6D3E\u53D1\u65F6\u76F4\u63A5\u4E22\u5F03\uFF09\uFF0C\u56E0\u6B64\u56FA\u5B9A\u516C\u5E03 dsh \u7684\u5168\u90E8\u6863\u4F4D\uFF0C\u9009\u62E9\u5668\u91CC\u9009\u54EA\u4E00\u6863\u90FD\u4E0D\u5F71\u54CD\u5B9E\u9645\u884C\u4E3A\u3002',
    capImage: "\u8BFB\u56FE",
    capImageYes: "\u652F\u6301",
    capImageNo: "\u4E0D\u652F\u6301",
    capContext: "\u4E0A\u4E0B\u6587",
    capOutput: "\u5355\u6B21\u8F93\u51FA\u4E0A\u9650",
    capReasoning: "\u63A8\u7406\u7B49\u7EA7",
    capReasoningIgnored: "\u5DF2\u5FFD\u7565\uFF08\u4EFB\u610F\u6863\u4F4D\u90FD\u63A5\u53D7\uFF09",
    capDefault: "\u9ED8\u8BA4",
    capUnknown: "\u672A\u77E5\uFF08\u8DEF\u7531\u672A\u54CD\u5E94\uFF09",
    capNotDeclared: "\u672A\u58F0\u660E",
    capEdited: "\u5DF2\u6539",
    edit: "\u4FEE\u6539\u914D\u7F6E",
    collapse: "\u6536\u8D77",
    apply: "\u4FDD\u5B58\u4FEE\u6539",
    revert: "\u6062\u590D\u4E3A dsh \u914D\u7F6E",
    synced: "\u5DF2\u4ECE dsh \u540C\u6B65",
    syncNow: "\u4ECE dsh \u91CD\u65B0\u540C\u6B65",
    syncHint: "\u63D2\u4EF6\u5E73\u65F6\u4E0D\u81EA\u52A8\u8DDF\u968F dsh\u3002dsh \u91CC\u6539\u4E86\u4E0A\u4E0B\u6587\u7A97\u53E3\u3001\u8F93\u51FA\u4E0A\u9650\u3001\u8BFB\u56FE\u80FD\u529B\u6216\u63A8\u7406\u7B49\u7EA7\u540E\uFF0C\u70B9\u8FD9\u91CC\u91CD\u65B0\u8BFB\u53D6\u4E00\u6B21\uFF1B\u624B\u52A8\u4FEE\u6539\u8FC7\u7684\u9879\u4E0D\u4F1A\u88AB\u8986\u76D6\u3002",
    fieldImage: "\u8BFB\u56FE\u80FD\u529B",
    fieldImageHint: "\u8FD9\u4E2A\u6A21\u578B\u80FD\u5426\u63A5\u6536\u56FE\u7247\u3002\u9ED8\u8BA4\u5B8C\u5168\u6CBF\u7528 dsh\uFF1A{value}\u3002\u6539\u6389\u4E4B\u540E\uFF0C\u961F\u5217\u53EA\u4F1A\u5728\u8FD9\u4E2A\u6210\u5458\u4E0A\u6309\u4F60\u9009\u7684\u80FD\u529B\u53D1\u9001\u6216\u62D2\u7EDD\u56FE\u7247\u3002",
    fieldContext: "\u4E0A\u4E0B\u6587\u7A97\u53E3\uFF08token\uFF09",
    fieldContextHint: "\u4E00\u6B21\u8BF7\u6C42\u91CC\u8F93\u5165 + \u8F93\u51FA\u6700\u591A\u80FD\u7528\u591A\u5C11 token\u3002dsh \u5F53\u524D\u7ED9\u51FA {value}\u3002\u7559\u7A7A\u8868\u793A\u6CBF\u7528 dsh\uFF1B\u8C03\u5C0F\u53EF\u7528\u4E8E\u8BA9\u961F\u5217\u5BF9\u5916\u516C\u5E03\u66F4\u4FDD\u5B88\u7684\u4E0A\u9650\u3002",
    fieldOutput: "\u5355\u6B21\u8F93\u51FA\u4E0A\u9650\uFF08token\uFF09",
    fieldOutputHint: "\u4E00\u6B21\u56DE\u590D\u6700\u591A\u751F\u6210\u591A\u5C11 token\u3002dsh \u5F53\u524D\u7ED9\u51FA {value}\u3002\u7559\u7A7A\u8868\u793A\u6CBF\u7528 dsh\uFF1B\u961F\u5217\u6D3E\u53D1\u5230\u8BE5\u6210\u5458\u65F6\uFF0C\u8D85\u8FC7\u8FD9\u4E2A\u503C\u7684 maxTokens \u4F1A\u88AB\u4E0B\u8C03\u5230\u8BE5\u503C\u3002",
    fieldReasoning: "\u6A21\u578B\u63A8\u7406\u7B49\u7EA7",
    fieldReasoningHint: "\u8FD9\u4E2A\u6A21\u578B\u81EA\u5DF1\u7684\u63A8\u7406\u5F3A\u5EA6\u3002dsh \u5F53\u524D\u63D0\u4F9B {value}\uFF0C\u9ED8\u8BA4 {default}\u3002\u7559\u7A7A\u8868\u793A\u6CBF\u7528 dsh \u7684\u9ED8\u8BA4\u503C\uFF1B\u9009\u5B9A\u540E\uFF0C\u961F\u5217\u6D3E\u53D1\u5230\u8FD9\u4E2A\u6210\u5458\u65F6\u5C31\u7528\u8FD9\u4E00\u6863\u2014\u2014\u4F1A\u8BDD\u91CC\u9009\u4E86\u4EC0\u4E48\u90FD\u4F1A\u88AB\u4E22\u5F03\u3002",
    fieldReasoningNone: "\u8BE5\u6A21\u578B\u6CA1\u6709\u58F0\u660E\u63A8\u7406\u7B49\u7EA7",
    inherit: "\u6CBF\u7528 dsh \u914D\u7F6E",
    imageInherit: "\u6CBF\u7528 dsh\uFF08{value}\uFF09",
    imageForceOn: "\u5F3A\u5236\u652F\u6301\u56FE\u7247",
    imageForceOff: "\u5F3A\u5236\u4E0D\u652F\u6301\u56FE\u7247",
    reasoningInherit: "\u6CBF\u7528 dsh \u9ED8\u8BA4\uFF08{value}\uFF09",
    reasoningInheritNoDefault: "\u6CBF\u7528 dsh \u9ED8\u8BA4\uFF08\u672A\u6307\u5B9A\u6863\u4F4D\uFF09",
    reasoningNone: "\u4E0D\u8BBE\u7F6E",
    undefinedValue: "\u672A\u58F0\u660E",
    modelsCount: "\u4E2A\u6A21\u578B",
    previewTitle: "\u5C06\u52A0\u5165\u7684\u6A21\u578B",
    previewHint: "\u52A0\u5165\u540E\u9ED8\u8BA4\u6CBF\u7528 dsh \u7684\u5B8C\u6574\u914D\u7F6E\uFF1A\u8BFB\u56FE {image}\uFF0C\u4E0A\u4E0B\u6587 {context}\uFF0C\u5355\u6B21\u8F93\u51FA {output}\uFF0C\u63A8\u7406\u7B49\u7EA7 {reasoning}\u3002\u52A0\u5230\u961F\u5217\u540E\u53EF\u4EE5\u9010\u9879\u4FEE\u6539\u3002",
    resolveFailed: "\u8BE5\u6A21\u578B\u6682\u65F6\u65E0\u6CD5\u4ECE dsh \u89E3\u6790\u5B8C\u6574\u914D\u7F6E\uFF1A{reason}",
    resolvedAtAdd: "\u8FD9\u91CC\u663E\u793A\u7684\u662F\u4E0A\u6B21\u4ECE dsh \u8BFB\u5230\u5E76\u5B58\u4E0B\u7684\u914D\u7F6E\uFF0C\u672C\u6B21\u542F\u52A8\u8FD8\u6CA1\u91CD\u65B0\u8BFB\u53D6\u3002\u70B9\u300C\u4ECE dsh \u91CD\u65B0\u540C\u6B65\u300D\u5373\u53EF\u5237\u65B0\u3002",
    overridesActive: "\u5DF2\u624B\u52A8\u4FEE\u6539"
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
    exhaustedReason: "Last failure",
    capsTitle: "Model configuration",
    capsIntro: 'Every value below is what dsh itself resolved for that model. "Queue route effective" is the value the queue advertises and actually dispatches with. Everything follows dsh by default; only fields you changed differ (marked green).',
    routeTitle: "What the queue route advertises",
    legendImage: "Image support",
    legendImageBody: "Whether this model can receive images. Follows what dsh resolved by default; set it to text only and the queue stops sending images to this member, which also narrows what the queue route advertises.",
    legendContext: "Context window",
    legendContextBody: "How many tokens one request may use for input plus output. Follows dsh by default; lowering it makes the queue advertise the smaller window, so the harness never plans a request this member cannot serve.",
    legendOutput: "Output cap",
    legendOutputBody: "How many tokens one reply may generate. Follows dsh by default; once lowered, a request that asks for more output is reduced to this value when it is dispatched to this member.",
    legendReasoning: "Reasoning level",
    legendReasoningBody: "The reasoning efforts this model offers (for example Low / Medium / High). Follows the dsh default by default; once you pick one, it is used whenever the queue dispatches to this member. A level named by the session or the picker is always dropped, never forwarded.",
    legendFollow: "The first three follow dsh by default: when a model declaration in dsh changes, one click on Re-sync from dsh brings the queue up to date without re-adding the row. Only the fields you changed differ, and they are marked green.",
    routeHint: 'The queue appears as one "Model Queue" in the picker. The image support, context window and output cap it advertises are the intersection of its members: images require every member to accept them, context and output use the smallest member. Reasoning is the exception: the route does not use a level (a dispatch drops it), so it always advertises every level dsh knows \u2014 whichever one the picker shows has no effect.',
    capImage: "Images",
    capImageYes: "yes",
    capImageNo: "no",
    capContext: "context",
    capOutput: "output cap",
    capReasoning: "reasoning",
    capReasoningIgnored: "ignored (any level accepted)",
    capDefault: "default",
    capUnknown: "unknown (route did not answer)",
    capNotDeclared: "not declared",
    capEdited: "edited",
    edit: "Edit configuration",
    collapse: "Collapse",
    apply: "Save changes",
    revert: "Follow dsh again",
    synced: "Synced from dsh",
    syncNow: "Re-sync from dsh",
    syncHint: "The plugin does not follow dsh on its own. After changing a context window, output cap, image support or reasoning level in dsh, click here to re-read once; fields you changed by hand are kept.",
    fieldImage: "Image support",
    fieldImageHint: "Whether this model can receive images. Following dsh means: {value}. Once changed, the queue sends or refuses images on this member the way you chose.",
    fieldContext: "Context window (tokens)",
    fieldContextHint: "How many tokens one request may use for input plus output. dsh currently reports {value}. Leave empty to follow dsh; lowering it makes the queue advertise a more conservative window.",
    fieldOutput: "Output cap (tokens)",
    fieldOutputHint: "How many tokens one reply may generate. dsh currently reports {value}. Leave empty to follow dsh; when a request is dispatched to this member, a larger maxTokens is lowered to this value.",
    fieldReasoning: "Reasoning level",
    fieldReasoningHint: "The reasoning effort this model offers. dsh currently offers {value}, defaulting to {default}. Leave empty to follow dsh; once chosen, the queue uses it whenever it dispatches to this member \u2014 a level named by the session is dropped.",
    fieldReasoningNone: "This model declares no reasoning levels",
    inherit: "Follow dsh",
    imageInherit: "Follow dsh ({value})",
    imageForceOn: "Force image support",
    imageForceOff: "Force text only",
    reasoningInherit: "Follow dsh default ({value})",
    reasoningInheritNoDefault: "Follow dsh default (no level named)",
    reasoningNone: "none",
    undefinedValue: "not declared",
    modelsCount: "model(s)",
    previewTitle: "Model to add",
    previewHint: "Once added it follows dsh completely: images {image}, context {context}, output {output}, reasoning {reasoning}. You can change any of these per row afterwards.",
    resolveFailed: "dsh could not resolve the full configuration for this model: {reason}",
    resolvedAtAdd: 'Captured from dsh and stored; this run has not read it again. Use "Re-sync from dsh" to refresh.',
    overridesActive: "edited by hand"
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
function tokens(value, fallback) {
  if (value === void 0) return fallback;
  if (value >= 1e6) {
    const millions = value / 1e6;
    return `${Number.isInteger(millions) ? String(millions) : millions.toFixed(1)}M`;
  }
  if (value >= 1e3) {
    const thousands = value / 1e3;
    return `${Number.isInteger(thousands) ? String(thousands) : thousands.toFixed(1)}K`;
  }
  return String(value);
}
function acceptsImages(config) {
  return config.inputModalities.includes("image");
}
function effortName(config, id) {
  return config.reasoning?.efforts.find((effort) => effort.id === id)?.name ?? id;
}
function reasoningSummary(config, t) {
  const reasoning = config.reasoning;
  if (reasoning === void 0 || reasoning.efforts.length === 0) return t.capNotDeclared;
  const levels = reasoning.efforts.map((effort) => effort.name).join(" / ");
  if (reasoning.defaultEffort === void 0) return levels;
  return `${levels} (${t.capDefault} ${effortName(config, reasoning.defaultEffort)})`;
}
function CapBadges(props) {
  const { config, overrides, unknown, t, reasoningText } = props;
  const unknownText = t.capUnknown;
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.caps, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: overrides.inputModalities === void 0 ? styles.cap : styles.capEdited, children: [
      t.capImage,
      ": ",
      unknown && config.inputModalities.length === 0 ? unknownText : acceptsImages(config) ? t.capImageYes : t.capImageNo
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: overrides.contextWindow === void 0 ? styles.cap : styles.capEdited, children: [
      t.capContext,
      ": ",
      tokens(config.contextWindow, unknown ? unknownText : t.capNotDeclared)
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: overrides.maxTokens === void 0 ? styles.cap : styles.capEdited, children: [
      t.capOutput,
      ": ",
      tokens(config.maxTokens, unknown ? unknownText : t.capNotDeclared)
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: overrides.reasoningEffort === void 0 ? styles.cap : styles.capEdited, children: [
      t.capReasoning,
      ": ",
      unknown && config.reasoning === void 0 ? unknownText : reasoningText ?? reasoningSummary(config, t)
    ] })
  ] });
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
    await post("/entries", {
      entries: entries.map((row) => row.overrides === void 0 || Object.keys(row.overrides).length === 0 ? row : { ...row, overrides: row.overrides })
    });
  }, [post]);
  const rowsOf = (0, import_react.useCallback)((entries) => entries.map((entry) => ({
    id: entry.id,
    provider: entry.provider,
    model: entry.model,
    label: entry.label,
    // Always present, even when empty: `{}` is how this page says "follow dsh
    // again", while omitting the key would mean "keep whatever is stored".
    overrides: entry.overrides
  })), []);
  const move = (0, import_react.useCallback)(async (index, delta) => {
    if (view === null) return;
    const next = rowsOf(view.entries);
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    const [moved] = next.splice(index, 1);
    if (moved === void 0) return;
    next.splice(target, 0, moved);
    await writeEntries(next);
  }, [view, rowsOf, writeEntries]);
  const remove = (0, import_react.useCallback)(async (id) => {
    if (view === null) return;
    await writeEntries(rowsOf(view.entries).filter((row) => row.id !== id));
  }, [view, rowsOf, writeEntries]);
  const saveOverrides = (0, import_react.useCallback)(async (id, overrides) => {
    if (view === null) return;
    await writeEntries(rowsOf(view.entries).map((row) => row.id === id ? { ...row, overrides } : row));
  }, [view, rowsOf, writeEntries]);
  const append = (0, import_react.useCallback)(async () => {
    if (view === null || pick === "") return;
    const [provider, ...rest] = pick.split("\0");
    const model = rest.join("\0");
    if (provider === void 0 || model === "") return;
    await writeEntries([...rowsOf(view.entries), { provider, model }]);
    setPick("");
  }, [view, pick, rowsOf, writeEntries]);
  const syncFromDsh = (0, import_react.useCallback)(async () => {
    const ok = await post("/sync");
    if (ok) setMessage(t.synced);
  }, [post, t.synced]);
  const cooldownMinutes = (0, import_react.useMemo)(
    () => Math.round((config.value?.cooldownMs ?? 36e5) / 6e4),
    [config.value?.cooldownMs]
  );
  const picked = (0, import_react.useMemo)(() => {
    if (pick === "" || catalog === null) return void 0;
    return catalog.models.find((model) => `${model.provider}\0${model.model}` === pick);
  }, [pick, catalog]);
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
      ] }) : null,
      view === null ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { marginTop: 12 }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { ...styles.label, marginBottom: 4 }, children: t.routeTitle }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: { ...styles.fieldHint, margin: "0 0 6px" }, children: t.routeHint }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          CapBadges,
          {
            config: view.route,
            overrides: {},
            unknown: view.entries.length === 0,
            reasoningText: t.capReasoningIgnored,
            t
          }
        )
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { style: styles.card, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.header, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { style: styles.title, children: t.members }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { flex: 1 } }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Action, { label: t.syncNow, disabled: busy, title: t.syncHint, onClick: () => {
          void syncFromDsh();
        } })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: { ...styles.hint, marginBottom: 10 }, children: t.syncHint }),
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
          },
          onSave: (overrides) => {
            void saveOverrides(entry.id, overrides);
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
      ] }),
      picked === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { marginTop: 10 }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { ...styles.label, marginBottom: 4 }, children: t.previewTitle }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(CapBadges, { config: picked.config, overrides: {}, unknown: !picked.resolved, t }),
        picked.resolved ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: { ...styles.fieldHint, marginTop: 6, color: "#b7791f" }, children: t.resolveFailed.replace("{reason}", picked.resolveError ?? t.capUnknown) }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: { ...styles.fieldHint, marginTop: 6 }, children: t.previewHint.replace("{image}", acceptsImages(picked.config) ? t.capImageYes : t.capImageNo).replace("{context}", tokens(picked.config.contextWindow, t.capNotDeclared)).replace("{output}", tokens(picked.config.maxTokens, t.capNotDeclared)).replace("{reasoning}", reasoningSummary(picked.config, t)) })
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { style: styles.card, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: styles.header, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { style: styles.title, children: t.capsTitle }) }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: styles.hint, children: t.capsIntro }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("dl", { style: styles.legend, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dt", { style: styles.legendTerm, children: t.legendImage }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dd", { style: styles.legendBody, children: t.legendImageBody }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dt", { style: styles.legendTerm, children: t.legendContext }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dd", { style: styles.legendBody, children: t.legendContextBody }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dt", { style: styles.legendTerm, children: t.legendOutput }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dd", { style: styles.legendBody, children: t.legendOutputBody }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dt", { style: styles.legendTerm, children: t.legendReasoning }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dd", { style: styles.legendBody, children: t.legendReasoningBody })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: { ...styles.hint, marginTop: 10 }, children: t.legendFollow })
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
            style: { ...styles.input, width: 90 },
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
  const [editing, setEditing] = (0, import_react.useState)(false);
  const [draft, setDraft] = (0, import_react.useState)(entry.overrides);
  const open = () => {
    setDraft(entry.overrides);
    setEditing(true);
  };
  const dshFacts = entry.resolved ?? entry.snapshot ?? entry.effective;
  const edited = Object.keys(entry.overrides).length > 0;
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.member, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.memberTop, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: styles.index, children: index + 1 }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { flex: 1, minWidth: 0 }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.name, children: [
          entry.label,
          head ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { ...styles.badge, marginLeft: 8, color: "#1f9d63" }, children: t.head }) : null,
          cooling ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: { ...styles.badge, marginLeft: 8, color: "#b7791f" }, children: [
            t.cooldown,
            " ",
            duration(entry.remainingMs, t)
          ] }) : null,
          edited ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { ...styles.badge, marginLeft: 8, color: "#1f9d63" }, children: t.overridesActive }) : null
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
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Action, { label: t.remove, disabled: busy, onClick: props.onRemove }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        Action,
        {
          label: editing ? t.collapse : t.edit,
          disabled: busy,
          onClick: () => {
            if (editing) setEditing(false);
            else open();
          }
        }
      )
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      CapBadges,
      {
        config: entry.effective,
        overrides: entry.overrides,
        unknown: entry.resolved === void 0,
        t
      }
    ),
    entry.resolved === void 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { ...styles.fieldHint, marginTop: 4 }, children: t.resolvedAtAdd }) : null,
    editing ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      Editor,
      {
        t,
        dsh: dshFacts,
        draft,
        busy,
        onChange: setDraft,
        onRevert: () => {
          setDraft({});
          props.onSave({});
          setEditing(false);
        },
        onApply: () => {
          props.onSave(draft);
          setEditing(false);
        }
      }
    ) : null
  ] });
}
function Editor(props) {
  const { t, dsh, draft, busy, onChange, onApply, onRevert } = props;
  const efforts = dsh.reasoning?.efforts ?? [];
  const imageValue = dsh.inputModalities.length === 0 ? t.capUnknown : acceptsImages(dsh) ? t.capImageYes : t.capImageNo;
  const imageChoice = draft.inputModalities === void 0 ? "inherit" : draft.inputModalities.includes("image") ? "on" : "off";
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.editor, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.field, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { style: styles.label, children: t.fieldImage }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
        "select",
        {
          style: styles.select,
          value: imageChoice,
          disabled: busy,
          onChange: (event) => {
            const value = event.target.value;
            const next = { ...draft };
            if (value === "inherit") delete next.inputModalities;
            else next.inputModalities = value === "on" ? ["text", "image"] : ["text"];
            onChange(next);
          },
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "inherit", children: t.imageInherit.replace("{value}", imageValue) }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "on", children: t.imageForceOn }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "off", children: t.imageForceOff })
          ]
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: styles.fieldHint, children: t.fieldImageHint.replace("{value}", imageValue) })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.field, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { style: styles.label, children: t.fieldContext }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "input",
        {
          type: "number",
          min: 1,
          placeholder: dsh.contextWindow === void 0 ? t.undefinedValue : String(dsh.contextWindow),
          style: styles.input,
          value: draft.contextWindow === void 0 ? "" : String(draft.contextWindow),
          disabled: busy,
          onChange: (event) => {
            const next = { ...draft };
            const raw = event.target.value.trim();
            if (raw === "") delete next.contextWindow;
            else {
              const value = Number(raw);
              if (!Number.isSafeInteger(value) || value <= 0) return;
              next.contextWindow = value;
            }
            onChange(next);
          }
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: styles.fieldHint, children: t.fieldContextHint.replace("{value}", tokens(dsh.contextWindow, t.undefinedValue)) })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.field, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { style: styles.label, children: t.fieldOutput }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "input",
        {
          type: "number",
          min: 1,
          placeholder: dsh.maxTokens === void 0 ? t.undefinedValue : String(dsh.maxTokens),
          style: styles.input,
          value: draft.maxTokens === void 0 ? "" : String(draft.maxTokens),
          disabled: busy,
          onChange: (event) => {
            const next = { ...draft };
            const raw = event.target.value.trim();
            if (raw === "") delete next.maxTokens;
            else {
              const value = Number(raw);
              if (!Number.isSafeInteger(value) || value <= 0) return;
              next.maxTokens = value;
            }
            onChange(next);
          }
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: styles.fieldHint, children: t.fieldOutputHint.replace("{value}", tokens(dsh.maxTokens, t.undefinedValue)) })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.field, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { style: styles.label, children: t.fieldReasoning }),
      efforts.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { ...styles.meta }, children: t.fieldReasoningNone }) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
          "select",
          {
            style: styles.select,
            value: draft.reasoningEffort ?? "",
            disabled: busy,
            onChange: (event) => {
              const next = { ...draft };
              if (event.target.value === "") delete next.reasoningEffort;
              else next.reasoningEffort = event.target.value;
              onChange(next);
            },
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "", children: dsh.reasoning?.defaultEffort === void 0 ? t.reasoningInheritNoDefault : t.reasoningInherit.replace("{value}", effortName(dsh, dsh.reasoning.defaultEffort)) }),
              efforts.map((effort) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("option", { value: effort.id, children: [
                effort.name,
                effort.description === void 0 ? "" : ` \u2014 ${effort.description}`
              ] }, effort.id))
            ]
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: styles.fieldHint, children: t.fieldReasoningHint.replace("{value}", efforts.map((effort) => effort.name).join(" / ")).replace("{default}", dsh.reasoning?.defaultEffort === void 0 ? t.reasoningNone : effortName(dsh, dsh.reasoning.defaultEffort)) })
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.row, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Action, { label: t.apply, disabled: busy, onClick: onApply }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Action, { label: t.revert, disabled: busy, onClick: onRevert })
    ] })
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
