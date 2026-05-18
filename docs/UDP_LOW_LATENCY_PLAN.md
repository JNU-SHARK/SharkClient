# UDP Low-Latency Video Plan

目标：Windows 和 Linux 都支持低延迟 UDP 图传。策略上优先保最新画面，允许丢旧帧，不追求逐帧完整播放。

## 背景结论

当前延迟大的主要原因不是 UDP 本身，而是实时视频链路里存在多级缓冲和重编码：

- `auto` 模式在 H.265 WebCodecs 不可用时会回退到 Rust 端解码再转 JPEG。
- Rust 端 H.265 回退队列当前容量较大，且队列满时丢最新帧，容易保留旧画面。
- `H.265 -> YUV -> JPEG -> base64 -> 前端 Image 解码 -> Canvas` 链路太重。
- `single` 包强制 `SHARK_USE_INTERNAL_FFMPEG=1`，但当前内嵌 FFmpeg 路径尚未真正启用 D3D11VA/VAAPI 硬解。
- UDP socket 接收缓冲偏大，会隐藏丢包，但也会积累旧数据。

内嵌 FFmpeg 源码本身不应比外置 ffmpeg.exe 差；目前差异来自调用路径：外置 CLI 路径使用了 `-hwaccel`、低延迟参数、过滤器和缩放，而内嵌路径当前主要是软件 `avcodec_send_packet` / `avcodec_receive_frame`。

## 阶段 1：先止血，阻止延迟继续累积

### 1. 改 H.265 队列策略

涉及文件：

- `src-tauri/src/udp_bridge.rs`

当前问题：

- `H265_DECODE_QUEUE_CAPACITY = 120`
- 队列满时丢弃最新输入帧
- 解码线程会继续处理旧帧，形成慢放式延迟

计划修改：

- 队列容量改为 `3` 或 `4`
- 队列堵塞时清空旧帧
- 设置 `needs_keyframe = true`
- 丢帧后只接受下一帧关键帧恢复解码
- 增加统计字段：
  - `droppedOldFrames`
  - `decodeQueueDepth`
  - `decoderWaitingKeyframe`

验收标准：

- 解码跟不上时画面允许跳帧，但不能继续播放旧画面。
- 队列深度长期保持在 `0~2`。

### 2. 缩小 UDP 接收缓冲

涉及文件：

- `src-tauri/src/udp_bridge.rs`
- `src/components/Dashboard/constants.ts`
- `src/components/Dashboard/types.ts`

当前问题：

- 接收端固定至少请求 16 MB socket buffer。
- 实时图传里大缓冲会增加旧数据排队时间。

计划修改：

- 增加低延迟默认值：`1 MB` 或 `2 MB`
- 保留手动配置覆盖能力
- UI 后续区分：
  - 低延迟优先
  - 抗丢包优先

验收标准：

- 丢包时可以掉帧，但不能积累秒级延迟。

### 3. 降低 WebCodecs 背压阈值

涉及文件：

- `src/views/Dashboard.vue`

当前问题：

- `MAX_VIDEO_DECODER_QUEUE_SIZE = 8` 对实时流偏大。

计划修改：

- 改为 `2~4`
- 超过阈值时 reset decoder，等待关键帧

验收标准：

- 前端不会继续堆积旧的 `EncodedVideoChunk`。

## 阶段 2：去掉 H.265 到 JPEG 的默认转码路径

### 4. Rust 解码后直接发 YUV/NV12

涉及文件：

- `src-tauri/src/udp_bridge.rs`
- `src-tauri/src/video_decoder.rs`
- `src/api-shim.ts`

当前问题：

- `frame.to_jpeg(75)` 会逐像素 YUV 转 RGB，再 JPEG 编码。
- 随后还要 base64 传给前端，再由前端 Image API 解码。

计划修改：

- 新增 `send_channel_yuv420p_frame`
- 启用已有 `FRAME_TYPE_YUV420P = 0x03`
- 新增 `FRAME_TYPE_NV12 = 0x04`
- `to_jpeg` 只保留为调试/兼容路径
- 默认 fallback 路径改为 raw YUV/NV12

验收标准：

- fallback 解码不再进行 JPEG 编码。
- IPC 单帧数据可预测，前端直接渲染。

### 5. 前端恢复 WebGL YUV 渲染

涉及文件：

- `src/views/Dashboard.vue`
- `src/utils/yuvRenderer.ts`

计划修改：

- native decode fallback 使用 `createYuvRenderer`
- YUV420P 直接上传三平面
- 增加 NV12 shader：
  - Y 平面一张纹理
  - UV interleaved 平面一张纹理
- 2D Canvas Image 解码只作为 JPEG 兼容路径

验收标准：

- Rust 输出 YUV420P/NV12 时，前端不经过 Image/Blob/createImageBitmap。

## 阶段 3：让内嵌 FFmpeg 真正走硬解

### 6. 内嵌 FFmpeg 硬解初始化

涉及文件：

- `src-tauri/src/video_decoder_internal.rs`
- `src-tauri/src/ffmpeg_ffi.rs`
- `src-tauri/src/ffmpeg_shim.c`

当前问题：

- 内嵌路径当前主要是普通软件解码调用。
- FFI 中已有 `av_hwdevice_ctx_create`、`av_hwframe_transfer_data` 等声明，但未完整接入。

计划修改：

- Windows 优先级：
  - `d3d11va`
  - `dxva2`
  - software
- Linux 优先级：
  - `vaapi`
  - 可选 `cuda`
  - 可选 `qsv`
  - software
- 给 `AVCodecContext` 设置 `hw_device_ctx`
- 增加 `get_format` 回调，让 FFmpeg 选择硬件像素格式
- 硬件帧通过 `av_hwframe_transfer_data` 转为 CPU 可读格式
- 输出优先使用 NV12，其次 YUV420P

验收标准：

- Windows 日志能显示 `internal d3d11va` 或 `internal dxva2`。
- Linux 日志能显示 `internal vaapi`。
- 硬解失败时能自动回退软件解码。

### 7. 完善 C shim

涉及文件：

- `src-tauri/src/ffmpeg_shim.c`

计划新增 helper：

- 设置 `AVCodecContext.hw_device_ctx`
- 设置 `get_format` 回调
- 读取 `AVFrame` 格式、尺寸、planes、linesize
- 必要时暴露低延迟 codec context 参数

验收标准：

- Rust 不直接依赖 FFmpeg 私有结构体布局。
- FFI 面保持小而稳定。

### 8. 调整 FFmpeg 构建脚本

涉及文件：

- `scripts/build-ffmpeg-minimal.ps1`
- `scripts/build-ffmpeg-minimal-linux.sh`

当前状态：

- Windows 脚本已启用 d3d11va/dxva2 相关 hwaccel。
- Linux 脚本已启用 vaapi 相关 hwaccel。

计划修改：

- 验证静态库导出完整。
- 补充可选 CUDA/QSV 构建开关。
- 增加构建产物自检：
  - HEVC decoder 存在
  - H.264 decoder 存在
  - 对应 hwaccel 存在

验收标准：

- Windows/Linux 静态库均可用于内嵌硬解。

## 阶段 4：统一策略与 UI

### 9. 重定义 `auto` 策略

涉及文件：

- `src/views/Dashboard.vue`
- `src-tauri/src/video_decoder.rs`
- `src-tauri/src/video_decoder_internal.rs`

新优先级：

1. H.265 WebCodecs 直通
2. Rust 内嵌 FFmpeg 硬解，输出 YUV/NV12
3. Rust 内嵌 FFmpeg 软件解码，输出 YUV
4. JPEG 兼容路径

验收标准：

- `auto` 不再轻易落到 JPEG 转码。
- 日志明确展示当前使用的解码后端。

### 10. 发布包调整

涉及文件：

- `scripts/package-single.ps1`
- `scripts/package-lite.ps1`

计划修改：

- `single` 包继续使用内嵌 FFmpeg。
- `SHARK_USE_INTERNAL_FFMPEG=1` 不再等价于软件解码。
- README 中明确：
  - 图传解码后端
  - AI 推理后端
  - 两者不是同一个概念

验收标准：

- `single` 包也能优先使用 D3D11VA/VAAPI。

## 阶段 5：诊断与验证

### 11. 增加运行时诊断

需要打印：

- 当前解码后端：
  - `webcodecs h265`
  - `internal d3d11va`
  - `internal dxva2`
  - `internal vaapi`
  - `internal software`
  - `jpeg compatibility`
- UDP assembly FPS
- decode queue depth
- decode time ms
- IPC bytes/frame
- render FPS
- dropped old frames
- waiting keyframe 状态

### 12. 验收标准

Windows：

- D3D11VA 路径稳定显示。
- 队列深度长期 `<= 2`。
- 堵塞时跳帧，不慢放。

Linux：

- VAAPI 路径稳定显示。
- VAAPI 不可用时自动回退软件解码。
- 回退后仍然不累积旧帧。

性能目标：

- 720p60 局域网端到端延迟目标 `< 150 ms`
- 1080p30 可接受目标 `< 200 ms`
- 网络抖动时允许丢帧，但不能累计秒级延迟

## 推荐实施顺序

1. 阶段 1：队列和缓冲止血。
2. 阶段 2：去掉 JPEG 默认转码。
3. 阶段 3：内嵌 FFmpeg 硬解。
4. 阶段 4：统一 `auto` 策略和发布包。
5. 阶段 5：补诊断、做 Windows/Linux 验收。

优先级最高的是阶段 1 和阶段 2。它们不依赖完整硬解实现，但能最快消除“越用越延迟”的核心问题。
