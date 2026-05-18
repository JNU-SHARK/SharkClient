<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps({
  value: { type: Number, default: 0 },
  max: { type: Number, default: 100 },
  min: { type: Number, default: 0 },
  unit: { type: String, default: '' },
  label: { type: String, default: '' },
  color: { type: String, default: '#3b82f6' },
  showValue: { type: Boolean, default: true },
  segmented: { type: Boolean, default: false },
  // 双段能量显示（类似超电能量条）
  dualMode: { type: Boolean, default: false },
  bufferValue: { type: Number, default: 0 },
  bufferMax: { type: Number, default: 60 },
  bufferColor: { type: String, default: '#06b6d4' }, // 缓冲能量颜色（青色）
  actualColor: { type: String, default: '#f59e0b' } // 实际能量颜色（橙色）
})

const percentage = computed(() => {
  const range = props.max - props.min
  const val = Math.max(props.min, Math.min(props.max, props.value))
  return ((val - props.min) / range) * 100
})

const segments = computed(() => {
  if (!props.segmented) return []
  return Array.from({ length: 10 }).map((_, i) => i * 10)
})

// 双段模式计算
const totalMaxEnergy = computed(() => props.bufferMax + props.max)
const bufferPercentage = computed(() => {
  const energy = Math.max(0, Math.min(props.bufferValue, props.bufferMax))
  return (energy / totalMaxEnergy.value) * 100
})
const actualPercentage = computed(() => {
  const energy = Math.max(0, Math.min(props.value, props.max))
  return (energy / totalMaxEnergy.value) * 100
})
</script>

<template>
  <div class="data-bar-widget">
    <!-- 标题和数值显示在同一行 -->
    <div v-if="label || (showValue && !dualMode)" class="bar-header">
      <div v-if="label" class="bar-label">{{ label }}</div>
      <div v-if="showValue && !dualMode" class="bar-value-inline">
        {{ Math.round(value) }}<span v-if="unit" class="unit">{{ unit }}</span>
      </div>
    </div>

    <!-- 双段能量条模式（类似超电） -->
    <template v-if="dualMode">
      <div class="bar-track dual-mode">
        <!-- 实际能量（底层） -->
        <div
          class="bar-fill dual-actual"
          :style="{
            width: `${bufferPercentage + actualPercentage}%`,
            background: `linear-gradient(90deg, ${actualColor}, ${actualColor}dd)`,
            boxShadow: `0 0 12px ${actualColor}cc`
          }"
        ></div>
        <!-- 缓冲能量（上层） -->
        <div
          class="bar-fill dual-buffer"
          :style="{
            width: `${bufferPercentage}%`,
            background: `linear-gradient(90deg, ${bufferColor}, ${bufferColor}dd)`,
            boxShadow: `0 0 12px ${bufferColor}cc`
          }"
        ></div>
      </div>
      <div v-if="showValue" class="bar-value dual-value">
        <span class="buffer-text" :style="{ color: bufferColor }">
          缓冲: {{ Math.round(bufferValue) }}
        </span>
        <span class="separator">+</span>
        <span class="actual-text" :style="{ color: actualColor }">
          实际: {{ Math.round(value) }}
        </span>
      </div>
    </template>

    <!-- 单段能量条模式（传统） -->
    <template v-else>
      <div class="bar-track">
        <div
          class="bar-fill"
          :style="{
            width: `${percentage}%`,
            background: `linear-gradient(90deg, ${color}, ${color}dd)`,
            boxShadow: `0 0 10px ${color}66`
          }"
        >
          <div class="bar-glare"></div>
        </div>

        <!-- 分割线 -->
        <template v-if="segmented">
          <div
            v-for="pos in segments"
            :key="pos"
            class="bar-segment"
            :style="{ left: `${pos}%` }"
          ></div>
        </template>
      </div>
    </template>
  </div>
</template>

<style scoped>
.data-bar-widget {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
  font-family: 'JetBrains Mono', monospace;
}

.bar-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}

.bar-label {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.7);
  text-transform: uppercase;
  font-weight: 600;
  letter-spacing: 0.5px;
  flex: 1;
}

.bar-value-inline {
  font-size: 14px;
  font-weight: bold;
  color: #fff;
  white-space: nowrap;
}

.bar-track {
  position: relative;
  height: 14px;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 2px;
  transform: skewX(-25deg);
  overflow: hidden;
}

.bar-fill {
  position: absolute;
  top: 0;
  left: 0;
  height: 100%;
  transition: width 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.bar-fill.dual-actual {
  z-index: 1;
}

.bar-fill.dual-buffer {
  z-index: 2;
}

.bar-glare {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 50%;
  background: linear-gradient(to bottom, rgba(255, 255, 255, 0.2), transparent);
}

.bar-segment {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background: rgba(0, 0, 0, 0.5);
  z-index: 3;
}

.bar-value {
  font-size: 14px;
  font-weight: bold;
  text-align: right;
  color: #fff;
}

.bar-value.dual-value {
  display: flex;
  align-items: center;
  gap: 6px;
  justify-content: flex-end;
  font-size: 13px;
}

.buffer-text,
.actual-text {
  font-weight: 600;
}

.separator {
  color: rgba(255, 255, 255, 0.4);
  font-weight: 400;
}

.unit {
  font-size: 10px;
  margin-left: 2px;
  opacity: 0.7;
}
</style>
