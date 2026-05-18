<template>
  <div class="performance-optimizer">
    <!-- 性能指标展示 -->
    <div class="performance-metrics">
      <!-- GPU 状态指示 -->
      <div class="metric-row gpu-status">
        <div class="metric-icon">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <rect x="4" y="4" width="16" height="16" rx="2" ry="2"></rect>
            <rect x="9" y="9" width="6" height="6"></rect>
            <line x1="9" y1="1" x2="9" y2="4"></line>
            <line x1="15" y1="1" x2="15" y2="4"></line>
            <line x1="9" y1="20" x2="9" y2="23"></line>
            <line x1="15" y1="20" x2="15" y2="23"></line>
            <line x1="20" y1="9" x2="23" y2="9"></line>
            <line x1="20" y1="14" x2="23" y2="14"></line>
            <line x1="1" y1="9" x2="4" y2="9"></line>
            <line x1="1" y1="14" x2="4" y2="14"></line>
          </svg>
        </div>
        <div class="metric-content">
          <span class="metric-label">GPU 加速</span>
          <span
            class="metric-value"
            :class="{ supported: gpuSupported, unsupported: !gpuSupported }"
          >
            {{ gpuSupported ? '已启用' : '不支持' }}
          </span>
        </div>
      </div>

      <!-- 编码方式 -->
      <div class="metric-row encoding-method">
        <div class="metric-icon">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <polyline points="16 18 22 12 16 6"></polyline>
            <polyline points="8 6 2 12 8 18"></polyline>
          </svg>
        </div>
        <div class="metric-content">
          <span class="metric-label">编码方式</span>
          <span class="metric-value" :class="encodingMethod">
            {{ encodingMethod === 'gpu' ? 'GPU 编码' : 'CPU 编码' }}
          </span>
        </div>
      </div>

      <!-- 编码质量 -->
      <div class="metric-row quality">
        <div class="metric-icon">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <circle cx="12" cy="12" r="10"></circle>
            <path d="M12 6v6l4 2"></path>
          </svg>
        </div>
        <div class="metric-content">
          <span class="metric-label">编码质量</span>
          <span class="metric-value">{{ (encodingConfig.quality * 100).toFixed(0) }}%</span>
        </div>
      </div>

      <!-- 最大尺寸 -->
      <div class="metric-row size">
        <div class="metric-icon">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
          </svg>
        </div>
        <div class="metric-content">
          <span class="metric-label">最大尺寸</span>
          <span class="metric-value">{{ encodingConfig.maxSize }}px</span>
        </div>
      </div>

      <!-- 基准测试结果 -->
      <div v-if="benchmarkResult" class="metric-row benchmark-result">
        <div class="metric-icon">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <path d="M22 12h-4l-3 9L9 3l-3 9H2"></path>
          </svg>
        </div>
        <div class="metric-content">
          <span class="metric-label">性能测试</span>
          <div class="benchmark-details">
            <div v-if="benchmarkResult.gpuSupported" class="benchmark-item">
              <span>GPU:</span>
              <span class="value">{{ benchmarkResult.gpuTime.toFixed(2) }}ms</span>
            </div>
            <div class="benchmark-item">
              <span>CPU:</span>
              <span class="value">{{ benchmarkResult.cpuTime.toFixed(2) }}ms</span>
            </div>
            <div v-if="benchmarkResult.gpuSupported" class="benchmark-item speedup">
              <span>加速比:</span>
              <span class="value">{{ benchmarkResult.speedup.toFixed(2) }}x</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- GPU 开关控制 -->
    <div class="control-section">
      <div class="toggle-option">
        <label class="toggle-label">
          <input
            type="checkbox"
            :checked="encodingMethod === 'gpu'"
            :disabled="!gpuSupported"
            class="toggle-input"
            @change="toggleGpuAcceleration"
          />
          <span class="toggle-switch"></span>
          <span class="toggle-text">使用 GPU 加速编码</span>
        </label>
        <div class="toggle-hint" v-if="!gpuSupported">当前浏览器不支持 GPU 加速</div>
      </div>

      <div class="toggle-option">
        <label class="toggle-label">
          <input
            type="checkbox"
            v-model="encodingConfig.enableDownsample"
            class="toggle-input"
            @change="handleConfigChange"
          />
          <span class="toggle-switch"></span>
          <span class="toggle-text">启用下采样优化</span>
        </label>
        <div class="toggle-hint">降低分辨率以提升编码性能</div>
      </div>
    </div>

    <!-- 编码参数滑块 -->
    <div class="slider-section">
      <div class="slider-group">
        <div class="slider-header">
          <span class="slider-label">编码质量</span>
          <span class="slider-value">{{ (encodingConfig.quality * 100).toFixed(0) }}%</span>
        </div>
        <input
          type="range"
          v-model.number="encodingConfig.quality"
          min="0.1"
          max="1"
          step="0.05"
          class="slider-input"
          @input="handleConfigChange"
        />
      </div>

      <div class="slider-group">
        <div class="slider-header">
          <span class="slider-label">最大尺寸</span>
          <span class="slider-value">{{ encodingConfig.maxSize }}px</span>
        </div>
        <input
          type="range"
          v-model.number="encodingConfig.maxSize"
          min="320"
          max="1920"
          step="80"
          class="slider-input"
          @input="handleConfigChange"
        />
      </div>
    </div>

    <!-- 操作按钮 -->
    <div class="action-section">
      <button
        class="action-button benchmark-button"
        :disabled="isBenchmarking || !videoElement"
        @click="runBenchmark"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <path d="M22 12h-4l-3 9L9 3l-3 9H2"></path>
        </svg>
        <span>{{ isBenchmarking ? '测试中...' : '运行性能测试' }}</span>
      </button>
    </div>

    <!-- 隐藏的 Canvas 容器（用于帧处理） -->
    <canvas ref="canvasRef" class="hidden-canvas"></canvas>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue'
import type { EncodeConfig } from '@/components/Dashboard/types'
import { DEFAULT_ENCODE_CONFIG } from '@/components/Dashboard/constants'
import {
  isWebCodecsSupported,
  benchmarkEncoding,
  smartEncodeCanvasToJpeg,
  cleanupGpuEncoder
} from '../../store/gpu-encoder'

// ==================== Props 定义 ====================
interface Props {
  /** 视频元素引用（用于帧捕获和基准测试） */
  videoElement?: HTMLVideoElement | null
  /** 初始编码配置 */
  initialConfig?: Partial<EncodeConfig>
}

const props = withDefaults(defineProps<Props>(), {
  videoElement: null,
  initialConfig: () => ({})
})

// ==================== Emits 定义 ====================
const emit = defineEmits<{
  /** 配置变更事件 */
  (e: 'config-change', config: EncodeConfig): void
  /** 编码方式变更事件 */
  (e: 'encoding-method-change', method: 'gpu' | 'cpu'): void
  /** GPU 支持变更事件 */
  (e: 'gpu-support-change', supported: boolean): void
  /** 帧编码完成事件 */
  (e: 'frame-encoded', blob: Blob, encodingTime: number): void
  /** 基准测试完成事件 */
  (e: 'benchmark-complete', result: BenchmarkResult): void
}>()

// ==================== Pinia Store 集成 ====================
import { useDashboardStore } from '../../store/modules/dashboard'
const store = useDashboardStore()

// ==================== 类型定义 ====================
interface BenchmarkResult {
  gpuTime: number
  cpuTime: number
  speedup: number
  gpuSupported: boolean
}

// ==================== 内部状态 ====================
// Canvas 引用
const canvasRef = ref<HTMLCanvasElement | null>(null)
let canvasContext: CanvasRenderingContext2D | null = null

// 编码配置
const encodingConfig = ref<EncodeConfig>({
  quality: props.initialConfig.quality ?? DEFAULT_ENCODE_CONFIG.quality,
  maxSize: props.initialConfig.maxSize ?? DEFAULT_ENCODE_CONFIG.maxSize,
  enableDownsample: props.initialConfig.enableDownsample ?? DEFAULT_ENCODE_CONFIG.enableDownsample
})

// GPU 支持状态
const gpuSupported = ref(false)

// 编码方式
const encodingMethod = ref<'gpu' | 'cpu'>('cpu')

// 基准测试结果
const benchmarkResult = ref<BenchmarkResult | null>(null)

// 测试中状态
const isBenchmarking = ref(false)

// ==================== 初始化方法 ====================
/**
 * 初始化 Canvas
 */
function initCanvas(): void {
  if (!canvasRef.value) {
    console.warn('[PerformanceOptimizer] Canvas 元素未找到')
    return
  }

  canvasContext = canvasRef.value.getContext('2d', {
    alpha: false, // 不需要透明通道，提升性能
    desynchronized: true, // 允许异步渲染
    willReadFrequently: false
  })

  if (canvasContext) {
    console.log('[PerformanceOptimizer] Canvas 初始化成功')
  } else {
    console.error('[PerformanceOptimizer] Canvas 上下文获取失败')
  }
}

/**
 * 检测 GPU 支持
 */
function checkGpuSupport(): void {
  gpuSupported.value = isWebCodecsSupported()
  console.log('[PerformanceOptimizer] GPU 编码支持:', gpuSupported.value)

  // 根据 GPU 支持情况设置默认编码方式
  encodingMethod.value = gpuSupported.value ? 'gpu' : 'cpu'
  console.log('[PerformanceOptimizer] 默认编码方式:', encodingMethod.value)

  // 同步到 Pinia store
  store.setGpuSupported(gpuSupported.value)
  store.setEncodingMethod(encodingMethod.value)

  // 通知父组件当前的编码方式（保持向后兼容）
  emit('encoding-method-change', encodingMethod.value)
  // 通知父组件 GPU 支持状态
  emit('gpu-support-change', gpuSupported.value)
}

// ==================== 编码控制方法 ====================
/**
 * 切换 GPU 加速
 */
function toggleGpuAcceleration(): void {
  if (!gpuSupported.value) {
    console.warn('[PerformanceOptimizer] GPU 不支持，无法切换')
    return
  }

  encodingMethod.value = encodingMethod.value === 'gpu' ? 'cpu' : 'gpu'
  console.log('[PerformanceOptimizer] 编码方式切换为:', encodingMethod.value)

  // 同步到 Pinia store
  store.setEncodingMethod(encodingMethod.value)

  emit('encoding-method-change', encodingMethod.value)
}

/**
 * 处理配置变更
 */
function handleConfigChange(): void {
  // 同步到 Pinia store
  store.updateEncodeConfig(encodingConfig.value)
  emit('config-change', { ...encodingConfig.value })
}

// ==================== 帧优化处理 ====================
/**
 * 优化帧处理
 * @param source 视频源或 Canvas 源
 * @returns 编码后的 Blob
 */
async function optimizeFrame(source: HTMLVideoElement | HTMLCanvasElement): Promise<Blob | null> {
  if (!canvasRef.value || !canvasContext) {
    console.warn('[PerformanceOptimizer] Canvas 未初始化')
    return null
  }

  const startTime = performance.now()

  try {
    // 获取源尺寸
    let sourceWidth: number
    let sourceHeight: number

    if (source instanceof HTMLVideoElement) {
      sourceWidth = source.videoWidth
      sourceHeight = source.videoHeight
    } else {
      sourceWidth = source.width
      sourceHeight = source.height
    }

    if (sourceWidth === 0 || sourceHeight === 0) {
      console.warn('[PerformanceOptimizer] 源尺寸无效')
      return null
    }

    // 设置 Canvas 尺寸
    canvasRef.value.width = sourceWidth
    canvasRef.value.height = sourceHeight

    // 绘制源到 Canvas
    canvasContext.drawImage(source, 0, 0, sourceWidth, sourceHeight)

    // 使用智能编码
    const blob = await smartEncodeCanvasToJpeg(
      canvasRef.value,
      encodingConfig.value.quality,
      encodingConfig.value.maxSize,
      encodingConfig.value.enableDownsample
    )

    const encodingTime = performance.now() - startTime

    // 触发编码完成事件
    emit('frame-encoded', blob, encodingTime)

    return blob
  } catch (error) {
    console.error('[PerformanceOptimizer] 帧优化失败:', error)
    return null
  }
}

// ==================== 基准测试 ====================
/**
 * 运行性能基准测试
 */
async function runBenchmark(): Promise<void> {
  if (!props.videoElement) {
    console.warn('[PerformanceOptimizer] 没有可用的视频元素')
    alert('请先连接视频源后再运行性能测试')
    return
  }

  if (isBenchmarking.value) {
    return
  }

  isBenchmarking.value = true

  try {
    // 创建测试 Canvas
    const testCanvas = document.createElement('canvas')
    const testCtx = testCanvas.getContext('2d')

    if (!testCtx) {
      console.error('[PerformanceOptimizer] 无法创建测试 Canvas')
      return
    }

    // 设置 Canvas 尺寸
    testCanvas.width = props.videoElement.videoWidth || 1280
    testCanvas.height = props.videoElement.videoHeight || 720

    // 绘制当前视频帧
    testCtx.drawImage(props.videoElement, 0, 0, testCanvas.width, testCanvas.height)

    // 运行性能测试
    console.log('[PerformanceOptimizer] 开始编码性能基准测试...')
    const results = await benchmarkEncoding(testCanvas, 10)

    // 保存结果
    benchmarkResult.value = results

    // 触发完成事件
    emit('benchmark-complete', results)

    // 显示结果
    const message = results.gpuSupported
      ? `性能测试完成！\n\nGPU编码: ${results.gpuTime.toFixed(2)}ms\nCPU编码: ${results.cpuTime.toFixed(2)}ms\n加速比: ${results.speedup.toFixed(2)}x`
      : `性能测试完成！\n\nCPU编码: ${results.cpuTime.toFixed(2)}ms\nGPU编码: 不支持`

    alert(message)
  } catch (error) {
    console.error('[PerformanceOptimizer] 基准测试失败:', error)
    alert('性能测试失败，请查看控制台日志')
  } finally {
    isBenchmarking.value = false
  }
}

// ==================== 暴露方法给父组件 ====================
defineExpose({
  /** 初始化 Canvas */
  initCanvas,
  /** 切换 GPU 加速 */
  toggleGpuAcceleration,
  /** 优化帧处理 */
  optimizeFrame,
  /** 运行基准测试 */
  runBenchmark,
  /** 获取当前编码配置 */
  getConfig: () => ({ ...encodingConfig.value }),
  /** 设置编码配置 */
  setConfig: (config: Partial<EncodeConfig>) => {
    Object.assign(encodingConfig.value, config)
    handleConfigChange()
  },
  /** 编码方式（直接暴露 ref，用于模板绑定） */
  encodingMethod,
  /** GPU 支持状态（直接暴露 ref，用于模板绑定） */
  gpuSupported,
  /** 获取编码方式 */
  getEncodingMethod: () => encodingMethod.value,
  /** 获取 GPU 支持状态 */
  isGpuSupported: () => gpuSupported.value,
  /** 获取基准测试结果 */
  getBenchmarkResult: () => benchmarkResult.value
})

// ==================== 生命周期钩子 ====================
onMounted(() => {
  console.log('[PerformanceOptimizer] 组件已挂载')

  // 检测 GPU 支持
  checkGpuSupport()

  // 初始化 Canvas
  initCanvas()
})

onUnmounted(() => {
  console.log('[PerformanceOptimizer] 组件卸载')

  // 清理 GPU 资源
  cleanupGpuEncoder()

  // 清理 Canvas 上下文
  canvasContext = null
})

// 监听初始配置变化
watch(
  () => props.initialConfig,
  (newConfig) => {
    if (newConfig) {
      Object.assign(encodingConfig.value, newConfig)
    }
  },
  { deep: true }
)
</script>

<style scoped>
.performance-optimizer {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 12px;
  background: rgba(0, 0, 0, 0.3);
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.1);
}

/* 性能指标展示 */
.performance-metrics {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.metric-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 6px;
  transition: background 0.2s ease;
}

.metric-row:hover {
  background: rgba(255, 255, 255, 0.08);
}

.metric-icon {
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 6px;
}

.metric-icon svg {
  opacity: 0.7;
  stroke: #60a5fa;
}

.gpu-status .metric-icon svg {
  stroke: #4ade80;
}

.encoding-method .metric-icon svg {
  stroke: #fbbf24;
}

.benchmark-result .metric-icon svg {
  stroke: #f472b6;
}

.metric-content {
  flex: 1;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.metric-label {
  font-size: 13px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.7);
  font-family: var(--font-tech-cn);
}

.metric-value {
  font-size: 13px;
  font-weight: 600;
  font-family: var(--font-tech-mono);
  color: rgba(255, 255, 255, 0.9);
}

.metric-value.supported {
  color: #4ade80;
}

.metric-value.unsupported {
  color: #f87171;
}

.metric-value.gpu {
  color: #4ade80;
}

.metric-value.cpu {
  color: #fbbf24;
}

/* 基准测试详情 */
.benchmark-details {
  display: flex;
  flex-direction: column;
  gap: 4px;
  text-align: right;
}

.benchmark-item {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.6);
}

.benchmark-item .value {
  font-weight: 600;
  color: rgba(255, 255, 255, 0.9);
  font-family: var(--font-tech-mono);
  margin-left: 4px;
}

.benchmark-item.speedup .value {
  color: #4ade80;
}

/* 控制区域 */
.control-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.toggle-option {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.toggle-label {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  user-select: none;
}

.toggle-input {
  display: none;
}

.toggle-switch {
  position: relative;
  width: 36px;
  height: 20px;
  background: rgba(255, 255, 255, 0.15);
  border-radius: 10px;
  transition: background 0.2s ease;
}

.toggle-switch::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  background: rgba(255, 255, 255, 0.8);
  border-radius: 50%;
  transition: transform 0.2s ease;
}

.toggle-input:checked + .toggle-switch {
  background: #4ade80;
}

.toggle-input:checked + .toggle-switch::after {
  transform: translateX(16px);
}

.toggle-input:disabled + .toggle-switch {
  opacity: 0.5;
  cursor: not-allowed;
}

.toggle-text {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.8);
  font-family: var(--font-tech-cn);
}

.toggle-hint {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.5);
  margin-left: 46px;
}

/* 滑块区域 */
.slider-section {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 12px;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.slider-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.slider-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.slider-label {
  font-size: 13px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.7);
  font-family: var(--font-tech-cn);
}

.slider-value {
  font-size: 13px;
  font-weight: 600;
  color: #60a5fa;
  font-family: var(--font-tech-mono);
}

.slider-input {
  width: 100%;
  height: 6px;
  background: rgba(255, 255, 255, 0.15);
  border-radius: 3px;
  outline: none;
  -webkit-appearance: none;
  appearance: none;
}

.slider-input::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 16px;
  height: 16px;
  background: #60a5fa;
  border-radius: 50%;
  cursor: pointer;
  transition:
    transform 0.2s ease,
    box-shadow 0.2s ease;
}

.slider-input::-webkit-slider-thumb:hover {
  transform: scale(1.1);
  box-shadow: 0 0 8px rgba(96, 165, 250, 0.6);
}

.slider-input::-moz-range-thumb {
  width: 16px;
  height: 16px;
  background: #60a5fa;
  border-radius: 50%;
  cursor: pointer;
  border: none;
}

/* 操作按钮区域 */
.action-section {
  display: flex;
  justify-content: center;
}

.action-button {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 20px;
  background: linear-gradient(135deg, rgba(96, 165, 250, 0.2), rgba(59, 130, 246, 0.2));
  border: 1px solid rgba(96, 165, 250, 0.4);
  border-radius: 8px;
  color: #60a5fa;
  font-size: 13px;
  font-weight: 600;
  font-family: var(--font-tech-cn);
  cursor: pointer;
  transition: all 0.2s ease;
}

.action-button:hover:not(:disabled) {
  background: linear-gradient(135deg, rgba(96, 165, 250, 0.3), rgba(59, 130, 246, 0.3));
  border-color: rgba(96, 165, 250, 0.6);
  transform: translateY(-1px);
}

.action-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.action-button svg {
  flex-shrink: 0;
}

/* 隐藏的 Canvas */
.hidden-canvas {
  display: none;
}
</style>
