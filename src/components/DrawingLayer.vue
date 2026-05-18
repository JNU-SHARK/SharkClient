<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, nextTick } from 'vue'

const props = defineProps({
  visible: { type: Boolean, default: false },
  videoSize: { type: Object, default: () => ({ width: 1280, height: 720 }) }
})

const emit = defineEmits(['close'])

// --- State ---
const canvasRef = ref<HTMLCanvasElement | null>(null)
const ctx = ref<CanvasRenderingContext2D | null>(null)
const isDrawing = ref(false)
const startPos = ref({ x: 0, y: 0 })
const currentTool = ref<'select' | 'line' | 'rect' | 'circle' | 'text' | 'eraser'>('line')
const currentColor = ref('#ff0000')
const currentLineWidth = ref(2)

// History for Undo/Redo
interface DrawAction {
  type: 'line' | 'rect' | 'circle' | 'text' | 'eraser'
  color: string
  lineWidth: number
  points?: { x: number; y: number }[]
  rect?: { x: number; y: number; w: number; h: number }
  circle?: { x: number; y: number; r: number }
  text?: {
    x: number
    y: number
    content: string
    size: number
    isBold?: boolean
    isItalic?: boolean
  }
  groupId?: string // 组ID，用于模板加载的元素分组
}

type GraphicConfigFile = {
  filename: string
  content: string
}

const history = ref<DrawAction[]>([])
const redoStack = ref<DrawAction[]>([])
const currentAction = ref<DrawAction | null>(null)

// Selection & Resizing State
const selectedActionIndex = ref<number>(-1)
const selectedGroupId = ref<string | null>(null) // 选中的组ID
const selectedIndices = ref<Set<number>>(new Set()) // Ctrl 多选的元素索引集合
const isDragging = ref(false)
const dragHandle = ref<string | null>(null) // 'tl', 'tr', 'bl', 'br', 'move', 'group', etc.
const dragStartPos = ref({ x: 0, y: 0 })
const initialActionState = ref<DrawAction | null>(null)
const initialGroupState = ref<DrawAction[]>([]) // 保存组的初始状态

// 框选状态
const isBoxSelecting = ref(false)
const boxSelectStart = ref({ x: 0, y: 0 })
const boxSelectEnd = ref({ x: 0, y: 0 })

// 右键菜单状态
const showContextMenu = ref(false)
const contextMenuPos = ref({ x: 0, y: 0 })
const hasGroupInSelection = ref(false) // 选中元素中是否包含组
const isSettingsMenu = ref(false) // 是否为设置菜单（空白处右键）

// 吸附功能状态
const snapEnabled = ref(true) // 是否启用端点吸附
const snapDistance = ref(15) // 吸附距离（像素）
const snapPoint = ref<{ x: number; y: number } | null>(null) // 当前吸附点

// Config Management
const configs = ref<string[]>([])
const currentConfigName = ref('')
const isConfigMenuOpen = ref(false)

// Modal State
const showModal = ref(false)
const modalType = ref<'text' | 'config' | 'parameterize'>('text')
const modalValue = ref('')
const inputRef = ref<HTMLInputElement | null>(null)

// 参数化模态框状态
const paramModalAction = ref<DrawAction | null>(null) // 正在编辑的元素
const paramModalIndex = ref(-1) // 元素索引
const paramIsGroup = ref(false) // 是否为组
const paramGroupId = ref<string | null>(null) // 组ID
const paramLineLength = ref(0)
const paramRectWidth = ref(0)
const paramRectHeight = ref(0)
const paramCircleDiameter = ref(0)
const paramGroupWidth = ref(0) // 组宽度
const paramGroupHeight = ref(0) // 组高度

// 监听模态框显示，自动聚焦输入框
watch(showModal, (val) => {
  if (val) {
    nextTick(() => {
      inputRef.value?.focus()
    })
  }
})

const modalTitle = ref('')
// Text styling in modal
const modalTextSize = ref(20)
const modalTextBold = ref(false)
const modalTextItalic = ref(false)

// --- Canvas Handling ---
const resizeCanvas = (): void => {
  if (canvasRef.value) {
    const vW = props.videoSize.width
    const vH = props.videoSize.height
    const cW = canvasRef.value.clientWidth
    const cH = canvasRef.value.clientHeight

    const width = Math.max(vW > 0 ? vW : cW, 1)
    const height = Math.max(vH > 0 ? vH : cH, 1)

    canvasRef.value.width = width
    canvasRef.value.height = height
    redraw()
  }
}

watch(() => props.videoSize, resizeCanvas, { deep: true })
watch(
  () => props.visible,
  (val) => {
    if (val) {
      nextTick(() => {
        if (canvasRef.value && !ctx.value) {
          ctx.value = canvasRef.value.getContext('2d')
        }
        resizeCanvas()
        loadConfigList()
      })
    } else {
      // Exit editing mode: clear selection
      selectedActionIndex.value = -1
      redraw()
    }
  }
)

onMounted(() => {
  if (canvasRef.value) {
    ctx.value = canvasRef.value.getContext('2d')
    resizeCanvas()
  }
  window.addEventListener('resize', resizeCanvas)
  window.addEventListener('keydown', handleKeyDown)
  window.addEventListener('click', handleGlobalClick)
})

onUnmounted(() => {
  window.removeEventListener('resize', resizeCanvas)
  window.removeEventListener('keydown', handleKeyDown)
  window.removeEventListener('click', handleGlobalClick)
})

// 全局点击事件处理（关闭右键菜单）
const handleGlobalClick = (): void => {
  if (showContextMenu.value) {
    showContextMenu.value = false
  }
}

// 键盘事件处理
const handleKeyDown = (e: KeyboardEvent): void => {
  if (!props.visible) return

  // ESC 键取消选择
  if (e.key === 'Escape') {
    selectedActionIndex.value = -1
    selectedGroupId.value = null
    selectedIndices.value.clear()
    isBoxSelecting.value = false
    showContextMenu.value = false
    redraw()
  }

  // Delete 键删除选中的元素或组
  if (e.key === 'Delete') {
    if (selectedGroupId.value) {
      // 删除整个组
      history.value = history.value.filter((a) => a.groupId !== selectedGroupId.value)
      selectedGroupId.value = null
      redraw()
    } else if (selectedIndices.value.size > 0) {
      // 删除多选元素
      const indicesToDelete = Array.from(selectedIndices.value).sort((a, b) => b - a)
      indicesToDelete.forEach((idx) => history.value.splice(idx, 1))
      selectedIndices.value.clear()
      redraw()
    } else if (selectedActionIndex.value !== -1) {
      // 删除单个元素
      history.value.splice(selectedActionIndex.value, 1)
      selectedActionIndex.value = -1
      redraw()
    }
  }
}

const getMousePos = (e: MouseEvent): { x: number; y: number } => {
  if (!canvasRef.value) return { x: 0, y: 0 }
  const rect = canvasRef.value.getBoundingClientRect()
  const scaleX = canvasRef.value.width / rect.width
  const scaleY = canvasRef.value.height / rect.height
  return {
    x: (e.clientX - rect.left) * scaleX,
    y: (e.clientY - rect.top) * scaleY
  }
}

// --- Hit Testing ---
const hitTest = (pos: { x: number; y: number }, action: DrawAction): boolean => {
  const tolerance = 10
  if (action.type === 'rect' && action.rect) {
    const { x, y, w, h } = action.rect
    // Check if point is near border
    const inRect =
      pos.x >= Math.min(x, x + w) - tolerance &&
      pos.x <= Math.max(x, x + w) + tolerance &&
      pos.y >= Math.min(y, y + h) - tolerance &&
      pos.y <= Math.max(y, y + h) + tolerance

    // For filled rects (if we had them) it would be simple inside check.
    // For stroked rects, check distance to edges? Or just inside for easier selection.
    // Let's use "inside or near edge"
    return inRect
  } else if (action.type === 'circle' && action.circle) {
    const { x, y, r } = action.circle
    const d = Math.sqrt(Math.pow(pos.x - x, 2) + Math.pow(pos.y - y, 2))
    return Math.abs(d - r) <= tolerance || d <= r // Inside or on edge
  } else if (action.type === 'line' && action.points && action.points.length >= 2) {
    const p1 = action.points[0]
    const p2 = action.points[1]
    // Distance from point to segment
    const A = pos.x - p1.x
    const B = pos.y - p1.y
    const C = p2.x - p1.x
    const D = p2.y - p1.y
    const dot = A * C + B * D
    const lenSq = C * C + D * D
    let param = -1
    if (lenSq !== 0) param = dot / lenSq
    let xx, yy
    if (param < 0) {
      xx = p1.x
      yy = p1.y
    } else if (param > 1) {
      xx = p2.x
      yy = p2.y
    } else {
      xx = p1.x + param * C
      yy = p1.y + param * D
    }
    const dx = pos.x - xx
    const dy = pos.y - yy
    return Math.sqrt(dx * dx + dy * dy) <= tolerance
  } else if (action.type === 'text' && action.text) {
    // Estimate text bounds
    if (!ctx.value) return false
    ctx.value.font = `${action.text.isBold ? 'bold ' : ''}${action.text.isItalic ? 'italic ' : ''}${action.text.size}px Arial`
    const metrics = ctx.value.measureText(action.text.content)
    const h = action.text.size // Approx height
    const w = metrics.width
    const x = action.text.x
    const y = action.text.y // Baseline
    // Simple box check (y is baseline, so top is y - h)
    return (
      pos.x >= x && pos.x <= x + w && pos.y >= y - h && pos.y <= y + h * 0.2 // Descent
    )
  }
  return false
}

const getHandleAt = (pos: { x: number; y: number }, action: DrawAction): string | null => {
  const handleSize = 8
  const isNear = (x: number, y: number): boolean =>
    Math.abs(pos.x - x) <= handleSize && Math.abs(pos.y - y) <= handleSize

  if (action.type === 'rect' && action.rect) {
    const { x, y, w, h } = action.rect
    if (isNear(x, y)) return 'tl'
    if (isNear(x + w, y)) return 'tr'
    if (isNear(x, y + h)) return 'bl'
    if (isNear(x + w, y + h)) return 'br'
  } else if (action.type === 'circle' && action.circle) {
    const { x, y, r } = action.circle
    if (isNear(x + r, y)) return 'r' // Right handle
  } else if (action.type === 'line' && action.points && action.points.length >= 2) {
    if (isNear(action.points[0].x, action.points[0].y)) return 'p1'
    if (isNear(action.points[1].x, action.points[1].y)) return 'p2'
  }
  return null
}

// 获取组的边界框
const getGroupBounds = (groupId: string): { x: number; y: number; w: number; h: number } | null => {
  const groupActions = history.value.filter((a) => a.groupId === groupId)
  if (groupActions.length === 0) return null

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  groupActions.forEach((action) => {
    if (action.type === 'rect' && action.rect) {
      const { x, y, w, h } = action.rect
      minX = Math.min(minX, x, x + w)
      maxX = Math.max(maxX, x, x + w)
      minY = Math.min(minY, y, y + h)
      maxY = Math.max(maxY, y, y + h)
    } else if (action.type === 'circle' && action.circle) {
      const { x, y, r } = action.circle
      minX = Math.min(minX, x - r)
      maxX = Math.max(maxX, x + r)
      minY = Math.min(minY, y - r)
      maxY = Math.max(maxY, y + r)
    } else if (action.type === 'line' && action.points) {
      action.points.forEach((p) => {
        minX = Math.min(minX, p.x)
        maxX = Math.max(maxX, p.x)
        minY = Math.min(minY, p.y)
        maxY = Math.max(maxY, p.y)
      })
    } else if (action.type === 'text' && action.text) {
      minX = Math.min(minX, action.text.x)
      maxX = Math.max(maxX, action.text.x + 100) // 估算文本宽度
      minY = Math.min(minY, action.text.y - action.text.size)
      maxY = Math.max(maxY, action.text.y)
    }
  })

  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

// 获取组边界框的调整手柄
const getGroupHandleAt = (
  pos: { x: number; y: number },
  bounds: { x: number; y: number; w: number; h: number }
): string | null => {
  const handleSize = 8
  const isNear = (x: number, y: number): boolean =>
    Math.abs(pos.x - x) <= handleSize && Math.abs(pos.y - y) <= handleSize

  const { x, y, w, h } = bounds
  if (isNear(x, y)) return 'group-tl'
  if (isNear(x + w, y)) return 'group-tr'
  if (isNear(x, y + h)) return 'group-bl'
  if (isNear(x + w, y + h)) return 'group-br'
  return null
}

// 处理右键菜单
const handleContextMenu = (e: MouseEvent, pos: { x: number; y: number }): void => {
  e.preventDefault()

  // 检查是否点击了选中的元素
  let clickedSelection = false

  // 检查是否点击了组
  if (selectedGroupId.value) {
    const groupActions = history.value.filter((a) => a.groupId === selectedGroupId.value)
    for (const action of groupActions) {
      if (hitTest(pos, action)) {
        clickedSelection = true
        break
      }
    }
  }

  // 检查是否点击了多选元素
  if (!clickedSelection && selectedIndices.value.size > 0) {
    for (const idx of selectedIndices.value) {
      if (hitTest(pos, history.value[idx])) {
        clickedSelection = true
        break
      }
    }
  }

  // 检查是否点击了单选元素
  if (!clickedSelection && selectedActionIndex.value !== -1) {
    if (hitTest(pos, history.value[selectedActionIndex.value])) {
      clickedSelection = true
    }
  }

  // 如果没有点击选中的元素，尝试选中点击位置的元素
  if (!clickedSelection) {
    for (let i = history.value.length - 1; i >= 0; i--) {
      if (hitTest(pos, history.value[i])) {
        // 选中这个元素
        const hitAction = history.value[i]
        if (hitAction.groupId) {
          selectedGroupId.value = hitAction.groupId
          selectedActionIndex.value = -1
          selectedIndices.value.clear()
        } else {
          selectedIndices.value.clear()
          selectedIndices.value.add(i)
          selectedActionIndex.value = -1
          selectedGroupId.value = null
        }
        clickedSelection = true
        redraw()
        break
      }
    }
  }

  if (clickedSelection) {
    // 检查选中元素中是否包含组
    hasGroupInSelection.value = false
    if (selectedGroupId.value) {
      hasGroupInSelection.value = true
    } else if (selectedIndices.value.size > 0) {
      for (const idx of selectedIndices.value) {
        if (history.value[idx].groupId) {
          hasGroupInSelection.value = true
          break
        }
      }
    } else if (selectedActionIndex.value !== -1) {
      if (history.value[selectedActionIndex.value].groupId) {
        hasGroupInSelection.value = true
      }
    }

    isSettingsMenu.value = false
    contextMenuPos.value = { x: e.clientX, y: e.clientY }
    showContextMenu.value = true
  } else {
    // 空白处右键显示设置菜单
    isSettingsMenu.value = true
    contextMenuPos.value = { x: e.clientX, y: e.clientY }
    showContextMenu.value = true
  }
}

// 合并为组
const mergeToGroup = (): void => {
  const newGroupId = `group-${Date.now()}`

  // 如果选中了组，将组内元素合并
  if (selectedGroupId.value) {
    const groupActions = history.value.filter((a) => a.groupId === selectedGroupId.value)
    groupActions.forEach((action) => {
      action.groupId = newGroupId
    })
    selectedGroupId.value = newGroupId
  }

  // 如果有多选元素，全部设置为同一组
  if (selectedIndices.value.size > 0) {
    selectedIndices.value.forEach((idx) => {
      history.value[idx].groupId = newGroupId
    })
    selectedGroupId.value = newGroupId
    selectedIndices.value.clear()
  }

  showContextMenu.value = false
  redraw()
}

// 解散组
const ungroupSelection = (): void => {
  // 如果选中了组，移除所有组ID
  if (selectedGroupId.value) {
    history.value.forEach((action) => {
      if (action.groupId === selectedGroupId.value) {
        delete action.groupId
      }
    })
    selectedGroupId.value = null
  }

  // 如果有多选元素，移除所有组ID
  if (selectedIndices.value.size > 0) {
    selectedIndices.value.forEach((idx) => {
      delete history.value[idx].groupId
    })
  }

  showContextMenu.value = false
  redraw()
}

// 切换吸附功能
const toggleSnap = (): void => {
  snapEnabled.value = !snapEnabled.value
  showContextMenu.value = false
}

// 双击打开参数化设置
const handleDoubleClick = (e: MouseEvent): void => {
  if (!props.visible || currentTool.value !== 'select') return

  const pos = getMousePos(e)

  // 检查是否双击了组
  if (selectedGroupId.value) {
    const groupBounds = getGroupBounds(selectedGroupId.value)
    if (groupBounds) {
      // 检查是否点击在组的范围内
      const groupActions = history.value.filter((a) => a.groupId === selectedGroupId.value)
      let hitInGroup = false
      for (const action of groupActions) {
        if (hitTest(pos, action)) {
          hitInGroup = true
          break
        }
      }

      if (hitInGroup) {
        openGroupParameterizeModal()
        return
      }
    }
  }

  // 检查是否双击了单个元素
  if (selectedActionIndex.value !== -1) {
    const action = history.value[selectedActionIndex.value]
    // 如果是文本元素，触发编辑而非参数化
    if (action.type === 'text') {
      editSelectedText()
    } else {
      openParameterizeModal()
    }
  }
}

// 打开组参数化模态框
const openGroupParameterizeModal = (): void => {
  if (!selectedGroupId.value) return

  const groupBounds = getGroupBounds(selectedGroupId.value)
  if (!groupBounds) return

  paramIsGroup.value = true
  paramGroupId.value = selectedGroupId.value
  paramGroupWidth.value = Math.round(Math.abs(groupBounds.w))
  paramGroupHeight.value = Math.round(Math.abs(groupBounds.h))
  modalTitle.value = '设置组尺寸'
  modalType.value = 'parameterize'
  showModal.value = true
  showContextMenu.value = false
}

// 打开参数化模态框
const openParameterizeModal = (): void => {
  if (selectedActionIndex.value === -1) return

  const action = history.value[selectedActionIndex.value]
  paramModalAction.value = action
  paramModalIndex.value = selectedActionIndex.value
  paramIsGroup.value = false
  paramGroupId.value = null

  // 根据元素类型初始化参数
  if (action.type === 'line' && action.points && action.points.length >= 2) {
    const dx = action.points[1].x - action.points[0].x
    const dy = action.points[1].y - action.points[0].y
    paramLineLength.value = Math.round(Math.sqrt(dx * dx + dy * dy))
    modalTitle.value = '设置线条长度'
  } else if (action.type === 'rect' && action.rect) {
    paramRectWidth.value = Math.round(Math.abs(action.rect.w))
    paramRectHeight.value = Math.round(Math.abs(action.rect.h))
    modalTitle.value = '设置矩形尺寸'
  } else if (action.type === 'circle' && action.circle) {
    paramCircleDiameter.value = Math.round(action.circle.r * 2)
    modalTitle.value = '设置圆形直径'
  }

  modalType.value = 'parameterize'
  showModal.value = true
  showContextMenu.value = false
}

// 应用参数化设置
const applyParameterize = (): void => {
  // 如果是组参数化
  if (paramIsGroup.value && paramGroupId.value) {
    const groupBounds = getGroupBounds(paramGroupId.value)
    if (!groupBounds) return

    const newW = paramGroupWidth.value
    const newH = paramGroupHeight.value
    const scaleX = newW / groupBounds.w
    const scaleY = newH / groupBounds.h

    // 更新组内所有元素
    const groupActions = history.value.filter((a) => a.groupId === paramGroupId.value)
    groupActions.forEach((action) => {
      if (action.type === 'rect' && action.rect) {
        const relX = (action.rect.x - groupBounds.x) / groupBounds.w
        const relY = (action.rect.y - groupBounds.y) / groupBounds.h
        const relW = action.rect.w / groupBounds.w
        const relH = action.rect.h / groupBounds.h

        action.rect.x = groupBounds.x + relX * newW
        action.rect.y = groupBounds.y + relY * newH
        action.rect.w = relW * newW
        action.rect.h = relH * newH
      } else if (action.type === 'circle' && action.circle) {
        const relX = (action.circle.x - groupBounds.x) / groupBounds.w
        const relY = (action.circle.y - groupBounds.y) / groupBounds.h
        const relR = action.circle.r / groupBounds.w

        action.circle.x = groupBounds.x + relX * newW
        action.circle.y = groupBounds.y + relY * newH
        action.circle.r = relR * newW
      } else if (action.type === 'line' && action.points) {
        action.points = action.points.map((p) => {
          const relX = (p.x - groupBounds.x) / groupBounds.w
          const relY = (p.y - groupBounds.y) / groupBounds.h
          return {
            x: groupBounds.x + relX * newW,
            y: groupBounds.y + relY * newH
          }
        })
      } else if (action.type === 'text' && action.text) {
        const relX = (action.text.x - groupBounds.x) / groupBounds.w
        const relY = (action.text.y - groupBounds.y) / groupBounds.h

        action.text.x = groupBounds.x + relX * newW
        action.text.y = groupBounds.y + relY * newH
        action.text.size = Math.round(action.text.size * Math.min(scaleX, scaleY))
      }
    })

    redraw()
    closeModal()
    return
  }

  // 单个元素参数化
  if (paramModalIndex.value === -1) return

  const action = history.value[paramModalIndex.value]

  if (action.type === 'line' && action.points && action.points.length >= 2) {
    // 计算当前线段的角度
    const dx = action.points[1].x - action.points[0].x
    const dy = action.points[1].y - action.points[0].y
    const angle = Math.atan2(dy, dx)

    // 按新长度重新计算终点
    const newLength = paramLineLength.value
    action.points[1].x = action.points[0].x + newLength * Math.cos(angle)
    action.points[1].y = action.points[0].y + newLength * Math.sin(angle)
  } else if (action.type === 'rect' && action.rect) {
    // 保持左上角位置，改变宽高
    const keepNegativeW = action.rect.w < 0
    const keepNegativeH = action.rect.h < 0
    action.rect.w = paramRectWidth.value * (keepNegativeW ? -1 : 1)
    action.rect.h = paramRectHeight.value * (keepNegativeH ? -1 : 1)
  } else if (action.type === 'circle' && action.circle) {
    // 改变半径
    action.circle.r = paramCircleDiameter.value / 2
  }

  redraw()
  closeModal()
}

const closeModal = (): void => {
  showModal.value = false
  paramModalAction.value = null
  paramModalIndex.value = -1
  paramIsGroup.value = false
  paramGroupId.value = null
}

// 获取所有可吸附的端点
const getAllSnapPoints = (): { x: number; y: number }[] => {
  const points: { x: number; y: number }[] = []

  history.value.forEach((action) => {
    if (action.type === 'line' && action.points && action.points.length >= 2) {
      points.push(action.points[0], action.points[1])
    } else if (action.type === 'rect' && action.rect) {
      const { x, y, w, h } = action.rect
      points.push({ x, y }, { x: x + w, y }, { x, y: y + h }, { x: x + w, y: y + h })
    } else if (action.type === 'circle' && action.circle) {
      const { x, y, r } = action.circle
      points.push({ x: x - r, y }, { x: x + r, y }, { x, y: y - r }, { x, y: y + r })
    } else if (action.type === 'text' && action.text) {
      points.push({ x: action.text.x, y: action.text.y })
    }
  })

  return points
}

// 查找最近的吸附点
const findNearestSnapPoint = (pos: { x: number; y: number }): { x: number; y: number } | null => {
  if (!snapEnabled.value) return null

  const snapPoints = getAllSnapPoints()
  let nearest: { x: number; y: number } | null = null
  let minDist = snapDistance.value

  snapPoints.forEach((point) => {
    const dist = Math.sqrt(Math.pow(pos.x - point.x, 2) + Math.pow(pos.y - point.y, 2))
    if (dist < minDist) {
      minDist = dist
      nearest = point
    }
  })

  return nearest
}

// 应用吸附到位置
const applySnap = (pos: { x: number; y: number }): { x: number; y: number } => {
  const snap = findNearestSnapPoint(pos)
  if (snap) {
    snapPoint.value = snap
    return snap
  }
  snapPoint.value = null
  return pos
}

const startDrawing = (e: MouseEvent): void => {
  if (!props.visible) return // Only interact if visible
  if (showModal.value) return

  const pos = getMousePos(e)
  const isCtrlPressed = e.ctrlKey || e.metaKey

  // 右键点击：显示上下文菜单
  if (e.button === 2) {
    e.preventDefault()
    if (currentTool.value === 'select') {
      handleContextMenu(e, pos)
    }
    return
  }

  if (currentTool.value === 'select') {
    // 隐藏右键菜单
    showContextMenu.value = false

    // 1. 检查是否点击了组的调整手柄
    if (selectedGroupId.value && !isCtrlPressed) {
      const groupBounds = getGroupBounds(selectedGroupId.value)
      if (groupBounds) {
        const handle = getGroupHandleAt(pos, groupBounds)
        if (handle) {
          isDragging.value = true
          dragHandle.value = handle
          dragStartPos.value = pos
          const groupActions = history.value.filter((a) => a.groupId === selectedGroupId.value)
          initialGroupState.value = groupActions.map((a) => JSON.parse(JSON.stringify(a)))
          // 保存原始边界到第一个元素的meta字段
          if (initialGroupState.value.length > 0) {
            const firstElement = initialGroupState.value[0] as DrawAction & {
              _originalBounds?: ReturnType<typeof getGroupBounds>
            }
            firstElement._originalBounds = JSON.parse(JSON.stringify(groupBounds))
          }
          return
        }
      }
    }

    // 2. 检查是否点击了组内元素（拖动整个组）
    if (selectedGroupId.value && !isCtrlPressed) {
      const groupActions = history.value.filter((a) => a.groupId === selectedGroupId.value)
      let hitInGroup = false

      for (const action of groupActions) {
        if (hitTest(pos, action)) {
          hitInGroup = true
          break
        }
      }

      if (hitInGroup) {
        isDragging.value = true
        dragHandle.value = 'group-move'
        dragStartPos.value = pos
        initialGroupState.value = groupActions.map((a) => JSON.parse(JSON.stringify(a)))
        return
      } else {
        // 点击了组外，取消组选择
        selectedGroupId.value = null
      }
    }

    // 3. 检查是否点击了多选元素中的任一元素（拖动所有多选元素）
    if (selectedIndices.value.size > 0 && !isCtrlPressed) {
      let hitInSelection = false

      for (const idx of selectedIndices.value) {
        if (hitTest(pos, history.value[idx])) {
          hitInSelection = true
          break
        }
      }

      if (hitInSelection) {
        isDragging.value = true
        dragHandle.value = 'multi-move'
        dragStartPos.value = pos
        initialGroupState.value = Array.from(selectedIndices.value).map((idx) =>
          JSON.parse(JSON.stringify(history.value[idx]))
        )
        return
      } else {
        // 点击了选区外，清空多选
        if (!isCtrlPressed) {
          selectedIndices.value.clear()
        }
      }
    }

    // 4. 检查是否点击了单个选中元素的调整手柄
    if (selectedActionIndex.value !== -1 && !isCtrlPressed) {
      const action = history.value[selectedActionIndex.value]
      const handle = getHandleAt(pos, action)
      if (handle) {
        isDragging.value = true
        dragHandle.value = handle
        dragStartPos.value = pos
        initialActionState.value = JSON.parse(JSON.stringify(action))
        return
      }
    }

    // 5. 检查是否点击了某个图形元素
    let hitIndex = -1
    for (let i = history.value.length - 1; i >= 0; i--) {
      if (hitTest(pos, history.value[i])) {
        hitIndex = i
        break
      }
    }

    if (hitIndex !== -1) {
      const hitAction = history.value[hitIndex]

      if (isCtrlPressed) {
        // Ctrl 多选模式
        if (selectedIndices.value.has(hitIndex)) {
          // 取消选择
          selectedIndices.value.delete(hitIndex)
        } else {
          // 添加到选择
          selectedIndices.value.add(hitIndex)
        }
        selectedActionIndex.value = -1
        selectedGroupId.value = null
        redraw()
        return
      }

      // 普通点击
      if (hitAction.groupId) {
        // 如果点击的元素有 groupId，选中整个组
        selectedGroupId.value = hitAction.groupId
        selectedActionIndex.value = -1
        selectedIndices.value.clear()
        isDragging.value = true
        dragHandle.value = 'group-move'
        dragStartPos.value = pos
        const groupActions = history.value.filter((a) => a.groupId === hitAction.groupId)
        initialGroupState.value = groupActions.map((a) => JSON.parse(JSON.stringify(a)))
      } else {
        // 单个元素选择
        selectedActionIndex.value = hitIndex
        selectedGroupId.value = null
        selectedIndices.value.clear()
        isDragging.value = true
        dragHandle.value = 'move'
        dragStartPos.value = pos
        initialActionState.value = JSON.parse(JSON.stringify(history.value[hitIndex]))
      }
      redraw()
    } else {
      // 没有点击任何元素，开始框选
      if (!isCtrlPressed) {
        selectedActionIndex.value = -1
        selectedGroupId.value = null
        selectedIndices.value.clear()
      }
      isBoxSelecting.value = true
      boxSelectStart.value = pos
      boxSelectEnd.value = pos
      redraw()
    }
    return
  }

  if (currentTool.value === 'text') {
    handleTextTool(e)
    return
  }

  // Start new drawing
  selectedActionIndex.value = -1 // Deselect
  selectedGroupId.value = null
  selectedIndices.value.clear()
  isDrawing.value = true

  // 对于线条工具，应用起点吸附
  let startPoint = pos
  if (currentTool.value === 'line') {
    startPoint = applySnap(pos)
  }

  // 同步更新startPos以保持一致性
  startPos.value = startPoint

  currentAction.value = {
    type: currentTool.value,
    color: currentColor.value,
    lineWidth: currentLineWidth.value,
    points: [startPoint],
    rect: { x: startPoint.x, y: startPoint.y, w: 0, h: 0 },
    circle: { x: startPoint.x, y: startPoint.y, r: 0 }
  }
}

const draw = (e: MouseEvent): void => {
  if (!props.visible) return
  const pos = getMousePos(e)

  // 在绘图工具模式下（非选择工具），显示潜在吸附点提示
  if (
    currentTool.value !== 'select' &&
    !isDrawing.value &&
    (currentTool.value === 'line' || currentTool.value === 'rect' || currentTool.value === 'circle')
  ) {
    // 仅用于视觉提示，不实际应用
    const snap = findNearestSnapPoint(pos)
    snapPoint.value = snap
    redraw()
    return
  }

  // 框选拖动
  if (currentTool.value === 'select' && isBoxSelecting.value) {
    boxSelectEnd.value = pos
    redraw()
    return
  }

  // 组拖动
  if (currentTool.value === 'select' && isDragging.value && dragHandle.value === 'group-move') {
    const dx = pos.x - dragStartPos.value.x
    const dy = pos.y - dragStartPos.value.y

    // 更新组内所有元素
    const groupActions = history.value.filter((a) => a.groupId === selectedGroupId.value)
    groupActions.forEach((action, idx) => {
      const init = initialGroupState.value[idx]
      if (!init) return

      if (action.type === 'rect' && action.rect && init.rect) {
        action.rect.x = init.rect.x + dx
        action.rect.y = init.rect.y + dy
      } else if (action.type === 'circle' && action.circle && init.circle) {
        action.circle.x = init.circle.x + dx
        action.circle.y = init.circle.y + dy
      } else if (action.type === 'line' && action.points && init.points) {
        action.points = init.points.map((p) => ({ x: p.x + dx, y: p.y + dy }))
      } else if (action.type === 'text' && action.text && init.text) {
        action.text.x = init.text.x + dx
        action.text.y = init.text.y + dy
      }
    })
    redraw()
    return
  }

  // 组尺寸调整（保持相对位置）
  if (
    currentTool.value === 'select' &&
    isDragging.value &&
    dragHandle.value?.startsWith('group-') &&
    dragHandle.value !== 'group-move'
  ) {
    // 从保存的初始状态读取原始边界
    const origBounds =
      initialGroupState.value.length > 0
        ? (
            initialGroupState.value[0] as DrawAction & {
              _originalBounds?: ReturnType<typeof getGroupBounds>
            }
          )._originalBounds
        : null
    if (!origBounds) return

    const dx = pos.x - dragStartPos.value.x
    const dy = pos.y - dragStartPos.value.y

    // 计算新边界
    let newX = origBounds.x
    let newY = origBounds.y
    let newW = origBounds.w
    let newH = origBounds.h

    if (dragHandle.value === 'group-br') {
      newW = origBounds.w + dx
      newH = origBounds.h + dy
    } else if (dragHandle.value === 'group-tl') {
      newW = origBounds.w - dx
      newH = origBounds.h - dy
      newX = origBounds.x + dx
      newY = origBounds.y + dy
    } else if (dragHandle.value === 'group-tr') {
      newW = origBounds.w + dx
      newH = origBounds.h - dy
      newY = origBounds.y + dy
    } else if (dragHandle.value === 'group-bl') {
      newW = origBounds.w - dx
      newH = origBounds.h + dy
      newX = origBounds.x + dx
    }

    // 计算缩放比例
    const scaleX = newW / origBounds.w
    const scaleY = newH / origBounds.h

    // 更新组内所有元素
    const groupActions = history.value.filter((a) => a.groupId === selectedGroupId.value)
    groupActions.forEach((action, idx) => {
      const init = initialGroupState.value[idx]
      if (!init) return

      if (action.type === 'rect' && action.rect && init.rect) {
        const relX = (init.rect.x - origBounds.x) / origBounds.w
        const relY = (init.rect.y - origBounds.y) / origBounds.h
        const relW = init.rect.w / origBounds.w
        const relH = init.rect.h / origBounds.h

        action.rect.x = newX + relX * newW
        action.rect.y = newY + relY * newH
        action.rect.w = relW * newW
        action.rect.h = relH * newH
      } else if (action.type === 'circle' && action.circle && init.circle) {
        const relX = (init.circle.x - origBounds.x) / origBounds.w
        const relY = (init.circle.y - origBounds.y) / origBounds.h
        const relR = init.circle.r / origBounds.w

        action.circle.x = newX + relX * newW
        action.circle.y = newY + relY * newH
        action.circle.r = relR * newW
      } else if (action.type === 'line' && action.points && init.points) {
        action.points = init.points.map((p) => {
          const relX = (p.x - origBounds.x) / origBounds.w
          const relY = (p.y - origBounds.y) / origBounds.h
          return {
            x: newX + relX * newW,
            y: newY + relY * newH
          }
        })
      } else if (action.type === 'text' && action.text && init.text) {
        const relX = (init.text.x - origBounds.x) / origBounds.w
        const relY = (init.text.y - origBounds.y) / origBounds.h

        action.text.x = newX + relX * newW
        action.text.y = newY + relY * newH
        action.text.size = Math.round(init.text.size * Math.min(scaleX, scaleY))
      }
    })
    redraw()
    return
  }

  // 多选元素拖动
  if (currentTool.value === 'select' && isDragging.value && dragHandle.value === 'multi-move') {
    const dx = pos.x - dragStartPos.value.x
    const dy = pos.y - dragStartPos.value.y

    // 更新所有多选元素
    Array.from(selectedIndices.value).forEach((idx, i) => {
      const action = history.value[idx]
      const init = initialGroupState.value[i]
      if (!init) return

      if (action.type === 'rect' && action.rect && init.rect) {
        action.rect.x = init.rect.x + dx
        action.rect.y = init.rect.y + dy
      } else if (action.type === 'circle' && action.circle && init.circle) {
        action.circle.x = init.circle.x + dx
        action.circle.y = init.circle.y + dy
      } else if (action.type === 'line' && action.points && init.points) {
        action.points = init.points.map((p) => ({ x: p.x + dx, y: p.y + dy }))
      } else if (action.type === 'text' && action.text && init.text) {
        action.text.x = init.text.x + dx
        action.text.y = init.text.y + dy
      }
    })
    redraw()
    return
  }

  // 单个元素拖动/调整
  if (currentTool.value === 'select' && isDragging.value && selectedActionIndex.value !== -1) {
    const action = history.value[selectedActionIndex.value]
    const dx = pos.x - dragStartPos.value.x
    const dy = pos.y - dragStartPos.value.y
    const init = initialActionState.value

    if (!init) return

    if (dragHandle.value === 'move') {
      if (action.type === 'rect' && action.rect && init.rect) {
        action.rect.x = init.rect.x + dx
        action.rect.y = init.rect.y + dy
      } else if (action.type === 'circle' && action.circle && init.circle) {
        action.circle.x = init.circle.x + dx
        action.circle.y = init.circle.y + dy
      } else if (
        action.type === 'line' &&
        action.points &&
        init.points &&
        action.points.length >= 2 &&
        init.points.length >= 2
      ) {
        action.points[0].x = init.points[0].x + dx
        action.points[0].y = init.points[0].y + dy
        action.points[1].x = init.points[1].x + dx
        action.points[1].y = init.points[1].y + dy
      } else if (action.type === 'text' && action.text && init.text) {
        action.text.x = init.text.x + dx
        action.text.y = init.text.y + dy
      }
    } else {
      // Resizing
      if (action.type === 'rect' && action.rect && init.rect) {
        let newW = 0
        let newH = 0
        let newX = action.rect.x
        let newY = action.rect.y

        if (dragHandle.value === 'br') {
          newW = init.rect.w + dx
          newH = init.rect.h + dy
          newX = init.rect.x
          newY = init.rect.y
        } else if (dragHandle.value === 'tl') {
          newW = init.rect.w - dx
          newH = init.rect.h - dy
          newX = init.rect.x + dx
          newY = init.rect.y + dy
        } else if (dragHandle.value === 'tr') {
          newW = init.rect.w + dx
          newH = init.rect.h - dy
          newX = init.rect.x
          newY = init.rect.y + dy
        } else if (dragHandle.value === 'bl') {
          newW = init.rect.w - dx
          newH = init.rect.h + dy
          newX = init.rect.x + dx
          newY = init.rect.y
        }

        if (e.shiftKey) {
          const s = Math.max(Math.abs(newW), Math.abs(newH))
          newW = s * (newW < 0 ? -1 : 1)
          newH = s * (newH < 0 ? -1 : 1)
          // Adjust X/Y if dragging left/top handles to maintain anchor
          if (dragHandle.value === 'tl' || dragHandle.value === 'bl') {
            newX = init.rect.x + init.rect.w - newW
          }
          if (dragHandle.value === 'tl' || dragHandle.value === 'tr') {
            newY = init.rect.y + init.rect.h - newH
          }
        }

        action.rect.x = newX
        action.rect.y = newY
        action.rect.w = newW
        action.rect.h = newH
      } else if (action.type === 'circle' && action.circle && init.circle) {
        if (dragHandle.value === 'r') {
          // Distance from center to mouse
          const r = Math.sqrt(
            Math.pow(pos.x - action.circle.x, 2) + Math.pow(pos.y - action.circle.y, 2)
          )
          action.circle.r = r
        }
      } else if (
        action.type === 'line' &&
        action.points &&
        init.points &&
        action.points.length >= 2
      ) {
        let targetX = pos.x
        let targetY = pos.y
        if (e.shiftKey) {
          const otherPoint = dragHandle.value === 'p1' ? action.points[1] : action.points[0]
          const dx = pos.x - otherPoint.x
          const dy = pos.y - otherPoint.y
          if (Math.abs(dx) > Math.abs(dy)) {
            targetY = otherPoint.y
          } else {
            targetX = otherPoint.x
          }
        }

        if (dragHandle.value === 'p1') {
          action.points[0].x = targetX
          action.points[0].y = targetY
        } else if (dragHandle.value === 'p2') {
          action.points[1].x = targetX
          action.points[1].y = targetY
        }
      }
    }
    redraw()
    return
  }

  if (!isDrawing.value || !currentAction.value || !ctx.value) return

  // Clear and redraw history + current action
  redraw()

  ctx.value.beginPath()
  ctx.value.strokeStyle = currentAction.value.color
  ctx.value.lineWidth = currentAction.value.lineWidth

  if (currentTool.value === 'line') {
    let targetX = pos.x
    let targetY = pos.y

    // 应用端点吸附
    const snappedPos = applySnap({ x: targetX, y: targetY })
    targetX = snappedPos.x
    targetY = snappedPos.y

    if (e.shiftKey) {
      const dx = targetX - startPos.value.x
      const dy = targetY - startPos.value.y
      if (Math.abs(dx) > Math.abs(dy)) {
        targetY = startPos.value.y // Horizontal
      } else {
        targetX = startPos.value.x // Vertical
      }
    }
    ctx.value.moveTo(startPos.value.x, startPos.value.y)
    ctx.value.lineTo(targetX, targetY)
    ctx.value.stroke()
    currentAction.value.points = [startPos.value, { x: targetX, y: targetY }]
  } else if (currentTool.value === 'rect') {
    let w = pos.x - startPos.value.x
    let h = pos.y - startPos.value.y
    if (e.shiftKey) {
      const s = Math.max(Math.abs(w), Math.abs(h))
      w = s * (w < 0 ? -1 : 1)
      h = s * (h < 0 ? -1 : 1)
    }
    ctx.value.strokeRect(startPos.value.x, startPos.value.y, w, h)
    currentAction.value.rect = { x: startPos.value.x, y: startPos.value.y, w, h }
  } else if (currentTool.value === 'circle') {
    const r = Math.sqrt(
      Math.pow(pos.x - startPos.value.x, 2) + Math.pow(pos.y - startPos.value.y, 2)
    )
    ctx.value.arc(startPos.value.x, startPos.value.y, r, 0, 2 * Math.PI)
    ctx.value.stroke()
    currentAction.value.circle = { x: startPos.value.x, y: startPos.value.y, r }
  } else if (currentTool.value === 'eraser') {
    ctx.value.save()
    ctx.value.globalCompositeOperation = 'destination-out'
    ctx.value.lineWidth = 20
    ctx.value.lineCap = 'round'
    ctx.value.beginPath()
    ctx.value.moveTo(startPos.value.x, startPos.value.y)
    if (!currentAction.value.points) currentAction.value.points = []
    currentAction.value.points.push(pos)

    ctx.value.beginPath()
    if (currentAction.value.points.length > 1) {
      const prev = currentAction.value.points[currentAction.value.points.length - 2]
      ctx.value.moveTo(prev.x, prev.y)
      ctx.value.lineTo(pos.x, pos.y)
      ctx.value.stroke()
    }
    ctx.value.restore()
  }
}

const stopDrawing = (): void => {
  // 框选结束
  if (isBoxSelecting.value) {
    isBoxSelecting.value = false

    // 检查框选区域内的元素
    const minX = Math.min(boxSelectStart.value.x, boxSelectEnd.value.x)
    const maxX = Math.max(boxSelectStart.value.x, boxSelectEnd.value.x)
    const minY = Math.min(boxSelectStart.value.y, boxSelectEnd.value.y)
    const maxY = Math.max(boxSelectStart.value.y, boxSelectEnd.value.y)

    // 找出所有在框选区域内的元素
    const newSelectedIndices: number[] = []
    history.value.forEach((action, idx) => {
      if (isActionInBox(action, minX, minY, maxX, maxY)) {
        newSelectedIndices.push(idx)
      }
    })

    // 如果选中了多个元素，添加到多选集合
    if (newSelectedIndices.length > 0) {
      // 根据是否按住 Ctrl 决定是追加还是替换
      if (!selectedIndices.value.size) {
        selectedIndices.value = new Set(newSelectedIndices)
      } else {
        newSelectedIndices.forEach((idx) => selectedIndices.value.add(idx))
      }
      selectedActionIndex.value = -1
      selectedGroupId.value = null
    }

    redraw()
    return
  }

  if (isDragging.value) {
    isDragging.value = false
    dragHandle.value = null
    initialActionState.value = null
    initialGroupState.value = []
    return
  }

  if (!isDrawing.value) return
  isDrawing.value = false
  if (currentAction.value) {
    // 验证图形数据有效性
    let isValid = true
    if (currentAction.value.type === 'line') {
      // 线条必须有至少 2 个点
      isValid = !!(currentAction.value.points && currentAction.value.points.length >= 2)
    } else if (currentAction.value.type === 'rect') {
      // 矩形宽高不能为 0
      isValid = !!(
        currentAction.value.rect &&
        (currentAction.value.rect.w !== 0 || currentAction.value.rect.h !== 0)
      )
    } else if (currentAction.value.type === 'circle') {
      // 圆形半径不能为 0
      isValid = !!(currentAction.value.circle && currentAction.value.circle.r !== 0)
    }

    if (isValid) {
      history.value.push(currentAction.value)
      redoStack.value = [] // Clear redo stack
    }
    currentAction.value = null
  }
  redraw()
}

// 检查元素是否在框选区域内
const isActionInBox = (
  action: DrawAction,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number
): boolean => {
  if (action.type === 'rect' && action.rect) {
    const { x, y, w, h } = action.rect
    return x >= minX && x + w <= maxX && y >= minY && y + h <= maxY
  } else if (action.type === 'circle' && action.circle) {
    const { x, y, r } = action.circle
    return x - r >= minX && x + r <= maxX && y - r >= minY && y + r <= maxY
  } else if (action.type === 'line' && action.points && action.points.length >= 2) {
    const p1 = action.points[0]
    const p2 = action.points[1]
    return (
      p1.x >= minX &&
      p1.x <= maxX &&
      p1.y >= minY &&
      p1.y <= maxY &&
      p2.x >= minX &&
      p2.x <= maxX &&
      p2.y >= minY &&
      p2.y <= maxY
    )
  } else if (action.type === 'text' && action.text) {
    const { x, y } = action.text
    return x >= minX && x <= maxX && y >= minY && y <= maxY
  }
  return false
}

// 暂存文本工具的点击位置
const textPos = ref({ x: 0, y: 0 })

const handleTextTool = (e: MouseEvent): void => {
  textPos.value = getMousePos(e)
  modalType.value = 'text'
  modalTitle.value = '添加文本'
  modalValue.value = ''
  modalTextSize.value = 20
  modalTextBold.value = false
  modalTextItalic.value = false
  showModal.value = true
}

const editSelectedText = (): void => {
  if (selectedActionIndex.value !== -1) {
    const action = history.value[selectedActionIndex.value]
    if (action.type === 'text' && action.text) {
      textPos.value = { x: action.text.x, y: action.text.y }
      modalType.value = 'text'
      modalTitle.value = '编辑文本'
      modalValue.value = action.text.content
      modalTextSize.value = action.text.size
      modalTextBold.value = action.text.isBold || false
      modalTextItalic.value = action.text.isItalic || false
      showModal.value = true
    }
  }
}

const handleModalConfirm = (): void => {
  if (modalType.value === 'text') {
    if (modalValue.value) {
      // Check if we are editing existing text
      if (
        selectedActionIndex.value !== -1 &&
        history.value[selectedActionIndex.value]?.type === 'text'
      ) {
        const action = history.value[selectedActionIndex.value]
        if (action.text) {
          action.text.content = modalValue.value
          action.text.size = modalTextSize.value
          action.text.isBold = modalTextBold.value
          action.text.isItalic = modalTextItalic.value
          action.color = currentColor.value // Update color too?
        }
      } else {
        // New text
        const action: DrawAction = {
          type: 'text',
          color: currentColor.value,
          lineWidth: 1,
          text: {
            x: textPos.value.x,
            y: textPos.value.y,
            content: modalValue.value,
            size: modalTextSize.value,
            isBold: modalTextBold.value,
            isItalic: modalTextItalic.value
          }
        }
        history.value.push(action)
        redoStack.value = []
      }
      redraw()
    }
  } else if (modalType.value === 'config') {
    if (modalValue.value) {
      currentConfigName.value = modalValue.value
      if (history.value.length > 0 && !confirm('是否保留当前画布内容到新配置？')) {
        history.value = []
        redoStack.value = []
        selectedActionIndex.value = -1
        selectedGroupId.value = null
        redraw()
      }
      saveConfigInternal()
    }
  }
  showModal.value = false
}

const redraw = (): void => {
  if (!ctx.value || !canvasRef.value) return
  ctx.value.clearRect(0, 0, canvasRef.value.width, canvasRef.value.height)

  history.value.forEach((action, index) => {
    drawAction(action)

    // 绘制单个元素选择手柄
    if (index === selectedActionIndex.value && props.visible) {
      drawSelectionHandles(action)
    }

    // 绘制多选元素高亮
    if (selectedIndices.value.has(index) && props.visible) {
      drawMultiSelectHighlight(action)
    }

    // 绘制组选择高亮
    if (selectedGroupId.value && action.groupId === selectedGroupId.value && props.visible) {
      drawGroupHighlight(action)
    }
  })

  // 绘制组的整体边界和调整手柄
  if (selectedGroupId.value && props.visible) {
    const groupBounds = getGroupBounds(selectedGroupId.value)
    if (groupBounds) {
      drawGroupBounds(groupBounds)
    }
  }

  // 绘制框选框
  if (isBoxSelecting.value && props.visible) {
    drawBoxSelection()
  }

  // 绘制吸附点
  if (snapPoint.value && props.visible && snapEnabled.value) {
    drawSnapPoint(snapPoint.value)
  }
}

// 绘制吸附点指示器
const drawSnapPoint = (point: { x: number; y: number }): void => {
  if (!ctx.value) return
  ctx.value.save()
  ctx.value.strokeStyle = '#00ff00'
  ctx.value.fillStyle = '#00ff00'
  ctx.value.lineWidth = 2

  // 绘制十字准星
  ctx.value.beginPath()
  ctx.value.moveTo(point.x - 8, point.y)
  ctx.value.lineTo(point.x + 8, point.y)
  ctx.value.moveTo(point.x, point.y - 8)
  ctx.value.lineTo(point.x, point.y + 8)
  ctx.value.stroke()

  // 绘制中心圆
  ctx.value.beginPath()
  ctx.value.arc(point.x, point.y, 3, 0, 2 * Math.PI)
  ctx.value.fill()

  ctx.value.restore()
}

// 绘制组的边界框和调整手柄
const drawGroupBounds = (bounds: { x: number; y: number; w: number; h: number }): void => {
  if (!ctx.value) return
  ctx.value.save()
  ctx.value.strokeStyle = '#ff9900'
  ctx.value.fillStyle = '#ffffff'
  ctx.value.lineWidth = 2
  ctx.value.setLineDash([5, 5])

  const { x, y, w, h } = bounds
  ctx.value.strokeRect(x - 3, y - 3, w + 6, h + 6)

  // 绘制调整手柄
  ctx.value.setLineDash([])
  const drawHandle = (hx: number, hy: number): void => {
    if (!ctx.value) return
    ctx.value.beginPath()
    ctx.value.rect(hx - 5, hy - 5, 10, 10)
    ctx.value.fill()
    ctx.value.stroke()
  }

  drawHandle(x, y) // tl
  drawHandle(x + w, y) // tr
  drawHandle(x, y + h) // bl
  drawHandle(x + w, y + h) // br

  ctx.value.restore()
}

// 绘制多选元素高亮
const drawMultiSelectHighlight = (action: DrawAction): void => {
  if (!ctx.value) return
  ctx.value.save()
  ctx.value.strokeStyle = '#00ffaa'
  ctx.value.lineWidth = 2
  ctx.value.setLineDash([3, 3])

  if (action.type === 'rect' && action.rect) {
    const { x, y, w, h } = action.rect
    ctx.value.strokeRect(x - 2, y - 2, w + 4, h + 4)
  } else if (action.type === 'circle' && action.circle) {
    const { x, y, r } = action.circle
    ctx.value.beginPath()
    ctx.value.arc(x, y, r + 2, 0, 2 * Math.PI)
    ctx.value.stroke()
  } else if (action.type === 'line' && action.points && action.points.length >= 2) {
    const p1 = action.points[0]
    const p2 = action.points[1]
    ctx.value.fillStyle = '#00ffaa'
    ctx.value.beginPath()
    ctx.value.arc(p1.x, p1.y, 3, 0, 2 * Math.PI)
    ctx.value.fill()
    ctx.value.beginPath()
    ctx.value.arc(p2.x, p2.y, 3, 0, 2 * Math.PI)
    ctx.value.fill()
  } else if (action.type === 'text' && action.text) {
    const { x, y, size } = action.text
    ctx.value.strokeRect(x - 2, y - size - 2, 100, size + 4)
  }

  ctx.value.restore()
}

// 绘制框选框
const drawBoxSelection = (): void => {
  if (!ctx.value) return
  ctx.value.save()
  ctx.value.strokeStyle = '#00aaff'
  ctx.value.lineWidth = 1
  ctx.value.setLineDash([5, 5])

  const x = Math.min(boxSelectStart.value.x, boxSelectEnd.value.x)
  const y = Math.min(boxSelectStart.value.y, boxSelectEnd.value.y)
  const w = Math.abs(boxSelectEnd.value.x - boxSelectStart.value.x)
  const h = Math.abs(boxSelectEnd.value.y - boxSelectStart.value.y)

  ctx.value.strokeRect(x, y, w, h)
  ctx.value.restore()
}

// 绘制组高亮
const drawGroupHighlight = (action: DrawAction): void => {
  if (!ctx.value) return
  ctx.value.save()
  ctx.value.strokeStyle = '#ff9900'
  ctx.value.lineWidth = 2
  ctx.value.setLineDash([])

  if (action.type === 'rect' && action.rect) {
    const { x, y, w, h } = action.rect
    ctx.value.strokeRect(x - 2, y - 2, w + 4, h + 4)
  } else if (action.type === 'circle' && action.circle) {
    const { x, y, r } = action.circle
    ctx.value.beginPath()
    ctx.value.arc(x, y, r + 2, 0, 2 * Math.PI)
    ctx.value.stroke()
  } else if (action.type === 'line' && action.points && action.points.length >= 2) {
    const p1 = action.points[0]
    const p2 = action.points[1]
    ctx.value.beginPath()
    ctx.value.arc(p1.x, p1.y, 3, 0, 2 * Math.PI)
    ctx.value.fill()
    ctx.value.beginPath()
    ctx.value.arc(p2.x, p2.y, 3, 0, 2 * Math.PI)
    ctx.value.fill()
  } else if (action.type === 'text' && action.text) {
    const { x, y, size } = action.text
    ctx.value.strokeRect(x - 2, y - size - 2, 100, size + 4)
  }

  ctx.value.restore()
}

const drawAction = (action: DrawAction): void => {
  if (!ctx.value) return
  ctx.value.save()
  ctx.value.beginPath()
  ctx.value.strokeStyle = action.color
  ctx.value.lineWidth = action.lineWidth
  ctx.value.fillStyle = action.color

  if (action.type === 'line' && action.points && action.points.length >= 2) {
    ctx.value.moveTo(action.points[0].x, action.points[0].y)
    ctx.value.lineTo(action.points[1].x, action.points[1].y)
    ctx.value.stroke()
  } else if (action.type === 'rect' && action.rect) {
    ctx.value.strokeRect(action.rect.x, action.rect.y, action.rect.w, action.rect.h)
  } else if (action.type === 'circle' && action.circle) {
    ctx.value.arc(action.circle.x, action.circle.y, action.circle.r, 0, 2 * Math.PI)
    ctx.value.stroke()
  } else if (action.type === 'text' && action.text) {
    const fontStyle = `${action.text.isItalic ? 'italic ' : ''}${action.text.isBold ? 'bold ' : ''}`
    ctx.value.font = `${fontStyle}${action.text.size}px Arial`
    ctx.value.fillText(action.text.content, action.text.x, action.text.y)
  } else if (action.type === 'eraser' && action.points) {
    ctx.value.globalCompositeOperation = 'destination-out'
    ctx.value.lineWidth = 20
    ctx.value.lineCap = 'round'
    ctx.value.beginPath()
    if (action.points.length > 0) {
      ctx.value.moveTo(action.points[0].x, action.points[0].y)
      for (let i = 1; i < action.points.length; i++) {
        ctx.value.lineTo(action.points[i].x, action.points[i].y)
      }
      ctx.value.stroke()
    }
  }
  ctx.value.restore()
}

const drawSelectionHandles = (action: DrawAction): void => {
  if (!ctx.value) return
  ctx.value.save()
  ctx.value.strokeStyle = '#00aaff'
  ctx.value.fillStyle = '#ffffff'
  ctx.value.lineWidth = 1

  const drawHandle = (x: number, y: number): void => {
    if (!ctx.value) return
    ctx.value.beginPath()
    ctx.value.rect(x - 4, y - 4, 8, 8)
    ctx.value.fill()
    ctx.value.stroke()
  }

  if (action.type === 'rect' && action.rect) {
    const { x, y, w, h } = action.rect
    ctx.value.strokeRect(x, y, w, h) // Highlight border
    drawHandle(x, y)
    drawHandle(x + w, y)
    drawHandle(x, y + h)
    drawHandle(x + w, y + h)
  } else if (action.type === 'circle' && action.circle) {
    const { x, y, r } = action.circle
    ctx.value.beginPath()
    ctx.value.arc(x, y, r, 0, 2 * Math.PI)
    ctx.value.stroke()
    drawHandle(x + r, y)
  } else if (action.type === 'line' && action.points && action.points.length >= 2) {
    drawHandle(action.points[0].x, action.points[0].y)
    drawHandle(action.points[1].x, action.points[1].y)
  } else if (action.type === 'text' && action.text) {
    // Draw box around text
    const fontStyle = `${action.text.isItalic ? 'italic ' : ''}${action.text.isBold ? 'bold ' : ''}`
    ctx.value.font = `${fontStyle}${action.text.size}px Arial`
    const metrics = ctx.value.measureText(action.text.content)
    const w = metrics.width
    const h = action.text.size
    ctx.value.strokeRect(action.text.x, action.text.y - h, w, h + h * 0.2)
  }
  ctx.value.restore()
}

const undo = (): void => {
  if (history.value.length > 0) {
    const action = history.value.pop()
    if (action) redoStack.value.push(action)
    redraw()
  }
}

const redo = (): void => {
  if (redoStack.value.length > 0) {
    const action = redoStack.value.pop()
    if (action) history.value.push(action)
    redraw()
  }
}

const clearCanvas = (): void => {
  if (confirm('确定要清空画布吗？')) {
    history.value = []
    redoStack.value = []
    selectedActionIndex.value = -1 // 重置选中索引
    selectedGroupId.value = null // 清除组选择
    redraw()
  }
}

// --- Config Management ---
const loadConfigList = async (): Promise<void> => {
  if (window.api?.graphic) {
    const list = await window.api.graphic.getList()
    configs.value = list.map((f: GraphicConfigFile) => f.filename.replace('.xml', ''))
  }
}

const saveConfig = async (): Promise<void> => {
  if (!currentConfigName.value) {
    modalType.value = 'config'
    modalTitle.value = '保存配置'
    modalValue.value = ''
    showModal.value = true
    return
  }
  await saveConfigInternal()
}

const saveConfigInternal = async (): Promise<void> => {
  const name = currentConfigName.value
  if (!name) return

  // Serialize history to XML
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<FixedGraphic>\n'
  history.value.forEach((action) => {
    xml += `  <Element type="${action.type}" color="${action.color}" lineWidth="${action.lineWidth}">\n`
    if (action.points) {
      xml += `    <Points>${JSON.stringify(action.points)}</Points>\n`
    }
    if (action.rect) {
      xml += `    <Rect>${JSON.stringify(action.rect)}</Rect>\n`
    }
    if (action.circle) {
      xml += `    <Circle>${JSON.stringify(action.circle)}</Circle>\n`
    }
    if (action.text) {
      xml += `    <Text>${JSON.stringify(action.text)}</Text>\n`
    }
    xml += `  </Element>\n`
  })
  xml += '</FixedGraphic>'

  if (window.api?.graphic) {
    await window.api.graphic.save(name, xml)
    await loadConfigList()
  }
}

const loadConfig = async (name: string): Promise<void> => {
  if (window.api?.graphic) {
    const list = await window.api.graphic.getList()
    const file = list.find((f: GraphicConfigFile) => f.filename === name + '.xml')
    if (file) {
      // Parse XML
      const parser = new DOMParser()
      const xmlDoc = parser.parseFromString(file.content, 'text/xml')
      const elements = xmlDoc.querySelectorAll('Element')

      history.value = []
      selectedActionIndex.value = -1
      selectedGroupId.value = null // 清除组选择
      elements.forEach((el) => {
        const type = el.getAttribute('type') as 'line' | 'rect' | 'circle' | 'text' | 'eraser'
        const color = el.getAttribute('color') || '#000'
        const lineWidth = Number(el.getAttribute('lineWidth')) || 2

        const action: DrawAction = { type, color, lineWidth }

        const pointsNode = el.querySelector('Points')
        if (pointsNode) action.points = JSON.parse(pointsNode.textContent || '[]')

        const rectNode = el.querySelector('Rect')
        if (rectNode) action.rect = JSON.parse(rectNode.textContent || '{}')

        const circleNode = el.querySelector('Circle')
        if (circleNode) action.circle = JSON.parse(circleNode.textContent || '{}')

        const textNode = el.querySelector('Text')
        if (textNode) action.text = JSON.parse(textNode.textContent || '{}')

        history.value.push(action)
      })

      currentConfigName.value = name
      isConfigMenuOpen.value = false
      redraw()
    }
  }
}

const deleteConfig = async (name: string): Promise<void> => {
  if (confirm(`确定要删除配置 "${name}" 吗？`)) {
    if (window.api?.graphic) {
      await window.api.graphic.delete(name)
      if (currentConfigName.value === name) {
        currentConfigName.value = ''
        history.value = []
        selectedActionIndex.value = -1
        selectedGroupId.value = null
        redraw()
      }
      await loadConfigList()
    }
  }
}

const createNewConfig = (): void => {
  modalType.value = 'config'
  modalTitle.value = '新建配置'
  modalValue.value = ''
  showModal.value = true
}

// 从XML内容加载模板（供外部调用）
const loadTemplateFromXML = (xmlContent: string): void => {
  try {
    const parser = new DOMParser()
    const xmlDoc = parser.parseFromString(xmlContent, 'text/xml')
    const elements = xmlDoc.querySelectorAll('Element')

    if (elements.length === 0) {
      console.warn('[DrawingLayer] 模板为空')
      return
    }

    // 为这批模板元素生成唯一的组ID
    const groupId = `template-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`

    elements.forEach((el) => {
      const type = el.getAttribute('type') as 'line' | 'rect' | 'circle' | 'text' | 'eraser'
      const color = el.getAttribute('color') || '#000'
      const lineWidth = Number(el.getAttribute('lineWidth')) || 2

      const action: DrawAction = { type, color, lineWidth, groupId } // 添加 groupId

      const pointsNode = el.querySelector('Points')
      if (pointsNode) action.points = JSON.parse(pointsNode.textContent || '[]')

      const rectNode = el.querySelector('Rect')
      if (rectNode) action.rect = JSON.parse(rectNode.textContent || '{}')

      const circleNode = el.querySelector('Circle')
      if (circleNode) action.circle = JSON.parse(circleNode.textContent || '{}')

      const textNode = el.querySelector('Text')
      if (textNode) action.text = JSON.parse(textNode.textContent || '{}')

      history.value.push(action)
    })

    redoStack.value = []

    // 自动选中新加载的组
    selectedGroupId.value = groupId
    selectedActionIndex.value = -1

    redraw()
    console.log(`[DrawingLayer] 已加载 ${elements.length} 个图形元素，组ID: ${groupId}`)
  } catch (error) {
    console.error('[DrawingLayer] 解析模板失败:', error)
  }
}

// 暴露方法给父组件
defineExpose({
  loadTemplateFromXML
})
</script>

<template>
  <div class="drawing-layer" :style="{ pointerEvents: visible ? 'auto' : 'none' }">
    <canvas
      ref="canvasRef"
      class="drawing-canvas"
      :style="{ pointerEvents: visible ? 'auto' : 'none' }"
      @mousedown="startDrawing"
      @mousemove="draw"
      @mouseup="stopDrawing"
      @mouseleave="stopDrawing"
      @dblclick="handleDoubleClick"
      @contextmenu.prevent
    ></canvas>

    <!-- 右键菜单 -->
    <div
      v-if="showContextMenu"
      class="context-menu"
      :style="{ left: contextMenuPos.x + 'px', top: contextMenuPos.y + 'px' }"
      @click.stop
    >
      <!-- 元素操作菜单 -->
      <template v-if="!isSettingsMenu">
        <div class="context-menu-item" @click="mergeToGroup">
          <span>🔗</span>
          <span>合并为组</span>
        </div>
        <div v-if="hasGroupInSelection" class="context-menu-item" @click="ungroupSelection">
          <span>💔</span>
          <span>解散组</span>
        </div>
        <div
          v-if="selectedActionIndex !== -1"
          class="context-menu-item"
          @click="openParameterizeModal"
        >
          <span>📐</span>
          <span>参数设置</span>
        </div>
      </template>

      <!-- 设置菜单 -->
      <template v-else>
        <div class="context-menu-item" @click="toggleSnap">
          <span>{{ snapEnabled ? '✅' : '⬜' }}</span>
          <span>端点吸附</span>
        </div>
        <div class="context-menu-item context-menu-label">
          <span>🎯</span>
          <span>吸附距离: {{ snapDistance }}px</span>
        </div>
        <div class="context-menu-slider">
          <input v-model.number="snapDistance" type="range" min="5" max="30" step="5" @click.stop />
        </div>
      </template>
    </div>

    <div v-if="visible" class="toolbar">
      <div class="tool-group">
        <button
          title="选择/调整"
          :class="{ active: currentTool === 'select' }"
          @click="currentTool = 'select'"
        >
          👆
        </button>
        <button
          title="直线"
          :class="{ active: currentTool === 'line' }"
          @click="currentTool = 'line'"
        >
          ╱
        </button>
        <button
          title="矩形"
          :class="{ active: currentTool === 'rect' }"
          @click="currentTool = 'rect'"
        >
          ⬜
        </button>
        <button
          title="圆形"
          :class="{ active: currentTool === 'circle' }"
          @click="currentTool = 'circle'"
        >
          ⭕
        </button>
        <button
          title="文本"
          :class="{ active: currentTool === 'text' }"
          @click="currentTool = 'text'"
        >
          T
        </button>
        <button
          title="橡皮擦"
          :class="{ active: currentTool === 'eraser' }"
          @click="currentTool = 'eraser'"
        >
          ⌫
        </button>
      </div>

      <div class="tool-group">
        <input v-model="currentColor" title="颜色" type="color" />
        <input v-model="currentLineWidth" title="线宽" type="range" min="1" max="10" />
      </div>

      <div class="tool-group">
        <button title="撤销" @click="undo">↩</button>
        <button title="重做" @click="redo">↪</button>
        <button title="清空" @click="clearCanvas">🗑</button>
      </div>

      <div class="tool-group config-group">
        <button title="配置管理" @click="isConfigMenuOpen = !isConfigMenuOpen">
          📂 {{ currentConfigName || '未保存' }}
        </button>
        <div v-if="isConfigMenuOpen" class="config-menu">
          <div class="config-item" @click="createNewConfig">➕ 新建配置</div>
          <div class="config-item" @click="saveConfig">💾 保存配置</div>
          <div class="divider"></div>
          <div v-for="name in configs" :key="name" class="config-item" @click="loadConfig(name)">
            <span>{{ name }}</span>
            <span class="delete-btn" @click.stop="deleteConfig(name)">×</span>
          </div>
        </div>
      </div>

      <div class="tool-group">
        <button
          v-if="
            selectedActionIndex !== -1 &&
            currentTool === 'select' &&
            history[selectedActionIndex]?.type === 'text'
          "
          class="edit-btn"
          @click="editSelectedText"
        >
          ✎ 编辑文本
        </button>

        <button class="close-btn" @click="emit('close')">❌</button>
      </div>
    </div>

    <!-- 输入模态框 -->
    <div v-if="showModal" class="modal-overlay" @click.self="closeModal">
      <div class="modal-content" @mousedown.stop @click.stop>
        <h3>{{ modalTitle }}</h3>

        <!-- 参数化模态框 -->
        <template v-if="modalType === 'parameterize'">
          <!-- 组尺寸 -->
          <div v-if="paramIsGroup" class="param-group">
            <label>宽度 (px):</label>
            <input
              ref="inputRef"
              v-model.number="paramGroupWidth"
              type="number"
              min="1"
              step="1"
              class="modal-input"
              @mousedown.stop
              @keydown.stop
              @keypress.stop
              @input.stop
              @keyup.enter="applyParameterize"
            />
            <label>高度 (px):</label>
            <input
              v-model.number="paramGroupHeight"
              type="number"
              min="1"
              step="1"
              class="modal-input"
              @mousedown.stop
              @keydown.stop
              @keypress.stop
              @input.stop
              @keyup.enter="applyParameterize"
            />
          </div>

          <!-- 线条长度 -->
          <div v-if="!paramIsGroup && paramModalAction?.type === 'line'" class="param-group">
            <label>长度 (px):</label>
            <input
              ref="inputRef"
              v-model.number="paramLineLength"
              type="number"
              min="1"
              step="1"
              class="modal-input"
              @mousedown.stop
              @keydown.stop
              @keypress.stop
              @input.stop
              @keyup.enter="applyParameterize"
            />
          </div>

          <!-- 矩形宽高 -->
          <div v-if="!paramIsGroup && paramModalAction?.type === 'rect'" class="param-group">
            <label>宽度 (px):</label>
            <input
              ref="inputRef"
              v-model.number="paramRectWidth"
              type="number"
              min="1"
              step="1"
              class="modal-input"
              @mousedown.stop
              @keydown.stop
              @keypress.stop
              @input.stop
              @keyup.enter="applyParameterize"
            />
            <label>高度 (px):</label>
            <input
              v-model.number="paramRectHeight"
              type="number"
              min="1"
              step="1"
              class="modal-input"
              @mousedown.stop
              @keydown.stop
              @keypress.stop
              @input.stop
              @keyup.enter="applyParameterize"
            />
          </div>

          <!-- 圆形直径 -->
          <div v-if="!paramIsGroup && paramModalAction?.type === 'circle'" class="param-group">
            <label>直径 (px):</label>
            <input
              ref="inputRef"
              v-model.number="paramCircleDiameter"
              type="number"
              min="1"
              step="1"
              class="modal-input"
              @mousedown.stop
              @keydown.stop
              @keypress.stop
              @input.stop
              @keyup.enter="applyParameterize"
            />
          </div>
        </template>

        <!-- 文本输入模态框 -->
        <template v-else-if="modalType === 'text'">
          <input
            ref="inputRef"
            v-model="modalValue"
            type="text"
            class="modal-input"
            placeholder="输入文本内容"
            style="pointer-events: auto; user-select: auto"
            autofocus
            @mousedown.stop
            @keydown.stop
            @keypress.stop
            @input.stop
            @keyup.enter="handleModalConfirm"
          />
          <div class="text-options">
            <label
              >大小:
              <input
                v-model.number="modalTextSize"
                type="number"
                min="10"
                max="100"
                @mousedown.stop
                @keydown.stop
                @keypress.stop
                @input.stop
              />
            </label>
            <label><input v-model="modalTextBold" type="checkbox" @click.stop /> 粗体</label>
            <label><input v-model="modalTextItalic" type="checkbox" @click.stop /> 斜体</label>
          </div>
        </template>

        <!-- 配置名称输入模态框 -->
        <template v-else>
          <input
            ref="inputRef"
            v-model="modalValue"
            type="text"
            class="modal-input"
            style="pointer-events: auto; user-select: auto"
            autofocus
            @mousedown.stop
            @keydown.stop
            @keypress.stop
            @input.stop
            @keyup.enter="handleModalConfirm"
          />
        </template>

        <!-- 统一的模态框按钮 -->
        <div class="modal-actions">
          <button class="btn-cancel" @click="closeModal">取消</button>
          <button
            class="btn-confirm"
            @click="modalType === 'parameterize' ? applyParameterize() : handleModalConfirm()"
          >
            确定
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.drawing-layer {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 45;
  /* pointer-events controlled by style binding */
}

.drawing-canvas {
  width: 100%;
  height: 100%;
  cursor: crosshair;
}

.toolbar {
  position: absolute;
  top: 24px;
  left: 50%;
  transform: translateX(-50%);
  background-color: rgba(25, 28, 38, 0.65);
  backdrop-filter: blur(30px) saturate(1.2);
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow:
    inset 0 1px 1px rgba(255, 255, 255, 0.05),
    0 10px 30px rgba(0, 0, 0, 0.3);
  padding: 8px 16px;
  border-radius: 16px;
  display: flex;
  gap: 16px;
  pointer-events: auto;
  align-items: center;
  transition: all 0.3s ease;
}

.tool-group {
  display: flex;
  gap: 8px;
  align-items: center;
  border-right: 1px solid rgba(255, 255, 255, 0.1);
  padding-right: 16px;
}

.tool-group:last-child {
  border-right: none;
  padding-right: 0;
}

button {
  background: transparent;
  border: none;
  color: rgba(255, 255, 255, 0.7);
  width: 36px;
  height: 36px;
  border-radius: 8px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
  font-size: 16px;
}

button:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
  transform: translateY(-1px);
}

button:active {
  transform: translateY(0);
}

button.active {
  background: rgba(59, 130, 246, 0.2);
  color: #60a5fa;
  box-shadow: 0 0 0 1px rgba(59, 130, 246, 0.4);
}

.edit-btn {
  width: auto;
  padding: 0 12px;
  font-size: 13px;
  background: rgba(59, 130, 246, 0.2);
  color: #60a5fa;
  white-space: nowrap;
}

/* 颜色选择器样式优化 */
input[type='color'] {
  -webkit-appearance: none;
  appearance: none;
  border: none;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: none;
  cursor: pointer;
  padding: 0;
  overflow: hidden;
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.2);
  transition: transform 0.2s;
}

input[type='color']::-webkit-color-swatch-wrapper {
  padding: 0;
}

input[type='color']::-webkit-color-swatch {
  border: none;
  border-radius: 50%;
}

input[type='color']:hover {
  transform: scale(1.1);
  box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.4);
}

/* 滑块样式优化 */
input[type='range'] {
  -webkit-appearance: none;
  appearance: none;
  width: 80px;
  height: 4px;
  background: rgba(255, 255, 255, 0.2);
  border-radius: 2px;
  outline: none;
}

input[type='range']::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #fff;
  cursor: pointer;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
  transition: transform 0.2s;
}

input[type='range']::-webkit-slider-thumb:hover {
  transform: scale(1.2);
}

.config-group {
  position: relative;
}

.config-group > button {
  width: auto;
  padding: 0 12px;
  font-size: 13px;
  font-weight: 500;
  gap: 6px;
  white-space: nowrap;
}

.config-menu {
  position: absolute;
  top: calc(100% + 8px);
  left: 50%;
  transform: translateX(-50%);
  background: rgba(25, 28, 38, 0.9);
  backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  width: 220px;
  max-height: 300px;
  overflow-y: auto;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
  padding: 6px;
  animation: menu-fade-in 0.2s ease-out;
}

@keyframes menu-fade-in {
  from {
    opacity: 0;
    transform: translateX(-50%) translateY(-10px);
  }
  to {
    opacity: 1;
    transform: translateX(-50%) translateY(0);
  }
}

.config-item {
  padding: 10px 12px;
  color: rgba(255, 255, 255, 0.8);
  cursor: pointer;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-radius: 8px;
  font-size: 13px;
  transition: all 0.2s;
}

.config-item:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
}

.delete-btn {
  color: #ef4444;
  font-weight: bold;
  opacity: 0.6;
  padding: 4px;
  border-radius: 4px;
}

.delete-btn:hover {
  opacity: 1;
  background: rgba(239, 68, 68, 0.1);
}

.divider {
  height: 1px;
  background: rgba(255, 255, 255, 0.1);
  margin: 6px 0;
}

.close-btn {
  background: rgba(239, 68, 68, 0.1);
  color: #ef4444;
  margin-left: 8px;
}

.close-btn:hover {
  background: #ef4444;
  color: white;
}

/* 模态框样式 */
.modal-overlay {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 200;
}

.modal-content {
  background: rgba(25, 28, 38, 0.9);
  backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 16px;
  padding: 24px;
  width: 320px;
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5);
  animation: modal-pop 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}

@keyframes modal-pop {
  from {
    opacity: 0;
    transform: scale(0.9);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

.modal-content h3 {
  margin: 0 0 16px;
  color: #fff;
  font-size: 18px;
  text-align: center;
}

.modal-input {
  width: 100%;
  padding: 10px 14px;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  color: #fff;
  font-size: 14px;
  margin-bottom: 20px;
  outline: none;
  transition: border-color 0.2s;
}

.modal-input:focus {
  border-color: #3b82f6;
}

.param-group {
  margin-bottom: 16px;
}

.param-group label {
  display: block;
  color: rgba(255, 255, 255, 0.7);
  font-size: 13px;
  margin-bottom: 6px;
  margin-top: 12px;
}

.param-group label:first-of-type {
  margin-top: 0;
}

.param-group input[type='number'] {
  width: 100%;
  padding: 10px 14px;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  color: #fff;
  font-size: 14px;
  outline: none;
  transition: border-color 0.2s;
}

.param-group input[type='number']:focus {
  border-color: #3b82f6;
}

.text-options {
  display: flex;
  gap: 16px;
  margin-bottom: 20px;
  color: #fff;
  font-size: 14px;
}

.text-options label {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
}

.text-options input[type='number'] {
  width: 60px;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 4px;
  color: #fff;
  padding: 4px;
}

.modal-actions {
  display: flex;
  gap: 12px;
  justify-content: flex-end;
}

.modal-actions button {
  width: auto;
  height: 36px;
  padding: 0 16px;
  font-size: 14px;
  font-weight: 500;
}

.btn-cancel {
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.8);
}

.btn-cancel:hover {
  background: rgba(255, 255, 255, 0.2);
  color: #fff;
}

.btn-confirm {
  background: #3b82f6;
  color: #fff;
  box-shadow: 0 2px 8px rgba(59, 130, 246, 0.4);
}

.btn-confirm:hover {
  background: #2563eb;
  transform: translateY(-1px);
}

/* 右键菜单样式 */
.context-menu {
  position: fixed;
  background: rgba(25, 28, 38, 0.95);
  backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 10px;
  padding: 6px;
  min-width: 160px;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.6);
  z-index: 300;
  animation: context-fade-in 0.15s ease-out;
}

@keyframes context-fade-in {
  from {
    opacity: 0;
    transform: scale(0.95);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

.context-menu-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  color: rgba(255, 255, 255, 0.9);
  cursor: pointer;
  border-radius: 6px;
  font-size: 14px;
  transition: all 0.2s;
  user-select: none;
}

.context-menu-item:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
}

.context-menu-item span:first-child {
  font-size: 16px;
}

.context-menu-label {
  cursor: default;
  color: rgba(255, 255, 255, 0.7);
  font-size: 13px;
}

.context-menu-label:hover {
  background: transparent;
}

.context-menu-slider {
  padding: 8px 14px;
}

.context-menu-slider input[type='range'] {
  width: 100%;
  height: 4px;
  background: rgba(255, 255, 255, 0.2);
  border-radius: 2px;
  outline: none;
  cursor: pointer;
}

.context-menu-slider input[type='range']::-webkit-slider-thumb {
  width: 14px;
  height: 14px;
  background: #00ff00;
  border-radius: 50%;
  cursor: pointer;
  transition: all 0.2s;
}

.context-menu-slider input[type='range']::-webkit-slider-thumb:hover {
  transform: scale(1.2);
}

.context-menu-slider input[type='range']::-moz-range-thumb {
  width: 14px;
  height: 14px;
  background: #00ff00;
  border: none;
  border-radius: 50%;
  cursor: pointer;
  transition: all 0.2s;
}

.context-menu-slider input[type='range']::-moz-range-thumb:hover {
  transform: scale(1.2);
}
</style>
