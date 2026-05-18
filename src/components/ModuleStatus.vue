<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useDashboardStore } from '../store'

const store = useDashboardStore()
const {
  cameraStatus,
  detectionEnabled,
  detectionStats
  // detectionStatusText, // computed in store, need to access via store instance or recreate
  // cameraStatusClass,
  // detectionStatusClass
} = storeToRefs(store)

// Access getters directly from store instance
const cameraStatusClass = computed(() => store.cameraStatusClass)
const detectionStatusText = computed(() => store.detectionStatusText)
const detectionStatusClass = computed(() => store.detectionStatusClass)

// 识别帧率（保留 1 位小数）；未启用或未更新时显示 0
const detectionFpsText = computed(() => {
  const fps = detectionStats.value?.currentFPS ?? 0
  return detectionEnabled.value ? `${fps.toFixed(1)} FPS` : '--'
})
const detectionFpsClass = computed(() => {
  if (!detectionEnabled.value) return ''
  const fps = detectionStats.value?.currentFPS ?? 0
  if (fps >= 20) return 'status-active'
  if (fps >= 10) return 'status-warning'
  return 'status-error'
})

const toggleDetection = (): void => {
  store.setDetectionEnabled(!detectionEnabled.value)
}
</script>

<template>
  <div class="module-status-container">
    <div class="status-row">
      <span>相机:</span>
      <span class="value status-badge" :class="cameraStatusClass">{{ cameraStatus }}</span>
    </div>
    <div class="status-row">
      <span>检测:</span>
      <span
        class="value status-badge status-badge-with-dot"
        :class="detectionStatusClass"
        title="按 D 切换检测"
      >
        {{ detectionStatusText }}
      </span>
      <button
        class="detection-toggle-button"
        title="按 D 切换检测"
        :aria-pressed="detectionEnabled"
        @click="toggleDetection"
      >
        {{ detectionEnabled ? '停止' : '启动' }}
      </button>
    </div>
    <div class="status-row">
      <span>识别帧率:</span>
      <span class="value status-badge" :class="detectionFpsClass">{{ detectionFpsText }}</span>
    </div>
    <div class="status-row">
      <span>通信:</span> <span class="value status-badge status-active">良好</span>
    </div>
    <div class="status-row"><span>电源:</span> <span class="value">84%</span></div>
  </div>
</template>

<style scoped>
.module-status-container {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 4px;
}

.status-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.8);
  padding: 4px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.status-row:last-child {
  border-bottom: none;
}

.value {
  font-family: 'JetBrains Mono', monospace;
  font-weight: 500;
}

.status-badge {
  padding: 2px 6px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.1);
  font-size: 12px;
}

.status-active {
  color: #10b981;
  background: rgba(16, 185, 129, 0.1);
}

.status-warning {
  color: #f59e0b;
  background: rgba(245, 158, 11, 0.1);
}

.status-error {
  color: #ef4444;
  background: rgba(239, 68, 68, 0.1);
}

.status-badge-with-dot {
  display: flex;
  align-items: center;
  gap: 6px;
}

.status-badge-with-dot::before {
  content: '';
  display: block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background-color: currentColor;
  box-shadow: 0 0 8px currentColor;
  animation: pulse 2s infinite;
}

.detection-toggle-button {
  margin-left: 8px;
  padding: 2px 8px;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.2);
  color: rgba(255, 255, 255, 0.8);
  border-radius: 4px;
  font-size: 11px;
  cursor: pointer;
  transition: all 0.2s;
}

.detection-toggle-button:hover {
  background: rgba(255, 255, 255, 0.2);
}

.detection-toggle-button[aria-pressed='true'] {
  background: rgba(16, 185, 129, 0.2);
  border-color: rgba(16, 185, 129, 0.4);
  color: #10b981;
}

@keyframes pulse {
  0% {
    opacity: 0.6;
    transform: scale(0.95);
  }
  50% {
    opacity: 1;
    transform: scale(1.05);
  }
  100% {
    opacity: 0.6;
    transform: scale(0.95);
  }
}
</style>
