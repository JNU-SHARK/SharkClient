<template>
  <div class="vehicle-attitude">
    <svg :width="size" :height="size" :viewBox="`0 0 ${size} ${size}`">
      <!-- 定义渐变色 -->
      <defs>
        <!-- 云台外环渐变 (霓虹蓝) -->
        <linearGradient id="gimbalGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color: #00f5ff; stop-opacity: 1" />
          <stop offset="100%" style="stop-color: #00a2ff; stop-opacity: 1" />
        </linearGradient>
        <!-- 底盘内环渐变 (霓虹绿) -->
        <linearGradient id="chassisGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color: #00ff9f; stop-opacity: 1" />
          <stop offset="100%" style="stop-color: #00d4aa; stop-opacity: 1" />
        </linearGradient>
        <!-- 中心圆渐变 (紫色) -->
        <radialGradient id="bodyGradient">
          <stop offset="0%" style="stop-color: #a78bfa; stop-opacity: 0.3" />
          <stop offset="100%" style="stop-color: #7c3aed; stop-opacity: 0.1" />
        </radialGradient>
      </defs>

      <!-- 外侧圆环 (云台朝向) - 一端开口 -->
      <path
        :d="getArcPath(centerX, centerY, outerRadius, gimbalYaw, arcAngle)"
        stroke="url(#gimbalGradient)"
        :stroke-width="ringWidth"
        fill="none"
        stroke-linecap="round"
        class="gimbal-ring"
      />

      <!-- 内侧圆环 (底盘朝向) - 一端开口，开口朝向表示底盘前方 -->
      <path
        :d="getArcPath(centerX, centerY, innerRadius, chassisYaw, arcAngle)"
        stroke="url(#chassisGradient)"
        :stroke-width="ringWidth"
        fill="none"
        stroke-linecap="round"
        class="chassis-ring"
      />

      <!-- 中心圆 (车身) -->
      <circle
        :cx="centerX"
        :cy="centerY"
        :r="bodyRadius"
        fill="url(#bodyGradient)"
        class="vehicle-body"
      />
      <circle
        :cx="centerX"
        :cy="centerY"
        :r="bodyRadius"
        :stroke="bodyColor"
        :stroke-width="2"
        fill="none"
        class="vehicle-body-outline"
      />

      <!-- 底盘朝向指示箭头 -->
      <line
        :x1="centerX"
        :y1="centerY"
        :x2="centerX + bodyRadius * Math.cos(toRadians(chassisYaw - 90))"
        :y2="centerY + bodyRadius * Math.sin(toRadians(chassisYaw - 90))"
        :stroke="chassisRingColor"
        :stroke-width="2"
        stroke-linecap="round"
        class="chassis-indicator"
      />

      <!-- 云台朝向指示箭头 -->
      <line
        :x1="centerX"
        :y1="centerY"
        :x2="centerX + (bodyRadius + 10) * Math.cos(toRadians(gimbalYaw - 90))"
        :y2="centerY + (bodyRadius + 10) * Math.sin(toRadians(gimbalYaw - 90))"
        :stroke="gimbalRingColor"
        :stroke-width="1.5"
        stroke-linecap="round"
        stroke-dasharray="2,2"
        class="gimbal-indicator"
      />
    </svg>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps({
  chassisYaw: {
    type: Number,
    default: 0 // 底盘朝向角度 (0-360)
  },
  gimbalYaw: {
    type: Number,
    default: 0 // 云台朝向角度 (0-360)
  },
  team: {
    type: String as () => 'red' | 'blue',
    default: 'red'
  },
  size: {
    type: Number,
    default: 150 // SVG 尺寸
  }
})

// 常量
const centerX = computed(() => props.size / 2)
const centerY = computed(() => props.size / 2)
const outerRadius = computed(() => props.size * 0.42) // 外圆环半径
const innerRadius = computed(() => props.size * 0.3) // 内圆环半径
const bodyRadius = computed(() => props.size * 0.15) // 车身圆半径
const ringWidth = computed(() => props.size * 0.06) // 圆环宽度
const arcAngle = 300 // 圆环弧度 (360 - 60 = 300度，留60度开口)

// 科技感配色
const gimbalRingColor = computed(() => '#00f5ff') // 霓虹蓝 - 云台外环
const chassisRingColor = computed(() => '#00ff9f') // 霓虹绿 - 底盘内环
const bodyColor = computed(() => '#a78bfa') // 紫色 - 中心车身

/**
 * 角度转弧度
 */
function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180
}

/**
 * 生成圆弧路径
 * @param cx 中心 X
 * @param cy 中心 Y
 * @param radius 半径
 * @param rotation 旋转角度 (开口朝向)
 * @param arcDegrees 弧度角度
 */
function getArcPath(
  cx: number,
  cy: number,
  radius: number,
  rotation: number,
  arcDegrees: number
): string {
  const startAngle = rotation - arcDegrees / 2
  const endAngle = rotation + arcDegrees / 2

  const startRad = toRadians(startAngle - 90) // -90 是为了从顶部开始
  const endRad = toRadians(endAngle - 90)

  const x1 = cx + radius * Math.cos(startRad)
  const y1 = cy + radius * Math.sin(startRad)
  const x2 = cx + radius * Math.cos(endRad)
  const y2 = cy + radius * Math.sin(endRad)

  const largeArcFlag = arcDegrees > 180 ? 1 : 0

  return `M ${x1} ${y1} A ${radius} ${radius} 0 ${largeArcFlag} 1 ${x2} ${y2}`
}
</script>

<style scoped>
.vehicle-attitude {
  display: flex;
  justify-content: center;
  align-items: center;
  width: 100%;
  height: 100%;
  user-select: none;
}

svg {
  filter: drop-shadow(0 0 3px rgba(0, 0, 0, 0.3));
}

/* 圆环动画 */
.gimbal-ring,
.chassis-ring {
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.vehicle-body {
  transition: all 0.2s ease;
}

.chassis-indicator,
.gimbal-indicator {
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}
</style>
