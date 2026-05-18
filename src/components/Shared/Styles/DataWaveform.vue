<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'

const props = defineProps({
  value: { type: Number, default: 0 },
  value2: { type: Number, default: null }, // 第二通道
  value3: { type: Number, default: null }, // 第三通道
  min: { type: Number, default: 0 },
  max: { type: Number, default: 100 },
  max2: { type: Number, default: null }, // 第二通道最大值
  max3: { type: Number, default: null }, // 第三通道最大值
  autoScale: { type: Boolean, default: false },
  historyLength: { type: Number, default: 60 },
  updateInterval: { type: Number, default: 50 }, // 更新间隔 (ms)
  color: { type: String, default: '#3b82f6' },
  color2: { type: String, default: '#10b981' }, // 第二通道颜色 (Green)
  color3: { type: String, default: '#f59e0b' }, // 第三通道颜色 (Orange)
  strokeWidth: { type: Number, default: 2 },
  label: { type: String, default: '' },
  label2: { type: String, default: '' },
  label3: { type: String, default: '' },
  unit: { type: String, default: '' },
  showValue: { type: Boolean, default: true },
  fillArea: { type: Boolean, default: true }
})

// 历史数据队列
const history1 = ref<number[]>([])
const history2 = ref<number[]>([])
const history3 = ref<number[]>([])
let timer: ReturnType<typeof setInterval> | null = null

// 初始化
onMounted(() => {
  history1.value = Array(props.historyLength).fill(props.min)
  history2.value = Array(props.historyLength).fill(props.min)
  history3.value = Array(props.historyLength).fill(props.min)

  // 启动定时更新，实现波形随时间移动的效果
  timer = setInterval(() => {
    updateHistory(history1.value, props.value, props.historyLength)
    updateHistory(history2.value, props.value2, props.historyLength)
    updateHistory(history3.value, props.value3, props.historyLength)
  }, props.updateInterval)
})

onUnmounted(() => {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
})

// 通用更新历史函数
const updateHistory = (queue: number[], val: number | null | undefined, len: number): void => {
  if (val === null || val === undefined) {
    // 如果没有值，重复上一个值或者填 min
    const lastVal = queue.length > 0 ? queue[queue.length - 1] : props.min
    queue.push(lastVal)
  } else {
    queue.push(val)
  }
  if (queue.length > len) {
    queue.shift()
  }
}

// 监听历史长度变化
watch(
  () => props.historyLength,
  (newLen) => {
    const adjustQueue = (queue: number[]): void => {
      if (queue.length > newLen) {
        queue.splice(0, queue.length - newLen)
      } else {
        const fillVal = queue.length > 0 ? queue[0] : props.min
        while (queue.length < newLen) {
          queue.unshift(fillVal)
        }
      }
    }
    adjustQueue(history1.value)
    adjustQueue(history2.value)
    adjustQueue(history3.value)
  }
)

// 判断通道是否激活 (只要接收到非 null 值或者有 label 配置)
const isCh2Active = computed(() => props.value2 !== null || props.label2)
const isCh3Active = computed(() => props.value3 !== null || props.label3)

// 计算各通道的范围
const getRange = (
  queue: number[],
  manualMax: number | null | undefined
): { min: number; max: number } => {
  if (props.autoScale) {
    if (queue.length === 0) return { min: 0, max: 100 }
    const minVal = Math.min(...queue)
    const maxVal = Math.max(...queue)
    const padding = Math.abs(maxVal - minVal) * 0.1
    return {
      min: minVal - padding,
      max: maxVal + padding
    }
  }

  // 固定范围
  // 如果没有指定 manualMax，则回退到 props.max
  const effectiveMax = manualMax !== null && manualMax !== undefined ? manualMax : props.max
  return {
    min: props.min,
    max: effectiveMax
  }
}

const range1 = computed(() => getRange(history1.value, props.max))
const range2 = computed(() => getRange(history2.value, props.max2))
const range3 = computed(() => getRange(history3.value, props.max3))

// 生成 SVG 路径通用函数
const generatePath = (queue: number[], min: number, max: number): string => {
  if (queue.length < 2) return ''
  const width = 100
  const height = 100
  const range = max - min || 1

  const points = queue.map((val, index) => {
    const x = (index / (props.historyLength - 1)) * width
    const clampedVal = Math.max(min, Math.min(max, val))
    const normalizedVal = (clampedVal - min) / range
    const y = height - normalizedVal * height
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })
  return `M ${points.join(' L ')}`
}

const path1 = computed(() => generatePath(history1.value, range1.value.min, range1.value.max))
const path2 = computed(() => generatePath(history2.value, range2.value.min, range2.value.max))
const path3 = computed(() => generatePath(history3.value, range3.value.min, range3.value.max))

// 填充区域 (仅主通道支持填充，避免混乱，或者都支持但透明度低)
const areaPath1 = computed(() => {
  if (!props.fillArea || history1.value.length < 2) return ''
  return `${path1.value} L 100,100 L 0,100 Z`
})
</script>

<template>
  <div class="data-waveform-widget">
    <div class="header">
      <!-- 通道 1 信息 -->
      <div class="channel-info">
        <span v-if="label" class="label" :style="{ color }">{{ label }}</span>
        <div v-if="showValue" class="value-container">
          <span class="value" :style="{ color }">
            {{ typeof value === 'number' ? value.toFixed(1) : value }}
          </span>
          <span v-if="unit" class="unit">{{ unit }}</span>
        </div>
      </div>

      <!-- 通道 2 信息 -->
      <div v-if="isCh2Active" class="channel-info">
        <span v-if="label2" class="label" :style="{ color: color2 }">{{ label2 }}</span>
        <div v-if="showValue && value2 !== null" class="value-container">
          <span class="value" :style="{ color: color2 }">
            {{ typeof value2 === 'number' ? value2.toFixed(1) : value2 }}
          </span>
        </div>
      </div>

      <!-- 通道 3 信息 -->
      <div v-if="isCh3Active" class="channel-info">
        <span v-if="label3" class="label" :style="{ color: color3 }">{{ label3 }}</span>
        <div v-if="showValue && value3 !== null" class="value-container">
          <span class="value" :style="{ color: color3 }">
            {{ typeof value3 === 'number' ? value3.toFixed(1) : value3 }}
          </span>
        </div>
      </div>
    </div>

    <div class="chart-container">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none">
        <!-- 背景网格 -->
        <line x1="0" y1="25" x2="100" y2="25" stroke="rgba(255,255,255,0.1)" stroke-width="0.5" />
        <line x1="0" y1="50" x2="100" y2="50" stroke="rgba(255,255,255,0.1)" stroke-width="0.5" />
        <line x1="0" y1="75" x2="100" y2="75" stroke="rgba(255,255,255,0.1)" stroke-width="0.5" />

        <!-- 通道 1 填充 -->
        <path v-if="fillArea" :d="areaPath1" :fill="color" opacity="0.1" />

        <!-- 通道 3 折线 -->
        <path
          v-if="isCh3Active"
          :d="path3"
          fill="none"
          :stroke="color3"
          :stroke-width="strokeWidth"
          stroke-linejoin="round"
          stroke-linecap="round"
          vector-effect="non-scaling-stroke"
        />

        <!-- 通道 2 折线 -->
        <path
          v-if="isCh2Active"
          :d="path2"
          fill="none"
          :stroke="color2"
          :stroke-width="strokeWidth"
          stroke-linejoin="round"
          stroke-linecap="round"
          vector-effect="non-scaling-stroke"
        />

        <!-- 通道 1 折线 (最上层) -->
        <path
          :d="path1"
          fill="none"
          :stroke="color"
          :stroke-width="strokeWidth"
          stroke-linejoin="round"
          stroke-linecap="round"
          vector-effect="non-scaling-stroke"
        />
      </svg>

      <!-- 极值指示 (仅显示通道1的范围，或者如果需要可以显示更多) -->
      <div class="axis-label max">{{ range1.max.toFixed(0) }}</div>
      <div class="axis-label min">{{ range1.min.toFixed(0) }}</div>
    </div>
  </div>
</template>

<style scoped>
.data-waveform-widget {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  font-family: 'JetBrains Mono', monospace;
  overflow: hidden;
}

.header {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  margin-bottom: 4px;
  padding: 0 4px;
}

.channel-info {
  display: flex;
  align-items: center;
  gap: 6px;
}

.label {
  font-size: 12px;
  font-weight: 600;
}

.value-container {
  display: flex;
  align-items: baseline;
  gap: 2px;
}

.value {
  font-size: 14px;
  font-weight: bold;
}

.unit {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.5);
}

.chart-container {
  flex: 1;
  position: relative;
  width: 100%;
  min-height: 0;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 4px;
  border: 1px solid rgba(255, 255, 255, 0.05);
}

svg {
  width: 100%;
  height: 100%;
  display: block;
}

.axis-label {
  position: absolute;
  right: 4px;
  font-size: 9px;
  color: rgba(255, 255, 255, 0.3);
  pointer-events: none;
}

.axis-label.max {
  top: 2px;
}

.axis-label.min {
  bottom: 2px;
}
</style>
