<template>
  <div class="weapon-status" :class="{ compact: compact }">
    <!-- 热量显示 -->
    <div class="weapon-stat heat-stat">
      <div class="stat-header">
        <span class="stat-label">热量</span>
        <span
          class="stat-value"
          :class="{ warning: heatPercent >= 60, critical: heatPercent >= 85 }"
        >
          {{ currentHeat }} / {{ maxHeat }}
        </span>
      </div>
      <div class="stat-bar heat-bar">
        <div
          class="stat-fill heat-fill"
          :class="{ warning: heatPercent >= 60, critical: heatPercent >= 85 }"
          :style="{ width: heatPercent + '%' }"
        ></div>
      </div>
    </div>

    <!-- 弹药显示 -->
    <div class="weapon-stat ammo-stat">
      <div class="stat-header">
        <span class="stat-label">弹药</span>
        <span
          class="stat-value"
          :class="{ warning: ammoPercent <= 30, critical: ammoPercent <= 10 }"
        >
          {{ remainingAmmo }}
        </span>
      </div>
      <div class="stat-bar ammo-bar">
        <div
          class="stat-fill ammo-fill"
          :class="{ warning: ammoPercent <= 30, critical: ammoPercent <= 10 }"
          :style="{ width: ammoPercent + '%' }"
        ></div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useMqttDataStore } from '@/store/modules/mqtt_data'
import { useDashboardStore } from '@/store'

const props = defineProps({
  /** 紧凑模式 */
  compact: {
    type: Boolean,
    default: false
  },
  /** 最大热量（不传则从 MQTT 数据获取） */
  maxHeatOverride: {
    type: Number,
    default: 0
  },
  /** 最大弹量（用于百分比计算） */
  maxAmmo: {
    type: Number,
    default: 500
  }
})

const mqttStore = useMqttDataStore()
const dashboardStore = useDashboardStore()

// 获取当前选中的机器人数据
const currentRobotData = computed(() => {
  const robotName = dashboardStore.selectedRobot
  if (!robotName) return null

  // 判断队伍
  const isRed = robotName.includes('红')
  const robotMap = isRed ? mqttStore.redRobots : mqttStore.blueRobots

  // 从机器人名称提取ID（如 "红1" -> 1）
  const match = robotName.match(/\d+/)
  if (match) {
    const robotId = parseInt(match[0])
    return robotMap.get(robotId)
  }
  return null
})

// 当前热量
const currentHeat = computed(() => {
  return currentRobotData.value?.currentHeat ?? 0
})

// 最大热量
const maxHeat = computed(() => {
  if (props.maxHeatOverride > 0) return props.maxHeatOverride
  return currentRobotData.value?.maxHeat ?? 240
})

// 热量百分比
const heatPercent = computed(() => {
  if (maxHeat.value === 0) return 0
  return Math.min(100, Math.round((currentHeat.value / maxHeat.value) * 100))
})

// 剩余弹量
const remainingAmmo = computed(() => {
  return currentRobotData.value?.remainingAmmo ?? dashboardStore.remainingAmmo ?? 0
})

// 弹量百分比
const ammoPercent = computed(() => {
  if (props.maxAmmo === 0) return 0
  return Math.min(100, Math.round((remainingAmmo.value / props.maxAmmo) * 100))
})
</script>

<style scoped>
.weapon-status {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
  width: 100%;
  height: 100%;
}

.weapon-status.compact {
  gap: 8px;
  padding: 8px;
}

.weapon-stat {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

/* 标题行：标签 + 数值 */
.stat-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

/* 文字标签样式 */
.stat-label {
  font-size: 12px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.7);
  letter-spacing: 0.5px;
}

.heat-stat .stat-label {
  color: #f59e0b;
}

.ammo-stat .stat-label {
  color: #3b82f6;
}

.stat-value {
  font-size: 12px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.8);
  font-family: 'Consolas', 'Monaco', monospace;
}

.stat-value.warning {
  color: #fbbf24;
}

.stat-value.critical {
  color: #f87171;
}

.stat-bar {
  height: 8px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 4px;
  overflow: hidden;
  transform: skewX(-15deg);
}

.stat-fill {
  height: 100%;
  transition: width 0.3s ease;
  border-radius: 4px;
}

/* 热量条颜色 */
.heat-fill {
  background: linear-gradient(90deg, #22c55e, #4ade80);
  box-shadow: 0 0 8px rgba(34, 197, 94, 0.4);
}

.heat-fill.warning {
  background: linear-gradient(90deg, #f59e0b, #fbbf24);
  box-shadow: 0 0 8px rgba(245, 158, 11, 0.5);
}

.heat-fill.critical {
  background: linear-gradient(90deg, #ef4444, #f87171);
  box-shadow: 0 0 10px rgba(239, 68, 68, 0.6);
  animation: heat-pulse 0.5s ease-in-out infinite alternate;
}

/* 弹药条颜色 */
.ammo-fill {
  background: linear-gradient(90deg, #3b82f6, #60a5fa);
  box-shadow: 0 0 8px rgba(59, 130, 246, 0.4);
}

.ammo-fill.warning {
  background: linear-gradient(90deg, #f59e0b, #fbbf24);
  box-shadow: 0 0 8px rgba(245, 158, 11, 0.5);
}

.ammo-fill.critical {
  background: linear-gradient(90deg, #ef4444, #f87171);
  box-shadow: 0 0 10px rgba(239, 68, 68, 0.6);
  animation: ammo-pulse 1s ease-in-out infinite;
}

@keyframes heat-pulse {
  from {
    box-shadow: 0 0 10px rgba(239, 68, 68, 0.6);
  }
  to {
    box-shadow: 0 0 16px rgba(239, 68, 68, 0.9);
  }
}

@keyframes ammo-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.7;
  }
}

/* 紧凑模式 */
.weapon-status.compact .stat-label {
  font-size: 10px;
}

.weapon-status.compact .stat-value {
  font-size: 10px;
}

.weapon-status.compact .stat-bar {
  height: 6px;
}
</style>
