# Changelog

本文件的格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

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

[Unreleased]: https://github.com/mzbot-creator/dsh-model-queue/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/mzbot-creator/dsh-model-queue/releases/tag/v0.1.0
