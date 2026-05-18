<template>
  <div ref="containerRef" class="pitch-indicator">
    <svg
      :width="actualWidth"
      :height="actualHeight"
      :viewBox="`0 0 ${actualWidth} ${actualHeight}`"
    >
      <defs>
        <!-- 中心线渐变 -->
        <linearGradient id="centerLineGradient" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" style="stop-color: rgba(0, 255, 159, 0)" />
          <stop offset="20%" style="stop-color: rgba(0, 255, 159, 1)" />
          <stop offset="80%" style="stop-color: rgba(0, 255, 159, 1)" />
          <stop offset="100%" style="stop-color: rgba(0, 255, 159, 0)" />
        </linearGradient>
        <!-- 裁剪区域 -->
        <clipPath id="pitchClip">
          <rect x="0" y="0" :width="actualWidth" :height="actualHeight" rx="8" ry="8" />
        </clipPath>
      </defs>

      <!-- 标线容器（带裁剪） -->
      <g clip-path="url(#pitchClip)">
        <!-- 刻度线组 - 根据俯仰角偏移 -->
        <g :transform="`translate(0, ${pitchOffset})`">
          <!-- 主刻度线（每10度） -->
          <template v-for="deg in majorDegrees" :key="`major-${deg}`">
            <g :transform="`translate(0, ${degToY(deg)})`">
              <!-- 刻度线 -->
              <line
                :x1="centerX - majorLineWidth / 2"
                y1="0"
                :x2="centerX + majorLineWidth / 2"
                y2="0"
                :stroke="getLineColor(deg)"
                :stroke-width="deg === 0 ? 2.5 : 1.5"
                stroke-linecap="round"
              />
              <!-- 角度数字（左侧） -->
              <text
                :x="centerX - majorLineWidth / 2 - 8"
                y="0"
                text-anchor="end"
                dominant-baseline="middle"
                :fill="getLineColor(deg)"
                :font-size="deg === 0 ? 12 : 10"
                font-family="monospace"
                class="degree-text"
              >
                {{ deg > 0 ? '+' : '' }}{{ deg }}°
              </text>
              <!-- 角度数字（右侧） -->
              <text
                :x="centerX + majorLineWidth / 2 + 8"
                y="0"
                text-anchor="start"
                dominant-baseline="middle"
                :fill="getLineColor(deg)"
                :font-size="deg === 0 ? 12 : 10"
                font-family="monospace"
                class="degree-text"
              >
                {{ deg > 0 ? '+' : '' }}{{ deg }}°
              </text>
            </g>
          </template>

          <!-- 次刻度线（每5度，排除主刻度） -->
          <template v-for="deg in minorDegrees" :key="`minor-${deg}`">
            <line
              :x1="centerX - minorLineWidth / 2"
              :y1="degToY(deg)"
              :x2="centerX + minorLineWidth / 2"
              :y2="degToY(deg)"
              :stroke="getLineColor(deg)"
              stroke-width="1"
              stroke-linecap="round"
              opacity="0.4"
            />
          </template>

          <!-- 上限/下限指示 -->
          <g v-if="showLimits">
            <!-- 上限线 -->
            <line
              :x1="centerX - limitLineWidth / 2"
              :y1="degToY(maxPitch)"
              :x2="centerX + limitLineWidth / 2"
              :y2="degToY(maxPitch)"
              stroke="#ef4444"
              stroke-width="2"
              stroke-dasharray="4,2"
            />
            <text
              :x="centerX + limitLineWidth / 2 + 20"
              :y="degToY(maxPitch)"
              text-anchor="start"
              dominant-baseline="middle"
              fill="#ef4444"
              font-size="9"
              font-family="monospace"
            >
              MAX
            </text>
            <!-- 下限线 -->
            <line
              :x1="centerX - limitLineWidth / 2"
              :y1="degToY(minPitch)"
              :x2="centerX + limitLineWidth / 2"
              :y2="degToY(minPitch)"
              stroke="#ef4444"
              stroke-width="2"
              stroke-dasharray="4,2"
            />
            <text
              :x="centerX + limitLineWidth / 2 + 20"
              :y="degToY(minPitch)"
              text-anchor="start"
              dominant-baseline="middle"
              fill="#ef4444"
              font-size="9"
              font-family="monospace"
            >
              MIN
            </text>
          </g>
        </g>
      </g>

      <!-- 固定的中心指示器（飞机符号） - 白色高亮 -->
      <g :transform="`translate(${centerX}, ${centerY})`">
        <!-- 左翼 -->
        <line
          :x1="-aircraftWingSpan"
          y1="0"
          :x2="-aircraftBodyWidth"
          y2="0"
          stroke="rgba(255, 255, 255, 0.95)"
          stroke-width="3"
          stroke-linecap="round"
        />
        <!-- 右翼 -->
        <line
          :x1="aircraftBodyWidth"
          y1="0"
          :x2="aircraftWingSpan"
          y2="0"
          stroke="rgba(255, 255, 255, 0.95)"
          stroke-width="3"
          stroke-linecap="round"
        />
        <!-- 中心圆点 -->
        <circle cx="0" cy="0" r="4" fill="rgba(255, 255, 255, 0.95)" />
        <!-- 机头指示 -->
        <line x1="0" :y1="-8" x2="0" :y2="-2" stroke="rgba(255, 255, 255, 0.95)" stroke-width="2" />
      </g>

      <!-- 当前角度数字显示 -->
      <g :transform="`translate(${centerX}, ${actualHeight - 18})`">
        <rect
          :x="-35"
          y="-10"
          width="70"
          height="20"
          rx="4"
          fill="rgba(0, 0, 0, 0.6)"
          stroke="rgba(255, 255, 255, 0.7)"
          stroke-width="1"
        />
        <text
          x="0"
          y="0"
          text-anchor="middle"
          dominant-baseline="middle"
          fill="rgba(255, 255, 255, 0.95)"
          font-size="12"
          font-family="monospace"
          font-weight="bold"
        >
          {{ formattedPitch }}
        </text>
      </g>
    </svg>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue'

const props = defineProps({
  /** 当前俯仰角（度）- 正值为抬头，负值为低头 */
  pitch: {
    type: Number,
    default: 0
  },
  /** 组件宽度（可选，不传则自适应容器） */
  width: {
    type: Number,
    default: 0
  },
  /** 组件高度（可选，不传则自适应容器） */
  height: {
    type: Number,
    default: 0
  },
  /** 最大俯仰角（上限） */
  maxPitch: {
    type: Number,
    default: 30
  },
  /** 最小俯仰角（下限） */
  minPitch: {
    type: Number,
    default: -30
  },
  /** 是否显示上下限指示 */
  showLimits: {
    type: Boolean,
    default: true
  },
  /** 每度像素数（可选，不传则自动计算） */
  pixelsPerDegree: {
    type: Number,
    default: 0
  }
})

// 容器引用
const containerRef = ref<HTMLElement | null>(null)

// 容器尺寸
const containerSize = ref({ width: 120, height: 200 })

// 实际使用的尺寸（优先使用 props，否则使用容器尺寸）
const actualWidth = computed(() => (props.width > 0 ? props.width : containerSize.value.width))
const actualHeight = computed(() => (props.height > 0 ? props.height : containerSize.value.height))

// 自动计算每度像素数（基于高度）
const actualPixelsPerDegree = computed(() => {
  if (props.pixelsPerDegree > 0) return props.pixelsPerDegree
  // 根据高度自动计算，使可见范围约为 ±30 度
  return actualHeight.value / 100
})

// 监听容器尺寸变化
let resizeObserver: ResizeObserver | null = null

onMounted(() => {
  if (containerRef.value) {
    // 初始化尺寸
    updateContainerSize()

    // 创建 ResizeObserver 监听尺寸变化
    resizeObserver = new ResizeObserver(() => {
      updateContainerSize()
    })
    resizeObserver.observe(containerRef.value)
  }
})

onUnmounted(() => {
  if (resizeObserver) {
    resizeObserver.disconnect()
    resizeObserver = null
  }
})

function updateContainerSize(): void {
  if (containerRef.value) {
    const rect = containerRef.value.getBoundingClientRect()
    containerSize.value = {
      width: Math.max(80, rect.width),
      height: Math.max(120, rect.height)
    }
  }
}

// 中心坐标
const centerX = computed(() => actualWidth.value / 2)
const centerY = computed(() => actualHeight.value / 2)

// 线条宽度
const majorLineWidth = computed(() => actualWidth.value * 0.4)
const minorLineWidth = computed(() => actualWidth.value * 0.2)
const limitLineWidth = computed(() => actualWidth.value * 0.5)

// 飞机符号尺寸
const aircraftWingSpan = computed(() => actualWidth.value * 0.35)
const aircraftBodyWidth = computed(() => Math.max(6, actualWidth.value * 0.05))

// 俯仰角偏移量（像素）
const pitchOffset = computed(() => props.pitch * actualPixelsPerDegree.value)

// 生成主刻度线的角度数组（每10度，扩大间隔避免拥挤）
const majorDegrees = computed(() => {
  const degrees: number[] = []
  // 扩展范围以确保滚动时有足够的刻度线
  const range = Math.max(Math.abs(props.maxPitch), Math.abs(props.minPitch)) + 45
  for (let d = -range; d <= range; d += 10) {
    degrees.push(d)
  }
  return degrees
})

// 生成次刻度线的角度数组（每5度，排除主刻度线）
const minorDegrees = computed(() => {
  const degrees: number[] = []
  const range = Math.max(Math.abs(props.maxPitch), Math.abs(props.minPitch)) + 45
  for (let d = -range; d <= range; d += 5) {
    if (d % 10 !== 0) {
      degrees.push(d)
    }
  }
  return degrees
})

// 角度转Y坐标（相对于中心）
const degToY = (deg: number): number => {
  // 正角度（抬头）在上方，负角度（低头）在下方
  return -deg * actualPixelsPerDegree.value + centerY.value
}

// 获取刻度线颜色（改为白色半透明，增强可读性）
const getLineColor = (deg: number): string => {
  if (deg === 0) return 'rgba(255, 255, 255, 0.95)' // 水平线 - 白色高亮
  if (deg > 0) return 'rgba(255, 255, 255, 0.6)' // 正角度 - 白色半透明（天空）
  return 'rgba(255, 255, 255, 0.5)' // 负角度 - 白色更透明（地面）
}

// 格式化显示的俯仰角
const formattedPitch = computed(() => {
  const sign = props.pitch >= 0 ? '+' : ''
  return `${sign}${props.pitch.toFixed(1)}°`
})
</script>

<style scoped>
.pitch-indicator {
  display: flex;
  justify-content: center;
  align-items: center;
  user-select: none;
  width: 100%;
  height: 100%;
}

svg {
  filter: drop-shadow(0 0 3px rgba(0, 0, 0, 0.3));
}

.degree-text {
  text-shadow: 0 0 4px rgba(0, 0, 0, 0.8);
}
</style>
