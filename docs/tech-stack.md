# 技术选型

> 原则：**少而硬。** 每一项依赖都必须服务黄金路径；能用内核原生能力解决的，不在应用层重造。

## 总览

| 层              | 选型                                                         | 一句话理由                                                     |
| --------------- | ------------------------------------------------------------ | -------------------------------------------------------------- |
| 桌面壳          | Electron（当前稳定版）                                       | Agent 内核是 Node 生态；需要托盘常驻、系统通知、本地文件与进程 |
| Agent 内核      | `@earendil-works/pi-durable` + `pi-ai` + `chord`             | 对话、任务、文档都是持久化的；崩溃/重启后从检查点续跑          |
| Agent 宿主进程  | Electron `utilityProcess`                                    | 内核独占存储、跑工具和调度，不阻塞主进程                       |
| 存储            | pi-durable SQLite 存储（`node:sqlite`），单文件              | 业务状态与对话在同一原子提交里；无原生模块，无需 rebuild       |
| 模型接入        | `pi-ai`                                                      | 多供应商统一接口、用量与成本统计                               |
| 工具与执行环境  | `pi-durable/tools` + `NodeExecutionEnv`                      | 内置 read / write / edit / bash，按工作目录隔离                |
| MCP             | `@modelcontextprotocol/sdk` 桥接为 extension + `tool-search` | 大量 MCP 工具延迟加载，不撑爆上下文                            |
| 前端            | React + Vite + TypeScript                                    | 团队熟悉，生态成熟                                             |
| 样式            | Tailwind CSS v4 + CSS 变量 token                             | 一套主题，浅色 / 深色                                          |
| 组件            | shadcn/ui（Base UI）+ Streamdown + lucide-react              | 基础控件、Agent 展示、图标各有唯一来源                         |
| 前端状态        | 订阅宿主推送的视图 + `useSyncExternalStore`                  | 真相在内核里，前端只做投影，不引入 Redux                       |
| 包管理 / 运行时 | Bun（安装）+ Node（运行）                                    | 与内核 Node 要求一致                                           |
| 质量            | oxlint、oxfmt、Vitest                                        | 快，足够用                                                     |
| 打包            | electron-builder                                             | macOS / Windows 安装包与自动更新                               |

所有依赖在初始化时**锁定精确版本**，`bun.lock` 变更视同代码评审。

## 关键取舍

### 1. Agent 内核：Pi Durable，而不是 Pi coding-agent

|            | Pi coding-agent            | Pi Durable                                |
| ---------- | -------------------------- | ----------------------------------------- |
| 设计目标   | 单用户、交互式终端编程助手 | 构建长期运行、可恢复的 Agent 应用         |
| 会话状态   | 进程内，靠宿主自己持久化   | 不可变 entry + 原子 commit，天然持久      |
| 崩溃恢复   | 宿主自行处理               | Task 每步存检查点，`resume()` 续跑        |
| 业务状态   | 宿主另建表，与对话分离     | Document 与对话在同一提交中变更           |
| 多视图订阅 | 宿主自建事件总线           | `watch()` / `viewState()` / `taskGraph()` |
| 后台子任务 | 宿主自建                   | owned conversation + background task      |
| 幂等       | 宿主自建                   | 提交时带 `requestId`                      |

上一代产品在 harness 层补了数千行代码去实现持久化、排队、中止、子 Agent 和完成语义。搭子的「工作」模型要求的恰好都是 Pi Durable 的原生能力，所以选它。

**风险与对策**

- **版本很新**（1.0 发布于 2026-10-01，当前 1.2.0）：锁死版本，升级走单独 PR，并跑崩溃续跑回归测试。
- **Agent Events 标注为实验性**：前端只消费结构化视图（`watch()`），不依赖 `watchEvents()`。
- **单进程独占存储**（无跨进程锁）：存储只在 Agent 宿主进程中打开，其他进程一律通过 RPC 访问。

### 2. 桌面壳：Electron，而不是 Tauri

Tauri 体积更小，但内核是 Node 包，需要 `node:sqlite`、子进程和文件系统。用 Tauri 就得再带一个 Node sidecar，等于两套运行时加一层 IPC，复杂度更高。Electron 的 `utilityProcess` 正好提供「有 Node、独立于主进程、可被主进程监管重启」的宿主。

前提：Electron 内置的 Node 版本必须 ≥ 22.19（pi-durable 的 `engines` 要求），并提供 `node:sqlite`。M0 验证这一点。

### 3. 存储：一个 SQLite 文件，不另建业务库

- 工作元数据、工作档案、待决事项、计划、产物清单全部定义为 pi-durable **Document**，与对话 entry 一起原子提交。
- 不再引入 better-sqlite3 等原生模块，消除 `electron-rebuild` 一类的问题。
- 只有与 Agent 无关的纯 UI 偏好（窗口尺寸、语言、浅色/深色）放在主进程的一个小 JSON 文件里。

### 4. 前端：一套主题，不建主题引擎

- 只有一套设计，提供浅色 / 深色 / 跟随系统。
- 视觉值集中在 CSS 变量 token 和共享组件的 variant 里；页面不写颜色、圆角、阴影、字号。
- 不做主题包、recipe 引擎、主题注册表。设计能力花在信息组织和文案上，而不是换肤。

### 5. 明确不引入

| 不引入                             | 原因                                                              |
| ---------------------------------- | ----------------------------------------------------------------- |
| 本地推理（llama.cpp 等）、模型市场 | 不服务黄金路径，维护成本高                                        |
| 独立记忆引擎                       | v0.1 记忆就是每项工作的档案（Document）；跨工作的个人偏好后续再议 |
| IM / 渠道连接器                    | 推进与通知先在桌面端闭环                                          |
| Redux 等全局状态库                 | 真相在内核里，前端只做订阅投影                                    |
| 托管 Python 运行时                 | 第一版 Skills 用 TypeScript extension 实现；确有需要时再引入      |
| 多主题 / 外观设置                  | 见上                                                              |

新增依赖需在 PR 中说明：服务黄金路径的哪一步，为什么现有能力不够。

## UI-first implementation

The first runnable slice is the React renderer only. No Electron/Host/kernel package is installed until the separate Agent integration phase. The in-memory `DemoStore` exposes immutable structured projections through `useSyncExternalStore`; refresh resets all work and preferences. It is a presentation fixture, not a second durable store.

Dependency purpose: React/Vite/TypeScript implement the renderer; Tailwind v4, Base UI, cva/clsx/tailwind-merge compose reusable controls and tokens; lucide supplies icons. Vitest, Playwright, oxlint and oxfmt verify state, interaction, visual captures and code quality. Versions are exact and Bun-lockfile backed. Message primitives use the ai-elements composition model without adding an AI SDK or provider to this UI-only stage.

## Agent 接入阶段

2026-10-18 用户明确允许保留现有 Agent 展示组件，不强制 ai-elements 来源。Streamdown 2.7.0 只负责 Markdown；Pi Durable/ai/chord 全部精确锁定 1.3.0，唯一运行与业务状态源仍是原生内核。选择直接渲染的理由是已验收 UI 只需 Markdown 能力，减少组件与消息结构转换；ai-elements 本身并不强制另一套运行时。Electron 44.9.0 / Node 24.22.0 与本机 SQLite 由实际桌面 CI 验证。恢复协议、依赖证据和未验证边界见 [接入记录](agent-integration.md)。
