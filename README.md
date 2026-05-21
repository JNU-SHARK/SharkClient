# SharkClient

> RoboMaster 风格的多机器人地面站客户端 · Tauri 2 + Vue 3 + Rust · v1.0.0

SharkClient客户端整合了 UDP H.265 视频接收、HUD 自定义叠加、MQTT 双向协议、外置 AI 检测和多种打包形态，目标是提供一份从克隆到运行都能跑通的、面向 RoboMaster 的开源参考实现。

本目录是 **v1.0.0 快照**。只需准备好 Node.js、Rust 工具链与平台依赖即可进入开发与构建流程。

---

## 目录

- [核心特性](#核心特性)
- [系统架构](#系统架构)
- [仓库结构](#仓库结构)
- [环境要求](#环境要求)
- [快速上手](#快速上手)
- [构建与运行](#构建与运行)
- [资源配置](#资源配置)
- [可选能力](#可选能力)
- [发行打包](#发行打包)
- [协议生成与验证](#协议生成与验证)
- [已知限制与 FAQ](#已知限制与-faq)
- [贡献指南](#贡献指南)
- [版本与变更](#版本与变更)
- [许可证](#许可证)
- [致谢](#致谢)

---

## 核心特性

- **UDP H.265 视频管线**：自定义分包/组帧协议，1080P 流可稳定接收；解码层主动丢弃积压旧帧，优先呈现最新画面，避免端到端延迟累积。
- **多解码后端**：默认走 WebCodecs 浏览器内解码，桌面端可切换 Rust 侧 libde265 软解或可选 GPU 路径，能在没有硬件加速的低性能机器上回退运行。
- **MQTT 双向协议**：基于 `messages.proto` 自动生成强类型前端 JSON Schema；裁判系统状态、控制指令、自定义数据块均按消息名解析与发送。
- **可定制 HUD 系统**：XML 描述 + Vue 渲染，预置准星、边框、血量指示器、警告区域、视频缩放状态等组件，可在运行时编辑布局与样式。
- **外置 AI 检测**：检测服务作为独立 Python 进程接入，通过 Windows Named Pipe / Linux Unix Socket 传控制信息，帧数据走共享内存零拷贝；可热启停、可换模型。
- **多发行形态**：单一源码可产出 Windows lite/mini/single 三档安装包、Linux tar.gz 与 Flatpak，按目标平台与依赖完整性按需选择。
- **跨平台一致**：Windows 10/11 与 Ubuntu 22.04+ 是主测平台；CI 工作流位于 `.github/workflows/ci.yml`。

---

## 系统架构

```
                              ┌────────────────────────────────────────┐
                              │            操作员（前端 UI）            │
                              │   Vue 3 + Pinia + WebCodecs/Canvas     │
                              └──────────────┬─────────────────────────┘
                                             │ Tauri IPC / events
                              ┌──────────────┴─────────────────────────┐
                              │             Tauri 2 Runtime            │
                              │           (Rust async backend)         │
                              ├─────────────┬───────────────┬──────────┤
                              │  UDP Bridge │ Video Decoder │  MQTT    │
                              │  ─────────  │   ─────────   │  ──────  │
                              │  分片组帧    │  libde265 软解 │ rumqttc │
                              │  MJPEG 兼容 │ 内嵌精简ffmpeg │ proto-  │
                              │  统计监控    │  丢旧帧策略    │ 强类型   │
                              └──────┬──────┴───────┬───────┴────┬─────┘
                                     │              │             │
                          UDP 视频流  │     SHM 帧   │  MQTT TCP   │
                                     ▼              ▼             ▼
                              ┌──────────────┐ ┌─────────────┐ ┌──────────┐
                              │  机器人/裁判  │ │ Python 检测 │ │  Broker  │
                              │  视频发送端   │ │  外置服务   │ │          │
                              └──────────────┘ └─────────────┘ └──────────┘
```

三条主线在后端互相解耦：

1. **UDP 视频线**：`src-tauri/src/udp_bridge/` 负责接收、分片重组、码流嗅探（H.265 / MJPEG）和统计。组好的帧推到前端或共享内存。
2. **解码线**：`src-tauri/src/video_decoder/` 提供 `native`（libde265 vendored 源码软解）与 `gpu` 两种实现，前端首选 WebCodecs（已废弃）；解码过程主动丢弃积压旧帧。
3. **MQTT 控制线**：`src-tauri/src/mqtt_client/` 基于 rumqttc，与前端 `src/mqtt/` 共同完成 proto → JSON Schema → Vue store 的端到端类型化数据流。

外置 AI 检测通过 `scripts/detection_pipe_server.py` 启动，Pipe / Socket 只承载控制 JSON，帧数据由 `src-tauri/src/shm_bridge.rs` 写入共享内存，避免大数组在 IPC 层来回拷贝。

---

## 仓库结构

| 路径 | 说明 |
| --- | --- |
| `src/` | Vue 3 前端：视图、组件、Pinia store、MQTT/解码 Worker、生成代码 |
| `src/views/` | `Dashboard`、`Settings`、`Telemetry`、`CustomDataConfig` 等顶层视图 |
| `src/components/` | HUD 元素、控制面板、状态条等 UI 单元 |
| `src/store/modules/` | `mqtt_data`、`dashboard`、`hud-templates` 等状态切片 |
| `src/generated/mqtt-proto.json` | 由 proto 编译得到的协议 JSON，**仓库已预生成** |
| `src-tauri/` | Rust/Tauri 后端工程 |
| `src-tauri/src/udp_bridge/` | UDP 接收、组帧、MJPEG 兼容、统计 |
| `src-tauri/src/video_decoder/` | libde265 软解 (`native.rs`) 与 GPU 路径 (`gpu.rs`) |
| `src-tauri/src/mqtt_client/` | MQTT 客户端封装 |
| `src-tauri/src/shm_bridge.rs` | AI 检测共享内存桥 |
| `src-tauri/vendor/libde265/` | H.265 解码库 vendored 源码（必需，构建时编译） |
| `resources/` | 运行时资源：地图、HUD 模板、配置、proto |
| `scripts/` | 构建、打包、依赖下载、AI 辅助脚本 |
| `flatpak/` | Linux Flatpak 打包描述（可选） |
| `docs/` | UDP 低延迟优化笔记等设计文档 |
| `.github/workflows/` | CI 工作流 |

---

## 环境要求

| 组件 | 最低版本 | 说明 |
| --- | --- | --- |
| Node.js | 20 LTS | 推荐使用 nvm / fnm 管理 |
| npm | 10+ | 随 Node 自带 |
| Rust | stable (>=1.78) | 通过 `rustup` 安装 |
| Windows | 10 / 11 | 需 Microsoft Edge WebView2 Runtime |
| Linux | Ubuntu 22.04+ | 需 WebKitGTK 4.1、GTK 3、libsoup 3、patchelf |

Linux 系统依赖一行装齐：

```bash
sudo apt-get update
sudo apt-get install -y \
  libwebkit2gtk-4.1-dev \
  libgtk-3-dev \
  libsoup-3.0-dev \
  libjavascriptcoregtk-4.1-dev \
  librsvg2-dev \
  patchelf \
  build-essential
```

Windows 推荐通过 `winget` 安装：

```powershell
winget install OpenJS.NodeJS.LTS
winget install Rustlang.Rustup
winget install Microsoft.EdgeWebView2Runtime
```

---

## 快速上手

```bash
# 1. 安装依赖
npm install

# 2. 启动开发模式（前端 Vite + Tauri 桌面壳）
npm run tauri dev

# 3. 编译发行二进制
npm run tauri build
```

> **提示**：仓库已经携带预生成的 `src/generated/mqtt-proto.json`，无需 proto 源即可启动开发和构建。仅当你要修改协议时才需要按 [协议生成与验证](#协议生成与验证) 节准备 `messages.proto`。

---

## 构建与运行

### 开发模式

```powershell
npm run tauri -- dev
```

前端默认监听 `http://localhost:1420`，Tauri 自动挂载 WebView。开发模式下打开 DevTools 可观察 IPC、MQTT、视频统计等事件。

### 仅前端构建

```powershell
npm run build
```

产物输出到 `dist/`，可被 Tauri 包装为桌面应用，也可用于纯浏览器内调试（无桌面后端能力）。

### 仅后端检查

```powershell
cargo check --manifest-path src-tauri/Cargo.toml
```

CI 也会跑这一步。

### 完整桌面构建

```powershell
npm run tauri build
```

会按 `src-tauri/tauri.conf.json` 的 `bundle.targets` 产出对应安装包（默认 Windows NSIS、Linux deb/AppImage）。

---

## 资源配置

`resources/` 下的资源在打包时会被嵌入应用，开发期通过 Tauri 资源协议直接读取。

| 路径 | 内容 |
| --- | --- |
| `MessageMQTTConfig.yaml` | MQTT 主题与订阅规则 |
| `RobotConfig.yaml` | 机器人显示元数据 |
| `RoboSelect.yaml` | 机器人选择面板配置 |
| `CustomByteBlockConfigs/*.{proto,xml}` | 自定义字节块（balance/drone/engineer/hero/infantry/radar/sentry） |
| `CustomData/{ReceiveDataBlock,Template}.proto` | 自定义数据块协议 |
| `CustomElement/` | HUD 静态/动态/固定元素 XML 描述 |
| `HUDPanel/` | HUD 面板模板（含本次新增的 `VideoZoomStatus.xml`） |
| `DashboardConfig/` | Dashboard 布局预设 |
| `MapConfig/` / `Map.png` | 地图标定与底图 |
| `VehiclePhysics/` / `physics/` | 车辆物理参数 |
| `splash.html` | 启动画面 |

修改 yaml/xml 后无需重新编译 Rust，前端热重载即可看到效果；修改 proto 需要重新生成 `src/generated/mqtt-proto.json`。

---

## 可选能力

### FFmpeg（嵌入式视频解码）

默认走 libde265 软解或 WebCodecs。若要在 Tauri 二进制内嵌入 FFmpeg 静态库（启用 `internal-ffmpeg` feature），可重新生成依赖：

```powershell
# Windows
npm run build:ffmpeg:minimal

# Linux
bash scripts/build-ffmpeg-minimal-linux.sh
```

也可以通过环境变量指向系统已有的 FFmpeg：

```powershell
$env:SHARK_FFMPEG_PATH = "C:\path\to\ffmpeg.exe"
```

构建产物默认放在 `src-tauri/vendor/ffmpeg-static/`（已在 `.gitignore` 中）。

### ONNX Runtime / AI 检测

AI 检测默认是 **可选外置 Python 服务**，不随客户端启动。开源仓库不包含模型，请自行准备 `AI Server` 目录：

```
AI Server/
├── server/Server.py
├── requirements.txt
└── model/
    ├── armor.onnx
    └── car.onnx
```

下载 ONNX Runtime 动态库：

```powershell
# Windows
npm run onnxruntime:download

# Linux
npm run onnxruntime:download:sh
```

如果 `AI Server` 不放在仓库根目录，可通过环境变量指定：

```powershell
$env:SHARK_AI_ROOT = "D:\path\to\AI Server"
```

控制通道协议：Windows 走 Named Pipe，Linux 走 Unix Domain Socket。两端只交换 JSON 控制消息，帧载荷由 Rust 端写入共享内存。

### CUDA / TensorRT（可选加速）

```powershell
# Windows 装 CUDA + cuDNN + TensorRT 工具链
scripts\install-cuda-stack.ps1

# Linux 同上
bash scripts/install-cuda-stack.sh

# 量化为 TensorRT engine（需先放入 onnx + 校准帧）
npm run quantize:int8
```

### Flatpak 打包（Linux，用于ubuntu20.04及以下版本，不推荐使用）

```bash
bash scripts/build-flatpak.sh
```

打包描述位于 `flatpak/`，需要本机已安装 `flatpak`、`flatpak-builder` 与 freedesktop runtime（脚本会提示具体版本号）。

---

## 发行打包

仓库提供三档 Windows 发行形态与一档 Linux 形态：

| 命令 | 形态 | 体积粗略 | 包含 |
| --- | --- | --- | --- |
| `npm run build:lite` | Lite (GPU) | 中 | 主程序 + 必要 DLL + AI Server 入口 |
| `npm run build:lite:cpu` | Lite (CPU) | 中 | 同上，使用 CPU ONNX Runtime |
| `npm run build:mini` | Mini | 小 | 内嵌 FFmpeg 静态库，去掉外置依赖 |
| `npm run build:single` | Single | 大 | 单文件发行，含全部依赖 |
| `npm run build:linux` + `npm run package:lite:linux` | Linux tar.gz | 中 | 跨发行版可移植 |

> 注意：lite/mini/single 系列脚本会要求本机已有 ONNX Runtime 动态库、TensorRT 或 FFmpeg 构建产物；脚本会在缺依赖时给出具体提示。源码仓库本身**只保证开发构建链自包含**，发行包请按脚本提示准备。

打包产物默认输出到：

- `build-lite/`：Windows lite/mini 系列
- `build-linux/`：Linux 系列
- `build-flatpak/` 与 `.flatpak-builder/`：Flatpak 中间产物

---

## 协议生成与验证

MQTT 消息走 protobuf 定义，前端通过编译后的 JSON Schema 完成强类型解析。

### 仓库默认状态

- `src/generated/mqtt-proto.json` **已预生成并随仓库发布**，开箱即可启动开发与构建。
- `npm run predev` / `npm run prebuild` hook 会调用 `generate:mqtt-proto`，**该脚本读取 `UDP-MQTT Server/proto/messages.proto`**——这是项目原始私有 submodule 的协议源，开源仓库不附带。

### 修改协议时

1. 准备一份 `messages.proto`（可来源于上游 SharkClient 主仓的 `UDP-MQTT Server/proto/messages.proto`，或自行编写）。
2. 放到仓库根目录 `UDP-MQTT Server/proto/messages.proto`（脚本默认路径），或修改 `scripts/generate-mqtt-proto-json.mjs` 中 `protoPath` 指向你的路径。
3. 重新生成与校验：

   ```powershell
   npm run generate:mqtt-proto
   npm run verify:mqtt-proto
   ```

### 不修改协议时

若只想在没有 proto 源的环境下跑 `npm run dev`/`build`，可在 `package.json` 临时移除 `predev` / `prebuild` hook，或通过 `npm run dev --ignore-scripts` / `npm run build --ignore-scripts` 跳过生成；仓库自带的 `mqtt-proto.json` 仍能保证完整功能。

---

## 已知限制与 FAQ

**Q：`npm run dev` 提示找不到 `UDP-MQTT Server/proto/messages.proto`？**
开源版默认不附带 proto 源。仓库的 `mqtt-proto.json` 已经预生成，按上一节说明跳过 hook 即可。需要修改协议时再补齐 proto 源。

**Q：启动后视频画面卡顿、延迟堆积？**
- 检查发送端是否真的是 H.265/HEVC 关键帧间隔合理（建议 GOP <= 30）。
- 在 Settings 内将解码器切到 `Rust libde265` 软解作为对照基线。
- 解码器每跑一轮都会丢掉积压旧帧，如果整机 CPU/GPU 真的不够，会主动降帧而不是堆队列。

**Q：AI 检测启动失败？**
- 确认 `AI Server/` 与模型路径存在，或正确设置 `SHARK_AI_ROOT`。
- Windows 需要 `pywin32`（已在 `AI Server/requirements.txt` 中）。
- 进入 Settings → AI Server 面板查看 Python 子进程 stdout，错误会原样回显。

**Q：Flatpak 构建提示找不到 runtime？**
按 `scripts/build-flatpak.sh` 提示用 `flatpak install` 安装对应版本的 freedesktop runtime 与 SDK。

**Q：能否裁掉某些 HUD 组件？**
HUD 组件由 XML + Vue 双层定义；在 `resources/CustomElement/` 与 `resources/HUDPanel/` 删除对应描述文件，并在 `src/components/` 中移除引用即可，不影响主线视频/MQTT。

---

## 贡献指南

欢迎以 PR 或 Issue 形式参与改进。建议遵循：

1. **从 Issue 起步**：较大改动请先开 Issue 讨论目标与范围，避免多人重叠或方向偏离。
2. **分支策略**：从最新 `main` 派生 `feature/<topic>` 或 `fix/<topic>` 分支。
3. **提交规范**：单次提交聚焦一个目标，commit message 使用中文/英文均可，简述 "动机 + 改动 + 影响范围"。
4. **构建自检**：提交前至少跑通：
   ```powershell
   npm run build
   cargo check --manifest-path src-tauri/Cargo.toml
   ```
5. **协议改动**：涉及 `messages.proto` 时务必同步 `npm run generate:mqtt-proto` 并提交 `src/generated/mqtt-proto.json`。
6. **平台兼容**：尽量同时关注 Windows 与 Linux 路径处理（使用 `path.join` / Rust `Path::join`，避免硬编码 `\` 或 `/`）。

发现安全问题请通过 Issue 私信维护者，不要直接在公开 Issue 暴露 PoC。

---

## 版本与变更

- **v1.0.0** · 2026-05-17 · 首个公开源码发行版本。
  - 完成对外发行清理：剔除模型/二进制/私有 submodule，源码可独立构建。
  - 视频管线、HUD 模板、MQTT proto 强类型链路全部就位。
  - 提供 Windows lite/mini/single + Linux tar.gz + Flatpak 多形态打包脚本。

后续变更请参考仓库 commit 历史；正式发布时会在 GitHub Releases 附 changelog。

---

## 许可证

- **GPL-3.0**

`src-tauri/vendor/libde265/` 为 vendored 第三方源码，请遵循其原始许可证（libde265 默认 LGPLv3）。

---

## 致谢

- [Tauri](https://tauri.app/) · 跨平台桌面运行时
- [Vue 3](https://vuejs.org/) · 前端框架
- [libde265](https://github.com/strukturag/libde265) · H.265 解码库
- [rumqttc](https://github.com/bytebeamio/rumqtt) · MQTT 客户端
- [protobuf.js](https://github.com/protobufjs/protobuf.js) · 协议解析
- [ONNX Runtime](https://onnxruntime.ai/) · AI 推理后端

以及所有为 RoboMaster 比赛与开源社区贡献过工具与方案的开发者。

---

如有问题、改进建议或合作意向，欢迎提交 Issue 或在社区频道联系维护者。
