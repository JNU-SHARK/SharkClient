<template>
  <div class="power-display-wrapper">
    <!-- 功率条 -->
    <div v-if="maxPower > 0" class="energy-row power-row">
      <div class="energy-label">功率</div>
      <div class="energy-bar-container power-bar">
        <div class="energy-track">
          <div
            class="energy-fill power-fill"
            :style="{ width: powerPercent + '%' }"
            :class="{ warning: powerPercent > 90 }"
          ></div>
        </div>
      </div>
      <div class="energy-text">{{ currentPower.toFixed(0) }} W</div>
    </div>

    <!-- 双能量条：缓冲 + 底盘 -->
    <div class="dual-energy-row">
      <!-- 缓冲能量 -->
      <div v-if="maxBufferEnergy > 0" class="mini-energy-item">
        <div class="mini-label">缓冲</div>
        <div class="mini-bar-container">
          <div class="energy-track">
            <div
              class="energy-fill buffer-fill"
              :style="{ width: bufferPercent + '%' }"
              :class="{ warning: bufferPercent < 20 }"
            ></div>
          </div>
        </div>
        <div class="mini-text">{{ currentBufferEnergy.toFixed(0) }}J</div>
      </div>

      <!-- 底盘能量 -->
      <div v-if="maxChassisEnergy > 0" class="mini-energy-item">
        <div class="mini-label">底盘</div>
        <div class="mini-bar-container">
          <div class="energy-track">
            <div class="energy-fill chassis-fill" :style="{ width: chassisPercent + '%' }"></div>
          </div>
        </div>
        <div class="mini-text">{{ currentChassisEnergy.toFixed(0) }}J</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

interface Props {
  currentPower?: number
  maxPower?: number
  currentBufferEnergy?: number
  maxBufferEnergy?: number
  currentChassisEnergy?: number
  maxChassisEnergy?: number
}

const props = withDefaults(defineProps<Props>(), {
  currentPower: 0,
  maxPower: 120,
  currentBufferEnergy: 0,
  maxBufferEnergy: 60,
  currentChassisEnergy: 0,
  maxChassisEnergy: 200
})

const powerPercent = computed(() => {
  if (props.maxPower === 0) return 0
  return Math.min(100, Math.round((props.currentPower / props.maxPower) * 100))
})

const bufferPercent = computed(() => {
  if (props.maxBufferEnergy === 0) return 0
  return Math.min(100, Math.round((props.currentBufferEnergy / props.maxBufferEnergy) * 100))
})

const chassisPercent = computed(() => {
  if (props.maxChassisEnergy === 0) return 0
  return Math.min(100, Math.round((props.currentChassisEnergy / props.maxChassisEnergy) * 100))
})

const currentBufferEnergy = computed(() => props.currentBufferEnergy)
const currentChassisEnergy = computed(() => props.currentChassisEnergy)
const currentPower = computed(() => props.currentPower)
</script>

<style scoped>
.power-display-wrapper {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

/* 功率条行 */
.energy-row {
  display: flex;
  align-items: center;
  width: 100%;
  gap: 6px;
}

.energy-label {
  flex-shrink: 0;
  font-size: 10px;
  color: rgba(255, 255, 255, 0.6);
  width: 24px;
  text-align: right;
}

.energy-bar-container {
  position: relative;
  flex: 1;
  height: 8px;
  transform: skewX(-15deg);
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  min-width: 0;
}

.energy-track {
  width: 100%;
  height: 100%;
  background: transparent;
}

.energy-fill {
  height: 100%;
  transition: width 0.1s linear;
  position: relative;
}

/* 功率 - 黄色 */
.power-fill {
  background: linear-gradient(180deg, #fbbf24 0%, #d97706 100%);
}

.power-fill::after {
  content: '';
  position: absolute;
  right: 0;
  top: 0;
  bottom: 0;
  width: 1px;
  background: #fcd34d;
  box-shadow: 0 0 6px #f59e0b;
}

.power-fill.warning {
  background: linear-gradient(180deg, #ef4444 0%, #991b1b 100%);
}

.power-fill.warning::after {
  background: #f87171;
  box-shadow: 0 0 6px #ef4444;
}

.energy-text {
  flex-shrink: 0;
  font-family: 'Orbitron', 'Arial', sans-serif;
  font-weight: 600;
  font-size: 11px;
  color: #e2e8f0;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
  white-space: nowrap;
  min-width: 45px;
  text-align: right;
}

/* 双能量条行 */
.dual-energy-row {
  display: flex;
  gap: 8px;
  width: 100%;
}

.mini-energy-item {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 4px;
}

.mini-label {
  flex-shrink: 0;
  font-size: 9px;
  color: rgba(255, 255, 255, 0.5);
  width: 20px;
  text-align: right;
}

.mini-bar-container {
  flex: 1;
  height: 6px;
  transform: skewX(-15deg);
  background: rgba(0, 0, 0, 0.7);
  min-width: 0;
}

.mini-text {
  flex-shrink: 0;
  font-family: 'Orbitron', 'Arial', sans-serif;
  font-weight: 500;
  font-size: 9px;
  color: #94a3b8;
  white-space: nowrap;
  min-width: 28px;
  text-align: right;
}

/* 缓冲能量 - 绿色 */
.buffer-fill {
  background: linear-gradient(180deg, #a3e635 0%, #65a30d 100%);
}

.buffer-fill::after {
  content: '';
  position: absolute;
  right: 0;
  top: 0;
  bottom: 0;
  width: 1px;
  background: #bef264;
  box-shadow: 0 0 6px #84cc16;
}

.buffer-fill.warning {
  background: linear-gradient(180deg, #ef4444 0%, #991b1b 100%);
}

.buffer-fill.warning::after {
  background: #f87171;
  box-shadow: 0 0 6px #ef4444;
}

/* 底盘能量 - 青色 */
.chassis-fill {
  background: linear-gradient(180deg, #22d3ee 0%, #0891b2 100%);
}

.chassis-fill::after {
  content: '';
  position: absolute;
  right: 0;
  top: 0;
  bottom: 0;
  width: 1px;
  background: #67e8f9;
  box-shadow: 0 0 6px #22d3ee;
}
</style>
