<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, reactive, computed } from 'vue'
import { useDashboardStore } from '@/store'
import { storeToRefs } from 'pinia'
import type { Detection as StoreDetection } from '@/utils/mqtt_protocol'

// 获取 store
const store = useDashboardStore()
const { detections, detectionEnabled, detectionFrameSize, videoSize } = storeToRefs(store)
const showDetectionBoxes = computed(() => store.detectionConfig.showBoxes !== false)

export interface Detection {
  bbox: [number, number, number, number] // [x1, y1, x2, y2]
  class_id?: number
  class_name: string
  confidence: number
  team?: string // 'red' | 'blue' | 'neutral'
  parent_car_id?: number // 装甲板所属车辆 ID
}

let lastOverlayDebugTs = 0

function asFiniteNumber(value: unknown): number | null {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function toBbox(detection: StoreDetection): [number, number, number, number] | null {
  const maybeBbox = (detection as unknown as { bbox?: unknown }).bbox
  if (Array.isArray(maybeBbox) && maybeBbox.length >= 4) {
    const x1 = asFiniteNumber(maybeBbox[0])
    const y1 = asFiniteNumber(maybeBbox[1])
    const x2 = asFiniteNumber(maybeBbox[2])
    const y2 = asFiniteNumber(maybeBbox[3])
    if (x1 !== null && y1 !== null && x2 !== null && y2 !== null) {
      return [x1, y1, x2, y2]
    }
  }

  const x1 = asFiniteNumber(detection.x1)
  const y1 = asFiniteNumber(detection.y1)
  const x2 = asFiniteNumber(detection.x2)
  const y2 = asFiniteNumber(detection.y2)
  if (x1 === null || y1 === null || x2 === null || y2 === null) {
    return null
  }

  return [x1, y1, x2, y2]
}

function toOverlayDetection(detection: StoreDetection): Detection {
  const bbox = toBbox(detection) ?? [0, 0, 0, 0]
  const rawClassName =
    (detection as unknown as { class_name?: unknown }).class_name ?? detection.className
  const rawClassId =
    (detection as unknown as { class_id?: unknown }).class_id ?? detection.classId

  return {
    bbox,
    class_id: Number(rawClassId ?? 0),
    class_name: String(rawClassName ?? 'unknown'),
    confidence: Number(detection.confidence ?? 0),
    team: detection.team
  }
}

// 车辆跟踪数据（包含模拟血量）
interface CarTrackData {
  id: string // 车辆编号（如 R1, B3）
  team: 'red' | 'blue' | 'neutral'
  health: number // 血量百分比 0-100
  maxHealth: number // 最大血量
  centerX: number // 车辆中心 X
  centerY: number // 车辆中心 Y
  bbox: [number, number, number, number]
  lastSeen: number // 上次检测时间戳
}

// 计算实际使用的视频宽高
const effectiveVideoWidth = computed(() => detectionFrameSize.value.width || videoSize.value.width)
const effectiveVideoHeight = computed(
  () => detectionFrameSize.value.height || videoSize.value.height
)

const canvasRef = ref<HTMLCanvasElement | null>(null)

// 性能优化：使用 RAF 节流，避免过度重绘
let rafId: number | null = null
let needsRedraw = false

// 模拟血量数据存储（按车辆编号索引）
const simulatedHealth = reactive<Record<string, { health: number; lastUpdate: number }>>({})

// 队伍颜色映射
const TEAM_COLORS: Record<string, { primary: string; secondary: string; bg: string }> = {
  red: {
    primary: '#ff3333',
    secondary: '#ff6666',
    bg: 'rgba(255, 51, 51, 0.3)'
  },
  blue: {
    primary: '#3399ff',
    secondary: '#66b3ff',
    bg: 'rgba(51, 153, 255, 0.3)'
  },
  neutral: {
    primary: '#ffcc00',
    secondary: '#ffdd55',
    bg: 'rgba(255, 204, 0, 0.3)'
  }
}

// 从类名判断队伍
function getTeamFromClassName(className: string): 'red' | 'blue' | 'neutral' {
  const name = className.toUpperCase()
  if (name.startsWith('R')) return 'red'
  if (name.startsWith('B')) return 'blue'
  return 'neutral'
}

// 获取或初始化模拟血量
function getSimulatedHealth(carId: string): number {
  const now = Date.now()
  if (!simulatedHealth[carId]) {
    // 初始化血量为 60-100 之间的随机值
    simulatedHealth[carId] = {
      health: 60 + Math.random() * 40,
      lastUpdate: now
    }
  }

  // 每秒随机波动血量（模拟战斗）
  const data = simulatedHealth[carId]
  if (now - data.lastUpdate > 500) {
    // 随机增减血量
    const change = (Math.random() - 0.5) * 10
    data.health = Math.max(5, Math.min(100, data.health + change))
    data.lastUpdate = now
  }

  return data.health
}

// 检查装甲板是否在车辆 ROI 内
function isArmorInCarROI(armor: Detection, car: Detection, expandRatio: number = 0.15): boolean {
  const [cx1, cy1, cx2, cy2] = car.bbox
  const cw = cx2 - cx1
  const ch = cy2 - cy1
  const expandW = cw * expandRatio
  const expandH = ch * expandRatio

  const roiX1 = cx1 - expandW
  const roiY1 = cy1 - expandH
  const roiX2 = cx2 + expandW
  const roiY2 = cy2 + expandH

  const [ax1, ay1, ax2, ay2] = armor.bbox
  const armorCenterX = (ax1 + ax2) / 2
  const armorCenterY = (ay1 + ay2) / 2

  return (
    armorCenterX >= roiX1 && armorCenterX <= roiX2 && armorCenterY >= roiY1 && armorCenterY <= roiY2
  )
}

// 处理检测结果，关联车辆和装甲板
function processDetections(detections: Detection[]): CarTrackData[] {
  const cars = detections.filter(
    (d) => d.class_name.toLowerCase() === 'car' || d.class_name.toLowerCase() === 'robot'
  )
  const armors = detections.filter(
    (d) => d.class_name.toLowerCase() !== 'car' && d.class_name.toLowerCase() !== 'robot'
  )

  const result: CarTrackData[] = []

  cars.forEach((car, carIdx) => {
    // 找到该车辆 ROI 内置信度最高的装甲板
    let bestArmor: Detection | undefined = undefined
    let bestConfidence = 0

    for (const armor of armors) {
      // 如果装甲板有 parent_car_id，优先使用
      if (armor.parent_car_id !== undefined) {
        if (armor.parent_car_id === carIdx && armor.confidence > bestConfidence) {
          bestArmor = armor
          bestConfidence = armor.confidence
        }
      } else if (isArmorInCarROI(armor, car) && armor.confidence > bestConfidence) {
        bestArmor = armor
        bestConfidence = armor.confidence
      }
    }

    // 确定车辆编号和队伍
    let carId = `C${carIdx + 1}` // 默认编号
    let team: 'red' | 'blue' | 'neutral' = 'neutral'

    if (bestArmor) {
      carId = bestArmor!.class_name.toUpperCase()
      team = bestArmor!.team
        ? (bestArmor!.team as 'red' | 'blue' | 'neutral')
        : getTeamFromClassName(bestArmor!.class_name)
    }

    const [x1, y1, x2, y2] = car.bbox
    const centerX = (x1 + x2) / 2
    const centerY = (y1 + y2) / 2

    result.push({
      id: carId,
      team,
      health: getSimulatedHealth(carId),
      maxHealth: 100,
      centerX,
      centerY,
      bbox: car.bbox,
      lastSeen: Date.now()
    })
  })

  return result
}

// 更新 Canvas 分辨率以匹配显示尺寸并考虑 DPR
function updateCanvasSize() {
  const canvas = canvasRef.value
  if (!canvas) return

  const rect = canvas.getBoundingClientRect()
  const dpr = window.devicePixelRatio || 1

  // 设置 canvas 的实际像素，乘以 DPR
  if (canvas.width !== rect.width * dpr || canvas.height !== rect.height * dpr) {
    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr
  }
}

// 绘制科技风格十字中心标点
function drawCrosshair(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  color: string,
  dpr: number
) {
  const halfSize = size / 2
  const innerGap = 4 * dpr // 中心间隙
  const lineWidth = 2 * dpr

  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = lineWidth
  ctx.lineCap = 'square'
  ctx.shadowColor = color
  ctx.shadowBlur = 4 * dpr

  // 四条短线（带中心间隙）
  // 上
  ctx.beginPath()
  ctx.moveTo(x, y - halfSize)
  ctx.lineTo(x, y - innerGap)
  ctx.stroke()

  // 下
  ctx.beginPath()
  ctx.moveTo(x, y + innerGap)
  ctx.lineTo(x, y + halfSize)
  ctx.stroke()

  // 左
  ctx.beginPath()
  ctx.moveTo(x - halfSize, y)
  ctx.lineTo(x - innerGap, y)
  ctx.stroke()

  // 右
  ctx.beginPath()
  ctx.moveTo(x + innerGap, y)
  ctx.lineTo(x + halfSize, y)
  ctx.stroke()

  // 四角装饰（科技感）
  const cornerOffset = halfSize * 0.7
  const cornerLen = 4 * dpr
  ctx.lineWidth = 1.5 * dpr

  // 左上
  ctx.beginPath()
  ctx.moveTo(x - cornerOffset, y - cornerOffset + cornerLen)
  ctx.lineTo(x - cornerOffset, y - cornerOffset)
  ctx.lineTo(x - cornerOffset + cornerLen, y - cornerOffset)
  ctx.stroke()

  // 右上
  ctx.beginPath()
  ctx.moveTo(x + cornerOffset - cornerLen, y - cornerOffset)
  ctx.lineTo(x + cornerOffset, y - cornerOffset)
  ctx.lineTo(x + cornerOffset, y - cornerOffset + cornerLen)
  ctx.stroke()

  // 左下
  ctx.beginPath()
  ctx.moveTo(x - cornerOffset, y + cornerOffset - cornerLen)
  ctx.lineTo(x - cornerOffset, y + cornerOffset)
  ctx.lineTo(x - cornerOffset + cornerLen, y + cornerOffset)
  ctx.stroke()

  // 右下
  ctx.beginPath()
  ctx.moveTo(x + cornerOffset - cornerLen, y + cornerOffset)
  ctx.lineTo(x + cornerOffset, y + cornerOffset)
  ctx.lineTo(x + cornerOffset, y + cornerOffset - cornerLen)
  ctx.stroke()

  ctx.shadowBlur = 0

  // 中心小菱形
  ctx.fillStyle = color
  const diamondSize = 2.5 * dpr
  ctx.beginPath()
  ctx.moveTo(x, y - diamondSize)
  ctx.lineTo(x + diamondSize, y)
  ctx.lineTo(x, y + diamondSize)
  ctx.lineTo(x - diamondSize, y)
  ctx.closePath()
  ctx.fill()

  ctx.restore()
}

// 绘制虚线连接
function drawDashedLine(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: string,
  dpr: number
) {
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = 1.5 * dpr
  ctx.setLineDash([6 * dpr, 4 * dpr])
  ctx.lineCap = 'round'

  ctx.beginPath()
  ctx.moveTo(x1, y1)
  ctx.lineTo(x2, y2)
  ctx.stroke()

  ctx.setLineDash([])
  ctx.restore()
}

// 绘制识别信息条（高可读性版）：
//   [ID徽标]  ███████▁▁▁  [数值]
// 设计要点：
//   - 单色纯色填充 + 顶部 1px 亮线，避免渐变把数字糊掉
//   - 数值独立成暗色胶囊，白字黑描边，任何底色下都可读
//   - 去掉斜切 / 分段线 / 多层内描边等视觉噪声
function drawHealthBar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  health: number,
  team: 'red' | 'blue' | 'neutral',
  carId: string,
  dpr: number
) {
  const colors = TEAM_COLORS[team]
  const healthPercent = Math.max(0, Math.min(100, health)) / 100

  ctx.save()

  // ===== 布局计算 =====
  const labelSize = Math.min(height * 1.1, 22 * dpr) // ID 徽标外接直径
  const labelCenterX = x + labelSize / 2
  const labelCenterY = y + height / 2
  const gap = 6 * dpr

  const valueBoxW = 34 * dpr // 数值胶囊宽度
  const barX = x + labelSize + gap
  const barWidth = width - labelSize - gap - valueBoxW - gap
  const valueBoxX = barX + barWidth + gap
  const barFillWidth = Math.max(0, barWidth * healthPercent)

  // ===== 1. ID 徽标（六边形） =====
  drawHexagon(ctx, labelCenterX, labelCenterY, labelSize * 0.48, 'rgba(0,0,0,0.85)', colors.primary, 1.5 * dpr)
  const idFont = 11 * dpr
  ctx.font = `bold ${idFont}px 'Consolas', 'Monaco', monospace`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineWidth = 3 * dpr
  ctx.strokeStyle = 'rgba(0,0,0,0.9)'
  ctx.strokeText(carId, labelCenterX, labelCenterY)
  ctx.fillStyle = '#ffffff'
  ctx.fillText(carId, labelCenterX, labelCenterY)

  // ===== 2. 血条轨道（暗色背景 + 细边） =====
  const radius = Math.min(height / 2, 4 * dpr)
  ctx.fillStyle = 'rgba(0,0,0,0.75)'
  roundedRect(ctx, barX, y, barWidth, height, radius)
  ctx.fill()

  // 血量填充色（按百分比分三档）
  let fillColor: string
  if (healthPercent > 0.6) fillColor = colors.primary
  else if (healthPercent > 0.3) fillColor = '#ff9500'
  else fillColor = '#ff2a2a'

  // 填充层
  if (barFillWidth > 1) {
    ctx.save()
    roundedRect(ctx, barX, y, barWidth, height, radius)
    ctx.clip()
    ctx.fillStyle = fillColor
    ctx.fillRect(barX, y, barFillWidth, height)
    // 顶部 1px 高光（仅在填充区域内）
    ctx.fillStyle = 'rgba(255,255,255,0.35)'
    ctx.fillRect(barX, y + 1 * dpr, barFillWidth, 1 * dpr)
    ctx.restore()
  }

  // 细描边
  ctx.strokeStyle = 'rgba(255,255,255,0.35)'
  ctx.lineWidth = 1 * dpr
  roundedRect(ctx, barX, y, barWidth, height, radius)
  ctx.stroke()

  // ===== 3. 数值胶囊（独立暗底，保证数字永远可读） =====
  ctx.fillStyle = 'rgba(0,0,0,0.85)'
  roundedRect(ctx, valueBoxX, y, valueBoxW, height, radius)
  ctx.fill()
  ctx.strokeStyle = fillColor
  ctx.lineWidth = 1 * dpr
  roundedRect(ctx, valueBoxX, y, valueBoxW, height, radius)
  ctx.stroke()

  const valueText = `${Math.round(health)}`
  ctx.font = `bold ${11 * dpr}px 'Consolas', 'Monaco', monospace`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineWidth = 3 * dpr
  ctx.strokeStyle = 'rgba(0,0,0,0.9)'
  ctx.strokeText(valueText, valueBoxX + valueBoxW / 2, y + height / 2)
  ctx.fillStyle = '#ffffff'
  ctx.fillText(valueText, valueBoxX + valueBoxW / 2, y + height / 2)

  ctx.restore()
}

// 圆角矩形路径辅助
function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2))
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.lineTo(x + w - rr, y)
  ctx.arcTo(x + w, y, x + w, y + rr, rr)
  ctx.lineTo(x + w, y + h - rr)
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr)
  ctx.lineTo(x + rr, y + h)
  ctx.arcTo(x, y + h, x, y + h - rr, rr)
  ctx.lineTo(x, y + rr)
  ctx.arcTo(x, y, x + rr, y, rr)
  ctx.closePath()
}

// 绘制六边形
function drawHexagon(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  fillColor: string,
  strokeColor: string,
  lineWidth: number
) {
  ctx.save()
  ctx.beginPath()
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i - Math.PI / 2
    const x = cx + radius * Math.cos(angle)
    const y = cy + radius * Math.sin(angle)
    if (i === 0) {
      ctx.moveTo(x, y)
    } else {
      ctx.lineTo(x, y)
    }
  }
  ctx.closePath()
  ctx.fillStyle = fillColor
  ctx.fill()
  ctx.strokeStyle = strokeColor
  ctx.lineWidth = lineWidth
  ctx.stroke()
  ctx.restore()
}

// 绘制车辆跟踪 HUD
function drawCarTrackingHUD(ctx: CanvasRenderingContext2D, carData: CarTrackData[], dpr: number) {
  carData.forEach((car) => {
    const colors = TEAM_COLORS[car.team]

    // 计算中心点位置
    const centerX = car.centerX
    const centerY = car.centerY

    // 血条位置（车辆上方）- 加宽以容纳编号+血条横排
    const barWidth = 180 * dpr // 加宽：编号(32) + 间距(8) + 血条(140)
    const barHeight = 20 * dpr // 加高
    const barY = car.bbox[1] - 55 * dpr // 在车辆顶部上方
    const barX = centerX - barWidth / 2

    // 绘制虚线连接（从中心到血条底部中心）
    const lineEndX = barX + (32 * dpr) / 2 // 连接到编号六边形中心
    drawDashedLine(ctx, centerX, centerY, lineEndX, barY + barHeight, colors.secondary, dpr)

    // 绘制十字中心标点
    const crosshairSize = 20 * dpr
    drawCrosshair(ctx, centerX, centerY, crosshairSize, colors.primary, dpr)

    // 绘制血量指示条（科技风格，编号和血条一排）
    drawHealthBar(ctx, barX, barY, barWidth, barHeight, car.health, car.team, car.id, dpr)
  })
}

function drawRawDetectionBoxes(ctx: CanvasRenderingContext2D, items: Detection[], dpr: number) {
  items.forEach((item) => {
    const [x1, y1, x2, y2] = item.bbox
    const team = item.team ?? getTeamFromClassName(item.class_name)
    const colors = TEAM_COLORS[team]
    const width = Math.max(1, x2 - x1)
    const height = Math.max(1, y2 - y1)
    const label = `${item.class_name} ${(item.confidence * 100).toFixed(0)}%`

    ctx.save()
    ctx.strokeStyle = colors.primary
    ctx.lineWidth = 2 * dpr
    ctx.shadowColor = colors.primary
    ctx.shadowBlur = 4 * dpr
    ctx.strokeRect(x1, y1, width, height)
    ctx.shadowBlur = 0

    const fontSize = 12 * dpr
    ctx.font = `bold ${fontSize}px 'Consolas', 'Monaco', monospace`
    const paddingX = 5 * dpr
    const labelW = ctx.measureText(label).width + paddingX * 2
    const labelH = 18 * dpr
    const labelY = Math.max(0, y1 - labelH)

    ctx.fillStyle = 'rgba(0, 0, 0, 0.78)'
    ctx.fillRect(x1, labelY, labelW, labelH)
    ctx.fillStyle = colors.primary
    ctx.fillRect(x1, labelY, 3 * dpr, labelH)
    ctx.fillStyle = '#ffffff'
    ctx.textBaseline = 'middle'
    ctx.fillText(label, x1 + paddingX, labelY + labelH / 2)
    ctx.restore()
  })
}

function drawDetections() {
  if (rafId !== null) {
    // 已有待处理的绘制任务，标记需要重绘
    needsRedraw = true
    return
  }

  rafId = requestAnimationFrame(() => {
    rafId = null

    const canvas = canvasRef.value
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const { width: canvasWidth, height: canvasHeight } = canvas
    const dpr = window.devicePixelRatio || 1

    // 清空画布
    ctx.clearRect(0, 0, canvasWidth, canvasHeight)

    if (!detectionEnabled.value || detections.value.length === 0) {
      if (needsRedraw) {
        needsRedraw = false
        drawDetections()
      }
      return
    }

    // 计算缩放比例时，要用 CSS 显示尺寸 (canvasWidth / dpr)
    const displayWidth = canvasWidth / dpr
    const displayHeight = canvasHeight / dpr
    const sourceWidth = effectiveVideoWidth.value
    const sourceHeight = effectiveVideoHeight.value

    if (sourceWidth <= 0 || sourceHeight <= 0 || displayWidth <= 0 || displayHeight <= 0) {
      maybeLogOverlayDebug('invalid-size', { canvasWidth, canvasHeight, sourceWidth, sourceHeight })
      return
    }

    const containScale = Math.min(displayWidth / sourceWidth, displayHeight / sourceHeight)
    const renderedWidth = sourceWidth * containScale
    const renderedHeight = sourceHeight * containScale
    const offsetX = (displayWidth - renderedWidth) * 0.5
    const offsetY = (displayHeight - renderedHeight) * 0.5
    const scaleX = containScale
    const scaleY = containScale
    if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY) || scaleX <= 0 || scaleY <= 0) {
      maybeLogOverlayDebug('invalid-scale', { displayWidth, displayHeight, sourceWidth, sourceHeight })
      return
    }

    const overlayDetections = detections.value
      .map(toOverlayDetection)
      .filter((item) => {
        const [x1, y1, x2, y2] = item.bbox
        return [x1, y1, x2, y2].every(Number.isFinite) && x2 > x1 && y2 > y1
      })
    if (overlayDetections.length === 0) {
      maybeLogOverlayDebug('empty-after-normalize', { rawCount: detections.value.length })
      return
    }

    const scaledDetections: Detection[] = overlayDetections.map((item) => {
      const [x1, y1, x2, y2] = item.bbox
      return {
        ...item,
        bbox: [
          (offsetX + x1 * scaleX) * dpr,
          (offsetY + y1 * scaleY) * dpr,
          (offsetX + x2 * scaleX) * dpr,
          (offsetY + y2 * scaleY) * dpr
        ]
      }
    })

    // 处理检测结果，关联车辆和装甲板
    const carTrackData = processDetections(overlayDetections)

    // 缩放车辆跟踪数据到 Canvas 坐标
    const scaledCarData: CarTrackData[] = carTrackData.map((car) => {
      const [x1, y1, x2, y2] = car.bbox
      return {
        ...car,
        centerX: (offsetX + car.centerX * scaleX) * dpr,
        centerY: (offsetY + car.centerY * scaleY) * dpr,
        bbox: [
          (offsetX + x1 * scaleX) * dpr,
          (offsetY + y1 * scaleY) * dpr,
          (offsetX + x2 * scaleX) * dpr,
          (offsetY + y2 * scaleY) * dpr
        ] as [number, number, number, number]
      }
    })

    // 绘制车辆跟踪 HUD
    if (showDetectionBoxes.value) {
      drawRawDetectionBoxes(ctx, scaledDetections, dpr)
    }
    drawCarTrackingHUD(ctx, scaledCarData, dpr)

    // 检查是否有待处理的重绘请求
    if (needsRedraw) {
      needsRedraw = false
      drawDetections()
    }
  })
}

function maybeLogOverlayDebug(reason: string, payload: Record<string, unknown>) {
  const now = performance.now()
  if (now - lastOverlayDebugTs < 2000) return
  lastOverlayDebugTs = now
  console.warn('[DetectionOverlay] draw skipped:', reason, payload)
}

// 监听检测结果变化和窗口大小变化
watch(
  () => [
    detections.value,
    detectionEnabled.value,
    showDetectionBoxes.value,
    effectiveVideoWidth.value,
    effectiveVideoHeight.value
  ],
  () => {
    updateCanvasSize()
    drawDetections()
  },
  { deep: true }
)

// 初始化
onMounted(() => {
  updateCanvasSize()
  drawDetections()

  // 监听窗口大小变化
  window.addEventListener('resize', () => {
    updateCanvasSize()
    drawDetections()
  })
})

onUnmounted(() => {
  // 清理 RAF
  if (rafId !== null) {
    cancelAnimationFrame(rafId)
    rafId = null
  }

  window.removeEventListener('resize', updateCanvasSize)
  const canvas = canvasRef.value
  if (canvas) {
    const ctx = canvas.getContext('2d')
    ctx?.clearRect(0, 0, canvas.width, canvas.height)
  }
})
</script>

<template>
  <canvas ref="canvasRef" class="detection-overlay" />
</template>

<style scoped>
.detection-overlay {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 10;
}
</style>
