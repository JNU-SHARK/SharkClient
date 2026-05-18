<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    zoom: number
    minZoom?: number
    maxZoom?: number
    step?: number
  }>(),
  {
    minZoom: 1,
    maxZoom: 10,
    step: 0.1
  }
)

const emit = defineEmits<{
  'update:zoom': [value: number]
}>()

const normalizedZoom = computed(() => {
  const clamped = Math.min(props.maxZoom, Math.max(props.minZoom, props.zoom))
  return Math.round(clamped * 10) / 10
})

const zoomText = computed(() => `${normalizedZoom.value.toFixed(1)}x`)
const zoomPercent = computed(() => {
  const range = props.maxZoom - props.minZoom
  if (range <= 0) return 0
  return ((normalizedZoom.value - props.minZoom) / range) * 100
})
const zoomNumberText = computed(() => normalizedZoom.value.toFixed(1))

function setZoom(value: number): void {
  const clamped = Math.min(props.maxZoom, Math.max(props.minZoom, value))
  emit('update:zoom', Math.round(clamped * 10) / 10)
}

function handleSliderInput(event: Event): void {
  const target = event.target as HTMLInputElement | null
  setZoom(Number(target?.value ?? normalizedZoom.value))
}
</script>

<template>
  <div class="video-zoom-status" :style="{ '--zoom-percent': `${zoomPercent}%` }">
    <div class="zoom-readout">
      <div class="zoom-meta">
        <span>图传倍率</span>
        <strong>ZOOM</strong>
      </div>
      <div class="zoom-value" :aria-label="zoomText">
        <span>{{ zoomNumberText }}</span>
        <small>x</small>
      </div>
    </div>

    <div class="zoom-rail" aria-hidden="true">
      <span class="rail-fill"></span>
      <span v-for="index in 9" :key="index" class="rail-tick"></span>
    </div>

    <div class="zoom-controls">
      <button
        type="button"
        aria-label="缩小图传倍率"
        :disabled="normalizedZoom <= minZoom"
        @click="setZoom(normalizedZoom - step)"
      >
        -
      </button>
      <input
        type="range"
        :min="minZoom"
        :max="maxZoom"
        :step="step"
        :value="normalizedZoom"
        aria-label="图传放大倍率"
        @input="handleSliderInput"
      />
      <button
        type="button"
        aria-label="放大图传倍率"
        :disabled="normalizedZoom >= maxZoom"
        @click="setZoom(normalizedZoom + step)"
      >
        +
      </button>
    </div>
  </div>
</template>

<style scoped>
.video-zoom-status {
  --zoom-percent: 0%;
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
  padding: 2px 0;
}

.zoom-readout {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 14px;
  min-height: 44px;
}

.zoom-meta {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding-bottom: 3px;
  min-width: 68px;
}

.zoom-meta span {
  color: rgba(255, 255, 255, 0.76);
  font-family: var(--font-tech-cn);
  font-size: 13px;
  line-height: 1;
}

.zoom-meta strong {
  width: fit-content;
  padding: 2px 6px;
  border: 1px solid rgba(96, 165, 250, 0.35);
  border-radius: 3px;
  color: #9bd5ff;
  background: rgba(96, 165, 250, 0.08);
  font: 700 10px/1 'JetBrains Mono', 'Consolas', monospace;
}

.zoom-value {
  display: flex;
  align-items: flex-end;
  color: #d8f3ff;
  font-family: 'JetBrains Mono', 'Consolas', monospace;
  line-height: 1;
  text-shadow:
    0 0 10px rgba(56, 189, 248, 0.5),
    0 0 24px rgba(34, 197, 94, 0.18);
}

.zoom-value span {
  font-size: 38px;
  font-weight: 800;
}

.zoom-value small {
  margin-left: 3px;
  margin-bottom: 4px;
  color: #7dd3fc;
  font-size: 15px;
  font-weight: 700;
}

.zoom-rail {
  position: relative;
  display: grid;
  grid-template-columns: repeat(9, 1fr);
  align-items: center;
  height: 18px;
  padding: 0 2px;
}

.zoom-rail::before,
.rail-fill {
  content: '';
  position: absolute;
  left: 2px;
  right: 2px;
  top: 7px;
  display: block;
  height: 2px;
  border-radius: 999px;
}

.zoom-rail::before {
  background: rgba(255, 255, 255, 0.12);
}

.rail-fill {
  right: auto;
  width: var(--zoom-percent);
  background: linear-gradient(90deg, #38bdf8, #22c55e);
  box-shadow: 0 0 12px rgba(56, 189, 248, 0.5);
}

.rail-tick {
  position: relative;
  z-index: 1;
  justify-self: center;
  width: 2px;
  height: 10px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.22);
}

.zoom-controls {
  display: grid;
  grid-template-columns: 26px minmax(0, 1fr) 26px;
  align-items: center;
  gap: 9px;
}

.zoom-controls button {
  width: 26px;
  height: 24px;
  border: 1px solid rgba(125, 211, 252, 0.22);
  border-radius: 4px;
  background: rgba(15, 23, 42, 0.55);
  color: #bae6fd;
  cursor: pointer;
  font: 700 15px/1 'JetBrains Mono', 'Consolas', monospace;
  transition:
    border-color 0.16s,
    background 0.16s,
    color 0.16s;
}

.zoom-controls button:hover:not(:disabled) {
  border-color: rgba(56, 189, 248, 0.55);
  background: rgba(14, 165, 233, 0.16);
  color: #ffffff;
}

.zoom-controls button:disabled {
  cursor: default;
  opacity: 0.35;
}

.zoom-controls input {
  width: 100%;
  height: 18px;
  margin: 0;
  cursor: pointer;
  appearance: none;
  background: transparent;
}

.zoom-controls input::-webkit-slider-runnable-track {
  height: 3px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.14);
}

.zoom-controls input::-webkit-slider-thumb {
  width: 10px;
  height: 16px;
  margin-top: -6px;
  border: 1px solid rgba(216, 243, 255, 0.85);
  border-radius: 3px;
  appearance: none;
  background: #38bdf8;
  box-shadow: 0 0 10px rgba(56, 189, 248, 0.55);
}

.zoom-controls input::-moz-range-track {
  height: 3px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.14);
}

.zoom-controls input::-moz-range-thumb {
  width: 10px;
  height: 16px;
  border: 1px solid rgba(216, 243, 255, 0.85);
  border-radius: 3px;
  background: #38bdf8;
  box-shadow: 0 0 10px rgba(56, 189, 248, 0.55);
}

</style>
