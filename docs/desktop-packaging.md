# 桌面试用包

本阶段补齐 M3 的本机打包与启动检查。使用锁定的 Electron 44.9.0 和 `@electron/packager` 20.3.0，生成当前机器系统与架构的未签名应用。应用自带运行时；使用者无需安装 Node、Bun 或克隆源码。现有水彩 UI、唯一 Host 与原生 watch/Chord 流式协议保持不变。

## 构建与核对

构建者使用 Node 24.22.0、Bun 1.4.3 和系统自带的 `tar`：

```sh
bun install --frozen-lockfile
bun run package:desktop
bun run test:package
```

只在目标系统上构建，不隐式交叉编译。产物在 `out/Dazi-<platform>-<arch>/`；同目录有 `Dazi-0.1.0-<platform>-<arch>-unsigned.tar.gz` 和对应 `.sha256`。重新构建仅覆盖当前目标目录和归档。从归档解压整个目录，保留相邻文件；不要单独搬动可执行文件。

每份应用附带 `build-info.json`：源码提交、工作区是否有未提交改动、锁文件 SHA-256、应用/Electron/打包器版本、系统和架构。它用于追溯构建输入，不承诺压缩包逐字节一致。macOS/Linux 可用 `shasum -a 256 <归档>`，Windows 可用 `Get-FileHash <归档> -Algorithm SHA256` 对照 `.sha256`。

CI 为 macOS Apple Silicon、macOS Intel 和 Windows x64 分别构建、搬移到带空格的临时目录并启动生产包；仅在该目标的启动测试通过后上传 14 天有效的 Actions 制品。没有创建 GitHub Release 或公开部署。Linux 可以本机构建，但不列为已验证试用目标，仍需在有显示服务与正确 Chromium sandbox 配置的系统验证。

## 启动与数据

macOS 解压后打开 `Dazi.app`；Windows 打开整个目录内的 `Dazi.exe`；Linux 打开 `Dazi`。这是开发试用包，没有签名、公证、安装器或自动更新；系统可能阻止下载后的未签名应用。本阶段不绕过 Gatekeeper、SmartScreen 或 Chromium sandbox，受系统策略阻止时仍需完成后续签名阶段。应用图标仍为 Electron 默认图标。

需要真实模型时，用户须在自己的终端安全配置供应商环境变量，再从该终端启动可执行文件。Finder/开始菜单启动的进程不一定继承终端变量；当前没有应用内凭据配置。不要将密钥写进启动参数、聊天、仓库或截图。缺少配置时可以创建工作、查看历史和修改档案；提交任务会明确报错并保留尚未发送的输入。

默认数据位置仍由 Electron 的应用名 `dazi` 决定。试用或排查时可显式指定独立目录；此参数在开发模式和正式包中均可用，不启用测试模型：

```sh
# macOS；其他系统使用各自的 Dazi 可执行文件
"/absolute/path/Dazi.app/Contents/MacOS/Dazi" --dazi-user-data="/absolute/path/dazi-trial"
```

路径必须是绝对路径，只能提供一次；错误参数会在打开存储前失败。用户数据存放在该目录的 `dazi.sqlite`，不写入应用包。删除试用应用不会删除数据；退出应用后再自行备份或删除明确选定的试用目录。数据库升级/降级兼容仍需单独验证。

## 实现与验证边界

- 打包白名单只有 `dist/`、`dist-desktop/`、`package.json` 和经生产依赖裁剪的 `node_modules/`。源码、测试、Git、本地配置及 source map 不进入应用；完整生产依赖保留自己的资源和许可证，避免破坏供应商目录与运行时动态资源。
- 新依赖仅为官方 `@electron/packager`，用于将现有 JS 构建和锁定运行时组合成可启动应用；它不参与 Agent 执行。
- 正式包使用 ASAR。搬移启动检查真实 `app.isPackaged`、sandbox、preload、插画解码、模型目录、创建去重、缺少模型时反复提交、Host 杀进程恢复、退出再启动和持久化。测试通过独立数据目录与环境白名单隔离个人数据和凭据；正式包必须忽略 `--test-provider`，不会为测试添加生产后门。
- 流式、工具、停止与运行中续跑沿用真实 Electron 的受控模型回归套件；生产包测试不调用付费 API，也不声称完成真实供应商在线验收。
- 签名/公证、安装器、自动更新、配置引导及后台子 Agent 仍未完成；没有将 M3 整体标记为完成。
