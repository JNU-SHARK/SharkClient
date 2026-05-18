<template>
  <div style="display: none"></div>
</template>

<script setup lang="ts">
/**
 * DetectionService
 * ----------------
 * 使用外置 Python 检测脚本。Rust 侧负责启动脚本、维护 IPC，并在 Windows
 * 下将每帧 JPEG 载荷放入共享内存，管道只传控制 JSON。
 *
 * 职责：
 *  1. 从父组件传入的 <video> 元素按帧捕获画面
 *  2. 以 JPEG base64 形式交给 Rust，Rust 侧升级为共享内存传输
 *  3. 将结果写入 Pinia store（detections / detectionStats）
 *  4. 对外保留 `stopDetection()` / `disconnectCommunication()` 方法，
 *     以及 `communication-status-change` 事件，确保 Dashboard.vue 的
 *     现有接线无需修改。
 */

import { watch, onUnmounted } from 'vue'
import { useDashboardStore } from '@/store'
import type { DetectionConfig, EncodeConfig } from './types'
import type { Detection as StoreDetection } from '@/utils/mqtt_protocol'

// ── Props / Emits ─────────────────────────────────────────────────────────────

interface Props {
  videoSource?: string
  videoElement: HTMLVideoElement | null
  // 可选的 canvas 帧源（如 UDP 直显 canvas）。当 <video> 没有装载内容时作为退路
  // 来源用于抓帧，保证 DetectionService 在 captureStream 管线被移除后继续工作。
  sourceCanvas?: HTMLCanvasElement | null
  sourceCanvasActive?: boolean
  // 可选的图片帧源（如后端 MJPEG fallback 的 <img>）。用于 WebView 不支持 H.265
  // 直解时，仍然能从当前显示帧进行 AI 检测。
  sourceImage?: HTMLImageElement | null
  sourceImageActive?: boolean
  detectionConfig: DetectionConfig
  encodeConfig?: EncodeConfig
  enabled: boolean
}

const props = defineProps<Props>()

const emit = defineEmits<{
  (e: 'communication-status-change', connected: boolean): void
}>()

// ── 状态 ──────────────────────────────────────────────────────────────────────

const store = useDashboardStore()
let rafId: number | null = null
let busy = false
let running = false

// 复用的离屏画布（避免每帧分配）
const captureCanvas: HTMLCanvasElement = document.createElement('canvas')
const captureCtx: CanvasRenderingContext2D | null = captureCanvas.getContext('2d', {
  willReadFrequently: true
})

// FPS/推理时间滑动统计
let lastFrameTs = 0
let emaFps = 0
let emaInferMs = 0
// 仅在视频源尚未就绪时打印一次提示，避免刷屏
let waitingForVideoLogged = false
// 帧源就绪后仅打印一次调试信息（带检测框数量），便于诊断"模块运行中但无框"
let firstDetectLogged = false
// 上次推理的视频帧标识（currentTime + readyState 指纹），用于跳过"同一帧反复推理"
let lastDetectedVideoTime = -1
// 最小推理间隔（ms），避免把 CPU/GPU 拉满影响视频渲染。
// CPU provider 下主动降频；GPU/DirectML/CUDA 下保留更高上限。
const UNKNOWN_DETECT_INTERVAL_MS = 1000 / 12
const CPU_DETECT_INTERVAL_MS = 1000 / 8
const ACCELERATED_DETECT_INTERVAL_MS = 1000 / 30
const CPU_DETECT_MAX_SIZE = 512
const UNKNOWN_DETECT_MAX_SIZE = 640
const DEFAULT_DETECTION_SCRIPT_PATH = 'AI Server'
const PIPE_SERVER_READY_TIMEOUT_MS = 60_000
type DetectorProviderClass = 'unknown' | 'cpu' | 'accelerated'
let activeDetectorProvider: DetectorProviderClass = 'unknown'
let lastDetectStartTs = 0

// 性能分解计时（供每 5s 汇总日志使用）
let lastCaptureTimingMs = 0
let lastEncodeTimingMs = 0
let lastRpcTimingMs = 0
let lastInferTimingMs = 0
let lastDecodeMs = 0
let lastPreprocessMs = 0
let lastOrtMs = 0
let lastPostMs = 0
let framesSinceLastPerfLog = 0
let lastPerfLogTs = 0
let lastEncodeErrorLogTs = 0

// ── 工具 ──────────────────────────────────────────────────────────────────────

/** 根据类名推断红/蓝/中立阵营（armor 类名形如 B1…B7 / R1…R7；car -> neutral） */
function inferTeam(className: string): 'red' | 'blue' | 'neutral' {
  if (!className) return 'neutral'
  const c = className.charAt(0).toUpperCase()
  if (c === 'B') return 'blue'
  if (c === 'R') return 'red'
  return 'neutral'
}

/** Rust 侧 Detection -> 前端 mqtt_protocol.Detection */
interface RustDetection {
  bbox: [number, number, number, number]
  class_id: number
  class_name: string
  confidence: number
  team?: string
}

type CapturedDetectionFrame = {
  b64?: string
  width: number
  height: number
  sourceKind: string
  backendLatestMjpeg?: boolean
}

function classifyDetectorProvider(provider: unknown): DetectorProviderClass {
  const text = String(provider ?? '').toLowerCase()
  if (!text) return 'unknown'
  if (
    text.includes('cuda') ||
    text.includes('tensorrt') ||
    text.includes('directml') ||
    text.includes('gpu')
  ) {
    return 'accelerated'
  }
  if (text.includes('cpu')) return 'cpu'
  return 'unknown'
}

function updateDetectorProvider(provider: unknown): void {
  const next = classifyDetectorProvider(provider)
  if (next !== activeDetectorProvider) {
    activeDetectorProvider = next
    console.log('[DetectionService] detector provider class:', next, provider ?? 'unknown')
  }
}

function currentDetectIntervalMs(): number {
  if (activeDetectorProvider === 'cpu') return CPU_DETECT_INTERVAL_MS
  if (activeDetectorProvider === 'accelerated') return ACCELERATED_DETECT_INTERVAL_MS
  return UNKNOWN_DETECT_INTERVAL_MS
}

function currentDetectMaxSizeCap(): number | null {
  if (activeDetectorProvider === 'cpu') return CPU_DETECT_MAX_SIZE
  if (activeDetectorProvider === 'unknown') return UNKNOWN_DETECT_MAX_SIZE
  return null
}

function waitForPipeServerReady(api: any): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false
    let cleanup: (() => void) | undefined

    const finish = (ready: boolean): void => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      cleanup?.()
      resolve(ready)
    }

    const timer = window.setTimeout(() => finish(false), PIPE_SERVER_READY_TIMEOUT_MS)
    cleanup = api.pipeServer?.onStatusChanged?.((status: string) => {
      if (status === 'running') finish(true)
      if (status === 'error' || status === 'stopped') finish(false)
    })
  })
}

async function ensureDetectionPipeServer(api: any): Promise<boolean> {
  const status = await api.pipeServer?.getStatus?.().catch(() => null)
  if (status?.running) return true
  if (!api.pipeServer?.start) return false

  console.log('[DetectionService] pipe server not running, starting detection script...')
  const readyPromise = waitForPipeServerReady(api)
  const startResult = await api.pipeServer.start(DEFAULT_DETECTION_SCRIPT_PATH).catch((error: unknown) => {
    console.error('[DetectionService] failed to start pipe server:', error)
    return null
  })
  if (startResult && startResult.success === false) {
    console.error('[DetectionService] pipe server start rejected:', startResult.error ?? startResult)
    return false
  }

  return await readyPromise
}

async function connectDetectionPipe(api: any): Promise<boolean> {
  try {
    if (!(await ensureDetectionPipeServer(api))) return false
    return Boolean(await api.shm.connect())
  } catch (error) {
    console.warn('[DetectionService] connect pipe failed:', error)
    return false
  }
}

function toStoreDetections(raw: RustDetection[]): StoreDetection[] {
  return raw.map((d) => {
    const [x1, y1, x2, y2] = d.bbox
    const team =
      d.team === 'red' || d.team === 'blue' || d.team === 'neutral'
        ? (d.team as 'red' | 'blue' | 'neutral')
        : inferTeam(d.class_name)
    // DetectionOverlay.vue 消费者使用 snake_case + bbox 数组形式（原 AI Server 协议），
    // 同时保留 camelCase 字段以兼容 mqtt_protocol.Detection 类型契约。
    return {
      bbox: [x1, y1, x2, y2],
      class_id: d.class_id,
      class_name: d.class_name,
      x1,
      y1,
      x2,
      y2,
      classId: d.class_id,
      className: d.class_name,
      confidence: d.confidence,
      team
    } as unknown as StoreDetection
  })
}

/** 解析当前帧源。后端 MJPEG 优先，因为它可绕过前端截图和 JPEG 编码。 */
function resolveFrameSource():
  | { element: CanvasImageSource; width: number; height: number; fingerprint: number; kind: string }
  | null {
  const image = props.sourceImage
  const imageActive = props.sourceImageActive ?? false
  if (imageActive && image && image.naturalWidth > 0 && image.naturalHeight > 0) {
    return {
      element: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      // MJPEG <img> 没有逐帧时间戳，用主循环的动态间隔控制采样频率。
      fingerprint: performance.now(),
      kind: 'image'
    }
  }

  const canvas = props.sourceCanvas
  const canvasActive = props.sourceCanvasActive ?? true
  if (canvasActive && canvas && canvas.width > 0 && canvas.height > 0) {
    return {
      element: canvas,
      width: canvas.width,
      height: canvas.height,
      // canvas 没有天然的帧指纹，用时间戳近似（主循环会再通过动态间隔节流）
      fingerprint: performance.now(),
      kind: 'canvas'
    }
  }

  const video = props.videoElement
  if (video && video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
    return {
      element: video,
      width: video.videoWidth,
      height: video.videoHeight,
      // currentTime 作为指纹，同帧跳过
      fingerprint: video.currentTime,
      kind: 'video'
    }
  }

  return null
}

function canvasToJpegDataUrl(canvas: HTMLCanvasElement, quality: number): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            resolve(null)
            return
          }
          const reader = new FileReader()
          reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null)
          reader.onerror = () => resolve(null)
          reader.readAsDataURL(blob)
        },
        'image/jpeg',
        quality
      )
    } catch (error) {
      const now = performance.now()
      if (now - lastEncodeErrorLogTs > 2000) {
        lastEncodeErrorLogTs = now
        console.warn('[DetectionService] canvas encode failed:', error)
      }
      resolve(null)
    }
  })
}

function captureBackendMjpegFrame(
  sourceKind: string,
  width: number,
  height: number
): CapturedDetectionFrame | null {
  if (sourceKind !== 'image') return null
  const api = (window as unknown as { api?: any }).api
  if (!api?.shm?.detectLatestMjpeg) return null
  if (width <= 0 || height <= 0) return null

  return {
    width,
    height,
    sourceKind: 'mjpeg-backend',
    backendLatestMjpeg: true
  }
}

/** 捕获当前视频帧为 JPEG base64（无 data: 前缀） */
async function captureFrame(): Promise<CapturedDetectionFrame | null> {
  if (!captureCtx) return null
  const source = resolveFrameSource()
  if (!source) {
    if (!waitingForVideoLogged) {
      console.warn('[DetectionService] 等待视频源就绪中（无 <video> 且无 sourceCanvas）...')
      waitingForVideoLogged = true
    }
    return null
  }
  if (waitingForVideoLogged) {
    console.log(
      '[DetectionService] 视频源就绪，开始推理 (' + source.width + 'x' + source.height + ')'
    )
    waitingForVideoLogged = false
  }

  const backendFrame = captureBackendMjpegFrame(source.kind, source.width, source.height)
  if (backendFrame) {
    lastCaptureTimingMs = 0
    lastEncodeTimingMs = 0
    return backendFrame
  }

  const vw = source.width
  const vh = source.height

  // 下采样策略（按优先级）：
  //   1. 用户在"AI 检测参数"面板配置的 detectionConfig.maxSize
  //   2. 编码面板的 encodeConfig.maxSize（兼容旧用法）
  //   3. 兜底：硬上限 1920px
  const HARD_MAX = 1920
  const detectMax = props.detectionConfig?.maxSize
  const encodeMax = props.encodeConfig?.maxSize
  const userMaxSize = (detectMax && detectMax > 0)
    ? detectMax
    : (encodeMax && encodeMax > 0 ? encodeMax : HARD_MAX)
  const runtimeCap = currentDetectMaxSizeCap()
  const maxSize = Math.min(userMaxSize, HARD_MAX, runtimeCap ?? HARD_MAX)
  let w = vw
  let h = vh
  if (Math.max(vw, vh) > maxSize) {
    const scale = maxSize / Math.max(vw, vh)
    w = Math.max(1, Math.round(vw * scale))
    h = Math.max(1, Math.round(vh * scale))
  }
  if (captureCanvas.width !== w) captureCanvas.width = w
  if (captureCanvas.height !== h) captureCanvas.height = h

  const tDraw0 = performance.now()
  try {
    captureCtx.drawImage(source.element, 0, 0, w, h)
  } catch (err) {
    console.warn('[DetectionService] drawImage failed:', err)
    return null
  }
  const tDraw = performance.now() - tDraw0

  // encodeConfig.quality 历史上存在两套量纲：性能预设使用 0-1（如 0.6），而老的编码面板用 0-100。
  // 这里做一次归一化：>=2 的值按百分比处理，<2 的值按 0-1 处理。再夹到 [0.5, 0.92]。
  // 下限保留 0.5：兼顾低性能平台编码压力和远处装甲板数字识别。
  const tEnc0 = performance.now()
  const rawQ = props.encodeConfig?.quality ?? 0.75
  const normalizedQ = rawQ >= 2 ? rawQ / 100 : rawQ
  const quality = Math.min(0.92, Math.max(0.5, normalizedQ))
  const dataUrl = await canvasToJpegDataUrl(captureCanvas, quality)
  const tEnc = performance.now() - tEnc0
  if (!dataUrl) return null
  const comma = dataUrl.indexOf(',')
  if (comma < 0) return null
  lastCaptureTimingMs = tDraw
  lastEncodeTimingMs = tEnc
  return { b64: dataUrl.slice(comma + 1), width: w, height: h, sourceKind: source.kind }
}

// ── 主循环 ────────────────────────────────────────────────────────────────────

async function tick(): Promise<void> {
  if (!running) return

  if (!busy) {
    const video = props.videoElement
    const nonVideoFrameSourceActive =
      Boolean(props.sourceImageActive) ||
      Boolean(props.sourceCanvasActive && props.sourceCanvas && props.sourceCanvas.width > 0 && props.sourceCanvas.height > 0)
    // 同帧跳过：只有在 video.currentTime 推进后才再次推理，避免 10 FPS 源被 60Hz rAF 反复轰炸
    // canvas 源没有 currentTime，只能靠动态最小间隔节流。
    const hasVideo = !nonVideoFrameSourceActive && video && video.readyState >= 2 && video.videoWidth > 0
    const vt = hasVideo ? video.currentTime : -1
    const nowTs = performance.now()
    const intervalOk = nowTs - lastDetectStartTs >= currentDetectIntervalMs()
    if (hasVideo && vt === lastDetectedVideoTime) {
      // 同一帧，不重复推理
    } else if (!intervalOk) {
      // 超过帧率上限，跳过本轮
    } else {
      busy = true
      lastDetectedVideoTime = vt
      lastDetectStartTs = nowTs
      const t0 = performance.now()
      try {
        const frame = await captureFrame()
        if (frame && running) {
          const api = (window as unknown as { api?: any }).api
          if (!api?.shm?.sendProtocolData) {
            throw new Error('外置检测 IPC 不可用')
          }
          const detectPayload = {
            op: 'detect',
            ...(frame.backendLatestMjpeg ? {} : { image: frame.b64 }),
            armor_conf: props.detectionConfig.armorConf,
            car_conf: props.detectionConfig.carConf,
            iou_threshold: props.detectionConfig.iouThreshold,
            max_size: props.detectionConfig.maxSize
          }
          const tRpc0 = performance.now()
          const res = (await (frame.backendLatestMjpeg && api.shm.detectLatestMjpeg
            ? api.shm.detectLatestMjpeg(detectPayload)
            : api.shm.sendProtocolData(detectPayload))) as {
            success?: boolean
            detections?: RustDetection[]
            inference_time?: number
            inference_time_ms?: number
            decode_ms?: number
            preprocess_ms?: number
            infer_ms?: number
            post_ms?: number
            active_provider?: string
            preprocess_impl?: string
            error?: string
          }
          updateDetectorProvider(res?.active_provider)
          lastRpcTimingMs = performance.now() - tRpc0
          // 外置脚本的 legacy inference_time 为秒；新字段 inference_time_ms 为毫秒。
          const legacyInfer = res?.inference_time ?? 0
          lastInferTimingMs =
            res?.inference_time_ms ?? (legacyInfer > 0 && legacyInfer < 10 ? legacyInfer * 1000 : legacyInfer)
          lastDecodeMs = res?.decode_ms ?? 0
          lastPreprocessMs = res?.preprocess_ms ?? 0
          lastOrtMs = res?.infer_ms ?? 0
          lastPostMs = res?.post_ms ?? 0

          if (res?.success && Array.isArray(res.detections)) {
            const mapped = toStoreDetections(res.detections)
            store.updateDetections(mapped, { width: frame.width, height: frame.height })

            if (!firstDetectLogged) {
              firstDetectLogged = true
              const sample = mapped[0]
              console.log(
                `[DetectionService] 首次推理完成：frame=${frame.width}x${frame.height}, detections=${mapped.length}, source=${frame.sourceKind}, first=${sample ? `${sample.className}:${sample.x1},${sample.y1},${sample.x2},${sample.y2}` : 'none'}`
              )
            }

            // 统计
            const now = performance.now()
            const dt = lastFrameTs > 0 ? now - lastFrameTs : 0
            lastFrameTs = now
            const instFps = dt > 0 ? 1000 / dt : 0
            emaFps = emaFps === 0 ? instFps : emaFps * 0.8 + instFps * 0.2
            const infer = lastInferTimingMs || now - t0
            emaInferMs = emaInferMs === 0 ? infer : emaInferMs * 0.8 + infer * 0.2

            store.updateDetectionStats({
              processingTime: now - t0,
              inferenceTime: emaInferMs,
              currentFPS: emaFps,
              totalLatency: now - t0,
              lastUpdateTime: now
            })

            // 每 ~5s 打印一次性能分解，便于定位帧率瓶颈
            framesSinceLastPerfLog++
            if (now - lastPerfLogTs >= 5000 && framesSinceLastPerfLog > 0) {
              const tail = now - t0
              console.log(
                `[DetectionService] perf | ${emaFps.toFixed(1)} FPS | ` +
                  `frame=${frame.width}x${frame.height} | ` +
                  `draw=${lastCaptureTimingMs.toFixed(1)}ms ` +
                  `enc=${lastEncodeTimingMs.toFixed(1)}ms ` +
                  `rpc=${lastRpcTimingMs.toFixed(1)}ms ` +
                  `[decode=${lastDecodeMs.toFixed(1)} pre=${lastPreprocessMs.toFixed(1)} ort=${lastOrtMs.toFixed(1)} post=${lastPostMs.toFixed(1)}]ms ` +
                  `prep=${res?.preprocess_impl ?? 'unknown'} ` +
                  `total=${tail.toFixed(1)}ms`
              )
              lastPerfLogTs = now
              framesSinceLastPerfLog = 0
            }
          } else if (res?.error) {
            console.warn('[DetectionService] detect error:', res.error)
          }
        }
      } catch (err) {
        console.error('[DetectionService] detect exception:', err)
      } finally {
        busy = false
      }
    }
  }

  if (running) {
    rafId = requestAnimationFrame(tick)
  }
}

// ── 生命周期控制 ──────────────────────────────────────────────────────────────

async function startDetection(): Promise<void> {
  if (running) return
  running = true
  busy = false
  lastFrameTs = 0
  emaFps = 0
  emaInferMs = 0
  waitingForVideoLogged = false
  firstDetectLogged = false
  lastDetectedVideoTime = -1
  activeDetectorProvider = 'unknown'
  lastDetectStartTs = 0
  lastPerfLogTs = performance.now()
  framesSinceLastPerfLog = 0
  console.log('[DetectionService] 已启用，正在连接外置检测服务...')
  const api = (window as unknown as { api?: any }).api
  if (!api?.shm?.connect) {
    console.warn('[DetectionService] 外置检测 IPC 不可用')
    running = false
    busy = false
    emit('communication-status-change', false)
    return
  }

  const connected = await connectDetectionPipe(api)
  if (!running) return
  if (!connected) {
    console.warn('[DetectionService] 外置检测服务未连接，请先手动启动检测脚本')
    running = false
    busy = false
    emit('communication-status-change', false)
    return
  }

  console.log('[DetectionService] 外置检测服务已连接，开始捕获视频帧...')
  emit('communication-status-change', true)
  rafId = requestAnimationFrame(tick)
}

function stopDetection(): void {
  running = false
  if (rafId !== null) {
    cancelAnimationFrame(rafId)
    rafId = null
  }
  busy = false
  store.clearDetections?.()
  emit('communication-status-change', false)
}

async function disconnectCommunication(): Promise<void> {
  stopDetection()
  const api = (window as unknown as { api?: any }).api
  if (api?.shm?.disconnect) {
    await api.shm.disconnect()
  }
}

// 监听 enabled：开关检测
watch(
  () => props.enabled,
  (on) => {
    if (on) void startDetection()
    else stopDetection()
  },
  { immediate: true }
)

onUnmounted(() => {
  stopDetection()
})

defineExpose({
  stopDetection,
  disconnectCommunication
})
</script>
