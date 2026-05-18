<template>
  <div class="status-row ammo-row">
    <div class="status-icon">
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <circle cx="12" cy="12" r="10"></circle>
        <circle cx="12" cy="12" r="3"></circle>
      </svg>
    </div>
    <div class="status-content">
      <div class="status-header">
        <span class="status-label">弹药</span>
        <span class="status-value" :class="{ low: ammoPercent < 20 }">
          {{ remainingAmmo }}
        </span>
      </div>
      <div class="progress-bar ammo-bar">
        <div
          class="progress-fill ammo-fill"
          :class="{ low: ammoPercent < 20 }"
          :style="{ width: ammoPercent + '%' }"
        ></div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

interface Props {
  remainingAmmo?: number
  maxAmmo?: number
}

const props = withDefaults(defineProps<Props>(), {
  remainingAmmo: 0,
  maxAmmo: 500
})

const ammoPercent = computed(() => {
  if (props.maxAmmo === 0) return 0
  return Math.round((props.remainingAmmo / props.maxAmmo) * 100)
})
</script>

<style scoped>
.status-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 0;
}

.status-icon {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(139, 92, 246, 0.1);
  border-radius: 8px;
  color: #a78bfa;
}

.status-content {
  flex: 1;
  min-width: 0;
}

.status-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}

.status-label {
  font-size: 13px;
  color: #94a3b8;
  font-weight: 500;
}

.status-value {
  font-size: 13px;
  font-weight: 600;
  color: #3b82f6;
  font-family: 'Orbitron', monospace;
}

.status-value.low {
  color: #ef4444;
}

.progress-bar {
  height: 6px;
  background: rgba(148, 163, 184, 0.1);
  border-radius: 3px;
  overflow: hidden;
  position: relative;
}

.progress-fill {
  height: 100%;
  transition: width 0.3s ease;
  border-radius: 3px;
}

.ammo-fill {
  background: linear-gradient(90deg, #3b82f6, #60a5fa);
}

.ammo-fill.low {
  background: linear-gradient(90deg, #ef4444, #f87171);
}
</style>
