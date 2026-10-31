# Changelog

本文件的格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

## [0.2.2] - 2026-10-31

### 修复

- **队列模型下 `read_image` 一律报 `model "queue" does not declare image input`**：成员配置原来有 30 秒 TTL，过期后 `memberFacts()` 返回「未知」，队列路由随即只公布 `text`；而 `dsh-tool-fs` 的 `assertImageCapableRoute()` 完全按路由自报的 `inputModalities` 放行。于是启动 30 秒后、只要没人打开插件页面轮询，读图就必定被拒。现在**没有 TTL**：读到的配置在整个进程内始终有效，不会被时间收回。重新读取失败也保留旧值（并记录错误），连不上成员不会让路由降级。
- **重启后能力凭据丢失**：`queue.json` 里各成员的 `snapshot` 一直是空的 `{ "inputModalities": [] }`（从 0.1.0 文档迁移而来，版本 1 没有这个字段），重启后没有任何可回落的值。现在解析成功的配置会写回各行的 `snapshot`，文档成为路由跨重启的记忆；值未变化时不产生写盘。

### 变更

- **dsh 只在两个时刻被读取：加入成员时，以及用户点 `Re-sync from dsh` 时。** 删掉了 TTL、过期重解析、`ensureFacts()`（`/state` 轮询触发的刷新）和「每次状态变更就重新解析全员」的订阅。一个模型配置好之后它能接什么就定了；即使真的改了，也是用户主动点一次的事，插件不再假装自己会跟随。好处是路由对外公布的能力只取决于用户做过什么，而不取决于插件页面开着多久。
- 唯一保留的启动期读取是 `readUnresolvedRows()`：只读那些 `snapshot` 完全为空的成员（即版本 1 迁移过来的行），这是它们第一次被读，不是跟随 dsh。已有配置的行不再重读。
- 页面文案随之更新：`resolved` 不再表示「TTL 内新鲜」，而是「本次进程读到过」；`Re-sync from dsh` 的说明改为「插件平时不自动跟随 dsh」。

## [0.2.1] - 2026-10-29

### 修复

- **切到队列模型后报 `UNSUPPORTED_REASONING_EFFORT`（provider "dsh-model-queue" model "queue" does not support reasoning effort "max"）**：队列路由原来公布「所有成员推理等级的交集」，交集随成员变化而收窄（某个成员不支持 `max`，或成员配置缓存过期时甚至为空），而会话里存着的档位仍会被下发，宿主编排阶段直接拒掉整轮请求。现在路由固定公布 dsh 的全部 7 档（`off`/`minimal`/`low`/`medium`/`high`/`xhigh`/`max`）且不设默认档，任何存量档位都不会被拒。
- **队列模式下图片超限无法自愈，报 `IMAGE_OFFLOAD_REQUIRED`（pi-ai request images exceed the 20971520-byte base64 bound）**：适配器转发成员失败时只保留 `code` 和 `message`，把 `offloadImages`（以及 `status`、`providerRetryAfterMs`、`requestId`）丢掉了，`dsh-compaction-image-offload` 拿不到要腾出的张数只能放弃。现在失败对象原样透传；`finish` 事件与抛出的 `LlmError` 两条路径都保留完整记录。

### 变更

- 派发到成员时**丢弃**调用方指定的 `reasoningEffort`：队列不使用档位，成员一律跑自己的默认档。每行 `Edit configuration` 里设的推理等级仍然生效，但只在成员确实支持该档时才转发。
- 队列路由不再聚合推理等级（`aggregateRouteConfig` 不再输出 `reasoning`），由 manager 统一附上全集。
- 页面文案同步：路由能力表里推理等级一项显示为「已忽略」，图例与字段说明改为「会话传来的档位一律丢弃」。

## [0.2.0] - 2026-10-25

模型配置现在与 dsh 完全对齐，而不是只有一个模型名。

### 新增

- 每个队列成员保存 dsh 解析出的完整模型配置：输入模态（读图）、上下文窗口、单次输出上限、推理等级及其默认档。
- 新增模型时立刻解析一次完整配置，添加前的预览里就标出这四项。
- 页面上每个成员显示「生效中的四项配置」，偏离 dsh 的项用绿色标记。
- `Edit configuration`：逐项覆盖读图能力、上下文窗口、输出上限、推理等级，每项都有说明文字解释作用；`Follow dsh again` 清空覆盖。
- `Re-sync from dsh` 与 `POST /api/dsh-model-queue/sync`：dsh 侧配置变化后重新解析全部成员，手动覆盖保留。
- 队列路由对外公布的能力改为成员聚合值：读图需全员支持，上下文与输出上限取最小值，推理等级取交集。
- 派发时按成员配置下调超过上限的 `maxTokens`；调用方未指定或指定了不受支持的推理档时，回落到该成员的档位。
- 队列文档版本升到 2，版本 1 的文档仍可读取（旧成员补空配置）。
- 页面「Model configuration」卡片逐条说明四项配置各自的作用与默认行为。

### 修复

- 之前队列成员只存 `provider` + `model` 字符串，选中后实际派发用的能力全凭猜测，与 dsh 中直接选该模型并不等价。
- `Follow dsh again` 之前清不掉已有覆盖：页面把空覆盖当作「未提供」而不发送，服务端又把它理解为「保持原样」。现在空对象表示恢复 dsh，缺省才表示保持。
- 队列路由在解析缓存冷启动时对外公布「未声明」的配置；现在回落到成员加入时保存的配置。
- 浏览器轮询读到过期的成员配置时不再显示「当前路由未响应」：轮询只重新解析已过期的成员。
- 推理等级下拉在 dsh 未声明默认档时显示为空的 `Follow dsh default ()`；上下文与输出输入框的占位值改用完整数字。

## [0.1.0] - 2026-10-25

首个可用版本。

### 新增

- 有序模型队列：会话选中一个 `Model Queue` 路由，请求按队列顺序尝试，队首优先。
- 失败轮换：路由级失败时，**同一个请求内**继续尝试下一个模型，失败的成员移到队尾并进入冷却（默认 1 小时）。
- 全部冷却时任务失败，错误码与消息取**最后一次尝试的原样内容**。
- 服务端持久化：队列存于 `$DSH_HOME/model-queue/queue.json`（权限 600，原子写入），跨浏览器与会话共享。
- Web 页面（Plugins → Model Queue）：状态、成员顺序调整与增删、剩余冷却与上次失败原因、冷却时长、一键清冷却、启用开关。
- 失败分类：区分「模型路由不可用」（轮换）与「这次请求本身不行」（直接失败）；未识别错误码默认轮换。
- 队列路由公布的能力取成员交集：上下文窗口取最小、图片需全员支持。
- 空队列默认不公布路由，可用 `offerWhenEmpty` 打开。
- 损坏的队列文档被改名隔离并从空队列开始，不覆盖原文件。
- 47 个单元测试与一个真实启动的加载冒烟测试；CI 覆盖 Node 22.19 / 24。

### 已知限制

- 只在 dsh `0.2.1-rc.3` 上实测。
- 一个请求内的轮换对上层表现为「这一次请求耗时更长」，没有单独的事件或 UI 提示；轮换痕迹在插件页面与宿主日志里。
- 队列路由不提供推理档位选择（Effort），每个成员用各自的默认档；调用方显式指定的档位只在成员支持时才转发。

[Unreleased]: https://github.com/mzbot-creator/dsh-model-queue/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/mzbot-creator/dsh-model-queue/releases/tag/v0.2.0
[0.1.0]: https://github.com/mzbot-creator/dsh-model-queue/releases/tag/v0.1.0
