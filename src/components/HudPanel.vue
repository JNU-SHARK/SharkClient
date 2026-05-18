<!-- filepath: e:\desktop\SharkClientVue\shark_client_vue\src\renderer\src\components\HudPanel.vue -->
<script setup lang="ts">
import { ref, computed, onUnmounted, reactive, onMounted, nextTick } from 'vue'
import { storeToRefs } from 'pinia'
import { useDashboardStore } from '../store/modules/dashboard'
import {
  registerPanel,
  unregisterPanel,
  registerPanelInfo,
  unregisterPanelInfo,
  panels,
  type PanelPosition
} from '../store/panels'

const dashboardStore = useDashboardStore()
const { isHudInteractive } = storeToRefs(dashboardStore)

const props = defineProps({
  title: String,
  team: String as () => 'red' | 'blue' | null,
  initialStyle: {
    type: Object as () => {
      top?: string
      left?: string
      right?: string
      bottom?: string
      width?: string
      height?: string
      minWidth?: string
      minHeight?: string
      maxWidth?: string
      maxHeight?: string
    },
    required: true
  },
  resizable: {
    type: Boolean,
    default: true
  },
  hideTitleBar: {
    type: Boolean,
    default: false
  },
  transparent: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['panel-context-menu'])

const isCollapsed = ref(false)
const isPinned = ref(false)
const isTitleBarHidden = ref(props.hideTitleBar) // 根据 prop 初始化
const isTransparent = ref(props.transparent) // 根据 prop 初始化透明模式
const position = reactive({
  top: 'auto',
  left: 'auto',
  right: 'auto',
  bottom: 'auto',
  width: 'auto',
  height: 'auto'
})
const rootEl = ref<HTMLDivElement | null>(null)
const snappedSide = ref<'left' | 'right' | null>(null)
const isHovered = ref(false)

// 尺寸约束
const sizeConstraints = reactive({
  minWidth: 180,
  minHeight: 100,
  maxWidth: 600,
  maxHeight: 500
})

// 磁贴动画状态
const magnetState = reactive({
  active: false,
  targetX: 0,
  targetY: 0,
  showGuide: false,
  guidePosition: 'left' as 'left' | 'right'
})

const dragState = reactive({
  active: false,
  initialPanelPos: { top: 0, left: 0 },
  initialMousePos: { x: 0, y: 0 }
})

// 调整大小状态
const resizeState = reactive({
  active: false,
  direction: '' as '' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw',
  initialSize: { width: 0, height: 0 },
  initialPos: { top: 0, left: 0 },
  initialMousePos: { x: 0, y: 0 }
})

const isDraggable = computed(() => !isPinned.value && isHudInteractive.value)
const isResizable = computed(
  () => props.resizable && !isPinned.value && !isCollapsed.value && isHudInteractive.value
)

const startDrag = (event: MouseEvent): void => {
  if (!isDraggable.value || !rootEl.value) return
  event.preventDefault()
  snappedSide.value = null

  const panelRect = rootEl.value.getBoundingClientRect()
  const parentEl = rootEl.value.offsetParent as HTMLElement | null
  if (!parentEl) return
  const parentRect = parentEl.getBoundingClientRect()

  const initialTop = panelRect.top - parentRect.top
  const initialLeft = panelRect.left - parentRect.left

  // 记录初始状态
  dragState.initialPanelPos = { top: initialTop, left: initialLeft }
  dragState.initialMousePos = { x: event.clientX, y: event.clientY }

  // 修复点：标记拖拽已激活，关闭过渡，禁用选中
  dragState.active = true
  rootEl.value.style.transition = 'none'
  document.body.style.userSelect = 'none'

  position.right = 'auto'
  position.bottom = 'auto'
  position.top = `${initialTop}px`
  position.left = `${initialLeft}px`

  window.addEventListener('mousemove', onDrag)
  window.addEventListener('mouseup', stopDrag)
}

const onDrag = (event: MouseEvent): void => {
  if (!dragState.active || !rootEl.value) return

  const dx = event.clientX - dragState.initialMousePos.x
  const dy = event.clientY - dragState.initialMousePos.y

  const parentEl = rootEl.value.offsetParent as HTMLElement | null
  if (!parentEl) return
  const parentRect = parentEl.getBoundingClientRect()

  const newLeft = dragState.initialPanelPos.left + dx
  const newTop = dragState.initialPanelPos.top + dy

  // --- 完全重合检测（允许部分重叠，不允许完全重合）---
  const currentRect = rootEl.value.getBoundingClientRect()
  const futureRect = {
    left: newLeft,
    top: newTop,
    right: newLeft + currentRect.width,
    bottom: newTop + currentRect.height,
    width: currentRect.width,
    height: currentRect.height
  }

  let fullyOverlapping = false
  const OVERLAP_TOLERANCE = 20 // 允许的位置差异容差（像素）

  for (const otherEl of panels) {
    // 跳过自身
    if (otherEl === rootEl.value || !otherEl) continue

    const otherRect = otherEl.getBoundingClientRect()

    // 检测是否完全重合（位置几乎相同）
    const leftDiff = Math.abs(futureRect.left - (otherRect.left - parentRect.left))
    const topDiff = Math.abs(futureRect.top - (otherRect.top - parentRect.top))

    if (leftDiff < OVERLAP_TOLERANCE && topDiff < OVERLAP_TOLERANCE) {
      fullyOverlapping = true
      break
    }
  }

  // 如果没有完全重合，则更新位置（允许部分重叠）
  if (!fullyOverlapping) {
    // --- 网格吸附逻辑 ---
    const GRID_SIZE = 100 // 网格大小
    const GRID_SNAP_THRESHOLD = 15 // 网格吸附阈值

    // 计算最近的网格线位置（支持边缘和中心吸附）
    const snapToGrid = (value: number, size: number): number => {
      // 1. 尝试边缘吸附
      const edgeRemainder = value % GRID_SIZE
      if (edgeRemainder < GRID_SNAP_THRESHOLD) {
        return value - edgeRemainder
      } else if (edgeRemainder > GRID_SIZE - GRID_SNAP_THRESHOLD) {
        return value + (GRID_SIZE - edgeRemainder)
      }

      // 2. 尝试中心吸附
      // 中心点坐标 = 当前位置 + 尺寸的一半
      // 我们希望中心点对齐到网格线 (k * GRID_SIZE + GRID_SIZE/2)
      // 即 (value + size/2) % GRID_SIZE 接近 GRID_SIZE/2
      // 或者更简单：(value + size/2) % GRID_SIZE 接近 0 或 GRID_SIZE (如果网格线在 0, 100...)
      // 根据之前的 CSS，网格线是在 50px 处 (center)，所以中心点应该对齐到 50, 150, 250...
      // 即 (value + size/2) % GRID_SIZE 接近 50

      const center = value + size / 2
      // 目标中心点应该是 50, 150, 250... 即 k * 100 + 50
      // 计算中心点相对于网格周期的偏移
      const centerRemainder = (center - GRID_SIZE / 2) % GRID_SIZE

      if (Math.abs(centerRemainder) < GRID_SNAP_THRESHOLD) {
        // 中心点接近网格中心 (50, 150...)
        return value - centerRemainder
      } else if (Math.abs(centerRemainder - GRID_SIZE) < GRID_SNAP_THRESHOLD) {
        // 处理负数取模或跨周期的情况
        return value - (centerRemainder - GRID_SIZE)
      } else if (Math.abs(centerRemainder + GRID_SIZE) < GRID_SNAP_THRESHOLD) {
        return value - (centerRemainder + GRID_SIZE)
      }

      return value
    }

    // 应用网格吸附
    let snappedLeft = snapToGrid(newLeft, currentRect.width)
    let snappedTop = snapToGrid(newTop, currentRect.height)

    const maxLeft = Math.max(0, parentRect.width - (rootEl.value.offsetWidth || 0))
    const maxTop = Math.max(0, parentRect.height - (rootEl.value.offsetHeight || 0))

    position.left = `${Math.min(Math.max(0, Math.round(snappedLeft)), Math.round(maxLeft))}px`
    position.top = `${Math.min(Math.max(0, Math.round(snappedTop)), Math.round(maxTop))}px`

    // --- 磁贴引导线检测 ---
    const SNAP_THRESHOLD = 80 // 吸附阈值（像素）
    const SNAP_MARGIN = 20 // 吸附边距

    const windowWidth = window.innerWidth
    const panelCenterX = newLeft + currentRect.width / 2

    // 检测是否接近左边或右边
    if (panelCenterX < windowWidth / 2) {
      // 靠近左边
      const distanceToSnap = Math.abs(newLeft - SNAP_MARGIN)
      if (distanceToSnap < SNAP_THRESHOLD) {
        magnetState.showGuide = true
        magnetState.guidePosition = 'left'
        magnetState.targetX = SNAP_MARGIN
      } else {
        magnetState.showGuide = false
      }
    } else {
      // 靠近右边
      const targetLeft = windowWidth - currentRect.width - SNAP_MARGIN
      const distanceToSnap = Math.abs(newLeft - targetLeft)
      if (distanceToSnap < SNAP_THRESHOLD) {
        magnetState.showGuide = true
        magnetState.guidePosition = 'right'
        magnetState.targetX = targetLeft
      } else {
        magnetState.showGuide = false
      }
    }
  }
}

const stopDrag = (): void => {
  if (!dragState.active || !rootEl.value) return

  // 隐藏磁贴引导线
  magnetState.showGuide = false

  // 清理工作
  dragState.active = false
  document.body.style.userSelect = ''
  window.removeEventListener('mousemove', onDrag)
  window.removeEventListener('mouseup', stopDrag)

  const currentRect = rootEl.value.getBoundingClientRect()
  const windowWidth = window.innerWidth
  const SNAP_MARGIN = 20
  const SNAP_THRESHOLD = 80 // 只有距离边缘小于此值才吸附

  // 1. 计算到左右边缘的距离
  const distanceToLeft = Math.abs(currentRect.left - SNAP_MARGIN)
  const distanceToRight = Math.abs(windowWidth - currentRect.right - SNAP_MARGIN)

  // 2. 判断是否足够靠近边缘
  const shouldSnapLeft = distanceToLeft < SNAP_THRESHOLD
  const shouldSnapRight = distanceToRight < SNAP_THRESHOLD

  // 3. 如果不靠近任何边缘，直接悬停在当前位置
  if (!shouldSnapLeft && !shouldSnapRight) {
    rootEl.value.style.transition = ''
    // 根据当前位置决定倾斜方向（左半边 -> left，右半边 -> right）
    const panelCenterX = currentRect.left + currentRect.width / 2
    snappedSide.value = panelCenterX < windowWidth / 2 ? 'left' : 'right'
    return
  }

  // 4. 确定吸附目标（优先选择更近的边）
  let targetLeft: number
  let targetSide: 'left' | 'right'

  if (shouldSnapLeft && shouldSnapRight) {
    // 两边都靠近，选择更近的
    if (distanceToLeft <= distanceToRight) {
      targetLeft = SNAP_MARGIN
      targetSide = 'left'
    } else {
      targetLeft = windowWidth - currentRect.width - SNAP_MARGIN
      targetSide = 'right'
    }
  } else if (shouldSnapLeft) {
    targetLeft = SNAP_MARGIN
    targetSide = 'left'
  } else {
    targetLeft = windowWidth - currentRect.width - SNAP_MARGIN
    targetSide = 'right'
  }

  // 5. 检查吸附目标位置是否会完全重合（允许部分重叠）
  const OVERLAP_TOLERANCE = 20 // 允许的位置差异容差（像素）
  let fullyOverlapping = false

  for (const otherPanelRef of panels) {
    const otherEl = otherPanelRef
    if (otherEl === rootEl.value || !otherEl) continue // 跳过自身

    const otherRect = otherEl.getBoundingClientRect()

    // 检测吸附后是否会完全重合
    const leftDiff = Math.abs(targetLeft - otherRect.left)
    const topDiff = Math.abs(currentRect.top - otherRect.top)

    if (leftDiff < OVERLAP_TOLERANCE && topDiff < OVERLAP_TOLERANCE) {
      fullyOverlapping = true
      break
    }
  }

  // 6. 仅在不会完全重合时才执行吸附（带弹簧动画）
  if (!fullyOverlapping) {
    // 启用弹簧过渡动画
    rootEl.value.style.transition =
      'left 0.4s cubic-bezier(0.34, 1.56, 0.64, 1), top 0.3s cubic-bezier(0.4, 0, 0.2, 1)'

    position.left = `${targetLeft}px`
    position.right = 'auto'
    snappedSide.value = targetSide
    magnetState.active = true

    // 动画结束后恢复默认过渡
    setTimeout(() => {
      if (rootEl.value) {
        rootEl.value.style.transition = ''
        magnetState.active = false
      }
    }, 400)
  } else {
    // 如果吸附位置会完全重合，面板停留在当前位置，但仍根据位置设置倾斜方向
    rootEl.value.style.transition = ''
    // 根据当前位置决定倾斜方向（左半边 -> left，右半边 -> right）
    const panelCenterX = currentRect.left + currentRect.width / 2
    snappedSide.value = panelCenterX < windowWidth / 2 ? 'left' : 'right'
  }
}

// ==================== 双击隐藏/恢复标题栏功能 ====================
/**
 * 处理整个面板的双击事件
 * - 如果标题栏可见，双击标题栏隐藏标题栏
 * - 如果标题栏隐藏，双击面板任意位置恢复标题栏
 */
const handlePanelDoubleClick = (event: MouseEvent): void => {
  // 如果标题栏已隐藏，双击任意位置恢复
  if (isTitleBarHidden.value) {
    isTitleBarHidden.value = false
    event.stopPropagation()
  }
  // 如果标题栏可见，只有双击标题栏才会隐藏（由 handleTitleBarDoubleClick 处理）
}

/**
 * 处理标题栏的双击事件 - 隐藏标题栏
 */
const handleTitleBarDoubleClick = (event: MouseEvent): void => {
  isTitleBarHidden.value = true
  event.stopPropagation() // 阻止冒泡到 handlePanelDoubleClick
}

// ==================== 调整大小功能 ====================
const startResize = (event: MouseEvent, direction: string): void => {
  if (!isResizable.value || !rootEl.value) return
  event.preventDefault()
  event.stopPropagation()

  const panelRect = rootEl.value.getBoundingClientRect()
  const parentEl = rootEl.value.offsetParent as HTMLElement | null
  if (!parentEl) return
  const parentRect = parentEl.getBoundingClientRect()

  resizeState.active = true
  resizeState.direction = direction as typeof resizeState.direction
  resizeState.initialSize = { width: panelRect.width, height: panelRect.height }
  resizeState.initialPos = {
    top: panelRect.top - parentRect.top,
    left: panelRect.left - parentRect.left
  }
  resizeState.initialMousePos = { x: event.clientX, y: event.clientY }

  // 切换到绝对定位
  position.right = 'auto'
  position.bottom = 'auto'
  position.top = `${resizeState.initialPos.top}px`
  position.left = `${resizeState.initialPos.left}px`
  position.width = `${panelRect.width}px`
  position.height = `${panelRect.height}px`

  rootEl.value.style.transition = 'none'
  document.body.style.userSelect = 'none'
  document.body.style.cursor = getCursorForDirection(direction)

  window.addEventListener('mousemove', onResize)
  window.addEventListener('mouseup', stopResize)
}

const getCursorForDirection = (direction: string): string => {
  const cursorMap: Record<string, string> = {
    n: 'ns-resize',
    s: 'ns-resize',
    e: 'ew-resize',
    w: 'ew-resize',
    ne: 'nesw-resize',
    sw: 'nesw-resize',
    nw: 'nwse-resize',
    se: 'nwse-resize'
  }
  return cursorMap[direction] || 'default'
}

const onResize = (event: MouseEvent): void => {
  if (!resizeState.active || !rootEl.value) return

  const dx = event.clientX - resizeState.initialMousePos.x
  const dy = event.clientY - resizeState.initialMousePos.y

  let newWidth = resizeState.initialSize.width
  let newHeight = resizeState.initialSize.height
  let newTop = resizeState.initialPos.top
  let newLeft = resizeState.initialPos.left

  const dir = resizeState.direction

  // 处理宽度变化
  if (dir.includes('e')) {
    newWidth = resizeState.initialSize.width + dx
  } else if (dir.includes('w')) {
    newWidth = resizeState.initialSize.width - dx
    newLeft = resizeState.initialPos.left + dx
  }

  // 处理高度变化
  if (dir.includes('s')) {
    newHeight = resizeState.initialSize.height + dy
  } else if (dir.includes('n')) {
    newHeight = resizeState.initialSize.height - dy
    newTop = resizeState.initialPos.top + dy
  }

  // 应用约束
  newWidth = Math.max(sizeConstraints.minWidth, Math.min(sizeConstraints.maxWidth, newWidth))
  newHeight = Math.max(sizeConstraints.minHeight, Math.min(sizeConstraints.maxHeight, newHeight))

  // 如果向左/上调整且达到最小值，需要修正位置
  if (dir.includes('w')) {
    const actualDx = resizeState.initialSize.width - newWidth
    newLeft = resizeState.initialPos.left + actualDx
  }
  if (dir.includes('n')) {
    const actualDy = resizeState.initialSize.height - newHeight
    newTop = resizeState.initialPos.top + actualDy
  }

  // 边界检查
  newLeft = Math.max(0, newLeft)
  newTop = Math.max(0, newTop)

  position.width = `${newWidth}px`
  position.height = `${newHeight}px`
  position.left = `${newLeft}px`
  position.top = `${newTop}px`
}

const stopResize = (): void => {
  if (!resizeState.active) return

  resizeState.active = false
  resizeState.direction = ''
  document.body.style.userSelect = ''
  document.body.style.cursor = ''

  if (rootEl.value) {
    rootEl.value.style.transition = ''
  }

  window.removeEventListener('mousemove', onResize)
  window.removeEventListener('mouseup', stopResize)
}

// 确保位置模式为 top/left (用于键盘微调)
const ensurePositionMode = (): void => {
  if (
    position.left !== 'auto' &&
    position.top !== 'auto' &&
    position.right === 'auto' &&
    position.bottom === 'auto'
  ) {
    return // 已经是 top/left 模式
  }

  if (!rootEl.value) return
  const panelRect = rootEl.value.getBoundingClientRect()
  const parentEl = rootEl.value.offsetParent as HTMLElement | null
  if (!parentEl) return
  const parentRect = parentEl.getBoundingClientRect()

  const currentTop = panelRect.top - parentRect.top
  const currentLeft = panelRect.left - parentRect.left

  position.top = `${currentTop}px`
  position.left = `${currentLeft}px`
  position.right = 'auto'
  position.bottom = 'auto'
}

const handleKeyDown = (e: KeyboardEvent): void => {
  // 如果焦点在输入框、文本域或可编辑元素上，不处理键盘事件
  const target = e.target as HTMLElement
  if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
    return
  }

  if (!isHudInteractive.value || !isHovered.value || isPinned.value) return

  const step = 1 // 每次移动 1px

  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
    e.preventDefault()
    ensurePositionMode()

    const currentLeft = parseInt(position.left) || 0
    const currentTop = parseInt(position.top) || 0

    switch (e.key) {
      case 'ArrowLeft':
        position.left = `${currentLeft - step}px`
        break
      case 'ArrowRight':
        position.left = `${currentLeft + step}px`
        break
      case 'ArrowUp':
        position.top = `${currentTop - step}px`
        break
      case 'ArrowDown':
        position.top = `${currentTop + step}px`
        break
    }
  }
}

// 获取当前位置
const getPosition = (): PanelPosition => {
  return {
    top: position.top,
    left: position.left,
    right: position.right,
    bottom: position.bottom,
    width: position.width,
    height: position.height
  }
}

// 设置位置
const setPosition = (pos: Partial<PanelPosition>): void => {
  if (pos.top !== undefined) position.top = pos.top
  if (pos.left !== undefined) position.left = pos.left
  if (pos.right !== undefined) position.right = pos.right
  if (pos.bottom !== undefined) position.bottom = pos.bottom
  if (pos.width !== undefined) position.width = pos.width
  if (pos.height !== undefined) position.height = pos.height
}

// 暴露给父组件
defineExpose({
  getPosition,
  setPosition
})

onMounted(() => {
  Object.assign(position, props.initialStyle)
  window.addEventListener('keydown', handleKeyDown)

  // 解析尺寸约束
  if (props.initialStyle.minWidth) {
    sizeConstraints.minWidth = parseInt(props.initialStyle.minWidth)
  }
  if (props.initialStyle.minHeight) {
    sizeConstraints.minHeight = parseInt(props.initialStyle.minHeight)
  }
  if (props.initialStyle.maxWidth) {
    sizeConstraints.maxWidth = parseInt(props.initialStyle.maxWidth)
  }
  if (props.initialStyle.maxHeight) {
    sizeConstraints.maxHeight = parseInt(props.initialStyle.maxHeight)
  }

  // 延迟到 DOM 完全渲染后，根据实际位置判断倾斜方向
  nextTick(() => {
    // 额外延迟确保 CSS 布局完成（特别是 right 定位的元素）
    setTimeout(() => {
      if (rootEl.value) {
        const rect = rootEl.value.getBoundingClientRect()
        const windowWidth = window.innerWidth
        const panelCenterX = rect.left + rect.width / 2
        snappedSide.value = panelCenterX < windowWidth / 2 ? 'left' : 'right'
      }
    }, 50)
  })

  registerPanel(rootEl.value)

  // 注册面板信息（用于配置保存/加载）
  if (props.title) {
    registerPanelInfo({
      id: props.title,
      title: props.title,
      getPosition,
      setPosition
    })
  }
})

const handleContextMenu = (event: MouseEvent): void => {
  if (isHudInteractive.value) {
    emit('panel-context-menu', { event, title: props.title })
  }
}

onUnmounted(() => {
  stopDrag()
  stopResize()
  unregisterPanel(rootEl.value)
  // 注销面板信息
  if (props.title) {
    unregisterPanelInfo(props.title)
  }
  window.removeEventListener('keydown', handleKeyDown)
})
</script>

<template>
  <div
    ref="rootEl"
    class="hud"
    :class="{
      collapsed: isCollapsed,
      pinned: isPinned,
      transparent: isTransparent,
      'team-red': team === 'red',
      'team-blue': team === 'blue',
      'snapped-left': snappedSide === 'left',
      'snapped-right': snappedSide === 'right',
      dragging: dragState.active,
      'magnet-active': magnetState.active
    }"
    :style="position"
    @dblclick="handlePanelDoubleClick"
    @contextmenu.prevent.stop="handleContextMenu"
    @mouseenter="isHovered = true"
    @mouseleave="isHovered = false"
  >
    <!-- 磁贴引导线 - 移到外部 -->
    <Teleport to="body">
      <Transition name="guide-fade">
        <div
          v-if="magnetState.showGuide && dragState.active"
          class="magnet-guide"
          :class="magnetState.guidePosition"
        />
      </Transition>
      <!-- 网格辅助线 -->
      <Transition name="grid-fade">
        <div v-if="dragState.active" class="grid-overlay"></div>
      </Transition>
    </Teleport>

    <div
      v-if="!isTitleBarHidden"
      class="hud-header"
      :class="{ draggable: isDraggable }"
      @dblclick="handleTitleBarDoubleClick"
    >
      <div class="hud-title" @mousedown.left="startDrag">{{ title }}</div>
      <div v-if="isHudInteractive" class="header-buttons" @mousedown.stop>
        <button
          class="transparent-btn"
          :class="{ active: isTransparent }"
          title="透明模式"
          @click="isTransparent = !isTransparent"
          @mousedown.stop
        >
          <span class="transparent-icon">◐</span>
        </button>
        <button
          class="pin-btn"
          :class="{ active: isPinned }"
          title="固定/取消固定"
          @click="isPinned = !isPinned"
          @mousedown.stop
        >
          <span class="pin-icon"></span>
        </button>
        <button
          class="collapse-btn"
          title="折叠/展开"
          @click="isCollapsed = !isCollapsed"
          @mousedown.stop
        >
          <span class="chevron"></span>
        </button>
      </div>
    </div>

    <div class="hud-body">
      <slot></slot>
    </div>

    <!-- 调整大小手柄 - 仅保留左下和右下角 -->
    <template v-if="isResizable">
      <div class="resize-handle resize-se" @mousedown="startResize($event, 'se')"></div>
      <div class="resize-handle resize-sw" @mousedown="startResize($event, 'sw')"></div>
    </template>
  </div>
</template>

<style scoped>
.hud {
  position: absolute;
  min-width: 180px;
  min-height: 100px;
  border-radius: 12px;
  color: #fff;
  background-color: rgba(25, 28, 38, 0.3);
  backdrop-filter: blur(30px) saturate(1.2);
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow:
    inset 0 1px 1px rgba(255, 255, 255, 0.05),
    0 8px 32px rgba(0, 0, 0, 0.3),
    0 2px 8px rgba(0, 0, 0, 0.2);
  overflow: visible;
  padding: 0;
  z-index: 60;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  display: flex;
  flex-direction: column;
  font-family: var(--font-tech);
  letter-spacing: 0.3px;
  transform-style: preserve-3d;
}

/* 左侧面板 - 轻微向右倾斜 */
.hud.snapped-left {
  /* transform: perspective(1200px) rotateY(3deg); */
  transform-origin: center center;
}

/* 右侧面板 - 轻微向左倾斜 */
.hud.snapped-right {
  /* transform: perspective(1200px) rotateY(-3deg); */
  transform-origin: center center;
}

/* 拖拽状态 - 恢复正常视角并放大 */
.hud.dragging {
  cursor: grabbing;
  box-shadow:
    inset 0 1px 1px rgba(255, 255, 255, 0.05),
    0 20px 40px rgba(0, 0, 0, 0.3),
    0 0 0 2px rgba(59, 130, 246, 0.3);
  transform: scale(1.02) !important;
  z-index: 100;
}

/* 磁贴吸附动画状态 */
.hud.magnet-active {
  box-shadow:
    inset 0 1px 1px rgba(255, 255, 255, 0.05),
    0 0 30px rgba(59, 130, 246, 0.4),
    0 0 0 2px rgba(59, 130, 246, 0.5);
}

/* 透明模式 - 隐藏背景和边框 */
.hud.transparent {
  background-color: transparent;
  backdrop-filter: none;
  border-color: transparent;
  box-shadow: none;
}

.hud.transparent .hud-header {
  background: rgba(0, 0, 0, 0.3);
  border-radius: 8px;
  border-bottom: none;
  margin-bottom: 4px;
}

.hud.transparent .hud-body {
  background: transparent;
}

.hud.transparent .resize-se::after,
.hud.transparent .resize-sw::after {
  border-color: rgba(255, 255, 255, 0.1);
}

/* 磁贴引导线 - 移到非scoped样式 */

/* 引导线过渡动画 - 保留在scoped内但也需要全局版本 */

.hud.collapsed {
  height: 48px !important;
  max-height: 48px !important;
  min-height: 48px !important;
  overflow: hidden;
}

.hud.collapsed .hud-body {
  display: none;
}

.hud-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  height: 48px;
  min-height: 48px;
  flex-shrink: 0;
  padding: 0 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}
.hud.collapsed .hud-header {
  border-bottom-color: transparent;
}
.hud-title {
  font-size: 17px;
  font-weight: 600;
  user-select: none;
  flex-grow: 1;
  height: 100%;
  display: flex;
  align-items: center;
  font-family: var(--font-tech-cn);
  letter-spacing: 2px;
}
.hud-header.draggable {
  cursor: default;
}
.hud-header.draggable .hud-title {
  cursor: grab;
}
.hud-header.draggable .hud-title:active {
  cursor: grabbing;
}
.hud-body {
  padding: 16px;
  overflow-y: auto;
  overflow-x: hidden;
  /* 动态高度由父容器控制 */
  flex: 1;
  /* 滚动性能优化 */
  overscroll-behavior-y: auto;
  -webkit-overflow-scrolling: touch;
  will-change: scroll-position;
  scroll-behavior: smooth;
  /* 滚动条样式 */
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.15) transparent;
  border-radius: 0 0 12px 12px;
  background: rgba(0, 0, 0, 0.1);
}

.hud-body::-webkit-scrollbar {
  width: 4px;
}

.hud-body::-webkit-scrollbar-track {
  background: transparent;
}

.hud-body::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.15);
  border-radius: 2px;
}

.hud-body::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.25);
}
.header-buttons {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.pin-btn,
.collapse-btn,
.transparent-btn {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: none;
  background: rgba(255, 255, 255, 0.05);
  color: #fff;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background-color 0.2s;
}
.pin-btn:hover,
.collapse-btn:hover,
.transparent-btn:hover {
  background: rgba(255, 255, 255, 0.1);
}
.transparent-icon {
  font-size: 14px;
  opacity: 0.5;
  transition: all 0.2s;
}
.transparent-btn.active .transparent-icon {
  opacity: 1;
  color: #60a5fa;
  text-shadow: 0 0 8px #60a5fa;
}
.pin-icon {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background-color: rgba(255, 255, 255, 0.4);
  transition: all 0.2s;
}
.pin-btn.active .pin-icon {
  background-color: #60a5fa;
  box-shadow: 0 0 8px #60a5fa;
}
.chevron {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-style: solid;
  border-color: currentColor;
  border-width: 0 2px 2px 0;
  transform: rotate(45deg);
  transition: transform 0.4s cubic-bezier(0.4, 0, 0.2, 1);
}
.hud.collapsed .chevron {
  transform: rotate(-135deg);
}
.hud .hud-title {
  color: #ff9fb0;
}
.hud.team-red .hud-title {
  color: #ff7a7a;
}
.hud.team-blue .hud-title {
  color: #80b8ff;
}

/* 调整大小手柄 */
.resize-handle {
  position: absolute;
  z-index: 10;
}

/* 角落手柄 - 仅保留左下和右下 */
.resize-se {
  bottom: 0;
  right: 0;
  width: 12px;
  height: 12px;
  cursor: nwse-resize;
}

.resize-sw {
  bottom: 0;
  left: 0;
  width: 12px;
  height: 12px;
  cursor: nesw-resize;
}

/* 右下角视觉指示器 */
.resize-se::after {
  content: '';
  position: absolute;
  bottom: 4px;
  right: 4px;
  width: 8px;
  height: 8px;
  border-right: 2px solid rgba(255, 255, 255, 0.2);
  border-bottom: 2px solid rgba(255, 255, 255, 0.2);
  border-radius: 0 0 2px 0;
  transition: border-color 0.2s;
}

/* 左下角视觉指示器 */
.resize-sw::after {
  content: '';
  position: absolute;
  bottom: 4px;
  left: 4px;
  width: 8px;
  height: 8px;
  border-left: 2px solid rgba(255, 255, 255, 0.2);
  border-bottom: 2px solid rgba(255, 255, 255, 0.2);
  border-radius: 0 0 0 2px;
  transition: border-color 0.2s;
}

.hud:hover .resize-se::after,
.hud:hover .resize-sw::after {
  border-color: rgba(255, 255, 255, 0.4);
}

/* 折叠时隐藏调整大小手柄 */
.hud.collapsed .resize-handle {
  display: none;
}
</style>

<!-- 全局样式 - 用于 Teleport 到 body 的磁贴引导线 -->
<style>
.magnet-guide {
  position: fixed;
  top: 0;
  bottom: 0;
  width: 3px;
  background: linear-gradient(
    180deg,
    transparent 0%,
    rgba(59, 130, 246, 0.8) 20%,
    rgba(59, 130, 246, 0.8) 80%,
    transparent 100%
  );
  box-shadow:
    0 0 10px rgba(59, 130, 246, 0.6),
    0 0 20px rgba(59, 130, 246, 0.4);
  z-index: 9999;
  pointer-events: none;
}

.magnet-guide.left {
  left: 20px;
}

.magnet-guide.right {
  right: 20px;
  left: auto;
}

/* 引导线过渡动画 */
.guide-fade-enter-active,
.guide-fade-leave-active {
  transition: opacity 0.2s ease;
}

.guide-fade-enter-from,
.guide-fade-leave-to {
  opacity: 0;
}

/* 网格辅助线样式 */
.grid-overlay {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 9998;
  /* 让网格线位于 100px 方格的中心 (50px处)，配合 background-position: center 实现屏幕居中 */
  background-image:
    linear-gradient(to right, transparent 49px, rgba(255, 255, 255, 0.1) 50px, transparent 51px),
    linear-gradient(to bottom, transparent 49px, rgba(255, 255, 255, 0.1) 50px, transparent 51px);
  background-size: 100px 100px;
  background-position: center center;
  mask-image: radial-gradient(circle at center, black 60%, transparent 100%);
}

.grid-fade-enter-active,
.grid-fade-leave-active {
  transition: opacity 0.3s ease;
}

.grid-fade-enter-from,
.grid-fade-leave-to {
  opacity: 0;
}
</style>
