<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'

const props = defineProps<{
  enabled: boolean
  hudEditMode: boolean
}>()

const emit = defineEmits<{
  (e: 'capture-change', captured: boolean): void
  (
    e: 'control-frame',
    frame: {
      mouseX: number
      mouseY: number
      mouseZ: number
      leftButtonDown: boolean
      rightButtonDown: boolean
      midButtonDown: boolean
      keyboardValue: number
    }
  ): void
}>()

const CONTROL_FRAME_HZ = 75
const CONTROL_FRAME_INTERVAL_MS = 1000 / CONTROL_FRAME_HZ
const IDLE_NEUTRAL_HEARTBEAT_MS = 250
const MOUSE_Y_PROTOCOL_DIRECTION = -1
const INT32_MIN = -2147483648
const INT32_MAX = 2147483647

// RoboMaster 2026 KeyboardMouseControl.keyboard_value bit 0-15.
const KEYBOARD_BITS_BY_CODE = new Map<string, number>([
  ['KeyW', 1 << 0],
  ['KeyS', 1 << 1],
  ['KeyA', 1 << 2],
  ['KeyD', 1 << 3],
  ['ShiftLeft', 1 << 4],
  ['ShiftRight', 1 << 4],
  ['ControlLeft', 1 << 5],
  ['ControlRight', 1 << 5],
  ['KeyQ', 1 << 6],
  ['KeyE', 1 << 7],
  ['KeyR', 1 << 8],
  ['KeyF', 1 << 9],
  ['KeyG', 1 << 10],
  ['KeyZ', 1 << 11],
  ['KeyX', 1 << 12],
  ['KeyC', 1 << 13],
  ['KeyV', 1 << 14],
  ['KeyB', 1 << 15]
])

const captureLayerRef = ref<HTMLElement | null>(null)
const isCaptured = ref(false)
const isBackspaceHeld = ref(false)
const pressedCodes = new Set<string>()
let enterTimer: number | null = null
let controlFrameTimer: number | null = null
let mouseXAccumulator = 0
let mouseYAccumulator = 0
let mouseZAccumulator = 0
let leftButtonDown = false
let rightButtonDown = false
let midButtonDown = false
let lastMouseClientX: number | null = null
let lastMouseClientY: number | null = null
let lastNeutralFrameAt = 0
let lastEmittedLeftButtonDown = false
let lastEmittedRightButtonDown = false
let lastEmittedMidButtonDown = false
let lastEmittedKeyboardValue = 0

const CAPTURE_LISTENER_OPTIONS: AddEventListenerOptions = { capture: true }
const WHEEL_LISTENER_OPTIONS: AddEventListenerOptions = { capture: true, passive: false }

const shouldCapture = computed(() => {
  return props.enabled && !props.hudEditMode && !isBackspaceHeld.value
})

function clearEnterTimer(): void {
  if (enterTimer !== null) {
    window.clearTimeout(enterTimer)
    enterTimer = null
  }
}

function clampInt32(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(INT32_MIN, Math.min(INT32_MAX, Math.round(value)))
}

function isRobotControlKey(code: string): boolean {
  return KEYBOARD_BITS_BY_CODE.has(code)
}

function getKeyboardValue(): number {
  let keyboardValue = 0
  KEYBOARD_BITS_BY_CODE.forEach((bit, code) => {
    if (pressedCodes.has(code)) {
      keyboardValue |= bit
    }
  })
  return keyboardValue
}

function createControlFrame(): {
  mouseX: number
  mouseY: number
  mouseZ: number
  leftButtonDown: boolean
  rightButtonDown: boolean
  midButtonDown: boolean
  keyboardValue: number
} {
  return {
    mouseX: clampInt32(mouseXAccumulator),
    mouseY: clampInt32(mouseYAccumulator),
    mouseZ: clampInt32(mouseZAccumulator),
    leftButtonDown,
    rightButtonDown,
    midButtonDown,
    keyboardValue: getKeyboardValue()
  }
}

function hasMotion(frame: ReturnType<typeof createControlFrame>): boolean {
  return frame.mouseX !== 0 || frame.mouseY !== 0 || frame.mouseZ !== 0
}

function hasHeldControl(frame: ReturnType<typeof createControlFrame>): boolean {
  return (
    frame.leftButtonDown ||
    frame.rightButtonDown ||
    frame.midButtonDown ||
    frame.keyboardValue !== 0
  )
}

function hasControlStateChanged(frame: ReturnType<typeof createControlFrame>): boolean {
  return (
    frame.leftButtonDown !== lastEmittedLeftButtonDown ||
    frame.rightButtonDown !== lastEmittedRightButtonDown ||
    frame.midButtonDown !== lastEmittedMidButtonDown ||
    frame.keyboardValue !== lastEmittedKeyboardValue
  )
}

function rememberEmittedControlState(frame: ReturnType<typeof createControlFrame>): void {
  lastEmittedLeftButtonDown = frame.leftButtonDown
  lastEmittedRightButtonDown = frame.rightButtonDown
  lastEmittedMidButtonDown = frame.midButtonDown
  lastEmittedKeyboardValue = frame.keyboardValue
}

function emitControlFrame(): void {
  if (!isCaptured.value) return

  const frame = createControlFrame()
  const moving = hasMotion(frame)
  const held = hasHeldControl(frame)
  const stateChanged = hasControlStateChanged(frame)
  const now = performance.now()
  const shouldSend = moving || held || stateChanged || now - lastNeutralFrameAt >= IDLE_NEUTRAL_HEARTBEAT_MS

  if (!shouldSend) return

  emit('control-frame', frame)
  rememberEmittedControlState(frame)
  if (!moving && !held) {
    lastNeutralFrameAt = now
  }
  mouseXAccumulator = 0
  mouseYAccumulator = 0
  mouseZAccumulator = 0
}

function emitNeutralFrame(): void {
  const frame = {
    mouseX: 0,
    mouseY: 0,
    mouseZ: 0,
    leftButtonDown: false,
    rightButtonDown: false,
    midButtonDown: false,
    keyboardValue: 0
  }
  emit('control-frame', frame)
  rememberEmittedControlState(frame)
  lastNeutralFrameAt = performance.now()
}

function startControlFrameTimer(): void {
  if (controlFrameTimer !== null) return
  controlFrameTimer = window.setInterval(emitControlFrame, CONTROL_FRAME_INTERVAL_MS)
}

function stopControlFrameTimer(): void {
  if (controlFrameTimer !== null) {
    window.clearInterval(controlFrameTimer)
    controlFrameTimer = null
  }
}

function resetControlState(): void {
  pressedCodes.clear()
  mouseXAccumulator = 0
  mouseYAccumulator = 0
  mouseZAccumulator = 0
  leftButtonDown = false
  rightButtonDown = false
  midButtonDown = false
  lastMouseClientX = null
  lastMouseClientY = null
}

function requestPointerLock(): void {
  const captureLayer = captureLayerRef.value
  if (!captureLayer || document.pointerLockElement === captureLayer) return

  try {
    const result = captureLayer.requestPointerLock()
    if (result && typeof result.catch === 'function') {
      result.catch(() => {
        // Pointer lock requires a user gesture in some WebViews; soft capture still works.
      })
    }
  } catch {
    // Soft capture is the fallback when pointer lock is unavailable.
  }
}

function releasePointerLock(): void {
  if (document.pointerLockElement === captureLayerRef.value) {
    document.exitPointerLock?.()
  }
}

function queueEnterCapture(delay = 100): void {
  clearEnterTimer()
  enterTimer = window.setTimeout(() => {
    enterTimer = null
    if (shouldCapture.value) {
      enterCapture()
    }
  }, delay)
}

function handleMouseMove(event: MouseEvent): void {
  if (!isCaptured.value) return

  event.preventDefault()
  event.stopPropagation()

  let deltaX = Number.isFinite(event.movementX) ? event.movementX : 0
  let deltaY = Number.isFinite(event.movementY) ? event.movementY : 0

  // Some WebView paths report movementX/Y as 0 without pointer lock. Fall back to client deltas.
  if (
    deltaX === 0 &&
    deltaY === 0 &&
    document.pointerLockElement !== captureLayerRef.value &&
    lastMouseClientX !== null &&
    lastMouseClientY !== null
  ) {
    deltaX = event.clientX - lastMouseClientX
    deltaY = event.clientY - lastMouseClientY
  }

  lastMouseClientX = event.clientX
  lastMouseClientY = event.clientY

  mouseXAccumulator += deltaX
  mouseYAccumulator += deltaY * MOUSE_Y_PROTOCOL_DIRECTION

  leftButtonDown = (event.buttons & 1) !== 0
  rightButtonDown = (event.buttons & 2) !== 0
  midButtonDown = (event.buttons & 4) !== 0
}

function handleMouseDown(event: MouseEvent): void {
  if (!isCaptured.value) return

  event.preventDefault()
  event.stopPropagation()

  lastMouseClientX = event.clientX
  lastMouseClientY = event.clientY
  requestPointerLock()

  if (event.button === 0) {
    leftButtonDown = true
  } else if (event.button === 1) {
    midButtonDown = true
  } else if (event.button === 2) {
    rightButtonDown = true
  }
}

function handleMouseUp(event: MouseEvent): void {
  if (!isCaptured.value) return

  event.preventDefault()
  event.stopPropagation()

  if (event.button === 0) {
    leftButtonDown = false
  } else if (event.button === 1) {
    midButtonDown = false
  } else if (event.button === 2) {
    rightButtonDown = false
  }
}

function handleWheel(event: WheelEvent): void {
  if (!isCaptured.value) return

  event.preventDefault()
  event.stopPropagation()

  const rawDelta = event.deltaY !== 0 ? event.deltaY : event.deltaX
  if (rawDelta === 0) return

  const notchCount = Math.max(1, Math.min(10, Math.round(Math.abs(rawDelta) / 120)))
  mouseZAccumulator -= Math.sign(rawDelta) * notchCount
}

function handleContextMenu(event: MouseEvent): void {
  if (!isCaptured.value) return
  event.preventDefault()
  event.stopPropagation()
}

function preventRobotKeyDefault(event: KeyboardEvent): void {
  event.preventDefault()
}

function preventCaptureExitKey(event: KeyboardEvent): void {
  event.preventDefault()
  event.stopPropagation()
}

function handleWindowBlur(): void {
  if (!isCaptured.value) return
  resetControlState()
  emitNeutralFrame()
}

function handleKeyDown(event: KeyboardEvent): void {
  if (event.key === 'Backspace') {
    if (!isCaptured.value && !isBackspaceHeld.value) return

    if (!isBackspaceHeld.value) {
      isBackspaceHeld.value = true
      exitCapture()
    }
    preventCaptureExitKey(event)
    return
  }

  if (!isCaptured.value) return

  if (isRobotControlKey(event.code)) {
    pressedCodes.add(event.code)
    preventRobotKeyDefault(event)
  }
}

function handleKeyUp(event: KeyboardEvent): void {
  if (event.key === 'Backspace') {
    if (!isBackspaceHeld.value && !isCaptured.value) return

    isBackspaceHeld.value = false
    if (shouldCapture.value) {
      queueEnterCapture(0)
    }
    preventCaptureExitKey(event)
    return
  }

  pressedCodes.delete(event.code)

  if (isCaptured.value && isRobotControlKey(event.code)) {
    preventRobotKeyDefault(event)
  }
}

function enterCapture(): void {
  clearEnterTimer()

  if (isCaptured.value || !shouldCapture.value) return

  resetControlState()
  isCaptured.value = true
  startControlFrameTimer()
  emitNeutralFrame()
  emit('capture-change', true)
  console.log('[RoboControl] Entered soft capture mode')
}

function exitCapture(): void {
  clearEnterTimer()

  if (!isCaptured.value) return

  isCaptured.value = false
  stopControlFrameTimer()
  releasePointerLock()
  resetControlState()
  emitNeutralFrame()
  emit('capture-change', false)
  console.log('[RoboControl] Exited soft capture mode')
}

watch(
  shouldCapture,
  (canCapture) => {
    if (!canCapture) {
      exitCapture()
    } else if (!isCaptured.value) {
      queueEnterCapture(100)
    }
  },
  { immediate: true, flush: 'sync' }
)

onMounted(() => {
  document.addEventListener('mousemove', handleMouseMove, CAPTURE_LISTENER_OPTIONS)
  document.addEventListener('mousedown', handleMouseDown, CAPTURE_LISTENER_OPTIONS)
  document.addEventListener('mouseup', handleMouseUp, CAPTURE_LISTENER_OPTIONS)
  document.addEventListener('wheel', handleWheel, WHEEL_LISTENER_OPTIONS)
  document.addEventListener('contextmenu', handleContextMenu, CAPTURE_LISTENER_OPTIONS)
  document.addEventListener('keydown', handleKeyDown, true)
  document.addEventListener('keyup', handleKeyUp, true)
  window.addEventListener('blur', handleWindowBlur)
})

onUnmounted(() => {
  clearEnterTimer()
  exitCapture()
  stopControlFrameTimer()
  document.removeEventListener('mousemove', handleMouseMove, CAPTURE_LISTENER_OPTIONS)
  document.removeEventListener('mousedown', handleMouseDown, CAPTURE_LISTENER_OPTIONS)
  document.removeEventListener('mouseup', handleMouseUp, CAPTURE_LISTENER_OPTIONS)
  document.removeEventListener('wheel', handleWheel, WHEEL_LISTENER_OPTIONS)
  document.removeEventListener('contextmenu', handleContextMenu, CAPTURE_LISTENER_OPTIONS)
  document.removeEventListener('keydown', handleKeyDown, true)
  document.removeEventListener('keyup', handleKeyUp, true)
  window.removeEventListener('blur', handleWindowBlur)
})

defineExpose({
  enterCapture,
  exitCapture,
  isCaptured
})
</script>

<template>
  <div
    v-if="isCaptured"
    ref="captureLayerRef"
    class="capture-layer"
  ></div>

  <Transition name="fade">
    <div v-if="isCaptured" class="capture-indicator">
      <div class="capture-badge">
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <circle cx="12" cy="12" r="10"></circle>
          <circle cx="12" cy="12" r="3"></circle>
        </svg>
        <span>操控模式</span>
        <span class="hint">按住 <kbd>Backspace</kbd> 退出</span>
      </div>
    </div>
  </Transition>

  <Transition name="fade">
    <div v-if="isBackspaceHeld && !isCaptured" class="exit-hint">
      <span>已退出操控模式，松开 <kbd>Backspace</kbd> 恢复</span>
    </div>
  </Transition>
</template>

<style scoped>
.capture-layer {
  position: fixed;
  inset: 0;
  z-index: 10000;
  cursor: none;
  background: transparent;
}

.capture-indicator {
  position: fixed;
  top: 16px;
  left: 16px;
  z-index: 10010;
  pointer-events: none;
}

.capture-badge {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  background: rgba(34, 197, 94, 0.9);
  color: white;
  font-size: 13px;
  font-weight: 500;
  border-radius: 20px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  white-space: nowrap;
}

.capture-badge svg {
  opacity: 0.9;
}

.capture-badge .hint {
  opacity: 0.7;
  font-size: 11px;
  margin-left: 6px;
  padding-left: 10px;
  border-left: 1px solid rgba(255, 255, 255, 0.3);
}

.capture-badge kbd {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  margin: 0 2px;
  background: rgba(255, 255, 255, 0.2);
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 3px;
  font-family: inherit;
  font-size: 10px;
  font-weight: 600;
}

.exit-hint {
  position: fixed;
  top: 16px;
  left: 16px;
  z-index: 10010;
  padding: 8px 16px;
  background: rgba(251, 191, 36, 0.9);
  color: #000;
  font-size: 13px;
  font-weight: 500;
  border-radius: 20px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  pointer-events: none;
}

.exit-hint kbd {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  margin: 0 2px;
  background: rgba(0, 0, 0, 0.1);
  border: 1px solid rgba(0, 0, 0, 0.2);
  border-radius: 3px;
  font-family: inherit;
  font-size: 10px;
  font-weight: 600;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
