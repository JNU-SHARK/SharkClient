<template>
  <div ref="containerRef" class="mini-map-container" :style="{ opacity: props.opacity }">
    <canvas ref="canvasRef" class="mini-map-canvas"></canvas>

    <!-- 机器人图例 -->
    <div v-if="props.showLegend" class="map-legend">
      <div class="legend-item">
        <span class="legend-dot red"></span>
        <span class="legend-text">红方</span>
      </div>
      <div class="legend-item">
        <span class="legend-dot blue"></span>
        <span class="legend-text">蓝方</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { useMqttDataStore } from '../../store/modules/mqtt_data'

interface Props {
  /** 地图图片路径 */
  mapImageSrc?: string
  /** 是否显示网格 */
  showGrid?: boolean
  /** 是否显示图例 */
  showLegend?: boolean
  /** 整体透明度 */
  opacity?: number
}

const props = withDefaults(defineProps<Props>(), {
  mapImageSrc: '/Map.png',
  showGrid: false,
  showLegend: true,
  opacity: 1
})

const mqttStore = useMqttDataStore()
const containerRef = ref<HTMLDivElement | null>(null)
const canvasRef = ref<HTMLCanvasElement | null>(null)
let ctx: CanvasRenderingContext2D | null = null
let animationFrameId: number | null = null
let resizeObserver: ResizeObserver | null = null

// 地图图片
const mapImage = ref<HTMLImageElement | null>(null)

// 场地尺寸（米）- RMUC 2025 标准场地
const FIELD_WIDTH = 28 // 场地长度
const FIELD_HEIGHT = 15 // 场地宽度

// 初始化 Canvas
const initCanvas = (): void => {
  if (!canvasRef.value || !containerRef.value) return

  ctx = canvasRef.value.getContext('2d')
  if (!ctx) return

  resizeCanvas()
}

// 调整 Canvas 尺寸
const resizeCanvas = (): void => {
  if (!canvasRef.value || !containerRef.value || !ctx) return

  const { width, height } = containerRef.value.getBoundingClientRect()
  const dpr = window.devicePixelRatio || 1

  canvasRef.value.width = width * dpr
  canvasRef.value.height = height * dpr
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
}

// 加载地图图片
const loadMapImage = (): void => {
  const img = new Image()
  img.onload = (): void => {
    mapImage.value = img
  }
  img.onerror = (): void => {
    console.warn('[MiniMap] 地图图片加载失败:', props.mapImageSrc)
    mapImage.value = null
  }
  img.src = props.mapImageSrc
}

// 将实际坐标转换为 Canvas 坐标
const worldToCanvas = (
  worldX: number,
  worldY: number,
  canvasWidth: number,
  canvasHeight: number
): { x: number; y: number } => {
  // 假设场地原点在中心，x 范围 [-14, 14]，y 范围 [-7.5, 7.5]
  const x = ((worldX + FIELD_WIDTH / 2) / FIELD_WIDTH) * canvasWidth
  const y = ((FIELD_HEIGHT / 2 - worldY) / FIELD_HEIGHT) * canvasHeight // Y 轴翻转
  return { x, y }
}

// 绘制函数
const draw = (): void => {
  if (!ctx || !canvasRef.value) {
    animationFrameId = requestAnimationFrame(draw)
    return
  }

  const { width, height } = canvasRef.value.getBoundingClientRect()

  // 清空画布
  ctx.clearRect(0, 0, width, height)

  // 绘制背景
  if (mapImage.value) {
    ctx.drawImage(mapImage.value, 0, 0, width, height)
  } else {
    // 默认深色背景
    ctx.fillStyle = 'rgba(0, 10, 30, 0.9)'
    ctx.fillRect(0, 0, width, height)
  }

  // 绘制网格
  if (props.showGrid) {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)'
    ctx.lineWidth = 1

    const gridCount = 8
    for (let i = 1; i < gridCount; i++) {
      // 垂直线
      ctx.beginPath()
      ctx.moveTo((i / gridCount) * width, 0)
      ctx.lineTo((i / gridCount) * width, height)
      ctx.stroke()

      // 水平线
      ctx.beginPath()
      ctx.moveTo(0, (i / gridCount) * height)
      ctx.lineTo(width, (i / gridCount) * height)
      ctx.stroke()
    }
  }

  // 绘制场地边界
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)'
  ctx.lineWidth = 2
  ctx.strokeRect(2, 2, width - 4, height - 4)

  // 绘制中线
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(width / 2, 0)
  ctx.lineTo(width / 2, height)
  ctx.stroke()

  // 绘制机器人
  drawRobots(width, height)

  animationFrameId = requestAnimationFrame(draw)
}

// 绘制机器人
const drawRobots = (canvasWidth: number, canvasHeight: number): void => {
  if (!ctx) return

  const robotSize = Math.min(canvasWidth, canvasHeight) * 0.04 // 机器人点的大小

  // 绘制红方机器人
  mqttStore.redRobots.forEach((robot) => {
    if (!robot.isAlive && robot.currentHealth <= 0) return

    const { x, y } = worldToCanvas(robot.x, robot.y, canvasWidth, canvasHeight)

    // 机器人圆点
    ctx!.beginPath()
    ctx!.arc(x, y, robotSize, 0, Math.PI * 2)
    ctx!.fillStyle = 'rgba(239, 68, 68, 0.9)' // 红色
    ctx!.fill()

    // 外圈发光
    ctx!.beginPath()
    ctx!.arc(x, y, robotSize + 2, 0, Math.PI * 2)
    ctx!.strokeStyle = 'rgba(239, 68, 68, 0.5)'
    ctx!.lineWidth = 2
    ctx!.stroke()

    // 机器人编号
    ctx!.fillStyle = '#fff'
    ctx!.font = `bold ${robotSize}px Arial`
    ctx!.textAlign = 'center'
    ctx!.textBaseline = 'middle'
    ctx!.fillText(String(robot.robotId % 100), x, y)
  })

  // 绘制蓝方机器人
  mqttStore.blueRobots.forEach((robot) => {
    if (!robot.isAlive && robot.currentHealth <= 0) return

    const { x, y } = worldToCanvas(robot.x, robot.y, canvasWidth, canvasHeight)

    // 机器人圆点
    ctx!.beginPath()
    ctx!.arc(x, y, robotSize, 0, Math.PI * 2)
    ctx!.fillStyle = 'rgba(59, 130, 246, 0.9)' // 蓝色
    ctx!.fill()

    // 外圈发光
    ctx!.beginPath()
    ctx!.arc(x, y, robotSize + 2, 0, Math.PI * 2)
    ctx!.strokeStyle = 'rgba(59, 130, 246, 0.5)'
    ctx!.lineWidth = 2
    ctx!.stroke()

    // 机器人编号
    ctx!.fillStyle = '#fff'
    ctx!.font = `bold ${robotSize}px Arial`
    ctx!.textAlign = 'center'
    ctx!.textBaseline = 'middle'
    ctx!.fillText(String(robot.robotId % 100), x, y)
  })
}

// 生命周期
onMounted(async () => {
  await nextTick()
  initCanvas()
  loadMapImage()

  // 监听容器尺寸变化
  if (containerRef.value) {
    resizeObserver = new ResizeObserver(() => {
      resizeCanvas()
    })
    resizeObserver.observe(containerRef.value)
  }

  // 开始绘制循环
  animationFrameId = requestAnimationFrame(draw)
})

onUnmounted(() => {
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId)
  }
  if (resizeObserver) {
    resizeObserver.disconnect()
  }
})

// 监听地图图片变化
watch(() => props.mapImageSrc, loadMapImage)
</script>

<style scoped>
.mini-map-container {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 120px;
  background: rgba(0, 0, 0, 0.6);
  border-radius: 4px;
  overflow: hidden;
}

.mini-map-canvas {
  width: 100%;
  height: 100%;
  display: block;
}

.map-legend {
  position: absolute;
  bottom: 4px;
  right: 4px;
  display: flex;
  gap: 8px;
  padding: 2px 6px;
  background: rgba(0, 0, 0, 0.6);
  border-radius: 3px;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 3px;
}

.legend-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}

.legend-dot.red {
  background: #ef4444;
  box-shadow: 0 0 4px rgba(239, 68, 68, 0.6);
}

.legend-dot.blue {
  background: #3b82f6;
  box-shadow: 0 0 4px rgba(59, 130, 246, 0.6);
}

.legend-text {
  font-size: 10px;
  color: #94a3b8;
}
</style>
