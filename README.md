# dsh-model-queue

**给 DeepSeek Harness 的模型排队与自动轮换。** 你排好一串模型，会话只选一个「Model Queue」；队首优先，失败了就换下一个、把它挪到队尾冷却一小时。某个 provider 额度用尽时，你不用再手动切换。

## 装

```sh
dsh plugin --profile web add github:mzbot-creator/dsh-model-queue
```

`lib/` 是随仓库提交的构建产物，所以装完就能直接用，不需要在安装时编译（pnpm 会拦截 git 依赖的 prepare 脚本）。

- 卸载：`dsh plugin --profile web remove dsh-model-queue`
- 从本地 checkout 装（开发用）：`dsh plugin --profile web add /path/to/dsh-model-queue`

装好之后：**Plugins → Model Queue** 里能开关、能配队列；新会话的模型选择器里多一个 **Model Queue** 分组。

## 它解决什么

你有多个 provider，额度会各自用尽。原来的做法是会话里手动换模型——你得先发现它失败了，再想起还有哪个能用。

这个插件把「换模型」变成一条流水线：

| 你的需求 | 插件里的行为 |
|---|---|
| 依次选择多个模型 | 队列是有序列表，想加几个加几个 |
| 优先使用第一个 | 每个请求都从队首取；列表里排第一的就是第一个被尝试的 |
| 失败就换下一个，并把它移到队尾、冷却 1 小时 | 同一个请求内继续试下一个；失败的进冷却，UI 上直接显示它排在队尾、还剩多少时间 |
| 队列信息存在服务端，跨浏览器、跨 session 共享 | 一份 JSON 文档存在 `$DSH_HOME/model-queue/queue.json`，所有浏览器和会话读同一份 |
| 全部冷却则任务失败，失败原因是最后一次请求的原因 | 报告最后一次尝试的原样错误码与消息 |

## 用起来是什么样

**Plugins → Model Queue**：

- **Status**：现在能不能请求（Ready / All cooling down / Queue is empty）；全部冷却时显示最后一次失败的原因。
- **Queue order**：成员列表。队首标 `Head`；冷却中的成员显示 `Cooldown left 52min`、失败次数和上次失败原因。`↑` `↓` 调顺序，`Remove` 移除。
- **Add a model**：下拉里是宿主机当前能路由到的所有模型（插件自己的队列路由已排除），`Add to tail` 加到队尾。
- **Cooldown**：冷却时长，默认 60 分钟；`Clear every cooldown` 只清冷却、不改顺序。
- **启用开关**：关闭后「Model Queue」从模型选择器消失，已排队的模型保持不变。

会话里：模型选择器选中 **Model Queue** 即可。之后每次请求由队列决定谁真的回答。

## 失败怎么算

不是所有失败都该换模型。插件按「这是模型路由的问题，还是这次请求的问题」分类：

**换下一个（并让这个模型冷却）**——额度用尽（`QUOTA` / `ACCOUNT_QUOTA`）、限流（`RATE_LIMIT`）、上游 5xx（`SERVER`）、超时（`TIMEOUT`）、网络错误（`TRANSPORT`）、空回复（`EMPTY_RESPONSE`）、凭据缺失或失效（`MISSING_CREDENTIAL` / `INVALID_CREDENTIAL`）、路由已注销（`NO_ADAPTER`），以及**任何未识别的新错误码**。

**不换，直接失败**——上下文超长（`CONTEXT_WINDOW_EXCEEDED`）、不支持的内容/选项/推理档位、`UNKNOWN_MODEL`、取消（`ABORTED`）。这些错误在哪个模型上都会同样发生，换模型只会把整条队列白白冷却一小时，还会把「你的请求有问题」误报成「模型有问题」。

> 默认倾向「换」是刻意的：未识别的错误码更可能是 provider 新出的故障，而不是新的请求形状错误；而错误轮换的代价是自愈的——冷却结束后它自己就回来了。

## 它怎么做到的

Harness 是「一个会话选一个模型」。插件注册**一条自己的 provider 路由**（`dsh-model-queue`，只公布一个模型 `queue`），然后在每次分发时：

1. 问队列现在该用谁（队首且不在冷却中的那个）；
2. 用 `ctx.llm.stream()` 把**同一个请求**重新分发给那条真实的 provider/model；
3. 看结果——成功就交出去；失败就按上面的分类决定轮换还是失败。

所以「一条路由、一堆真实模型」这件事对会话是透明的，同一个请求内就能连续换人。

几个刻意的取舍：

- **队列路由公布的上下文窗口取所有成员里最小的**，图片能力取「所有成员都支持」才算数。乐观值会让宿主编排出一个某成员接不住的请求，轮换后报一个用户无法处理的错。
- **失败尝试的残缺输出不会交给会话**。否则它会被存成 assistant 消息，然后在一段半截内容上继续重试。
- **冷却时长是插件配置（`cooldownMs`），不是队列文档的一部分**，改设置不需要重写你排好的队列；`0` 仍然会轮换到队尾，只是不等待。
- **空队列默认不公布路由**。一个选得到、但必然失败的模型选项比没有更糟。想要的话可以在页面里打开 `Offer the route even when empty`。
- **每次修改都串行化并落盘后才回包**，所以两个会话同时失败不会丢掉其中一次轮换。

## 配置

`cordis.patch.yml` 里的行，也可以在 **Plugins → Model Queue** 页面改（写回 profile 的 patch 层）：

| 字段 | 默认 | 含义 |
|---|---|---|
| `enabled` | `true` | 是否公布队列路由 |
| `cooldownMs` | `3600000` | 失败后的冷却时长（毫秒），上限一年 |
| `offerWhenEmpty` | `false` | 队列为空时是否也公布路由 |

队列文档（`$DSH_HOME/model-queue/queue.json`，权限 600）故意不含 `cooldownMs`：顺序和冷却状态归文档，策略归配置。

文档损坏时会被改名隔离（`queue.json.corrupt-<时间戳>`）并从空队列开始，而不是覆盖掉唯一一份顺序记录。

## HTTP 接口

页面用这五个同源、经宿主认证的接口（前缀 `/api/dsh-model-queue`）：

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | `/state` | 读整个队列视图（含剩余冷却、队首、是否全部冷却、最后失败原因） |
| GET | `/catalog` | 列出宿主上可路由的模型 |
| POST | `/entries` | 整体替换队列顺序与成员 |
| POST | `/cooldown` | 改冷却时长 |
| POST | `/reset` | 清除全部冷却 |

## 开发

```sh
npm ci
npm run typecheck   # host + client
npm run compile     # 写 lib/（产物入库）
npm run check:dist  # 校验 lib/ 与源码一致
npm test            # 47 个单测
npm run verify:load # 装进临时 profile、真的启动一次、查 API
```

`npm run verify:load` 需要 PATH 上有 `dsh` 和 `pnpm`（或用 `DSH_BIN` 指定），它不会碰你自己的 harness home。

发布：打一个与 `package.json` 版本一致的 tag（`v0.1.0`）并推送，Release 工作流会校验 tag、跑全部检查、`npm publish`、把 `.tgz` 挂到 GitHub Release。

## 已验证与未验证

**已实测**（本机真实 dsh `0.2.1-rc.3` + 真实 provider）：

- 插件出现在 Plugins → Installed，开关可切换
- 页面配置卡完整渲染，无控制台错误
- 会话选中 Model Queue 并发消息，请求经队列路由成功返回
- 队首指向坏路由时，**同一个请求内**轮换到下一个成员并成功回答；坏成员移到队尾、`remainingMs ≈ 3600000`、记录了 `NO_ADAPTER`
- 两个独立浏览器上下文读到同一份队列（head 一致）
- 全部成员冷却时，错误码与消息是**最后一次失败的原样内容**

**未验证**：

- 只有 `0.2.1-rc.3` 一个宿主版本上跑过；更早的 `0.2.0-rc.x` 只做了类型层面的兼容（`engines.dsh` 写的是 `>=0.2.0-rc.1 <0.3.0`）
- 插件市场索引（`dist/plugin-index.json`）会生成本仓库的描述，但尚未发布到任何公开索引源
- 真实 provider 的**额度耗尽**没有真的打到过；轮换路径是用「不存在的路由」和「缺凭据的路由」触发的，它们与 `QUOTA` 走同一条分类分支

## 许可

MIT
