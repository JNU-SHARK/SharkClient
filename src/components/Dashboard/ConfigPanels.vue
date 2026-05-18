<script setup lang="ts">
/**
 * ConfigPanels.vue - 配置面板组件
 *
 * 功能：
 * - 外置检测脚本状态显示和手动启动/停止
 * - 编码参数配置（JPEG质量、分辨率、下采样）
 * - Pipe/共享内存 IPC 状态显示和控制
 *
 * Props:
 * - defaultEncodeConfig: 默认编码配置
 * - pipeServerStatus: Pipe 服务器状态
 * - encodingMethod: 编码方式（GPU/CPU）
 *
 * Emits:
 * - encode-config-change: 编码配置变更
 * - start-pipe-server: 请求启动 Pipe 服务器
 * - stop-pipe-server: 请求停止 Pipe 服务器
 */

import { ref, watch, onMounted } from 'vue'
import type { EncodeConfig, PipeServerStatus } from '@/components/Dashboard/types'

// ==================== Pinia Store 集成 ====================
import { useDashboardStore } from '../../store/modules/dashboard'
const store = useDashboardStore()

// ==================== Props 定义 ====================
const props = withDefaults(
  defineProps<{
    /** 默认编码配置 */
    defaultEncodeConfig?: Partial<EncodeConfig>
    /** Pipe 服务器状态 */
    pipeServerStatus?: PipeServerStatus
    /** 编码方式 */
    encodingMethod?: 'gpu' | 'cpu'
  }>(),
  {
    defaultEncodeConfig: () => ({
      quality: 0.5,
      maxSize: 640,
      enableDownsample: true
    }),
    pipeServerStatus: 'stopped',
    encodingMethod: 'cpu'
  }
)

// ==================== Emits 定义 ====================
const emit = defineEmits<{
  /** 编码配置变更事件 */
  (e: 'encode-config-change', config: EncodeConfig): void
  /** 请求启动 Pipe 服务器 */
  (e: 'start-pipe-server'): void
  /** 请求停止 Pipe 服务器 */
  (e: 'stop-pipe-server'): void
}>()

// ==================== 内部状态 ====================
/** 临时编码配置（用于表单绑定） */
const tempEncodeConfig = ref<EncodeConfig>({
  quality: props.defaultEncodeConfig.quality ?? 0.5,
  maxSize: props.defaultEncodeConfig.maxSize ?? 640,
  enableDownsample: props.defaultEncodeConfig.enableDownsample ?? true
})

// ==================== 监听器 ====================
/**
 * 监听编码配置变化并触发事件
 */
watch(
  tempEncodeConfig,
  (newConfig) => {
    console.log('[ConfigPanels] 编码配置变更:', newConfig)
    emit('encode-config-change', { ...newConfig })
    store.updateEncodeConfig({ ...newConfig })
  },
  { deep: true }
)

watch(
  () => props.defaultEncodeConfig,
  (newConfig) => {
    if (newConfig) {
      if (newConfig.quality !== undefined) tempEncodeConfig.value.quality = newConfig.quality
      if (newConfig.maxSize !== undefined) tempEncodeConfig.value.maxSize = newConfig.maxSize
      if (newConfig.enableDownsample !== undefined)
        tempEncodeConfig.value.enableDownsample = newConfig.enableDownsample
    }
  },
  { deep: true }
)

// ==================== 方法 ====================
/**
 * 处理编码配置变更
 */
function handleEncodingConfigChange(key: keyof EncodeConfig, value: number | boolean): void {
  if (key === 'quality' || key === 'maxSize') {
    tempEncodeConfig.value[key] = value as number
  } else if (key === 'enableDownsample') {
    tempEncodeConfig.value[key] = value as boolean
  }
}

/**
 * 请求启动 Pipe 服务器
 */
function requestStartPipeServer(): void {
  console.log('[ConfigPanels] 请求启动外置检测服务')
  emit('start-pipe-server')
  store.setPipeServerStatus('starting')
}

/**
 * 请求停止 Pipe 服务器
 */
function requestStopPipeServer(): void {
  console.log('[ConfigPanels] 请求停止外置检测服务')
  emit('stop-pipe-server')
  // 停止时由父组件在实际停止后设置状态为 'stopped'
}

// ==================== 暴露方法给父组件 ====================
defineExpose({
  /** 获取当前编码配置 */
  getEncodeConfig: () => ({ ...tempEncodeConfig.value }),
  /** 设置编码配置 */
  setEncodeConfig: (config: Partial<EncodeConfig>) => {
    if (config.quality !== undefined) tempEncodeConfig.value.quality = config.quality
    if (config.maxSize !== undefined) tempEncodeConfig.value.maxSize = config.maxSize
    if (config.enableDownsample !== undefined)
      tempEncodeConfig.value.enableDownsample = config.enableDownsample
  }
})

// ==================== 生命周期 ====================
onMounted(() => {
  console.log('[ConfigPanels] 组件已挂载')
  console.log('[ConfigPanels] 初始编码配置:', tempEncodeConfig.value)
})
</script>

<template>
  <div class="config-panels">
    <!-- 外置检测服务 -->
    <div class="panel-section">
      <h4 class="section-title">
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
        外置检测服务
      </h4>

      <div class="engine-info-card">
        <div class="engine-info-row">
          <span class="info-label">模式</span>
          <span class="info-value">Python 脚本 + 共享内存传帧 + Pipe 控制</span>
        </div>
        <div class="engine-info-row">
          <span class="info-label">模型</span>
          <span class="info-value">AI Server/model/armor.onnx + car.onnx</span>
        </div>
        <div class="engine-info-row">
          <span class="info-label">状态</span>
          <span class="status-badge" :class="pipeServerStatus === 'running' ? 'connected' : 'disconnected'">
            {{ pipeServerStatus === 'running' ? '已启动' : pipeServerStatus === 'starting' ? '启动中...' : pipeServerStatus === 'error' ? '异常' : '未启动' }}
          </span>
        </div>
      </div>

      <div class="pipe-server-control">
        <div class="server-control-buttons">
          <button
            class="server-btn start"
            :disabled="pipeServerStatus === 'running' || pipeServerStatus === 'starting'"
            @click="requestStartPipeServer"
          >
            启动
          </button>
          <button
            class="server-btn stop"
            :disabled="pipeServerStatus === 'stopped' || pipeServerStatus === 'starting'"
            @click="requestStopPipeServer"
          >
            停止
          </button>
        </div>
      </div>

      <div class="slider-hint">
        检测服务默认不会随客户端启动；需要先手动启动脚本，再开启 AI 检测。
      </div>
    </div>

    <!-- 图像编码配置 -->
    <div class="panel-section">
      <h4 class="section-title">
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
          <circle cx="8.5" cy="8.5" r="1.5"></circle>
          <polyline points="21 15 16 10 5 21"></polyline>
        </svg>
        图像编码配置
      </h4>

      <!-- JPEG 质量滑块 -->
      <div class="slider-group">
        <label class="slider-label">
          <span class="label-text">JPEG质量</span>
          <span class="label-value">{{ (tempEncodeConfig.quality * 100).toFixed(0) }}%</span>
        </label>
        <input
          type="range"
          :value="tempEncodeConfig.quality"
          min="0.3"
          max="0.9"
          step="0.1"
          class="slider"
          @input="
            handleEncodingConfigChange('quality', Number(($event.target as HTMLInputElement).value))
          "
        />
        <div class="slider-hint">降低质量可减少编码时间和网络传输</div>
      </div>

      <!-- 编码分辨率滑块 -->
      <div class="slider-group">
        <label class="slider-label">
          <span class="label-text">编码分辨率</span>
          <span class="label-value">{{ tempEncodeConfig.maxSize }}px</span>
        </label>
        <input
          type="range"
          :value="tempEncodeConfig.maxSize"
          min="480"
          max="1280"
          step="160"
          class="slider"
          @input="
            handleEncodingConfigChange('maxSize', Number(($event.target as HTMLInputElement).value))
          "
        />
        <div class="slider-hint">编码前下采样尺寸，降低可大幅提升性能</div>
      </div>

      <!-- 下采样开关 -->
      <div class="toggle-option">
        <label class="toggle-label">
          <input
            type="checkbox"
            :checked="tempEncodeConfig.enableDownsample"
            class="toggle-input"
            @change="
              handleEncodingConfigChange(
                'enableDownsample',
                ($event.target as HTMLInputElement).checked
              )
            "
          />
          <span class="toggle-switch"></span>
          <span class="toggle-text">启用下采样</span>
        </label>
        <div class="slider-hint">关闭后使用原始分辨率编码</div>
      </div>

      <!-- 编码状态显示 -->
      <div class="encode-status">
        <span class="status-label">编码方式:</span>
        <span class="status-badge" :class="encodingMethod">
          {{ encodingMethod === 'gpu' ? 'GPU加速' : 'CPU' }}
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 配置面板容器 */
.config-panels {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

/* 面板区块 */
.panel-section {
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 12px;
  padding: 16px;
}

.section-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.9);
  margin-bottom: 14px;
}

.section-title svg {
  opacity: 0.6;
}

/* 推理引擎信息卡片 */
.engine-info-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 14px;
  margin-bottom: 8px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 8px;
}

.engine-info-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: 12px;
  line-height: 1.4;
}

.engine-info-row .info-label {
  flex-shrink: 0;
  color: rgba(255, 255, 255, 0.5);
}

.engine-info-row .info-value {
  flex: 1;
  min-width: 0;
  text-align: right;
  color: rgba(255, 255, 255, 0.85);
  word-break: break-word;
}

.engine-info-row .status-badge {
  font-size: 11px;
  font-weight: 600;
  padding: 3px 10px;
  border-radius: 4px;
}

.engine-info-row .status-badge.connected {
  background: rgba(102, 187, 106, 0.2);
  color: #66bb6a;
}

.engine-info-row .status-badge.disconnected {
  background: rgba(148, 163, 184, 0.18);
  color: rgba(255, 255, 255, 0.65);
}

/* Pipe 服务器控制 */
.pipe-server-control {
  margin-top: 12px;
  padding: 12px;
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 8px;
}

.server-status-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.server-status-row .status-label {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.6);
}

.server-status-row .status-badge {
  font-size: 11px;
  font-weight: 600;
  padding: 3px 10px;
  border-radius: 4px;
}

.server-status-row .status-badge.running {
  background: rgba(102, 187, 106, 0.2);
  color: #66bb6a;
}

.server-status-row .status-badge.starting {
  background: rgba(251, 191, 36, 0.2);
  color: #fbbf24;
  animation: pulse 1.5s infinite;
}

.server-status-row .status-badge.stopped {
  background: rgba(156, 163, 175, 0.2);
  color: #9ca3af;
}

.server-status-row .status-badge.error {
  background: rgba(239, 68, 68, 0.2);
  color: #ef4444;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.6;
  }
}

.server-control-buttons {
  display: flex;
  gap: 8px;
}

.server-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px 12px;
  border: none;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition:
    background 0.2s,
    border-color 0.2s,
    opacity 0.2s;
}

.server-btn.start {
  background: rgba(102, 187, 106, 0.15);
  color: #66bb6a;
  border: 1px solid rgba(102, 187, 106, 0.3);
}

.server-btn.start:hover:not(:disabled) {
  background: rgba(102, 187, 106, 0.25);
  border-color: rgba(102, 187, 106, 0.5);
}

.server-btn.stop {
  background: rgba(239, 68, 68, 0.15);
  color: #ef4444;
  border: 1px solid rgba(239, 68, 68, 0.3);
}

.server-btn.stop:hover:not(:disabled) {
  background: rgba(239, 68, 68, 0.25);
  border-color: rgba(239, 68, 68, 0.5);
}

.server-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* 滑块组件样式 */
.slider-group {
  margin-bottom: 16px;
}

.slider-label {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.label-text {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.7);
}

.label-value {
  font-size: 13px;
  font-weight: 600;
  color: #60a5fa;
  font-family: 'SF Mono', 'Monaco', 'Consolas', monospace;
}

.slider {
  width: 100%;
  height: 6px;
  -webkit-appearance: none;
  appearance: none;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 3px;
  outline: none;
  cursor: pointer;
}

.slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 16px;
  height: 16px;
  background: #60a5fa;
  border-radius: 50%;
  cursor: pointer;
  transition:
    transform 0.15s,
    box-shadow 0.15s;
}

.slider::-webkit-slider-thumb:hover {
  transform: scale(1.15);
  box-shadow: 0 0 8px rgba(96, 165, 250, 0.5);
}

.slider::-moz-range-thumb {
  width: 16px;
  height: 16px;
  background: #60a5fa;
  border: none;
  border-radius: 50%;
  cursor: pointer;
}

.slider-hint {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.4);
  margin-top: 6px;
}

/* 开关样式 */
.toggle-option {
  margin-top: 12px;
}

.toggle-label {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
}

.toggle-input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

.toggle-switch {
  position: relative;
  width: 40px;
  height: 22px;
  background: rgba(255, 255, 255, 0.15);
  border-radius: 11px;
  transition: background 0.25s;
}

.toggle-switch::before {
  content: '';
  position: absolute;
  top: 3px;
  left: 3px;
  width: 16px;
  height: 16px;
  background: white;
  border-radius: 50%;
  transition: transform 0.25s;
}

.toggle-input:checked + .toggle-switch {
  background: #66bb6a;
}

.toggle-input:checked + .toggle-switch::before {
  transform: translateX(18px);
}

.toggle-text {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.7);
}

/* 编码状态显示 */
.encode-status {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 16px;
  padding: 10px 12px;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 6px;
}

.encode-status .status-label {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.5);
}

.encode-status .status-badge {
  font-size: 11px;
  font-weight: 600;
  padding: 3px 10px;
  border-radius: 4px;
}

.encode-status .status-badge.gpu {
  background: rgba(102, 187, 106, 0.2);
  color: #66bb6a;
}

.encode-status .status-badge.cpu {
  background: rgba(251, 191, 36, 0.2);
  color: #fbbf24;
}
</style>
