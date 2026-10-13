# AGENTS.md

本仓库编码 Agent 与贡献者指南。`CLAUDE.md` 是本文件的软链接。用户指令与本文件冲突时，先请求明确确认再执行。

## 先读这三条

1. **产品立场优先于一切。** 动手前读 [README.md](README.md) 的「产品立场」。每个改动都要能回答：它让黄金路径的哪一步变得更好？回答不了就不做。
2. **Durable First。** `@earendil-works/pi-durable` 是唯一的 Agent 内核。持久化、续跑、排队、中止、子 Agent、业务状态，优先用它的原生机制（Conversation、Task、Document、Extension、`watch()`），不在应用层重造。
3. **Harness 不得劣化模型。** 提示注入、工具包装、闸门、强制纠偏都不得浪费 token、制造摩擦或扭曲行为。不强制模型调用声明/协议类工具才算完成；被证明劣化的机制直接移除，不加固。

## 文档地图

| 文档 | 用途 |
| --- | --- |
| [README.md](README.md) | 产品是什么、为谁、做什么、不做什么 |
| [docs/tech-stack.md](docs/tech-stack.md) | 技术选型与「明确不引入」清单 |
| [docs/architecture.md](docs/architecture.md) | 进程结构、领域模型、关键流程、里程碑 |

改了架构或选型，同一个 PR 里更新对应文档。

## 命令

脚手架尚未建立。M0 完成后在这里补齐：开发、构建、lint、format、test、打包命令。约定：

- 包管理只用 Bun（`bun install`、`bun.lock`）；脚本可用 npm 运行。
- Node 版本与 Electron 内置 Node 保持一致，且 ≥ 22.19。

## 架构速览

- **Main**：窗口、托盘、通知、Host 监管。不打开存储，不跑 Agent。
- **Agent Host**（`utilityProcess`）：唯一打开 `dazi.sqlite` 的进程；Harness、extension、调度、简报都在这里。
- **Renderer**：只通过 MessagePort / preload 与外界通信，不访问文件系统和网络。
- **领域模型**：一项「工作」= 一个根 Conversation + `dazi.*` Document。业务状态一律做成 Document，与对话同一事务提交；不另建业务表。

细节见 [docs/architecture.md](docs/architecture.md)。

### 硬性约束

- 存储只在 Host 中打开；其他进程通过 RPC 访问。
- 每个自定义工具都要明确 `replay` 策略；有外部副作用的工具必须自己保证幂等。
- 每次提交带 `requestId`；定时触发用 `schedule:<workId>:<槽位>`。
- Main 进程保持响应：不在主进程做扫盘、整文件哈希、大文件解析等重活。
- 前端只消费结构化视图（`watch()` / `viewState()`），不依赖实验性的 `watchEvents()`。
- 内核依赖锁定精确版本；升级单独提 PR，并跑崩溃续跑回归测试。

## 前端规则

- **一套主题**，浅色 / 深色 / 跟随系统。不做主题包、外观设置或换肤。
- 视觉值（颜色、字号、圆角、阴影、间距档位）只存在于 `src/renderer/theme/` 的 CSS 变量 token 和共享组件的 variant 中。页面和业务组件只写布局类（flex、grid、gap、宽高约束、滚动）。
- 组件只从这些地方来：基础控件用 shadcn/ui，Agent 相关展示（消息、推理、工具、附件、代码）用 ai-elements，图标用 `lucide-react`。先找现成的，再考虑扩展 variant，最后才新建。
- 结构组合用 Tailwind `className` + `cn()`。
- 不加装饰性渐变、光晕、彩色卡片、嵌套卡片、多余动效；动效遵守 `prefers-reduced-motion`。
- 每个界面必须在实际渲染中检查：浅色 / 深色、窄窗口、长文本、空状态、加载与错误、键盘焦点。

### 文案（温度来自这里）

- 先结论，后过程：「已修好登录测试，还差你确认是否推送」，而不是罗列执行步骤。
- 用户说人话，产品也说人话：不出现内部组件名、模型供应商名、内核名、技术术语。
- 只在必要时提问，一次问完；能从工作档案推断的不问。
- 错误信息说清楚发生了什么、影响了什么、用户可以怎么做。
- 用户可见字符串一律走 i18n，新键 zh / en 同时补齐。

## 编码规范

- TypeScript strict；函数组件 + Hooks；2 空格、单引号、分号。
- 禁止 `any`（确需时旁注理由）。第三方 API 先查 `node_modules` 里的实际类型声明，不凭记忆。
- 禁止内联 `await import()`，一律顶层 import。
- 新文件目标 ≤ 500 行，硬上限 800 行。
- 判别值、状态、RPC 命令名、Document kind 等多处比较的字符串禁止裸字面量，集中定义常量：

  ```typescript
  export const WorkStatus = { Active: 'active', Paused: 'paused', Done: 'done', Archived: 'archived' } as const;
  export type WorkStatus = (typeof WorkStatus)[keyof typeof WorkStatus];
  ```

- 日志：`[ModuleName]` + 英文自然语句，一行一事；error 对象作为最后一个参数；高频路径不打逐次日志。
- 删除看似有意为之的代码前先问。不做用户没要求的向后兼容。
- 新增依赖必须在 PR 中说明服务哪一步、为什么现有能力不够。

## 测试与验证

- 单测与源码同目录，命名 `*.test.ts`，使用 Vitest。
- Extension / Document / 简报投影用 `MemoryStorage` 测；崩溃续跑用临时 SQLite 文件测（运行中关闭 → 重开 → 断言无重复提交、无重复审批）。
- 代码改动后 lint 清零、format 通过、相关测试通过。
- 截图、测试、lint 各证明不同的事，不能互相替代；自动检查不覆盖设计判断。

## Git 与 PR

- 只提交自己改的文件：`git add <显式路径>`，不用 `git add -A` / `git add .`。
- 禁止 `git reset --hard`、`git checkout .`、`git clean -fd`、`git commit --no-verify`、`git push --force`。
- 提交信息遵循 Conventional Commits，英文：`type(scope): summary`，subject 小写祈使、≤ 72 字符、无句号；body 写 why。
- PR 说明三段：改了什么、为什么、怎么验证的。UI 改动附浅色 / 深色截图和已检查的状态；未验证的如实列出。

## 协作

- 回答简洁直接；用户提问先回答，再动手。
- 不确定就问，不自行假设需求。
- 回应评审先明确同意/不同意，再说改了什么。
