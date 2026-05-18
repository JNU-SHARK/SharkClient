<template>
  <div class="video-source-manager">
    <h3 class="section-title">视频源</h3>

    <div class="video-source-selector">
      <label
        v-if="isDebugMode"
        class="source-card"
        :class="{ selected: selectedVideoSource === 'camera' }"
      >
        <input
          v-model="selectedVideoSource"
          name="videoSource"
          type="radio"
          value="camera"
          @change="handleSourceTypeChange('camera')"
        />
        <div class="card-icon">
          <!-- Camera icon -->
          <svg
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <rect x="3" y="7" width="18" height="13" rx="2" ry="2"></rect>
            <circle cx="12" cy="13" r="3"></circle>
          </svg>
        </div>
        <div class="card-content">
          <div class="card-title">摄像头</div>
          <div class="card-desc">直接从本机摄像头抓取视频流</div>
        </div>
      </label>

      <label
        v-if="isDebugMode"
        class="source-card"
        :class="{ selected: selectedVideoSource === 'file' }"
      >
        <input
          v-model="selectedVideoSource"
          name="videoSource"
          type="radio"
          value="file"
          @change="handleSourceTypeChange('file')"
        />
        <div class="card-icon">
          <!-- File icon -->
          <svg
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
            <polyline points="14 2 14 8 20 8"></polyline>
          </svg>
        </div>
        <div class="card-content">
          <div class="card-title">文件</div>
          <div class="card-desc">从本地视频文件播放</div>
        </div>
      </label>

      <label class="source-card" :class="{ selected: selectedVideoSource === 'udp' }">
        <input
          v-model="selectedVideoSource"
          name="videoSource"
          type="radio"
          value="udp"
          @change="handleSourceTypeChange('udp')"
        />
        <div class="card-icon">
          <!-- UDP icon -->
          <svg
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M21 10v6a2 2 0 0 1-2 2H5"></path>
            <path d="M7 10l5-5 5 5"></path>
          </svg>
        </div>
        <div class="card-content">
          <div class="card-title">UDP</div>
          <div class="card-desc">通过 UDP 接收图像帧</div>
        </div>
      </label>
    </div>

    <div class="panel-section">
      <div v-if="selectedVideoSource === 'camera'">
        <label class="small-label">选择摄像头</label>
        <div class="path-input-group">
          <select id="camera-select" v-model="selectedCameraId" class="camera-select path-input">
            <option
              v-for="(device, i) in cameraDevices"
              :key="device.deviceId"
              :value="device.deviceId"
            >
              {{ device.label || `摄像头 ${i + 1}` }}
            </option>
          </select>
          <button class="modal-button-secondary" @click="enumerateCameraDevices">刷新</button>
        </div>
      </div>

      <div v-if="selectedVideoSource === 'file'">
        <label class="small-label">选择视频文件</label>
        <div class="path-input-group" style="align-items: center">
          <input class="path-input" readonly :value="fileDisplay" />
          <button class="modal-button-primary" @click="handleBrowseFile">浏览</button>
        </div>
      </div>

      <div v-if="selectedVideoSource === 'udp'">
        <div class="info-hint">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="16" x2="12" y2="12"></line>
            <line x1="12" y1="8" x2="12.01" y2="8"></line>
          </svg>
          <span>UDP 地址、端口和编码类型在"网络"标签页配置</span>
        </div>
      </div>

      <div class="row" style="margin-top: 10px; gap: 8px">
        <span class="status-label"
          >状态: <strong>{{ isVideoConnected ? '已连接' : '未连接' }}</strong></span
        >
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, computed } from 'vue'
import type { VideoSource, UdpCodecType } from '@/components/Dashboard/types'
import { DEFAULT_UDP_CONFIG } from '@/components/Dashboard/constants'

// ==================== Pinia Store 集成 ====================
import { useDashboardStore } from '../../store/modules/dashboard'
import { storeToRefs } from 'pinia'
const store = useDashboardStore()
const { isDebugMode } = storeToRefs(store)

const emit = defineEmits([
  'update:video-source',
  'video-connected',
  'update:selected-camera-id',
  'update:video-file-path',
  'update:udp-config'
])

const props = defineProps<{
  videoSource?: VideoSource
  selectedCameraId?: string
  videoFilePath?: string
  connected?: boolean
  udpConfig?: {
    host?: string
    sourceHost?: string
    port?: number
    bufferSize?: number
    codec?: string
  }
}>()

// Local reactive states (fall back to props if provided)
const selectedVideoSource = ref<VideoSource>(props.videoSource ?? 'udp')
const cameraDevices = ref<MediaDeviceInfo[]>([])
const selectedCameraId = ref<string>(props.selectedCameraId ?? '')
const isVideoConnected = ref<boolean>(props.connected ?? false)
const videoFilePath = ref<string>(props.videoFilePath ?? '')
const fileDisplay = computed(() => {
  if (!videoFilePath.value) return ''
  if (videoFilePath.value.startsWith('blob:') || /https?:\/\//.test(videoFilePath.value))
    return videoFilePath.value
  try {
    return videoFilePath.value.split(/[\\\/]/).pop() || videoFilePath.value
  } catch {
    return videoFilePath.value
  }
})
const udpHost = ref<string>(props.udpConfig?.host ?? DEFAULT_UDP_CONFIG.host)
const udpPort = ref<number>(props.udpConfig?.port ?? DEFAULT_UDP_CONFIG.port)
const udpCodec = ref<string>(props.udpConfig?.codec ?? DEFAULT_UDP_CONFIG.codec)

let cameraStream: MediaStream | null = null

async function enumerateCameraDevices(): Promise<void> {
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
      cameraDevices.value = []
      return
    }
    const devices = await navigator.mediaDevices.enumerateDevices()
    cameraDevices.value = devices.filter((d) => d.kind === 'videoinput')
    if (cameraDevices.value.length > 0 && !selectedCameraId.value) {
      selectedCameraId.value = cameraDevices.value[0].deviceId
      emit('update:selected-camera-id', selectedCameraId.value)
    }
  } catch (error) {
    console.warn('[VideoSourceManager] enumerateCameraDevices error', error)
    cameraDevices.value = []
  }
}

function handleSourceTypeChange(type: VideoSource) {
  if (isVideoConnected.value) {
    // 当用户切换视频源时，只更新连接状态并通知父组件（父组件负责实际连接/断开）
    isVideoConnected.value = false
    emit('video-connected', false)
    store.setVideoConnected(false)
  }
  selectedVideoSource.value = type
  emit('update:video-source', type)
  store.setVideoSource(type)
}

// 非调试模式下强制使用 UDP（摄像头/文件仅供调试），避免遗留状态导致界面不可达。
watch(
  isDebugMode,
  (debug) => {
    if (!debug && selectedVideoSource.value !== 'udp') {
      handleSourceTypeChange('udp')
    }
  },
  { immediate: true }
)

// NOTE: 使用 handleBrowseFile 从主进程选择文件并返回路径，保留 input 选择以防未来需求

async function handleBrowseFile(): Promise<void> {
  // Use the main process dialog to select a real local file path so parent can read it
  try {
    if (!window.api?.selectFile) {
      console.warn('[VideoSourceManager] selectFile API not available')
      return
    }
    const path = await window.api.selectFile()
    if (!path) return
    videoFilePath.value = path
    emit('update:video-file-path', path)
    store.setVideoFilePath(path)
    // 如果用户选择了文件，则自动切换到 file 视频源
    selectedVideoSource.value = 'file'
    emit('update:video-source', 'file')
    store.setVideoSource('file')
  } catch (error) {
    console.warn('[VideoSourceManager] handleBrowseFile error', error)
  }
}

// connect/disconnect lifecycle is handled by parent dashboard

// Sync incoming prop changes
watch(
  () => props.videoSource,
  (val) => {
    if (val) selectedVideoSource.value = val
  }
)
watch(
  () => props.selectedCameraId,
  (val) => {
    if (val) selectedCameraId.value = val
  }
)
watch(
  () => props.videoFilePath,
  (val) => {
    if (val) videoFilePath.value = val
  }
)
watch(
  () => ({
    host: props.udpConfig?.host,
    port: props.udpConfig?.port,
    codec: props.udpConfig?.codec
  }),
  (val) => {
    if (val) {
      udpHost.value = val.host ?? udpHost.value
      udpPort.value = val.port ?? udpPort.value
      udpCodec.value = val.codec ?? udpCodec.value
    }
  }
)

onMounted(async () => {
  await enumerateCameraDevices()
})

// 同步父组件的 connected prop 到本地状态
watch(
  () => props.connected,
  (val) => {
    isVideoConnected.value = !!val
  }
)

onUnmounted(() => {
  if (cameraStream) {
    cameraStream.getTracks().forEach((t) => t.stop())
    cameraStream = null
  }
})

// Emit changes to parent when local refs change so v-model bindings update properly
watch(selectedCameraId, (val) => {
  if (val !== undefined) {
    emit('update:selected-camera-id', val)
    store.setSelectedCameraId(val)
  }
})
watch(videoFilePath, (val) => {
  if (val !== undefined) {
    emit('update:video-file-path', val)
    store.setVideoFilePath(val)
  }
})

// UDP 配置变更同步到 store
function syncUdpConfigToStore(): void {
  store.updateUdpConfig({
    host: udpHost.value,
    sourceHost: props.udpConfig?.sourceHost ?? DEFAULT_UDP_CONFIG.sourceHost,
    port: udpPort.value,
    bufferSize: props.udpConfig?.bufferSize ?? DEFAULT_UDP_CONFIG.bufferSize,
    codec: udpCodec.value as UdpCodecType
  })
}

watch(udpHost, () => {
  emit('update:udp-config', {
    host: udpHost.value,
    sourceHost: props.udpConfig?.sourceHost ?? DEFAULT_UDP_CONFIG.sourceHost,
    port: udpPort.value,
    bufferSize: props.udpConfig?.bufferSize ?? DEFAULT_UDP_CONFIG.bufferSize,
    codec: udpCodec.value
  })
  syncUdpConfigToStore()
})
watch(udpPort, () => {
  emit('update:udp-config', {
    host: udpHost.value,
    sourceHost: props.udpConfig?.sourceHost ?? DEFAULT_UDP_CONFIG.sourceHost,
    port: udpPort.value,
    bufferSize: props.udpConfig?.bufferSize ?? DEFAULT_UDP_CONFIG.bufferSize,
    codec: udpCodec.value
  })
  syncUdpConfigToStore()
})
watch(udpCodec, () => {
  emit('update:udp-config', {
    host: udpHost.value,
    sourceHost: props.udpConfig?.sourceHost ?? DEFAULT_UDP_CONFIG.sourceHost,
    port: udpPort.value,
    bufferSize: props.udpConfig?.bufferSize ?? DEFAULT_UDP_CONFIG.bufferSize,
    codec: udpCodec.value
  })
  syncUdpConfigToStore()
})
</script>

<style scoped>
.video-source-manager {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* 区块标题样式（从 Dashboard.vue 中复用） */
.section-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.85);
  padding-bottom: 10px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}
.section-title svg {
  opacity: 0.7;
}
.video-source-manager .panel-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.video-source-manager .row {
  display: flex;
  gap: 8px;
  width: 100%;
}
.video-source-manager .small-label {
  font-weight: 600;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.85);
  margin-bottom: 4px;
}
.video-source-manager .file-path {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.6);
}
.video-source-manager .status-label {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.9);
  margin-left: 8px;
}
/* 按钮样式 */
.video-source-manager .btn {
  padding: 8px 16px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.06);
  color: #fff;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  white-space: nowrap;
}

.video-source-manager .btn:hover {
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.2);
  transform: translateY(-1px);
}

.video-source-manager .btn:active {
  transform: translateY(0);
}

.video-source-manager .btn.primary {
  background: #3b82f6;
  border-color: #3b82f6;
  font-weight: 600;
}

.video-source-manager .btn.primary:hover {
  background: #2563eb;
  border-color: #2563eb;
}

.video-source-manager .btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
}

/* 输入框样式 */
.video-source-manager input[type='text'],
.video-source-manager input[type='number'] {
  padding: 8px 12px;
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 6px;
  color: #fff;
  font-size: 13px;
  transition:
    border-color 0.2s,
    background 0.2s;
}

.video-source-manager input[type='text']:focus,
.video-source-manager input[type='number']:focus {
  outline: none;
  border-color: rgba(59, 130, 246, 0.5);
  background: rgba(0, 0, 0, 0.35);
}

.video-source-manager input[type='text']::placeholder,
.video-source-manager input[type='number']::placeholder {
  color: rgba(255, 255, 255, 0.3);
}

/* 使用全局 .codec-select 样式 */

.video-source-manager .path-input-group select {
  width: 100%;
  box-sizing: border-box;
}

/* path input group: match Dashboard styles */

/* 来自 Dashboard.vue 的 .source-card 样式，已移植至此组件 */
.video-source-selector {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.source-card {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 20px 16px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  cursor: pointer;
  transition:
    background 0.25s cubic-bezier(0.4, 0, 0.2, 1),
    border-color 0.25s cubic-bezier(0.4, 0, 0.2, 1),
    transform 0.25s cubic-bezier(0.4, 0, 0.2, 1),
    box-shadow 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  will-change: transform;
}

.source-card input[type='radio'] {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

.source-card:hover {
  border-color: rgba(59, 130, 246, 0.5);
  background: rgba(59, 130, 246, 0.1);
  transform: translateY(-2px);
}

.source-card.selected {
  border-color: rgba(59, 130, 246, 0.6);
  background: rgba(59, 130, 246, 0.15);
  box-shadow:
    inset 0 1px 1px rgba(255, 255, 255, 0.1),
    0 0 20px rgba(59, 130, 246, 0.15);
}

.source-card.selected::before {
  content: '✓';
  position: absolute;
  top: 10px;
  right: 10px;
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #3b82f6;
  color: white;
  border-radius: 50%;
  font-size: 13px;
  font-weight: bold;
}

.card-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  background: rgba(255, 255, 255, 0.04);
  border-radius: 12px;
  transition: background 0.25s;
}

.source-card:hover .card-icon {
  background: rgba(59, 130, 246, 0.15);
}

.source-card.selected .card-icon {
  background: rgba(59, 130, 246, 0.25);
}

.card-icon svg {
  opacity: 0.6;
  transition:
    opacity 0.25s,
    stroke 0.25s;
}

.source-card:hover .card-icon svg,
.source-card.selected .card-icon svg {
  opacity: 1;
  stroke: #3b82f6;
}

.card-content {
  text-align: center;
}

.card-title {
  font-size: 15px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.9);
  margin-bottom: 4px;
}

.card-desc {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.45);
  line-height: 1.4;
}
</style>
