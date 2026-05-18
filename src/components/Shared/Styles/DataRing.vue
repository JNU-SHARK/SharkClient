<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps({
  value: { type: Number, default: 0 },
  max: { type: Number, default: 100 },
  min: { type: Number, default: 0 },
  unit: { type: String, default: '' },
  label: { type: String, default: '' },
  color: { type: String, default: '#3b82f6' },
  size: { type: Number, default: 100 },
  strokeWidth: { type: Number, default: 8 }
})

const radius = computed(() => (props.size - props.strokeWidth) / 2)
const circumference = computed(() => 2 * Math.PI * radius.value)
const offset = computed(() => {
  const range = props.max - props.min
  const val = Math.max(props.min, Math.min(props.max, props.value))
  const percentage = (val - props.min) / range
  return circumference.value * (1 - percentage)
})
</script>

<template>
  <div class="data-ring-widget" :style="{ width: `${size}px`, height: `${size}px` }">
    <svg :width="size" :height="size" class="ring-svg">
      <!-- 背景环 -->
      <circle
        class="ring-bg"
        :cx="size / 2"
        :cy="size / 2"
        :r="radius"
        :stroke-width="strokeWidth"
      />
      <!-- 进度环 -->
      <circle
        class="ring-progress"
        :cx="size / 2"
        :cy="size / 2"
        :r="radius"
        :stroke-width="strokeWidth"
        :stroke="color"
        :stroke-dasharray="circumference"
        :stroke-dashoffset="offset"
        stroke-linecap="round"
      />
    </svg>
    <div class="ring-content">
      <div class="ring-value">
        {{ Math.round(value) }}<span class="unit">{{ unit }}</span>
      </div>
      <div v-if="label" class="ring-label">{{ label }}</div>
    </div>
  </div>
</template>

<style scoped>
.data-ring-widget {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: 'JetBrains Mono', monospace;
}

.ring-svg {
  transform: rotate(-90deg);
}

.ring-bg {
  fill: none;
  stroke: rgba(255, 255, 255, 0.1);
}

.ring-progress {
  fill: none;
  transition: stroke-dashoffset 0.5s cubic-bezier(0.4, 0, 0.2, 1);
  filter: drop-shadow(0 0 4px currentColor);
}

.ring-content {
  position: absolute;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
}

.ring-value {
  font-size: 1.5em;
  font-weight: bold;
  color: #fff;
  line-height: 1;
}

.unit {
  font-size: 0.5em;
  margin-left: 2px;
  opacity: 0.7;
}

.ring-label {
  font-size: 0.7em;
  color: rgba(255, 255, 255, 0.6);
  margin-top: 4px;
  text-transform: uppercase;
}
</style>
