# 项目记忆与对话记录恢复索引

生成时间：2026-05-06

## 恢复结论

- 已找回 Copilot Chat 两批项目会话：一批已完整导出到 `chat-history-recovered.md`，另一批仍保留在 VS Code `workspaceStorage` 的原始 JSONL 中。
- 已找回 Claude Code 当前项目目录、项目内 `.claude` 配置、4 个 Claude Code JSONL 会话，以及 1 份与 SharkClientRust 相关的重构计划。
- 已找回 Codex 4 个与 SharkClientRust 当前项目直接相关的 JSONL 会话；Codex 的 `memories` 目录当前为空。
- 已读取当前仓库级记忆 3 条：FFmpeg 最小化构建、Windows ORT GPU、UDP 视频 IPC。

## 一、项目级记忆

当前可复用的仓库记忆如下：

- `ffmpeg-minimal-build.md`
  - `scripts/build-ffmpeg-minimal.ps1` 使用内置 MSYS2 MINGW64 构建最小 FFmpeg。
  - 产物 `resources/ffmpeg/ffmpeg.exe` 约 2.9 MB，静态链接，支持 `dxva2`、`d3d11va`、`h264`、`hevc`。
  - 使用 `-f yuv4mpegpipe` 时必须启用 `wrapped_avframe` encoder。
  - lite/full 都应使用 FP32 ONNX，避免 FP16 与 `OrtTensor<f32>` 不匹配。

- `ort-gpu-on-windows.md`
  - ORT 2.x GPU Provider 失败时可能静默回退 CPU。
  - 可靠做法是逐个手动注册 TensorRT/CUDA/DirectML/CPU EP，并记录首个成功 Provider。
  - Windows 下需用 `SetDefaultDllDirectories` + `AddDllDirectory` 加入 ORT、CUDA、cuDNN、TensorRT DLL 目录，不能只依赖 `PATH`。

- `udp-video-ipc.md`
  - 大视频帧不要用 Tauri `Channel<Vec<u8>>`，前端会收到巨大 numeric-key object 并卡主线程。
  - 当前折中方案：Rust 侧经字符串通道发送 base64 IPC frame，前端一次 decode 后再解析 4 字节帧头。
  - HEVC 不要在解码前 drop compressed frame；保持 FIFO 送入解码器。
  - FFmpeg fallback 遇到溢出或瞬时错误不要销毁 decoder；保持较大队列并 drop newest。
  - UDP 视频直接渲染到 canvas，不再走 `canvas.captureStream()` → `MediaStream` → `video.srcObject`。

## 二、Copilot Chat

### 已完整导出的旧会话

- 工作区文件：`chat-history-recovered.md`
- 原始来源：`C:\Users\Administrator\AppData\Roaming\Code\User\workspaceStorage\6f4dc85e9418212b587cea5155f95fb7\chatSessions\14a9101d-9172-4a79-850a-0eb0d87ee6bf.jsonl`
- 标题：工程分析请求
- 时间：2026-04-21 19:04:59 起
- 规模：42 轮对话
- 主线：项目分析、MQTT/UDP、protobuf、轻量化版本、GPU/CPU 解码、Linux/AMD/无独显兼容、WebCodecs、AI Server/Named Pipe、Python 3.12、内置 AI/ONNX/ORT/TensorRT、CUDA/cuDNN 安装。

42 轮用户请求概要：

1. 分析一下这个工程
2. 完善 MQTT 和 UDP 系统
3. 确认 MQTT 和 protobuf 对应
4. 编译轻量化版本
5. 提升启动速度、直接全屏
6. 更新 protobuf 并让 MQTT 数据与实际 UI 联动
7. 修复反复连接导致视频卡死黑屏、长时间 UDP 卡顿
8. 启用 GPU 解码并优化 Linux 方案
9. 讨论 FFmpeg WASM 跨平台方案
10. 去掉前端 CPU 编码，兼容 Linux、AMD、无独显
11. 修复 AI Server、Named Pipe、全屏和未对接功能
12. 更新 Python 依赖并切到 Python 3.12
13. 将 Python/AI 能力改为内置推理方向
14. 预下载依赖层，注意跨平台和硬件支持
15. CUDA/cuDNN/TensorRT 手动下载与安装

### 未导出的 Copilot 续接会话

- 原始来源：`C:\Users\Administrator\AppData\Roaming\Code\User\workspaceStorage\ceda887b1aa96c13bcfc1f38a74726e6\chatSessions\4ec270e3-7b6a-4669-8842-7bd465c0b11b.jsonl`
- 标题：恢复并继续之前的聊天记录
- 时间：2026-04-23 11:04:01 至 2026-04-25 00:00:36
- 规模：59 轮用户请求
- 主线：追回旧 Copilot 聊天、检查 CUDA/cuDNN/TensorRT 依赖、跨平台和硬件兼容修复、内嵌 ONNX、移除 Python、内置推理器、UDP 图传压扁/卡顿/花屏/低 FPS 全管线重修、AI 检测无框/低帧率、ORT GPU 静默 CPU、INT8/CUDA 量化。

59 轮用户请求概要：

1. 追回之前的聊天记录，继续
2. 追回 Copilot 的聊天记录
3. 检查依赖层安装情况
4. cuDNN/CUDA 安装确认
5. 帮我操作、开始
6. 检查跨平台兼容性和硬件兼容性
7. 全部完整彻底修复
8. 修复 Tauri/dev server 编译启动错误
9. 将 ONNX 模型内嵌，不暴露路径
10. 同步修改 P 键菜单设计，移除 Python 相关内容，改为内置推理器
11. 修复开始检测没反应、按键未加载推理器
12. 修复 1080x720 视频被左右压扁
13. 修复横屏 30 FPS 视频接收卡顿
14. 修复视频闪烁、花屏、黑屏、初始帧卡死、色块累积
15. 完整重新分析 UDP 视频管线
16. 修复播放只有 3 FPS 的问题
17. 编译并验证 UDP 图传恢复
18. 修复 AI 检测模块状态运行但无识别框
19. 修复 ORT 输入类型 FP32/FP16 不匹配
20. 增加识别帧数显示，优化识别条可读性
21. 处理 stderr 管道关闭导致的 panic
22. 确认首次推理和检测数量，但继续排查检测显示
23. 发现推理完全跑在 CPU，未使用任何加速
24. 分析检测帧率提高后效果下降原因
25. 对比 CPU 模式可识别、GPU/加速路径识别异常
26. 排查 FFmpeg GPU decoder 与 ORT DLL 目录
27. 提升 CPU 下速度，使用 INT8 量化并更新 README
28. 内嵌 INT8 模型
29. 修复 invalid model / FP16 input type 错误
30. 使用 CUDA 量化，避免静态 QRT
31. 解决缺少实际图片参考问题
32. 修复开启检测后显示 0 FPS

## 三、Claude Code

### 工作区配置

- 项目内配置：`.claude/settings.local.json`
- 主要内容：允许 Claude Code 执行 WebSearch、Cargo build/check/clippy/fmt、git add/commit/ls-files、若干 libde265/FFmpeg 排查命令。
- 该配置中仍可见旧路径 `c:/Users/xu/Desktop/SharkClientRust`，后续若继续用 Claude Code，可考虑同步到当前路径。

### 当前项目 Claude 会话

项目目录：`C:\Users\Administrator\.claude\projects\c--Users-Administrator-Desktop-SharkClientRust-SharkClientRust`

找到 4 个 JSONL：

- `8ab8a5e2-cace-4bb9-a6b5-45431a664bbf.jsonl`
  - 时间：2026-04-23 11:00:33
  - 用户请求：追溯 copilot 的聊天记录接管

- `dc8a1902-6afe-43e0-acc1-de2066951381.jsonl`
  - 时间：2026-04-25 17:00:04
  - 用户请求：1

- `a5e5d355-6379-4076-b779-867b7c64ded4.jsonl`
  - 时间：2026-04-25 18:20:33 至 2026-04-29 18:36:50
  - 规模：815 行，约 2.19 MB
  - 用户请求：评价当前工程、开始规划、继续、帮我验证、继续等
  - 附带工具结果目录：`a5e5d355-6379-4076-b779-867b7c64ded4/tool-results/`

- `3392a82d-d2d0-45c7-80f6-709d2c518486.jsonl`
  - 时间：2026-05-06 15:39:05 起
  - 用户请求：找回这个项目的记忆和对话记录

### Claude memory 与计划

- 当前项目 Claude `memory/` 目录为空。
- 找到项目相关计划：`C:\Users\Administrator\.claude\plans\clever-noodling-hejlsberg.md`
- 计划标题：SharkClientRust 集中重构路线图（1–2 周）
- 核心路线：
  - S0：基线冻结、CI 骨架、仓库清理
  - S1：拆分 `udp_bridge.rs`、`video_decoder.rs`、`mqtt_client.rs`，引入 `tracing`
  - S2：CSP、devtools、unwrap/expect 稳健性收口
  - S3：拆分超大 `Dashboard.vue`，新增 `src/composables/`
  - S4：Rust 单测 + Vitest
  - S5：Linux 脚本与文档补齐

## 四、Codex

### Codex memory 状态

- `C:\Users\Administrator\.codex\memories` 当前未发现文件。
- `session_index.jsonl` 未提取到当前项目条目；可用会话主要来自 `sessions` 下的 JSONL。

### 当前项目相关 Codex 会话

找到 4 个与 SharkClientRust 直接相关的 JSONL：

- `rollout-2026-04-20T17-49-28-019daa4b-81aa-72f1-8ab5-51ff4d53816e.jsonl`
  - 工作目录：`C:\Users\Administrator\Desktop\SharkClientRust`
  - 时间：2026-04-20
  - 规模：约 7.58 MB，1246 行
  - 主线：编译轻量化版本、lite 报错、release 显示问题、围绕 `video_decoder.rs`、`udp_bridge.rs`、`lib.rs`、`RoboControl.vue` 继续修复。

- `rollout-2026-04-25T17-05-44-019dc3e3-4429-7920-b5a6-52c083c5cbfb.jsonl`
  - 工作目录：`C:\Users\Administrator\Desktop\SharkClientRust\SharkClientRust`
  - 时间：2026-04-25 至 2026-04-26
  - 规模：约 9.42 MB，4723 行
  - 主线：分析 UDP 图传延迟，Windows/Linux 低延迟解码，内嵌 FFmpeg，生成 `docs/UDP_LOW_LATENCY_PLAN.md`，WebCodecs，WSL Ubuntu 22.04，镜像源，启动慢，协议 PDF，冗余设计清理，single/CPU single 打包，AI INT8/TensorRT 性能优化。

- `rollout-2026-04-26T00-21-23-019dc572-1eee-7971-ac9c-01bf6cf768ab.jsonl`
  - 工作目录：`C:\Users\Administrator\Desktop\SharkClientRust\SharkClientRust`
  - 时间：2026-04-26
  - 规模：约 1.68 MB，543 行
  - 主线：CPU-Single 高占用、死锁/内存泄漏/死循环排查、中文提交、创建 Mini 分支、移除内置 AI，改回外置脚本 + 共享内存，默认不启动。

- `rollout-2026-04-26T00-35-34-019dc57f-1817-71a0-b181-338bbaddb7a0.jsonl`
  - 工作目录：`C:\Users\Administrator\Desktop\SharkClientRust\SharkClientRust`
  - 时间：2026-04-26
  - 规模：约 8.25 MB，3039 行
  - 主线：重构 AI 检测为外置脚本 + 共享内存，清理低性能平台冗余，编译 minimal 客户端版本，确认/接入内置 FFmpeg，更新打包脚本。

## 五、继续接管时的推荐阅读顺序

1. 本文件：快速定位所有记忆与对话来源。
2. `chat-history-recovered.md`：读取 2026-04-21 至 2026-04-23 的 Copilot 完整恢复记录。
3. `docs/UDP_LOW_LATENCY_PLAN.md`：读取 Codex 生成的 UDP 低延迟方案与后续改动主线。
4. 仓库记忆：优先遵守 FFmpeg、ORT GPU、UDP IPC 三条踩坑记录。
5. 如需逐字恢复 Claude/Codex/Copilot 续接会话，再按本文件列出的原始 JSONL 路径导出。

## 六、未做的事

- 没有把 36 MB 的 Copilot 续接 JSONL 和多个 Codex/Claude 大会话全文复制进仓库，避免仓库膨胀。
- 没有读取 `auth.json` 等认证文件。
- 没有解析 Codex 的 SQLite 日志；当前项目主会话已能从 JSONL 覆盖。