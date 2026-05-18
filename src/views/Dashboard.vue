<script setup lang="ts">
import {
  ref,
  reactive,
  onMounted,
  onUnmounted,
  computed,
  onActivated,
  onDeactivated,
  nextTick,
  watch,
  type Component
} from 'vue'
import { storeToRefs } from 'pinia'
import HudPanel from '@/components/HudPanel.vue'
import VideoSourceManager from '@/components/Dashboard/VideoSourceManager.vue'
import DetectionService from '@/components/Dashboard/DetectionService.vue'
import RobotStateManager from '@/components/Dashboard/RobotStateManager.vue'
import PerformanceOptimizer from '@/components/Dashboard/PerformanceOptimizer.vue'
import ConfigPanels from '@/components/Dashboard/ConfigPanels.vue'
import DetectionOverlay from '@/components/DetectionOverlay.vue'
import CrosshairSettings, { type CrosshairConfig } from '@/components/CrosshairSettings.vue'
import AmmoPurchaseMenu from '@/components/AmmoPurchaseMenu.vue'
import RemoteAmmoPurchaseMenu from '@/components/RemoteAmmoPurchaseMenu.vue'
import RoboControl from '@/components/RoboControl.vue'
import RobotActionHint from '@/components/RobotActionHint.vue'
import VehicleAttitude from '@/components/VehicleAttitude.vue'
import PitchIndicator from '@/components/PitchIndicator.vue'
import WeaponStatus from '@/components/WeaponStatus.vue'
import MqttCommandPanel from '@/components/MqttCommandPanel.vue'
import HudContextMenu from '@/components/HudContextMenu.vue'
import ModuleStatus from '@/components/ModuleStatus.vue'
import DrawingLayer from '@/components/DrawingLayer.vue'
import PanelWidgetContainer from '@/components/PanelWidgetContainer.vue'
import MiniMap from '@/components/Dashboard/MiniMap.vue'
import MessageWindow from '@/components/MessageWindow.vue'
import MessageList from '@/components/MessageList.vue'
import ViewportFrame from '@/components/ViewportFrame.vue'
import VideoZoomStatus from '@/components/VideoZoomStatus.vue'
import RoboModeSettings from '@/components/Dashboard/RoboModeSettings.vue'
import DashboardConfigManager from '@/components/Dashboard/DashboardConfigManager.vue'
import type { DashboardLayoutConfig } from '@/components/Dashboard/DashboardConfigManager.vue'

// 导入 Pinia Store
import { useDashboardStore } from '../store'
import { useHudTemplatesStore } from '../store/modules/hud-templates'
import { useMqttDataStore } from '../store/modules/mqtt_data' // <--- 新增
import { panelRegistry } from '../store/panels' // 面板注册表，用于获取实时位置

// 导入类型和常量
import type { PipeServerStatus, PerformancePreset, UdpStats } from '@/components/Dashboard/types'
import {
  VIDEO_CONSTRAINTS,
  MAX_MUZZLE_HEAT,
  RING_RADIUS,
  HEAT_SIMULATION_INTERVAL,
  PERFORMANCE_PRESETS
} from '@/components/Dashboard/constants'

// ==================== Pinia Store ====================
const store = useDashboardStore()
const mqttDataStore = useMqttDataStore()

// 使用 storeToRefs 解构响应式状态（保持 ref 特性）
const {
  // UI 状态
  isSettingsVisible,
  isCrosshairSettingsVisible,
  isAmmoPurchaseVisible,
  isRemoteAmmoPurchaseVisible,
  activeTab,
  isHudInteractive,
  // 视频状态
  videoStatus,
  cameraStatus,
  videoSource,
  videoFilePath,
  selectedCameraId,
  isConnecting,
  wasConnected,
  videoSize,
  // 绘图模式
  isDrawingMode,
  // 调试模式
  isDebugMode,
  // 检测状态
  detectionEnabled,
  // UDP 状态
  udpStreamStatus,
  udpStats,
  // MQTT 状态
  mqttStatus,
  mqttStats,
  useLocalBroker,
  localBrokerPort,
  localBrokerStatus,
  // Pipe 服务器状态
  pipeServerStatus,
  // 机器人状态
  robotTypes,
  selectedRobot,
  remainingAmmo,
  exchangeableAmmo,
  // 性能状态
  enableSimulation,
  performancePreset,
  // WebRTC 分发状态
  webrtcDistributeEnabled,
  webrtcSignalingStatus,
  webrtcSignalingAddress,
  webrtcConnectedClients,
  // 全局配置
  globalConfig
} = storeToRefs(store)

// 计算属性直接从 store 获取
// 注意: 直接解构 computed 会失去响应性，需要通过包装保持响应式
const { selectedTeam } = store

// 需要响应式的 computed，通过包装保持响应性
const encodingMethod = computed(() => store.encodingMethod)

// 配置对象需要保持响应式（用于传递给子组件和 v-model 绑定）
// 使用 computed 包装，在 script 中需要用 .value 访问
const encodeConfig = computed({
  get: () => store.encodeConfig,
  set: (val) => {
    store.encodeConfig = val
  }
})
const detectionConfig = computed({
  get: () => store.detectionConfig,
  set: (val) => {
    store.detectionConfig = val
  }
})
const udpConfig = computed({
  get: () => store.udpConfig,
  set: (val) => {
    store.udpConfig = val
  }
})
const mqttConfig = computed({
  get: () => store.mqttConfig,
  set: (val) => {
    store.mqttConfig = val
  }
})

// 网络配置（本地保留，不在 store 中）
const ipAddress = ref('192.168.12.1')
const mqttNeedsManualReconnect = ref(false)
let mqttAutoConnectAttempted = false
let mqttConnectedClientId: string | null = null
let mqttClientIdReconnectTimer: number | null = null

function isMqttActive(): boolean {
  return mqttStatus.value === 'connected' || mqttStatus.value === 'connecting'
}

function markMqttEndpointChanged(reason: string): void {
  mqttNeedsManualReconnect.value = true
  console.log(`[MQTT] Endpoint changed (${reason}); manual reconnect required`)

  if (isMqttActive()) {
    void disconnectMqtt()
  }
}

function clearMqttClientIdReconnectTimer(): void {
  if (mqttClientIdReconnectTimer !== null) {
    window.clearTimeout(mqttClientIdReconnectTimer)
    mqttClientIdReconnectTimer = null
  }
}

function scheduleMqttClientIdReconnect(nextClientId: string): void {
  if (!nextClientId || mqttNeedsManualReconnect.value) return

  clearMqttClientIdReconnectTimer()
  mqttClientIdReconnectTimer = window.setTimeout(() => {
    mqttClientIdReconnectTimer = null
    if (mqttStatus.value !== 'connected') return
    if (mqttConnectedClientId === nextClientId) return

    console.log(
      `[MQTT] Client ID changed, reconnecting: ${mqttConnectedClientId || 'unknown'} -> ${nextClientId}`
    )
    void connectMqtt({ reason: 'client-id-change' })
  }, 300)
}

function parseBrokerUrlParts(brokerUrl: string): { scheme: string; host: string; port: number } {
  const match = brokerUrl.trim().match(/^([a-z]+):\/\/([^:\/]+)(?::(\d+))?/i)
  return {
    scheme: match?.[1] || 'mqtt',
    host: match?.[2] || '127.0.0.1',
    port: match?.[3] ? parseInt(match[3], 10) : mqttConfig.value.port || 3333
  }
}

function buildBrokerUrl(host: string, port: number, scheme: string): string {
  return `${scheme}://${host}:${port}`
}

watch(
  () => mqttConfig.value.brokerUrl,
  (brokerUrl) => {
    const { host, port } = parseBrokerUrlParts(brokerUrl)

    if (host && host !== ipAddress.value) {
      ipAddress.value = host
    }

    if (mqttConfig.value.port !== port) {
      mqttConfig.value = {
        ...mqttConfig.value,
        port
      }
    }
  },
  { immediate: true }
)

watch(
  () => mqttConfig.value.port,
  (port, previousPort) => {
    if (!port) return

    const { scheme, host } = parseBrokerUrlParts(mqttConfig.value.brokerUrl)
    const nextBrokerUrl = buildBrokerUrl(host || ipAddress.value || '127.0.0.1', port, scheme)

    if (mqttConfig.value.brokerUrl !== nextBrokerUrl) {
      mqttConfig.value = {
        ...mqttConfig.value,
        brokerUrl: nextBrokerUrl
      }
    }

    if (previousPort !== undefined && previousPort !== port) {
      markMqttEndpointChanged('port')
    }
  }
)

watch(
  ipAddress,
  (host, previousHost) => {
    const trimmedHost = host.trim()
    if (!trimmedHost) return

    const { scheme, port } = parseBrokerUrlParts(mqttConfig.value.brokerUrl)
    const nextBrokerUrl = buildBrokerUrl(trimmedHost, port || mqttConfig.value.port || 3333, scheme)

    if (mqttConfig.value.brokerUrl !== nextBrokerUrl) {
      mqttConfig.value = {
        ...mqttConfig.value,
        brokerUrl: nextBrokerUrl
      }
    }

    if ((udpConfig.value.sourceHost || '') !== trimmedHost) {
      udpConfig.value = {
        ...udpConfig.value,
        sourceHost: trimmedHost
      }
    }

    if (previousHost !== undefined && previousHost.trim() !== trimmedHost) {
      markMqttEndpointChanged('ip')
    }
  },
  { immediate: true }
)

// 车辆姿态数据（模拟数据，后续可从 MQTT/UDP 获取）
const chassisYaw = ref(45) // 底盘朝向角度
const gimbalYaw = ref(90) // 云台朝向角度
const gimbalPitch = ref(0) // 云台俯仰角度（正值为抬头，负值为低头）

const dashboardVerboseLogs =
  import.meta.env.DEV &&
  typeof window !== 'undefined' &&
  window.localStorage?.getItem('shark.dashboard.verbose') === '1'

function dashboardDebugLog(...args: unknown[]): void {
  if (dashboardVerboseLogs) {
    console.debug(...args)
  }
}

// --- 机器人配置系统（由 RobotStateManager 组件管理，此处仅保留必要的引用）---
import type { RobotConfigFile, RobotConfigResult } from '@/types/robot-config'

const robotConfig = ref<RobotConfigFile | null>(null)
const currentRobotConfig = ref<RobotConfigResult | null>(null)

const DEFAULT_ROBOT_IDS_BY_NAME: Record<string, number> = {
  红方1号英雄: 1,
  蓝方1号英雄: 101,
  红方3号步兵: 3,
  蓝方3号步兵: 103,
  红方4号步兵: 4,
  蓝方4号步兵: 104,
  红方5号步兵: 5,
  蓝方5号步兵: 105,
  红方2号工程: 2,
  蓝方2号工程: 102,
  红方6号无人机: 6,
  蓝方6号无人机: 106,
  红方7号哨兵: 7,
  蓝方7号哨兵: 107,
  红方雷达站: 9,
  蓝方雷达站: 109
}

function normalizeVehicleId(value: unknown): number {
  const vehicleId = Math.trunc(Number(value))
  return Number.isFinite(vehicleId) && vehicleId > 0 ? vehicleId : 0
}

function resolveVehicleIdByRobotName(robotName: string): number {
  const serverRobotId = normalizeVehicleId(mqttDataStore.serverSelectedRobotId)
  if (serverRobotId > 0) return serverRobotId

  const configId = normalizeVehicleId(robotConfig.value?.robotMappings?.[robotName]?.id)
  if (configId > 0) return configId

  const currentConfigId = normalizeVehicleId(currentRobotConfig.value?.id)
  if (currentConfigId > 0 && robotName === selectedRobot.value) return currentConfigId

  const storeRobotId = normalizeVehicleId(mqttDataStore.currentRobotId)
  if (storeRobotId > 0 && mqttDataStore.currentRobotType === robotName) return storeRobotId

  return DEFAULT_ROBOT_IDS_BY_NAME[robotName] ?? 0
}

const selectedVehicleId = computed(() => resolveVehicleIdByRobotName(selectedRobot.value))
const effectiveMqttClientId = computed(() => {
  return selectedVehicleId.value > 0 ? String(selectedVehicleId.value) : ''
})

function getMqttClientIdForConnection(): string | undefined {
  const clientId = effectiveMqttClientId.value
  if (clientId) return clientId

  const trimmedFallback = String(mqttConfig.value.clientId ?? '').trim()
  return trimmedFallback || undefined
}
// --- 结束 ---

// 准星配置（本地保留，UI 特定配置）
const crosshairConfig = ref<CrosshairConfig>({
  style: 'cross',
  color: '#00ff0d',
  outlineColor: '#000000',
  outlineThickness: 0,
  size: 12,
  thickness: 2,
  gap: 4,
  centerDot: false,
  centerDotSize: 2,
  dynamic: false,
  dynamicSplit: 5,
  opacity: 0.85
})

// ==================== 低血量屏幕效果 ====================
/**
 * 计算当前机器人的血量百分比
 * 根据选择的队伍和机器人类型从 MQTT 数据中获取血量
 */
const currentRobotHealthPercentage = computed(() => {
  const team = selectedTeam || 'red'
  const robotList = team === 'red' ? mqttDataStore.redRobotList : mqttDataStore.blueRobotList

  // 如果没有机器人数据，返回满血（避免误触发低血量效果）
  if (robotList.length === 0) {
    return 100
  }

  // 简单实现：使用第一个机器人的血量
  // TODO: 根据 selectedRobot 匹配具体机器人类型
  const robot = robotList[0]
  if (!robot || robot.maxHealth <= 0) {
    return 100
  }

  return (robot.currentHealth / robot.maxHealth) * 100
})

/**
 * 计算低血量渐晕的不透明度
 * 血量 > 50%: 不显示
 * 血量 25%-50%: 渐变显示 (0-0.3)
 * 血量 < 25%: 强烈显示 (0.3-0.6)
 */
const lowHealthVignetteOpacity = computed(() => {
  const healthPercent = currentRobotHealthPercentage.value

  if (healthPercent >= 50) {
    return 0
  } else if (healthPercent >= 25) {
    // 25-50% 血量：线性插值 0 -> 0.3
    return ((50 - healthPercent) / 25) * 0.3
  } else {
    // 0-25% 血量：线性插值 0.3 -> 0.6
    return 0.3 + ((25 - healthPercent) / 25) * 0.3
  }
})

/**
 * 低血量脉搏动画触发条件（血量 < 25%）
 */
const isLowHealthCritical = computed(() => currentRobotHealthPercentage.value < 25)

/**
 * 是否有任何菜单打开（用于禁用鼠标捕获）
 */
const isAnyMenuOpen = computed(
  () =>
    isSettingsVisible.value ||
    isCrosshairSettingsVisible.value ||
    isAmmoPurchaseVisible.value ||
    isRemoteAmmoPurchaseVisible.value ||
    // 工程装配菜单打开时也需要释放鼠标捕获
    robotActionHintRef.value?.isAssemblyMenuOpen ||
    // 无人机飞镖瞄准时也需要释放鼠标捕获
    robotActionHintRef.value?.isDartTargeting
)

// 鼠标捕获状态
const isMouseCaptured = ref(false)

// 视频缩放状态
const MIN_ZOOM = 1.0 // 最小缩放（原始大小，不允许缩小）
const MAX_ZOOM = 10.0 // 最大缩放 10 倍
const ZOOM_STEP = 0.1 // 每次缩放步进，保留 1 位小数
const VIDEO_ZOOM_STORAGE_KEY = 'shark.dashboard.videoZoom'
const GLOBAL_HOTKEY_STORAGE_KEY = 'shark.dashboard.globalHotkeys'
const LEGACY_VIDEO_ZOOM_HOTKEY_STORAGE_KEY = 'shark.dashboard.videoZoomHotkeys'

type GlobalHotkeyAction =
  | 'toggleSettings'
  | 'exitHudEdit'
  | 'toggleDetection'
  | 'crosshairSettings'
  | 'ammoPurchase'
  | 'remoteAmmoPurchase'
  | 'zoomIn'
  | 'zoomOut'
  | 'zoomReset'

type GlobalHotkeys = Record<GlobalHotkeyAction, string>

const DEFAULT_GLOBAL_HOTKEYS: GlobalHotkeys = {
  toggleSettings: 'KeyP',
  exitHudEdit: 'Escape',
  toggleDetection: 'F6',
  crosshairSettings: 'F7',
  ammoPurchase: 'F8',
  remoteAmmoPurchase: 'KeyH',
  zoomIn: 'Equal',
  zoomOut: 'Minus',
  zoomReset: 'Delete'
}

const LEGACY_DEFAULT_ROBOT_CONFLICT_HOTKEYS: Partial<GlobalHotkeys> = {
  toggleDetection: 'KeyD',
  crosshairSettings: 'KeyE',
  ammoPurchase: 'KeyB'
}

const ROBOT_CONTROL_KEY_LABELS: Record<string, string> = {
  KeyW: 'W',
  KeyS: 'S',
  KeyA: 'A',
  KeyD: 'D',
  ShiftLeft: 'Shift',
  ShiftRight: 'Shift',
  ControlLeft: 'Ctrl',
  ControlRight: 'Ctrl',
  KeyQ: 'Q',
  KeyE: 'E',
  KeyR: 'R',
  KeyF: 'F',
  KeyG: 'G',
  KeyZ: 'Z',
  KeyX: 'X',
  KeyC: 'C',
  KeyV: 'V',
  KeyB: 'B'
}

const GLOBAL_HOTKEY_GROUPS: Array<{
  title: string
  actions: Array<{ action: GlobalHotkeyAction; label: string; description: string }>
}> = [
  {
    title: '界面',
    actions: [
      { action: 'toggleSettings', label: '设置菜单', description: '打开或关闭 P 键设置菜单' },
      { action: 'exitHudEdit', label: '退出 HUD 编辑', description: '关闭 HUD 编辑模式' },
      { action: 'crosshairSettings', label: '准星设置', description: '打开或关闭准星设置窗口' }
    ]
  },
  {
    title: '战斗',
    actions: [
      { action: 'toggleDetection', label: '检测开关', description: '启用或停止 AI 检测' },
      { action: 'ammoPurchase', label: '弹丸购买', description: '打开或关闭弹丸购买菜单' },
      { action: 'remoteAmmoPurchase', label: '远程补弹', description: '打开或关闭远程补弹菜单' }
    ]
  },
  {
    title: '图传',
    actions: [
      { action: 'zoomIn', label: '图传放大', description: '按 0.1 倍步进放大图传' },
      { action: 'zoomOut', label: '图传缩小', description: '按 0.1 倍步进缩小图传' },
      { action: 'zoomReset', label: '图传复位', description: '恢复到 1.0 倍' }
    ]
  }
]

function normalizeVideoZoom(value: number): number {
  if (!Number.isFinite(value)) return MIN_ZOOM
  const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value))
  return Math.round(clamped * 10) / 10
}

function loadSavedVideoZoom(): number {
  try {
    const saved = window.localStorage?.getItem(VIDEO_ZOOM_STORAGE_KEY)
    return normalizeVideoZoom(saved === null ? MIN_ZOOM : Number(saved))
  } catch {
    return MIN_ZOOM
  }
}

function saveVideoZoom(value: number): void {
  try {
    window.localStorage?.setItem(VIDEO_ZOOM_STORAGE_KEY, normalizeVideoZoom(value).toFixed(1))
  } catch (error) {
    console.warn('[Dashboard] Failed to save video zoom:', error)
  }
}

function normalizeGlobalHotkeys(value: unknown): GlobalHotkeys {
  const source = value && typeof value === 'object' ? (value as Partial<GlobalHotkeys>) : {}
  const normalizedSource = { ...source }
  ;(Object.entries(LEGACY_DEFAULT_ROBOT_CONFLICT_HOTKEYS) as Array<[GlobalHotkeyAction, string]>).forEach(
    ([action, legacyCode]) => {
      if (normalizedSource[action] === legacyCode) {
        delete normalizedSource[action]
      }
    }
  )

  return {
    ...DEFAULT_GLOBAL_HOTKEYS,
    ...Object.fromEntries(
      Object.entries(normalizedSource).filter(([, code]) => typeof code === 'string' && code.length > 0)
    )
  }
}

function loadSavedGlobalHotkeys(): GlobalHotkeys {
  try {
    const saved = window.localStorage?.getItem(GLOBAL_HOTKEY_STORAGE_KEY)
    if (saved) return normalizeGlobalHotkeys(JSON.parse(saved))

    const legacyZoom = window.localStorage?.getItem(LEGACY_VIDEO_ZOOM_HOTKEY_STORAGE_KEY)
    if (legacyZoom) {
      const legacy = JSON.parse(legacyZoom) as Partial<Record<'zoomIn' | 'zoomOut' | 'reset', string>>
      return normalizeGlobalHotkeys({
        zoomIn: legacy.zoomIn,
        zoomOut: legacy.zoomOut,
        zoomReset: legacy.reset
      })
    }
  } catch {
    // fallback below
  }
  return { ...DEFAULT_GLOBAL_HOTKEYS }
}

function saveGlobalHotkeys(value: GlobalHotkeys): void {
  try {
    window.localStorage?.setItem(GLOBAL_HOTKEY_STORAGE_KEY, JSON.stringify(normalizeGlobalHotkeys(value)))
  } catch (error) {
    console.warn('[Dashboard] Failed to save global hotkeys:', error)
  }
}

function formatHotkey(code: string): string {
  const robotKeyLabel = ROBOT_CONTROL_KEY_LABELS[code]
  if (robotKeyLabel) return robotKeyLabel
  if (code === 'Equal') return '+/='
  if (code === 'Minus') return '-'
  if (code === 'Delete') return 'Del'
  if (code === 'Escape') return 'Esc'
  if (code === 'Space') return 'Space'
  if (code.startsWith('Key')) return code.slice(3)
  if (code.startsWith('Digit')) return code.slice(5)
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`
  if (code.startsWith('Arrow')) return code.replace('Arrow', '')
  return code.replace(/([a-z])([A-Z])/g, '$1 $2')
}

const videoZoom = ref(loadSavedVideoZoom()) // 缩放倍率，1.0 为原始大小
const videoZoomText = computed(() => `${videoZoom.value.toFixed(1)}x`)
const globalHotkeys = ref<GlobalHotkeys>(loadSavedGlobalHotkeys())
const recordingHotkeyAction = ref<GlobalHotkeyAction | null>(null)

interface KeyboardMouseControlFrame {
  mouseX: number
  mouseY: number
  mouseZ: number
  leftButtonDown: boolean
  rightButtonDown: boolean
  midButtonDown: boolean
  keyboardValue: number
}

const ZERO_KEYBOARD_MOUSE_CONTROL_FRAME: KeyboardMouseControlFrame = {
  mouseX: 0,
  mouseY: 0,
  mouseZ: 0,
  leftButtonDown: false,
  rightButtonDown: false,
  midButtonDown: false,
  keyboardValue: 0
}

const ROBO_CONTROL_TOPIC = 'KeyboardMouseControl'
const ROBO_CONTROL_LEGACY_TOPIC = 'robot/client/keyboard_mouse'
const ROBO_CONTROL_MESSAGE_TYPE = 'KeyboardMouseControl'
const ROBO_CONTROL_QOS = 0
const ROBO_CONTROL_MAX_IN_FLIGHT = 1
const ROBO_CONTROL_DEBUG_STORAGE_KEY = 'shark.dashboard.roboControlDebug'
const ROBO_CONTROL_ECHO_TOPICS = new Set([ROBO_CONTROL_TOPIC, ROBO_CONTROL_LEGACY_TOPIC])
const MQTT_UI_FRAME_BUDGET_MS = 6
const MQTT_UI_MAX_MESSAGES_PER_FRAME = 48
const MQTT_UI_IMPORTANT_QUEUE_MAX = 256
const MQTT_COALESCED_MESSAGE_TYPES = new Set([
  'game_status',
  'global_unit_status',
  'global_logistics_status',
  'global_special_mechanism',
  'robot_static_status',
  'robot_dynamic_status',
  'robot_position',
  'custom_byte_block',
  'robot_module_status',
  'robot_injury_stat',
  'robot_respawn_status',
  'buff',
  'penalty_info',
  'rader_info_to_client',
  'sentinel_status_sync',
  'rune_status_sync',
  'air_support_status_sync'
])

type RoboControlPublishOptions = {
  force?: boolean
}

type DashboardMqttMessage = {
  topic: string
  messageType: string
  data: object | string
  raw: string
  timestamp: number
  parseSuccess?: boolean
}

let roboControlPublishInFlight = 0
let queuedRoboControlFrame: KeyboardMouseControlFrame | null = null
let lastRoboControlPublishWarningAt = 0
let lastRoboControlPublishErrorAt = 0
let lastRoboControlDebugAt = 0
let roboControlDebugFrames = 0
let roboControlDebugSent = 0
let roboControlDebugDropped = 0
let pendingImportantMqttMessages: DashboardMqttMessage[] = []
let pendingLatestMqttMessages = new Map<string, DashboardMqttMessage>()
let mqttUiPumpFrame: number | null = null
let mqttUiStatsPending = 0
let mqttUiLastMessageTime = 0

function mergeKeyboardMouseControlFrames(
  previous: KeyboardMouseControlFrame,
  next: KeyboardMouseControlFrame
): KeyboardMouseControlFrame {
  return {
    mouseX: previous.mouseX + next.mouseX,
    mouseY: previous.mouseY + next.mouseY,
    mouseZ: previous.mouseZ + next.mouseZ,
    leftButtonDown: next.leftButtonDown,
    rightButtonDown: next.rightButtonDown,
    midButtonDown: next.midButtonDown,
    keyboardValue: next.keyboardValue
  }
}

function isZeroKeyboardMouseControlFrame(frame: KeyboardMouseControlFrame): boolean {
  return (
    frame.mouseX === 0 &&
    frame.mouseY === 0 &&
    frame.mouseZ === 0 &&
    frame.leftButtonDown === false &&
    frame.rightButtonDown === false &&
    frame.midButtonDown === false &&
    frame.keyboardValue === 0
  )
}

function isRoboControlEchoMessage(topic: string, messageType: string): boolean {
  return messageType === 'remote_control' && ROBO_CONTROL_ECHO_TOPICS.has(topic)
}

function isMqttMessageCoalescable(messageType: string): boolean {
  return MQTT_COALESCED_MESSAGE_TYPES.has(messageType)
}

function flushMqttUiStats(): void {
  if (mqttUiStatsPending <= 0) return

  mqttStats.value.messagesReceived += mqttUiStatsPending
  mqttStats.value.lastMessageTime = mqttUiLastMessageTime || Date.now()
  mqttUiStatsPending = 0
}

function handleDashboardMqttMessage(data: DashboardMqttMessage): void {
  dashboardDebugLog('[MQTT] 收到消息:', data.topic, data.data)
  mqttUiStatsPending += 1
  mqttUiLastMessageTime = Date.now()
  mqttDataStore.handleMessage(data.topic, data.messageType as any, data.data)
}

function scheduleDashboardMqttPump(): void {
  if (mqttUiPumpFrame !== null) return

  mqttUiPumpFrame = window.requestAnimationFrame(() => {
    mqttUiPumpFrame = null
    drainDashboardMqttMessages()
  })
}

function drainDashboardMqttMessages(): void {
  const startedAt = performance.now()
  let processed = 0

  while (
    pendingImportantMqttMessages.length > 0 &&
    processed < MQTT_UI_MAX_MESSAGES_PER_FRAME &&
    performance.now() - startedAt < MQTT_UI_FRAME_BUDGET_MS
  ) {
    const next = pendingImportantMqttMessages.shift()
    if (!next) continue
    handleDashboardMqttMessage(next)
    processed += 1
  }

  for (const [key, next] of pendingLatestMqttMessages) {
    if (
      processed >= MQTT_UI_MAX_MESSAGES_PER_FRAME ||
      performance.now() - startedAt >= MQTT_UI_FRAME_BUDGET_MS
    ) {
      break
    }

    pendingLatestMqttMessages.delete(key)
    handleDashboardMqttMessage(next)
    processed += 1
  }

  flushMqttUiStats()

  if (pendingImportantMqttMessages.length > 0 || pendingLatestMqttMessages.size > 0) {
    scheduleDashboardMqttPump()
  }
}

function enqueueDashboardMqttMessage(data: DashboardMqttMessage): void {
  if (isRoboControlEchoMessage(data.topic, data.messageType)) {
    return
  }

  if (data.parseSuccess === false) {
    dashboardDebugLog('[MQTT] Dropped undecodable message:', data.topic)
    return
  }

  if (isMqttMessageCoalescable(data.messageType)) {
    pendingLatestMqttMessages.set(`${data.messageType}:${data.topic}`, data)
  } else {
    pendingImportantMqttMessages.push(data)
    if (pendingImportantMqttMessages.length > MQTT_UI_IMPORTANT_QUEUE_MAX) {
      pendingImportantMqttMessages.splice(
        0,
        pendingImportantMqttMessages.length - MQTT_UI_IMPORTANT_QUEUE_MAX
      )
    }
  }

  scheduleDashboardMqttPump()
}

function cleanupDashboardMqttQueue(): void {
  if (mqttUiPumpFrame !== null) {
    window.cancelAnimationFrame(mqttUiPumpFrame)
    mqttUiPumpFrame = null
  }

  pendingImportantMqttMessages = []
  pendingLatestMqttMessages = new Map()
  mqttUiStatsPending = 0
  mqttUiLastMessageTime = 0
}

function isRoboControlDebugEnabled(): boolean {
  return localStorage.getItem(ROBO_CONTROL_DEBUG_STORAGE_KEY) === '1'
}

function recordRoboControlDebug(frame: KeyboardMouseControlFrame, sent = false, dropped = false): void {
  if (!isRoboControlDebugEnabled()) return

  roboControlDebugFrames += 1
  if (sent) roboControlDebugSent += 1
  if (dropped) roboControlDebugDropped += 1

  const now = Date.now()
  if (now - lastRoboControlDebugAt < 1000) return

  lastRoboControlDebugAt = now
  console.debug('[RoboControl] publish stats', {
    frames: roboControlDebugFrames,
    sent: roboControlDebugSent,
    dropped: roboControlDebugDropped,
    inFlight: roboControlPublishInFlight,
    queued: Boolean(queuedRoboControlFrame),
    mqttStatus: mqttStatus.value,
    lastFrame: frame,
    isZero: isZeroKeyboardMouseControlFrame(frame)
  })
  roboControlDebugFrames = 0
  roboControlDebugSent = 0
  roboControlDebugDropped = 0
}

// 监听 Pipe 服务器状态变化
if (window.api?.pipeServer?.onStatusChanged) {
  window.api.pipeServer.onStatusChanged((status: string, message?: string) => {
    console.log('[Dashboard] Pipe 服务器状态变化:', status, message ?? '')
    store.setPipeServerStatus(status as PipeServerStatus)
    if (status === 'error' && message) {
      console.error('[Dashboard] Pipe 服务器错误:', message)
    }
  })
}

// 视频状态（本地 DOM 引用）
const videoEl = ref<HTMLVideoElement | null>(null)
const tabsContentEl = ref<HTMLDivElement | null>(null)
const detectionServiceRef = ref<InstanceType<typeof DetectionService> | null>(null)
const robotStateRef = ref<InstanceType<typeof RobotStateManager> | null>(null)
const performanceOptimizerRef = ref<InstanceType<typeof PerformanceOptimizer> | null>(null)
const configPanelsRef = ref<InstanceType<typeof ConfigPanels> | null>(null)
const dashboardConfigRef = ref<InstanceType<typeof DashboardConfigManager> | null>(null)
const robotActionHintRef = ref<InstanceType<typeof RobotActionHint> | null>(null)
const cameraDevices = ref<MediaDeviceInfo[]>([])

// WebRTC 分发连接管理（本地变量）
let localStream: MediaStream | null = null
let rtcPeerConnections: Map<string, RTCPeerConnection> = new Map()

// ==================== 目标检测相关 ====================
// detections, detectionFrameSize, videoSize 现在从 Pinia store 获取
// 推理引擎已内嵌到 Rust 二进制，无需监听外部 Python 子进程状态。

// 子组件 video-connected 事件回调：更新父级状态
function handleVideoConnected(connected: boolean): void {
  wasConnected.value = connected
  if (connected) {
    cameraStatus.value =
      videoSource.value === 'camera'
        ? '摄像头 (直连)'
        : videoSource.value === 'file'
          ? '视频文件播放中'
          : `UDP (${udpConfig.value.port})`
  } else {
    cameraStatus.value = '未连接'
  }
}

// ==================== DetectionService 事件处理 ====================
// 注意: 子组件现在直接同步状态到 Pinia store，以下处理函数仅用于日志记录

/**
 * 处理通信状态变化事件（仅日志）
 */
function handleCommunicationStatusChange(connected: boolean): void {
  console.log('[Dashboard] 检测通信状态变化:', connected ? '已连接' : '已断开')
}

// ==================== RobotStateManager 事件处理 ====================
// 注意: 子组件现在直接同步状态到 Pinia store

/**
 * 处理机器人配置加载事件
 */
function handleRobotConfigLoaded(config: RobotConfigResult | null): void {
  currentRobotConfig.value = config
  console.log('[Dashboard] 机器人配置已加载:', config?.type)
}

function shouldRenderViaLatestFrameQueue(frame: UdpFramePacket): boolean {
  if (activeUdpCodec === 'mjpeg') {
    return true
  }

  if (activeUdpCodec === 'h264' || activeUdpCodec === 'h265') {
    return false
  }

  if (frame.info.type && frame.info.type !== 'unknown') {
    return frame.info.type !== 'h264' && frame.info.type !== 'h265'
  }

  const frameType =
    frame.info.type && frame.info.type !== 'unknown'
      ? frame.info.type
      : detectUdpFrameType(frame.data)

  return frameType !== 'h264' && frameType !== 'h265'
}

function enqueueUdpRenderFrame(frame: UdpFramePacket): void {
  if (latestUdpRenderFrame) {
    udpStats.value.droppedOldFrames = (udpStats.value.droppedOldFrames ?? 0) + 1
  }

  latestUdpRenderFrame = frame

  if (udpRenderPumpScheduled) {
    return
  }

  udpRenderPumpScheduled = true
  requestAnimationFrame(() => {
    udpRenderPumpScheduled = false
    void drainLatestUdpRenderFrame()
  })
}

async function drainLatestUdpRenderFrame(): Promise<void> {
  if (udpRenderPumpRunning) {
    return
  }

  udpRenderPumpRunning = true

  try {
    while (latestUdpRenderFrame) {
      const frame = latestUdpRenderFrame
      latestUdpRenderFrame = null
      await processReceivedFrame(frame.data, frame.info)
    }
  } finally {
    udpRenderPumpRunning = false

    if (latestUdpRenderFrame) {
      enqueueUdpRenderFrame(latestUdpRenderFrame)
    }
  }
}

/**
 * 处理机器人选择变化
 */
function handleRobotChange(robotName: string): void {
  selectedRobot.value = robotName
  void mqttDataStore.updateCurrentRobotType(robotName)
  console.log('[Dashboard] 机器人选择已更新:', robotName)
}

// ==================== PerformanceOptimizer 事件处理 ====================
// 注意: 子组件现在直接同步状态到 Pinia store

/**
 * 运行编码性能测试（委托给 PerformanceOptimizer 组件）
 */
const runEncodingBenchmark = async (): Promise<void> => {
  if (!performanceOptimizerRef.value) {
    console.warn('[性能测试] PerformanceOptimizer 组件未就绪')
    return
  }
  performanceOptimizerRef.value.runBenchmark()
}

// ==================== ConfigPanels 事件处理 ====================
// 注意: 子组件现在直接同步状态到 Pinia store

// ==================== 外置检测服务管理 ====================
const DEFAULT_DETECTION_SCRIPT_PATH = 'AI Server'

/**
 * 手动启动外置检测脚本。
 */
const startPipeServer = async (): Promise<boolean> => {
  try {
    pipeServerStatus.value = 'starting'
    const result = await window.api.pipeServer.start(DEFAULT_DETECTION_SCRIPT_PATH)
    if (result?.success) {
      pipeServerStatus.value = ((result as any).status as PipeServerStatus) ?? 'starting'
      console.log('[Detector] 外置检测脚本启动中', result)
      return true
    }
    pipeServerStatus.value = 'error'
    console.error('[Detector] 启动失败:', (result as any)?.error)
    return false
  } catch (error) {
    console.error('[Detector] 启动异常:', error)
    pipeServerStatus.value = 'error'
    return false
  }
}

/**
 * 停止 Pipe 服务器
 */
const stopPipeServer = async (): Promise<void> => {
  if (!window.api?.pipeServer) return

  try {
    // 通过 DetectionService 组件断开 Pipe 连接（如果有）
    if (detectionServiceRef.value) {
      await detectionServiceRef.value.disconnectCommunication()
    }

    await window.api.pipeServer.stop()
    pipeServerStatus.value = 'stopped'
    console.log('[Pipe Server] 已停止')
  } catch (error) {
    console.error('[Pipe Server] 停止失败:', error)
  }
}

/**
 * 应用性能预设
 * 更新 globalConfig 中的编码和检测配置
 */
function applyPreset(preset: PerformancePreset): void {
  const config = PERFORMANCE_PRESETS[preset]
  performancePreset.value = preset
  globalConfig.value.performancePreset = preset

  // 应用编码配置到 globalConfig
  globalConfig.value.encode = {
    quality: config.encode.quality,
    maxSize: config.encode.maxSize,
    enableDownsample: config.encode.enableDownsample
  }

  // 应用检测配置到 globalConfig
  globalConfig.value.detection = {
    ...globalConfig.value.detection,
    armorConf: config.detect.armorConf,
    carConf: config.detect.carConf,
    maxSize: config.detect.maxSize
  }

  console.log(`[Dashboard] 切换到预设: ${preset} - ${config.desc}`)
}

/**
 * 切换目标检测功能（委托给 DetectionService 组件）
 */
async function toggleDetection(): Promise<void> {
  if (!detectionEnabled.value && pipeServerStatus.value !== 'running') {
    console.warn('[Dashboard] 请先手动启动外置检测服务')
    return
  }
  // 切换父组件（Dashboard）的 detectionEnabled 状态，子组件通过 props.watch 响应
  detectionEnabled.value = !detectionEnabled.value
}

/**
 * 停止检测（委托给 DetectionService 组件）
 */
function stopDetection(): void {
  // 停止检测：切换父级状态为 false，子组件会通过 props.watch 停止检测
  detectionEnabled.value = false
}

// ==================== 摄像头设备管理 ====================
/**
 * 加载并枚举摄像头设备
 */
async function loadCameraDevices(): Promise<void> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices()
    cameraDevices.value = devices.filter((d) => d.kind === 'videoinput')

    // 自动选择第一个物理摄像头（过滤虚拟摄像头）
    if (cameraDevices.value.length > 0 && !selectedCameraId.value) {
      const virtualKeywords = ['virtual', 'obs', 'eshare', 'snap camera']
      const physicalCamera = cameraDevices.value.find(
        (d) => !virtualKeywords.some((keyword) => d.label.toLowerCase().includes(keyword))
      )
      selectedCameraId.value = physicalCamera?.deviceId || cameraDevices.value[0].deviceId
    }

    console.log(
      `[Dashboard] 加载摄像头设备: 共 ${cameraDevices.value.length} 个`,
      cameraDevices.value.map((d) => ({ id: d.deviceId.slice(0, 12), label: d.label }))
    )
  } catch (error) {
    console.error('[Dashboard] 加载摄像头设备失败:', error)
    cameraDevices.value = []
  }
}

// ==================== 枪口热量模拟 ====================
const muzzleHeat = ref(0)
let heatTimer: number | null = null

/**
 * 热量百分比 (0-1)
 */
const heatPercent = computed(() => Math.max(0, Math.min(1, muzzleHeat.value / MAX_MUZZLE_HEAT)))

/**
 * 根据热量动态计算环形颜色 (绿 -> 红)
 */
const ringColor = computed(() => {
  const t = heatPercent.value
  const r = Math.round(34 + (239 - 34) * t) // 34 -> 239
  const g = Math.round(197 + (68 - 197) * t) // 197 -> 68
  const b = Math.round(94 + (68 - 94) * t) // 94 -> 68
  return `rgb(${r}, ${g}, ${b})`
})

/**
 * 环形周长
 */
const ringCircumference = 2 * Math.PI * RING_RADIUS

/**
 * 启动热量模拟动画
 */
function startHeatSimulation(): void {
  if (heatTimer || !enableSimulation.value) return

  const startTime = performance.now()
  heatTimer = window.setInterval(() => {
    const elapsedSeconds = (performance.now() - startTime) / 1000
    // 正弦波模拟热量变化
    muzzleHeat.value = ((Math.sin((elapsedSeconds * Math.PI) / 3) + 1) / 2) * MAX_MUZZLE_HEAT
  }, HEAT_SIMULATION_INTERVAL)
}

/**
 * 停止热量模拟动画
 */
function stopHeatSimulation(): void {
  if (heatTimer) {
    clearInterval(heatTimer)
    heatTimer = null
    muzzleHeat.value = 0
  }
}

// ==================== WebRTC 控制 ====================
/**
 * 获取媒体流（摄像头）
 */
async function getMediaStream(): Promise<MediaStream> {
  if (videoSource.value !== 'camera') {
    throw new Error('视频文件模式不支持 WebRTC')
  }

  videoStatus.value = '请求摄像头权限...'

  const constraints: MediaStreamConstraints = {
    video: {
      deviceId: selectedCameraId.value ? { exact: selectedCameraId.value } : undefined,
      ...VIDEO_CONSTRAINTS
    },
    audio: false
  }

  console.log('[Dashboard] getUserMedia 约束:', constraints)
  const stream = await navigator.mediaDevices.getUserMedia(constraints)

  // 记录实际获取的设备信息
  const videoTrack = stream.getVideoTracks()[0]
  if (videoTrack) {
    const settings = videoTrack.getSettings()
    console.log('[Dashboard] 摄像头设置:', {
      label: videoTrack.label,
      width: settings.width,
      height: settings.height,
      deviceId: settings.deviceId
    })
  }

  return stream
}

/**
 * 清理视频流和相关资源
 */
function cleanup(): void {
  // 性能优化：清理时停止模拟
  stopHeatSimulation()
  // 状态模拟由 RobotStateManager 组件内部管理

  // 停止 WebRTC 分发
  stopWebRTCDistribution()

  // 停止所有媒体轨道
  if (localStream) {
    localStream.getTracks().forEach((track) => {
      track.stop()
      console.log(`[Dashboard] 停止媒体轨道: ${track.kind}`)
    })
    localStream = null
  }

  // 停止 UDP 视频流
  stopUdpStream()

  // 清空视频元素
  if (videoEl.value) {
    const video = videoEl.value
    video.srcObject = null
    video.src = ''
    video.poster = ''
  }

  console.log('[Dashboard] 视频资源已清理')
}

// ==================== UDP 图传相关 ====================
let udpCleanupHandler: (() => void) | null = null
let udpStatsCleanupHandler: (() => void) | null = null
let udpFpsTimer: number | null = null
let udpFrameCountForFps = 0
let udpBytesReceived = 0
let udpFpsStartTime = 0

// UDP Canvas -> 直接显示（绕过 captureStream + <video>，消除同步/合成开销）
const udpCanvasEl = ref<HTMLCanvasElement | null>(null)
let udpCanvasCtx: CanvasRenderingContext2D | null = null
let udpMediaStream: MediaStream | null = null
let pendingUdpImage: HTMLImageElement | null = null // 复用 Image 对象减少 GC
const udpDirectCanvasActive = ref(false)
const udpBackendMjpegActive = ref(false)
const udpMjpegImageEl = ref<HTMLImageElement | null>(null)
const udpMjpegStreamUrl = ref('')
type UdpFrameInfoLike = {
  type: string
  isKeyframe: boolean
  width?: number
  height?: number
}
type UdpFramePayload = BufferSource
type UdpFramePacket = {
  data: UdpFramePayload
  info: UdpFrameInfoLike
}

type UdpCodecPreference = 'auto' | 'mjpeg' | 'h264' | 'h265'
type ActiveUdpCodec = Exclude<UdpCodecPreference, 'auto'>
type UdpActualFrameType = 'jpeg' | 'h264' | 'h265' | 'unknown'
type UdpCodecOption = { value: UdpCodecPreference; label: string; disabled?: boolean }
type DecodeCapabilities = {
  nativeDecodeAvailable?: boolean
  gpuDecodeAvailable?: boolean
  backendFfmpegAvailable?: boolean
  internalFfmpegAvailable?: boolean
  strategy?: string
}

function framePayloadToUint8Array(data: UdpFramePayload): Uint8Array {
  if (data instanceof Uint8Array) {
    return data
  }

  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data)
  }

  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
}

function normalizeUdpFrameType(type: string | null | undefined): UdpActualFrameType | null {
  return type === 'jpeg' || type === 'h264' || type === 'h265' ? type : null
}

let latestUdpRenderFrame: UdpFramePacket | null = null
let udpRenderPumpRunning = false
let udpRenderPumpScheduled = false
const UDP_FRAME_LOG_ENABLED = false
let activeUdpCodec: ActiveUdpCodec | null = null
let lastUdpCodecDecisionReason = ''
let decodeCapabilitiesPromise: Promise<DecodeCapabilities | null> | null = null
let hasWarnedUnsupportedH264Selection = false
let lastCompressedFrameDropLogAt = 0
let udpStatsPollTimer: number | null = null
let lastUdpStatsSampleAt = 0
let lastUdpStatsSampleBytes = 0
let lastUdpStatsSampleFrames = 0

type UdpStatsEventPayload = {
  fps?: number
  bytesPerSecond?: number
  stats?: Partial<UdpStats>
}

// 前端压缩视频解码已移除；UDP 视频统一交给后端解码/MJPEG 流显示。

// 编码类型选项
const codecOptions = computed<UdpCodecOption[]>(() => [
  { value: 'auto', label: '自动检测' },
  { value: 'mjpeg', label: 'MJPEG' },
  { value: 'h264', label: 'H.264（前端解码已移除）', disabled: true },
  { value: 'h265', label: 'H.265 (HEVC，后端解码→MJPEG)' }
])

watch(
  () => udpConfig.value.codec,
  (codec, previousCodec) => {
    if (codec === 'h264') {
      forceUnsupportedUdpCodecToMjpeg(previousCodec === undefined ? 'init' : 'select')
    }
  },
  { immediate: true }
)

function findAnnexBStartCode(bytes: Uint8Array, from: number): { index: number; length: number } | null {
  for (let index = from; index <= bytes.length - 3; index += 1) {
    if (bytes[index] !== 0x00 || bytes[index + 1] !== 0x00) {
      continue
    }

    if (bytes[index + 2] === 0x01) {
      return { index, length: 3 }
    }

    if (index + 3 < bytes.length && bytes[index + 2] === 0x00 && bytes[index + 3] === 0x01) {
      return { index, length: 4 }
    }
  }

  return null
}

function nextAnnexBNal(bytes: Uint8Array, from: number): { nextOffset: number; nal: Uint8Array } | null {
  const start = findAnnexBStartCode(bytes, from)
  if (!start) {
    return null
  }

  const nalStart = start.index + start.length
  if (nalStart >= bytes.length) {
    return null
  }

  const nextStart = findAnnexBStartCode(bytes, nalStart)
  const nextOffset = nextStart ? nextStart.index : bytes.length
  return {
    nextOffset,
    nal: bytes.subarray(nalStart, nextOffset)
  }
}

function parseH265NalType(nal: Uint8Array): number | null {
  if (nal.length < 2 || (nal[0] & 0x80) !== 0) {
    return null
  }

  const nalType = (nal[0] >> 1) & 0x3f
  const layerId = ((nal[0] & 0x01) << 5) | (nal[1] >> 3)
  const temporalIdPlus1 = nal[1] & 0x07
  return layerId === 0 && temporalIdPlus1 !== 0 && nalType <= 40 ? nalType : null
}

function parseH264NalType(nal: Uint8Array): number | null {
  if (nal.length === 0 || (nal[0] & 0x80) !== 0) {
    return null
  }

  const nalType = nal[0] & 0x1f
  return nalType >= 1 && nalType < 24 ? nalType : null
}

function analyzeAnnexBFrame(
  bytes: Uint8Array
): { codec: 'h264' | 'h265'; isKeyframe: boolean } | null {
  let offset = 0
  let sawH265 = false
  let sawH264 = false
  let h265Keyframe = false
  let h264Keyframe = false

  while (offset < bytes.length) {
    const nextNal = nextAnnexBNal(bytes, offset)
    if (!nextNal) {
      break
    }

    const nalTypeH265 = parseH265NalType(nextNal.nal)
    if (nalTypeH265 !== null) {
      sawH265 = true
      if ((nalTypeH265 >= 16 && nalTypeH265 <= 21) || nalTypeH265 === 32 || nalTypeH265 === 33 || nalTypeH265 === 34) {
        h265Keyframe = true
      }
    }

    const nalTypeH264 = parseH264NalType(nextNal.nal)
    if (nalTypeH264 !== null) {
      sawH264 = true
      if (nalTypeH264 === 5 || nalTypeH264 === 7 || nalTypeH264 === 8) {
        h264Keyframe = true
      }
    }

    if (nextNal.nextOffset >= bytes.length) {
      break
    }
    offset = nextNal.nextOffset
  }

  if (sawH265) {
    return { codec: 'h265', isKeyframe: h265Keyframe }
  }

  if (sawH264) {
    return { codec: 'h264', isKeyframe: h264Keyframe }
  }

  return null
}

function detectUdpFrameType(data: UdpFramePayload): UdpActualFrameType {
  const bytes = framePayloadToUint8Array(data)

  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    return 'jpeg'
  }

  return analyzeAnnexBFrame(bytes)?.codec ?? 'unknown'
}

function warnDroppedCompressedUdpFrame(frameType: UdpActualFrameType): void {
  const now = performance.now()
  if (now - lastCompressedFrameDropLogAt < 1000) {
    return
  }

  lastCompressedFrameDropLogAt = now
  console.warn(`[UDP] 前端压缩视频解码已移除，丢弃 ${frameType.toUpperCase()} 帧；请使用后端 MJPEG 输出。`)
}

function toFiniteNumber(value: unknown, fallback = 0): number {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : fallback
}

function pickPositiveNumber(value: unknown, fallback = 0): number {
  const numberValue = toFiniteNumber(value, 0)
  return numberValue > 0 ? numberValue : fallback
}

function resetUdpStatsForNewStream(timestamp = Date.now()): void {
  udpStats.value = {
    receivedFrames: 0,
    fps: 0,
    bitrate: 0,
    lastFrameTime: timestamp,
    totalBytes: 0,
    droppedFrames: 0,
    droppedOldFrames: 0,
    errors: 0,
    decodeQueueDepth: 0,
    decoderWaitingKeyframe: false,
    decoderBackend: 'unknown',
    decodedWidth: 0,
    decodedHeight: 0,
    outputWidth: 0,
    outputHeight: 0
  }
  videoSize.value = { width: 0, height: 0 }
  udpFrameCountForFps = 0
  udpBytesReceived = 0
  udpFpsStartTime = performance.now()
  lastUdpStatsSampleAt = 0
  lastUdpStatsSampleBytes = 0
  lastUdpStatsSampleFrames = 0
}

function updateUdpOutputDimensions(width: number, height: number): void {
  const normalizedWidth = Math.round(width)
  const normalizedHeight = Math.round(height)
  if (normalizedWidth <= 0 || normalizedHeight <= 0) {
    return
  }

  videoSize.value = { width: normalizedWidth, height: normalizedHeight }
  udpStats.value = {
    ...udpStats.value,
    outputWidth: normalizedWidth,
    outputHeight: normalizedHeight,
    decoderBackend:
      udpStats.value.decoderBackend && udpStats.value.decoderBackend !== 'unknown'
        ? udpStats.value.decoderBackend
        : 'backend-mjpeg'
  }
}

function resolveUdpDecoderBackend(nextBackend: unknown, previousBackend: string | undefined, hasOutput: boolean): string {
  const backend = typeof nextBackend === 'string' ? nextBackend.trim() : ''
  if (backend && backend !== 'unknown') {
    return backend
  }
  if (previousBackend && previousBackend !== 'unknown') {
    return previousBackend
  }
  return hasOutput ? 'backend-mjpeg' : 'unknown'
}

function applyUdpStatsPayload(payload: UdpStatsEventPayload | null | undefined): void {
  const backendStats = payload?.stats ?? {}
  const previous = udpStats.value
  const now = performance.now()
  const receivedFrames = Math.max(
    toFiniteNumber(backendStats.receivedFrames, previous.receivedFrames),
    previous.receivedFrames
  )
  const totalBytes = Math.max(
    toFiniteNumber(backendStats.totalBytes, previous.totalBytes ?? 0),
    previous.totalBytes ?? 0
  )
  const outputWidth = pickPositiveNumber(backendStats.outputWidth, previous.outputWidth ?? 0)
  const outputHeight = pickPositiveNumber(backendStats.outputHeight, previous.outputHeight ?? 0)
  const decodedWidth = pickPositiveNumber(backendStats.decodedWidth, previous.decodedWidth ?? 0)
  const decodedHeight = pickPositiveNumber(backendStats.decodedHeight, previous.decodedHeight ?? 0)
  const lastFrameTime = pickPositiveNumber(backendStats.lastFrameTime, previous.lastFrameTime)
  const hasOutput = outputWidth > 0 && outputHeight > 0
  const nextStats: UdpStats = {
    ...previous,
    receivedFrames,
    fps: previous.fps,
    bitrate: previous.bitrate,
    lastFrameTime,
    totalBytes,
    droppedFrames: toFiniteNumber(backendStats.droppedFrames, previous.droppedFrames ?? 0),
    droppedOldFrames: toFiniteNumber(backendStats.droppedOldFrames, previous.droppedOldFrames ?? 0),
    errors: toFiniteNumber(backendStats.errors, previous.errors ?? 0),
    decodeQueueDepth: toFiniteNumber(backendStats.decodeQueueDepth, previous.decodeQueueDepth ?? 0),
    decoderWaitingKeyframe: Boolean(backendStats.decoderWaitingKeyframe ?? previous.decoderWaitingKeyframe ?? false),
    decoderBackend: resolveUdpDecoderBackend(backendStats.decoderBackend, previous.decoderBackend, hasOutput),
    decodedWidth,
    decodedHeight,
    outputWidth,
    outputHeight
  }

  const eventFps = Number(payload?.fps)
  if (Number.isFinite(eventFps)) {
    nextStats.fps = Math.max(0, Math.round(eventFps))
  }

  const eventBytesPerSecond = Number(payload?.bytesPerSecond)
  if (Number.isFinite(eventBytesPerSecond)) {
    nextStats.bitrate = Math.max(0, Math.round(eventBytesPerSecond * 8))
  } else if (lastUdpStatsSampleAt > 0) {
    const elapsedSeconds = (now - lastUdpStatsSampleAt) / 1000
    if (elapsedSeconds > 0.25) {
      nextStats.fps = Math.max(0, Math.round((receivedFrames - lastUdpStatsSampleFrames) / elapsedSeconds))
      nextStats.bitrate = Math.max(0, Math.round(((totalBytes - lastUdpStatsSampleBytes) * 8) / elapsedSeconds))
    }
  }

  lastUdpStatsSampleAt = now
  lastUdpStatsSampleBytes = totalBytes
  lastUdpStatsSampleFrames = receivedFrames
  udpStats.value = nextStats

  if (hasOutput) {
    videoSize.value = { width: outputWidth, height: outputHeight }
  }
}

async function pollUdpBackendStatus(): Promise<void> {
  if (udpStreamStatus.value !== 'connected' || !window.api?.udpStream?.getStatus) {
    return
  }

  try {
    const status = await window.api.udpStream.getStatus()
    if (status?.stats) {
      applyUdpStatsPayload({ stats: status.stats })
    }
  } catch (error) {
    console.warn('[UDP] 查询后端统计失败:', error)
  }
}

function startUdpStatsPoller(): void {
  if (udpStatsPollTimer) {
    clearInterval(udpStatsPollTimer)
  }
  udpStatsPollTimer = window.setInterval(() => {
    void pollUdpBackendStatus()
  }, 1000)
  void pollUdpBackendStatus()
}

function stopUdpStatsPoller(): void {
  if (udpStatsPollTimer) {
    clearInterval(udpStatsPollTimer)
    udpStatsPollTimer = null
  }
}

function formatUdpDecoderBackendLabel(backend: string | undefined): string {
  switch (backend) {
    case 'internal-ffmpeg':
      return '内置 FFmpeg'
    case 'gpu-ffmpeg':
      return 'GPU FFmpeg'
    case 'cpu-libde265':
      return 'CPU libde265'
    case 'mjpeg-passthrough':
    case 'backend-mjpeg':
      return '后端 MJPEG'
    default:
      return '等待首帧'
  }
}

const udpDecoderBackendLabel = computed(() => formatUdpDecoderBackendLabel(udpStats.value.decoderBackend))
const udpOutputResolutionLabel = computed(() => {
  const width = udpStats.value.outputWidth ?? 0
  const height = udpStats.value.outputHeight ?? 0
  return width > 0 && height > 0 ? `${width}x${height}` : '等待分辨率'
})

/**
 * 处理接收到的帧数据（直接从 IPC 调用）
 * 架构: UDP → 主进程后端解码/MJPEG → 渲染器 <img>/Image → Canvas
 */
function processReceivedFrame(
  data: UdpFramePayload,
  frameInfo: UdpFrameInfoLike
): Promise<void> | void {
  const frameTypeFromHeader = normalizeUdpFrameType(frameInfo.type)
  let actualFrameType: UdpActualFrameType = frameTypeFromHeader ?? 'unknown'

  if (!frameTypeFromHeader) {
    const bytes = framePayloadToUint8Array(data)
    if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) {
      actualFrameType = 'jpeg'
    } else {
      const detectedFrame = analyzeAnnexBFrame(bytes)
      actualFrameType = detectedFrame?.codec ?? normalizeUdpFrameType(frameInfo.type) ?? 'unknown'
    }
  }

  const codecType = activeUdpCodec ?? udpConfig.value.codec

  if (UDP_FRAME_LOG_ENABLED) {
    console.log(
    `[UDP] 处理帧: 实际=${actualFrameType}, 使用=${codecType}, 大小=${data.byteLength}, 关键帧=${frameInfo.isKeyframe}`
    )
  }

  if (actualFrameType === 'jpeg') {
    return decodeMjpegFrame(data)
  }

  if (actualFrameType === 'h264' || actualFrameType === 'h265') {
    warnDroppedCompressedUdpFrame(actualFrameType)
    return
  }

  // 未知类型按 MJPEG/JPEG 兜底尝试，避免后端旧协议缺少类型头时黑屏。
  return decodeMjpegFrame(data)
}

/**
 * 启动 UDP 视频流接收
 * 架构: UDP → 后端解码/MJPEG HTTP 流 → <img> / Canvas
 */
async function startUdpStream(): Promise<void> {
  if (!window.api?.udpStream) {
    console.error('[UDP] UDP API 不可用')
    videoStatus.value = 'UDP 功能不可用'
    return
  }

  if (!udpCanvasEl.value || !videoEl.value) {
    console.error('[UDP] Canvas 或 Video 元素未找到')
    videoStatus.value = 'UI 元素未就绪'
    return
  }

  try {
    if (udpCleanupHandler || udpStatsCleanupHandler || udpFpsTimer || udpMediaStream || udpBackendMjpegActive.value) {
      await stopUdpStream()
    }

    if (localStream) {
      localStream.getTracks().forEach((track) => track.stop())
      localStream = null
    }

    latestUdpRenderFrame = null
    udpRenderPumpRunning = false
    udpRenderPumpScheduled = false
    udpBackendMjpegActive.value = false
    udpMjpegStreamUrl.value = ''
    resetUdpStatsForNewStream()

    udpStreamStatus.value = 'connecting'
    const requestedUdpCodec = udpConfig.value.codec as UdpCodecPreference
    console.log(`[UDP] Requested codec mode: ${requestedUdpCodec}`)
    const effectiveUdpCodec = await resolveUdpCodecPreference(
      requestedUdpCodec
    )
    activeUdpCodec = effectiveUdpCodec as ActiveUdpCodec
    videoStatus.value = '正在初始化视频流...'

    // 1. 初始化 Canvas 上下文
    // 根据实际运行的解码器方案选择 Canvas 上下文类型：
    //   - mjpeg: 后端输出本机 MJPEG HTTP 流，前端不再逐帧处理大 payload。
    //   - 其他旧协议 JPEG IPC: 懒创建 2D Canvas 兜底显示。
    if (effectiveUdpCodec === 'mjpeg') {
      udpCanvasCtx = null
      console.log('[UDP] Backend MJPEG stream renderer selected')
    } else {
      udpCanvasCtx = udpCanvasEl.value.getContext('2d', {
        alpha: false,
        desynchronized: true // 降低延迟
      })
      if (!udpCanvasCtx) {
        throw new Error('无法创建 Canvas 2D 上下文')
      }
    }

    // 2. MJPEG fallback 由 <img> 直接消费后端流，不再逐帧创建 Image/Blob。
    pendingUdpImage = null

    videoStatus.value = '正在启动 UDP 接收...'

    // 3. 启动 UDP 服务器
    if (!window.api.udpStream.onFrame) {
      throw new Error('UDP frame listener is unavailable')
    }

    udpCleanupHandler = await window.api.udpStream.onFrame(
      (frameData: { data: UdpFramePayload; info: UdpFrameInfoLike }) => {
        udpStats.value.receivedFrames++
        udpStats.value.lastFrameTime = Date.now()
        udpFrameCountForFps++
        udpBytesReceived += frameData.data.byteLength

        if (shouldRenderViaLatestFrameQueue(frameData)) {
          enqueueUdpRenderFrame(frameData)
        } else {
          void processReceivedFrame(frameData.data, frameData.info)
        }
      }
    )

    if (effectiveUdpCodec === 'mjpeg' && window.api.udpStream.onStats) {
      udpStatsCleanupHandler = window.api.udpStream.onStats((payload: any) => {
        applyUdpStatsPayload(payload)
      })
    }

    const result = await window.api.udpStream.start({
      host: udpConfig.value.host,
      sourceHost: udpConfig.value.sourceHost,
      port: udpConfig.value.port,
      bufferSize: udpConfig.value.bufferSize,
      codec: effectiveUdpCodec,
      requestedCodec: requestedUdpCodec,
      codecDecisionReason: lastUdpCodecDecisionReason
    })

    const udpStartSuccess = typeof result === 'boolean' ? result : Boolean(result?.success)
    const udpStartError =
      result && typeof result === 'object' && 'error' in result ? result.error : undefined

    if (udpStartSuccess) {
      udpStreamStatus.value = 'connected'
      const codecLabel = formatUdpCodecModeLabel(requestedUdpCodec, effectiveUdpCodec)
      const mjpegStreamUrl =
        result && typeof result === 'object' && 'mjpegStreamUrl' in result
          ? String((result as any).mjpegStreamUrl || '')
          : ''
      if (effectiveUdpCodec === 'mjpeg') {
        if (!mjpegStreamUrl) {
          throw new Error('Backend MJPEG stream URL missing')
        }
        udpMjpegStreamUrl.value = `${mjpegStreamUrl}${mjpegStreamUrl.includes('?') ? '&' : '?'}t=${Date.now()}`
        udpBackendMjpegActive.value = true
        udpDirectCanvasActive.value = false
      }
      cameraStatus.value = `UDP [${codecLabel}] (${udpConfig.value.port})`
      videoStatus.value = '等待首帧...'
      wasConnected.value = true
      if (effectiveUdpCodec === 'mjpeg') {
        startUdpStatsPoller()
      }
      console.log(
        `[UDP] Negotiated codec mode: requested=${requestedUdpCodec}, effective=${effectiveUdpCodec}, renderer=backend-mjpeg`
      )

      // 启动 FPS 计算定时器
      if (effectiveUdpCodec !== 'mjpeg') {
        udpFpsTimer = window.setInterval(() => {
          const now = performance.now()
          const elapsed = (now - udpFpsStartTime) / 1000
          if (elapsed > 0) {
            udpStats.value.fps = Math.round(udpFrameCountForFps / elapsed)
            udpStats.value.bitrate = Math.round((udpBytesReceived * 8) / elapsed)
          }
          udpFrameCountForFps = 0
          udpBytesReceived = 0
          udpFpsStartTime = now
        }, 1000)
      }

      console.log(`[UDP] Video pipeline started (${codecLabel})`)
    } else {
      await stopUdpStream()
      udpStreamStatus.value = 'error'
      videoStatus.value = `UDP 启动失败: ${udpStartError || '未知错误'}`
      console.error('[UDP] 启动失败:', udpStartError || result)
    }
  } catch (error) {
    await stopUdpStream()
    udpStreamStatus.value = 'error'
    videoStatus.value = `UDP 错误: ${error instanceof Error ? error.message : '未知错误'}`
    console.error('[UDP] 启动异常:', error)
  }
}

/**
 * 停止 UDP 视频流接收
 */
async function stopUdpStream(): Promise<void> {
  stopUdpStatsPoller()

  if (udpFpsTimer) {
    clearInterval(udpFpsTimer)
    udpFpsTimer = null
  }

  if (window.api?.udpStream) {
    try {
      await window.api.udpStream.stop()
    } catch (error) {
      console.error('[UDP] 停止失败:', error)
    }
  }

  if (udpCleanupHandler) {
    udpCleanupHandler()
    udpCleanupHandler = null
  }

  if (udpStatsCleanupHandler) {
    udpStatsCleanupHandler()
    udpStatsCleanupHandler = null
  }

  // 释放 MediaStream 资源
  if (udpMediaStream) {
    udpMediaStream.getTracks().forEach((track) => track.stop())
    udpMediaStream = null
  }

  // 清理 Canvas 上下文和 Image 对象
  udpCanvasCtx = null
  pendingUdpImage = null
  latestUdpRenderFrame = null
  udpRenderPumpRunning = false
  udpRenderPumpScheduled = false

  // 清除 video 的 srcObject
  if (videoEl.value) {
    videoEl.value.srcObject = null
  }

  udpStreamStatus.value = 'disconnected'
  activeUdpCodec = null
  udpDirectCanvasActive.value = false
  udpBackendMjpegActive.value = false
  udpMjpegStreamUrl.value = ''
  cameraStatus.value = '未连接'
  console.log('[UDP] 视频流接收已停止')
}

/**
 * 连接 MQTT 服务器
 */
async function connectMqtt(options: { auto?: boolean; reason?: string } = {}): Promise<void> {
  if (!window.api?.mqtt) {
    console.error('[MQTT] API 不可用')
    return
  }

  if (options.auto && mqttNeedsManualReconnect.value) {
    console.log('[MQTT] Auto connect skipped: endpoint changed and needs manual reconnect')
    return
  }

  if (mqttStatus.value === 'connecting') {
    return
  }

  try {
    mqttStatus.value = 'connecting'

    // 如果使用本地 Broker，自动使用本地地址
    const brokerUrl = useLocalBroker.value
      ? `mqtt://127.0.0.1:${localBrokerPort.value}`
      : mqttConfig.value.brokerUrl

    const clientId = getMqttClientIdForConnection()
    if (!clientId) {
      mqttStatus.value = 'error'
      console.error('[MQTT] 未选择车辆，无法设置 Client ID')
      return
    }

    console.log('[MQTT] 正在连接:', brokerUrl, `clientId=${clientId}`)

    // 解析 brokerUrl 为 host + port
    const urlMatch = brokerUrl.match(/^mqtts?:\/\/([^:\/]+)(?::(\d+))?/)
    const host = urlMatch ? urlMatch[1] : '127.0.0.1'
    const port = urlMatch && urlMatch[2] ? parseInt(urlMatch[2]) : 1883

    // 将 Reactive Proxy 对象转换为纯对象（避免序列化错误）
    const result = await window.api.mqtt.connect({
      host,
      port,
      clientId,
      username: mqttConfig.value.username || undefined,
      password: mqttConfig.value.password || undefined,
      topics: mqttConfig.value.topics || [],
    })

    const success = typeof result === 'boolean' ? result : Boolean(result?.success ?? result)
    if (!success) {
      mqttStatus.value = 'error'
      mqttConnectedClientId = null
      console.error('[MQTT] 连接失败')
      return
    }

    const status = await window.api.mqtt.getStatus()
    mqttStatus.value = status.status as 'disconnected' | 'connecting' | 'connected' | 'error'
    mqttDataStore.setConnectionStatus(status.connected)
    if (status.connected) {
      mqttConnectedClientId = clientId
      mqttNeedsManualReconnect.value = false
    } else {
      mqttConnectedClientId = null
    }
    console.log('[MQTT] 连接请求已确认:', status.status)
  } catch (error) {
    mqttStatus.value = 'error'
    mqttConnectedClientId = null
    mqttDataStore.setConnectionStatus(false)
    console.error('[MQTT] 连接错误:', error)
  }
}

/**
 * 断开 MQTT 连接
 */
async function disconnectMqtt(): Promise<void> {
  if (!window.api?.mqtt) {
    return
  }

  try {
    clearMqttClientIdReconnectTimer()
    await window.api.mqtt.disconnect()
    mqttStatus.value = 'disconnected'
    mqttConnectedClientId = null
    mqttDataStore.setConnectionStatus(false)
    console.log('[MQTT] 已断开连接')
  } catch (error) {
    console.error('[MQTT] 断开失败:', error)
  }
}

function forceUnsupportedUdpCodecToMjpeg(reason: 'init' | 'select'): void {
  if (udpConfig.value.codec !== 'h264') {
    return
  }

  udpConfig.value = {
    ...udpConfig.value,
    codec: 'mjpeg'
  }

  if (reason === 'select' && !hasWarnedUnsupportedH264Selection) {
    hasWarnedUnsupportedH264Selection = true
    console.warn('[UDP] H.264 前端解码已移除，已自动切回 MJPEG。')
  }
}

function formatUdpCodecModeLabel(
  requestedCodec: UdpCodecPreference,
  effectiveCodec: UdpCodecPreference
): string {
  if (requestedCodec === 'auto') {
    return 'Auto -> Backend MJPEG'
  }

  if (requestedCodec === 'h265' && effectiveCodec === 'mjpeg') {
    return 'H.265 -> Backend MJPEG'
  }

  if (requestedCodec === 'h264' && effectiveCodec === 'mjpeg') {
    return 'H.264 disabled -> Backend MJPEG'
  }

  return effectiveCodec === 'mjpeg' ? 'Backend MJPEG' : effectiveCodec.toUpperCase()
}

async function getDecodeCapabilities(): Promise<DecodeCapabilities | null> {
  if (!decodeCapabilitiesPromise) {
    decodeCapabilitiesPromise = (async () => {
      try {
        const api = window.api?.udpStream
        if (!api?.getDecodeCapabilities) {
          return null
        }
        return (await api.getDecodeCapabilities()) as DecodeCapabilities
      } catch (error) {
        console.warn('[UDP] Decode capability query failed:', error)
        return null
      }
    })()
  }

  return decodeCapabilitiesPromise
}

async function hasBackendH265Decode(): Promise<boolean> {
  const capabilities = await getDecodeCapabilities()
  return Boolean(
    capabilities?.internalFfmpegAvailable ||
      capabilities?.backendFfmpegAvailable ||
      capabilities?.gpuDecodeAvailable
  )
}

async function resolveUdpCodecPreference(requestedCodec: UdpCodecPreference): Promise<UdpCodecPreference> {
  if (requestedCodec === 'h264') {
    lastUdpCodecDecisionReason = 'H.264 frontend decode removed; forcing backend MJPEG mode'
    console.warn(`[UDP] ${lastUdpCodecDecisionReason}`)
    return 'mjpeg'
  }

  if (requestedCodec === 'h265') {
    const backendReady = await hasBackendH265Decode()
    lastUdpCodecDecisionReason = backendReady
      ? 'H.265 uses backend decoder and MJPEG renderer'
      : 'H.265 requested but backend decoder availability is unknown; using MJPEG renderer'
    console.log(`[UDP] ${lastUdpCodecDecisionReason}`)
    return 'mjpeg'
  }

  if (requestedCodec === 'auto') {
    const backendReady = await hasBackendH265Decode()
    lastUdpCodecDecisionReason = backendReady
      ? 'auto uses backend MJPEG renderer; backend H.265 decoder available'
      : 'auto uses backend MJPEG renderer'
    console.log(`[UDP] ${lastUdpCodecDecisionReason}`)
    return 'mjpeg'
  }

  lastUdpCodecDecisionReason = `manual codec selection: ${requestedCodec}`
  return 'mjpeg'
}

function ensureUdp2dContext(): CanvasRenderingContext2D | null {
  if (!udpCanvasEl.value) return null
  if (udpCanvasCtx) return udpCanvasCtx
  udpCanvasCtx = udpCanvasEl.value.getContext('2d', {
    alpha: false,
    desynchronized: true
  })
  return udpCanvasCtx
}

function ensureUdpCanvasSize(width: number, height: number): void {
  if (!udpCanvasEl.value) return

  const canvas = udpCanvasEl.value

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width
    canvas.height = height
    videoSize.value = { width, height }
    console.log('[MJPEG] canvas 尺寸更新:', width, 'x', height)
  }

  if (!udpDirectCanvasActive.value) {
    udpDirectCanvasActive.value = true
    if (videoEl.value?.srcObject) {
      videoEl.value.srcObject = null
    }
    videoStatus.value = ''
  }
}

function drawMjpegSource(source: CanvasImageSource, width: number, height: number): void {
  const ctx = ensureUdp2dContext()
  if (!udpCanvasEl.value || !ctx) return

  ensureUdpCanvasSize(width, height)
  ctx.drawImage(source, 0, 0, width, height)
}

function handleMjpegStreamLoad(event: Event): void {
  const img = event.target as HTMLImageElement | null
  if (img?.naturalWidth && img?.naturalHeight) {
    updateUdpOutputDimensions(img.naturalWidth, img.naturalHeight)
  }
  videoStatus.value = ''
}

async function renderMjpegFrameAsync(frameData: UdpFramePayload): Promise<void> {
  if (!udpCanvasEl.value || !videoEl.value) return

  const blob = new Blob([frameData], { type: 'image/jpeg' })

  if ('createImageBitmap' in window) {
    try {
      const bitmap = await createImageBitmap(blob)
      try {
        drawMjpegSource(bitmap, bitmap.width, bitmap.height)
      } finally {
        bitmap.close()
      }
      return
    } catch (error) {
      console.warn('[MJPEG] createImageBitmap failed, falling back to Image:', error)
    }
  }

  if (!pendingUdpImage) return

  const img = pendingUdpImage
  const url = URL.createObjectURL(blob)

  await new Promise<void>((resolve) => {
    img.onload = () => {
      drawMjpegSource(img, img.width, img.height)
      URL.revokeObjectURL(url)
      resolve()
    }

    img.onerror = () => {
      URL.revokeObjectURL(url)
      console.warn('[MJPEG] Invalid frame data')
      resolve()
    }

    img.src = url
  })
}

async function decodeMjpegFrame(frameData: UdpFramePayload): Promise<void> {
  await renderMjpegFrameAsync(frameData)

  /*

  img.onload = () => {
    if (canvas.width !== img.width || canvas.height !== img.height) {
      canvas.width = img.width
      canvas.height = img.height
      videoSize.value = { width: img.width, height: img.height }

      if (!udpMediaStream) {
        udpMediaStream = canvas.captureStream(0)
        video.srcObject = udpMediaStream
        video.src = ''
        video.poster = ''
        video.play().catch((e) => console.warn('[UDP] video.play() 失败:', e))
        videoStatus.value = ''
        console.log('[MJPEG] MediaStream 已创建，尺寸:', img.width, 'x', img.height)
      }
    }

    ctx.drawImage(img, 0, 0)

    const track = udpMediaStream?.getVideoTracks()[0] as MediaStreamTrack & {
      requestFrame?: () => void
    }
    if (track?.requestFrame) {
      track.requestFrame()
    }

    URL.revokeObjectURL(url)
  }

  img.onerror = () => {
    URL.revokeObjectURL(url)
    console.warn('[MJPEG] 无效的帧数据')
  }

  img.src = url
  */
}

// ==================== 结束 UDP 图传相关 ====================

/**
 * 启动视频文件播放
 */
async function startVideoFile(): Promise<void> {
  if (!videoEl.value) {
    throw new Error('Video 元素未找到')
  }

  // 清理旧的视频流
  if (localStream) {
    localStream.getTracks().forEach((t) => t.stop())
    localStream = null
  }

  console.log('[Dashboard] 加载视频文件:', videoFilePath.value)
  videoStatus.value = '加载视频文件...'

  try {
    // 通过 IPC 安全读取文件
    const arrayBuffer = await window.api.readVideoFile(videoFilePath.value)
    const blob = new Blob([arrayBuffer], { type: 'video/mp4' })
    const blobUrl = URL.createObjectURL(blob)

    console.log(
      '[Dashboard] Blob URL 已创建，大小:',
      (arrayBuffer.byteLength / 1024 / 1024).toFixed(2),
      'MB'
    )

    const video = videoEl.value
    video.srcObject = null
    video.src = blobUrl
    video.loop = true

    await video.play()

    videoStatus.value = ''
    cameraStatus.value = '视频文件播放中'
    wasConnected.value = true

    console.log('[Dashboard] 视频文件播放成功')
  } catch (error) {
    console.error('[Dashboard] 加载视频失败:', error)
    videoStatus.value = `加载失败: ${error instanceof Error ? error.message : '未知错误'}`
    cameraStatus.value = '错误'
    throw error
  }
}

/**
 * 连接视频源（摄像头、文件或UDP）
 */
async function connect(): Promise<void> {
  if (isConnecting.value) {
    console.log('[Dashboard] 连接中，跳过重复请求')
    return
  }

  isConnecting.value = true

  // 使用微任务让 UI 立即响应
  queueMicrotask(async () => {
    try {
      if (videoSource.value === 'file') {
        await startVideoFile()
        return
      }

      if (videoSource.value === 'udp') {
        await startUdpStream()
        return
      }

      // 摄像头模式：使用 WebRTC
      await connectCamera()
    } catch (error) {
      console.error('[Dashboard] 连接失败:', error)
      videoStatus.value = `错误: ${error instanceof Error ? error.message : '未知错误'}`
      cameraStatus.value = '错误'
      cleanup()
    } finally {
      isConnecting.value = false
    }
  })

  // 子组件 video-connected 事件回调：更新父级状态
}

// Helper that wraps connect and closes settings modal
function handleConnectAndClose(): void {
  connect()
  isSettingsVisible.value = false
}

/**
 * 连接摄像头（直连模式）
 * 直接将 MediaStream 播放到 video 元素，无 WebRTC 本地回环开销
 */
async function connectCamera(): Promise<void> {
  cleanup()
  videoStatus.value = '请授权摄像头访问...'

  // 等待下一帧渲染，确保 UI 更新
  await new Promise((resolve) => requestAnimationFrame(resolve))

  console.log('[Dashboard] 请求摄像头权限...')
  localStream = await getMediaStream()
  console.log('[Dashboard] 摄像头流获取成功, tracks:', localStream.getTracks().length)

  // 直接将摄像头流播放到 video 元素（不使用 WebRTC 本地回环）
  if (videoEl.value) {
    videoEl.value.srcObject = localStream
    videoStatus.value = ''
    cameraStatus.value = '摄像头 (直连)'
    wasConnected.value = true
    console.log('[Dashboard] 摄像头直连成功')

    // 性能优化：视频连接后可选启动模拟（如果用户启用）
    if (enableSimulation.value) {
      startHeatSimulation()
      // 状态模拟由 RobotStateManager 组件内部管理
    }

    // 如果启用了 WebRTC 分发，则启动分发（仅用于远程客户端）
    if (webrtcDistributeEnabled.value && webrtcSignalingStatus.value !== 'running') {
      await startWebRTCDistribution()
    }
  }
}

// ==================== WebRTC 网络分发 ====================
/**
 * 启动 WebRTC 网络分发
 * 创建信令服务器，允许其他设备连接观看视频流
 */
async function startWebRTCDistribution(): Promise<void> {
  try {
    webrtcSignalingStatus.value = 'starting'

    // 通过 IPC 启动信令服务器
    const result = await window.api?.startSignalingServer?.()
    if (result?.success) {
      webrtcSignalingStatus.value = 'running'
      webrtcSignalingAddress.value = result.address || ''
      console.log('[WebRTC分发] 信令服务器已启动:', webrtcSignalingAddress.value)
    } else {
      webrtcSignalingStatus.value = 'error'
      console.error('[WebRTC分发] 启动失败:', result?.error)
    }
  } catch (error) {
    webrtcSignalingStatus.value = 'error'
    console.error('[WebRTC分发] 启动异常:', error)
  }
}

/**
 * 停止 WebRTC 网络分发
 */
async function stopWebRTCDistribution(): Promise<void> {
  // 关闭所有对等连接
  rtcPeerConnections.forEach((pc, clientId) => {
    console.log('[WebRTC分发] 关闭客户端连接:', clientId)
    pc.close()
  })
  rtcPeerConnections.clear()
  webrtcConnectedClients.value = 0

  // 停止信令服务器
  if (webrtcSignalingStatus.value === 'running') {
    try {
      await window.api?.stopSignalingServer?.()
    } catch (e) {
      console.warn('[WebRTC分发] 停止信令服务器失败:', e)
    }
  }

  webrtcSignalingStatus.value = 'stopped'
  webrtcSignalingAddress.value = ''
  console.log('[WebRTC分发] 已停止')
}

/**
 * 切换 WebRTC 分发开关
 */
async function toggleWebRTCDistribution(): Promise<void> {
  if (webrtcDistributeEnabled.value) {
    // 启用时立即启动信令服务器
    await startWebRTCDistribution()
  } else {
    await stopWebRTCDistribution()
  }
}

/**
 * 复制信令服务器地址到剪贴板
 */
async function copySignalingAddress(): Promise<void> {
  if (!webrtcSignalingAddress.value) return

  try {
    await navigator.clipboard.writeText(webrtcSignalingAddress.value)
    console.log('[WebRTC分发] 地址已复制:', webrtcSignalingAddress.value)
  } catch (error) {
    console.error('[WebRTC分发] 复制失败:', error)
  }
}

// ==================== 键盘事件 ====================
/**
 * 处理全局快捷键
 */
function handleKeyDown(event: KeyboardEvent): void {
  // 如果正在输入或模态框打开，忽略快捷键
  if (
    renameModal.visible ||
    event.target instanceof HTMLInputElement ||
    event.target instanceof HTMLTextAreaElement
  ) {
    return
  }

  handleGlobalHotkey(event)
}

/**
 * 处理弹丸购买
 */
function runGlobalHotkeyAction(action: GlobalHotkeyAction, event?: KeyboardEvent): void {
  switch (action) {
    case 'toggleSettings':
      isSettingsVisible.value = !isSettingsVisible.value
      break
    case 'exitHudEdit':
      if (isHudInteractive.value) {
        isHudInteractive.value = false
      } else {
        return
      }
      break
    case 'toggleDetection':
      toggleDetection()
      break
    case 'crosshairSettings':
      isCrosshairSettingsVisible.value = !isCrosshairSettingsVisible.value
      break
    case 'ammoPurchase':
      isAmmoPurchaseVisible.value = !isAmmoPurchaseVisible.value
      break
    case 'remoteAmmoPurchase':
      isRemoteAmmoPurchaseVisible.value = !isRemoteAmmoPurchaseVisible.value
      break
    case 'zoomIn':
      handleZoomIn()
      break
    case 'zoomOut':
      handleZoomOut()
      break
    case 'zoomReset':
      if (videoZoom.value > MIN_ZOOM) {
        resetZoom()
      } else {
        return
      }
      break
  }
  event?.preventDefault()
}

function handleGlobalHotkey(event: KeyboardEvent): void {
  const code = event.code
  const keyCode = event.keyCode

  if (code === 'ShowAllWindows' || keyCode === 182) {
    window.api?.isDevToolsOpened?.().then((devToolsOpened) => {
      if (devToolsOpened) {
        window.api?.closeDevTools?.()
      } else {
        window.api?.openDevTools?.()
      }
    })
    event.preventDefault()
    return
  }

  const action = (Object.entries(globalHotkeys.value) as Array<[GlobalHotkeyAction, string]>).find(
    ([, hotkeyCode]) => hotkeyCode === code
  )?.[0]

  if (action) {
    runGlobalHotkeyAction(action, event)
  }
}

function startHotkeyRecording(action: GlobalHotkeyAction): void {
  recordingHotkeyAction.value = action
}

function handleHotkeyRecorderKeydown(event: KeyboardEvent): void {
  if (!recordingHotkeyAction.value) return
  event.preventDefault()
  event.stopPropagation()

  if (event.code === 'Escape') {
    recordingHotkeyAction.value = null
    return
  }

  const action = recordingHotkeyAction.value
  const robotKeyLabel = ROBOT_CONTROL_KEY_LABELS[event.code]

  if (robotKeyLabel) {
    const confirmed = window.confirm(
      `当前按键 ${formatHotkey(event.code)} 是机器人控制按键。\n\n` +
        '设置为全局热键后，在操控模式下按下它会同时触发机器人控制和全局功能。\n\n' +
        '确定仍要使用这个按键吗？'
    )

    if (!confirmed) {
      return
    }
  }

  const previousCode = globalHotkeys.value[action]
  const nextHotkeys = { ...globalHotkeys.value }
  for (const key of Object.keys(nextHotkeys) as GlobalHotkeyAction[]) {
    if (key !== action && nextHotkeys[key] === event.code) {
      nextHotkeys[key] = previousCode
    }
  }
  nextHotkeys[action] = event.code
  globalHotkeys.value = normalizeGlobalHotkeys(nextHotkeys)
  recordingHotkeyAction.value = null
}

function resetGlobalHotkeys(): void {
  globalHotkeys.value = { ...DEFAULT_GLOBAL_HOTKEYS }
  recordingHotkeyAction.value = null
}

function handleAmmoPurchase(amount: number): void {
  // 从可兑换弹量中扣除
  const actualAmount = Math.min(amount, exchangeableAmmo.value)
  exchangeableAmmo.value -= actualAmount
  // 增加到当前弹量
  remainingAmmo.value += actualAmount
  console.log(`[Dashboard] 购买弹丸: ${actualAmount} 发，剩余可兑换: ${exchangeableAmmo.value}`)
}

/**
 * 处理远程弹丸购买
 */
function handleRemoteAmmoPurchase(amount: number): void {
  // TODO: 发送远程弹丸购买请求到服务器
  console.log(`[Dashboard] 远程购买弹丸请求: ${amount} 发`)
}

// ==================== 视频缩放功能 ====================
/**
 * 放大视频
 */
function handleZoomIn(): void {
  if (videoZoom.value < MAX_ZOOM) {
    videoZoom.value = normalizeVideoZoom(videoZoom.value + ZOOM_STEP)
    console.log(`[Dashboard] 视频放大: ${videoZoomText.value}`)
  }
}

/**
 * 缩小视频（不允许低于原始大小）
 */
function handleZoomOut(): void {
  if (videoZoom.value > MIN_ZOOM) {
    videoZoom.value = normalizeVideoZoom(videoZoom.value - ZOOM_STEP)
    console.log(`[Dashboard] 视频缩小: ${videoZoomText.value}`)
  }
}

/**
 * 重置缩放为原始大小
 */
function resetZoom(): void {
  videoZoom.value = MIN_ZOOM
  console.log('[Dashboard] 视频缩放已重置')
}

/**
 * 是否处于放大状态
 */
const isZoomed = computed(() => videoZoom.value > MIN_ZOOM)

watch(
  videoZoom,
  (value) => {
    const normalized = normalizeVideoZoom(value)
    if (normalized !== value) {
      videoZoom.value = normalized
      return
    }
    saveVideoZoom(normalized)
  },
  { immediate: true }
)

watch(
  globalHotkeys,
  (value) => {
    saveGlobalHotkeys(value)
  },
  { deep: true, immediate: true }
)

/**
 * 发布机器人键鼠控制帧
 */
async function publishKeyboardMouseControl(
  frame: KeyboardMouseControlFrame,
  options: RoboControlPublishOptions = {}
): Promise<void> {
  if (!window.api?.mqtt?.publish) return

  if (mqttStatus.value !== 'connected') {
    const now = Date.now()
    if (isMouseCaptured.value && now - lastRoboControlPublishWarningAt > 3000) {
      lastRoboControlPublishWarningAt = now
      console.warn('[RoboControl] MQTT 未连接，键鼠控制帧未发送')
    }
    return
  }

  if (roboControlPublishInFlight >= ROBO_CONTROL_MAX_IN_FLIGHT) {
    queuedRoboControlFrame = options.force
      ? frame
      : queuedRoboControlFrame
        ? mergeKeyboardMouseControlFrames(queuedRoboControlFrame, frame)
        : frame
    recordRoboControlDebug(frame, false, true)
    return
  }

  roboControlPublishInFlight += 1
  try {
    const result = await window.api.mqtt.publish({
      topic: ROBO_CONTROL_TOPIC,
      messageType: ROBO_CONTROL_MESSAGE_TYPE,
      payload: frame,
      qos: ROBO_CONTROL_QOS
    })

    if (result?.success === false) {
      const now = Date.now()
      if (now - lastRoboControlPublishErrorAt > 1000) {
        lastRoboControlPublishErrorAt = now
        console.warn('[RoboControl] 键鼠控制帧发送失败:', result.error || 'unknown error')
      }
    } else {
      recordRoboControlDebug(frame, true)
    }
  } catch (error) {
    const now = Date.now()
    if (now - lastRoboControlPublishErrorAt > 1000) {
      lastRoboControlPublishErrorAt = now
      console.warn('[RoboControl] 键鼠控制帧发送异常:', error)
    }
  } finally {
    roboControlPublishInFlight = Math.max(0, roboControlPublishInFlight - 1)
    if (roboControlPublishInFlight < ROBO_CONTROL_MAX_IN_FLIGHT && queuedRoboControlFrame) {
      const nextFrame = queuedRoboControlFrame
      queuedRoboControlFrame = null
      void publishKeyboardMouseControl(nextFrame)
    }
  }
}

/**
 * 处理机器人操控组件控制帧
 */
function handleRoboControlFrame(frame: KeyboardMouseControlFrame): void {
  void publishKeyboardMouseControl(frame)
}

/**
 * 处理鼠标捕获状态变化
 */
function handleCaptureChange(captured: boolean): void {
  isMouseCaptured.value = captured
  if (!captured) {
    queuedRoboControlFrame = null
    void publishKeyboardMouseControl(ZERO_KEYBOARD_MOUSE_CONTROL_FRAME, { force: true })
  }
  console.log('[Dashboard] 鼠标捕获状态:', captured ? '已捕获' : '已释放')
}

/**
 * 处理机器人特殊操作 (K 键)
 */
function handleRobotAction(action: string, params?: Record<string, unknown>): void {
  console.log('[Dashboard] 机器人操作:', action, params)

  switch (action) {
    case 'hero-deploy':
      // 英雄部署模式切换
      // TODO: 发送部署命令
      break
    case 'engineer-assembly-menu':
      // 工程装配菜单
      // TODO: 处理装配菜单逻辑
      break
    case 'engineer-start-assembly':
      // 工程开始装配
      // TODO: 发送装配命令
      break
    case 'engineer-cancel-assembly':
      // 工程取消装配
      // TODO: 发送取消命令
      break
    case 'infantry-power-rune':
      // 步兵激活能量机关
      // TODO: 发送激活命令
      break
    case 'drone-air-support':
      // 无人机空中支援
      // TODO: 发送空中支援命令
      break
    case 'drone-dart-fire':
      // 无人机发射飞镖
      // TODO: 发送飞镖命令
      break
    default:
      console.warn('[Dashboard] 未知机器人操作:', action)
  }
}

// ==================== Dashboard 界面配置管理 ====================

/**
 * 获取当前 Dashboard 界面配置
 * 优先从 panelRegistry 获取实时位置，若无则使用模板默认值
 */
function getCurrentDashboardConfig(): DashboardLayoutConfig {
  const panelsConfig: DashboardLayoutConfig['panels'] = []

  // 遍历所有 HUD 面板模板
  Object.entries(hudTemplatesStore.templates).forEach(([id, template]) => {
    // 获取当前可见性状态
    const isVisible = panelVisibility[template.title] !== false

    // 尝试从 panelRegistry 获取实时位置
    const panelInfo = panelRegistry.get(template.title)
    let currentPosition = {
      top: template.position.top,
      left: template.position.left,
      right: template.position.right,
      bottom: template.position.bottom
    }
    let currentSize = {
      width: template.size.width,
      height: template.size.height
    }

    if (panelInfo) {
      // 使用面板的实际位置
      const actualPosition = panelInfo.getPosition()
      currentPosition = {
        top: actualPosition.top,
        left: actualPosition.left,
        right: actualPosition.right,
        bottom: actualPosition.bottom
      }
      currentSize = {
        width: actualPosition.width,
        height: actualPosition.height
      }
    }

    panelsConfig.push({
      id,
      title: template.title,
      visible: isVisible,
      position: currentPosition,
      size: currentSize,
      options: {
        hideTitleBar: template.options.hideTitleBar,
        transparent: template.options.transparent,
        opacity: template.options.opacity
      }
    })
  })

  return {
    name: '',
    version: '1.0',
    createdAt: new Date().toISOString(),
    modifiedAt: new Date().toISOString(),
    panels: panelsConfig
  }
}

/**
 * 处理 Dashboard 配置加载
 * 同时更新模板数据和实际面板位置
 */
function handleDashboardConfigLoaded(config: DashboardLayoutConfig): void {
  console.log('[Dashboard] 加载界面配置:', config.name)

  // 应用面板配置
  for (const panelConfig of config.panels) {
    // 更新可见性
    panelVisibility[panelConfig.title] = panelConfig.visible

    // 查找对应的模板
    const template = hudTemplatesStore.templates[panelConfig.id]
    if (template) {
      // 更新模板数据（用于新创建的面板）
      template.position = panelConfig.position
      template.size = panelConfig.size
      template.options.hideTitleBar = panelConfig.options.hideTitleBar
      template.options.transparent = panelConfig.options.transparent
      template.options.opacity = panelConfig.options.opacity
    }

    // 同时更新已渲染的面板实际位置
    const panelInfo = panelRegistry.get(panelConfig.title)
    if (panelInfo) {
      panelInfo.setPosition({
        top: panelConfig.position.top,
        left: panelConfig.position.left,
        right: panelConfig.position.right,
        bottom: panelConfig.position.bottom,
        width: panelConfig.size.width,
        height: panelConfig.size.height
      })
    }
  }

  console.log('[Dashboard] 配置应用完成，已更新', config.panels.length, '个面板')
}

/**
 * 处理 Dashboard 配置变更
 */
function handleDashboardConfigChanged(filename: string): void {
  console.log('[Dashboard] 配置已切换:', filename || '默认配置')
}

/**
 * 重新加载应用
 */
function handleReload(): void {
  // if (window.api?.reload) {
  //   console.log('[Dashboard] 重新加载应用...')
  //   window.api.reload()
  // }
  console.log('[Dashboard] 重新加载功能暂未实现')
}

// ==================== 生命周期 ====================
// ==================== 下拉框选项 ====================
// cameraOptions 已迁移到 VideoSourceManager 组件，父组件无需单独维护。

const robotOptions = computed<Array<{ value: string; label: string }>>(() => {
  return robotTypes.value.map((robot) => ({
    label: robot,
    value: robot
  }))
})

// ==================== 生命周期钩子 ====================
// UDP 错误监听清理函数
watch(
  () => mqttDataStore.currentRobotType,
  (robotName) => {
    if (robotName && selectedRobot.value !== robotName) {
      selectedRobot.value = robotName
      console.log('[Dashboard] Robot selection synced from MQTT server:', robotName)
    }
  }
)

watch(
  effectiveMqttClientId,
  (clientId, previousClientId) => {
    if (!clientId || !previousClientId || clientId === previousClientId) return
    if (mqttStatus.value !== 'connected') return
    if (mqttConnectedClientId === clientId) return

    scheduleMqttClientIdReconnect(clientId)
  }
)

let udpErrorCleanup: (() => void) | null = null
let mqttStatusCleanup: (() => void) | null = null
let mqttMessageCleanup: (() => void) | null = null
let mqttBrokerStatusCleanup: (() => void) | null = null

onMounted(async () => {
  console.log('[Dashboard] 组件已挂载')

  // GPU 编码支持检查由 PerformanceOptimizer 组件自动处理
  // 子组件会在 onMounted 中直接同步状态到 Pinia store

  // 加载 HUD 模板并初始化组件配置
  await hudTemplatesStore.loadTemplates()

  // 等待 DOM 更新后加载各个面板的组件配置
  await nextTick()
  loadPanelWidgets()

  // 外置检测服务默认不随客户端启动，这里只同步现有脚本状态。
  try {
    const pipeStatus = await window.api.pipeServer.getStatus()
    const status = pipeStatus?.running ? 'running' : 'stopped'
    pipeServerStatus.value = status
  } catch {
    pipeServerStatus.value = 'stopped'
  }

  try {

    // 检查 UDP 流状态
    if (window.api?.udpStream) {
      const udpStatus = await window.api.udpStream.getStatus()
      if (udpStatus.running) {
        udpStreamStatus.value = 'connected'
        console.log('[Dashboard] UDP 流服务运行中')
      }
    }
  } catch (error) {
    console.warn('[Dashboard] 获取服务器状态失败:', error)
  }

  // 监听 UDP 错误
  if (window.api?.udpStream?.onError) {
    udpErrorCleanup = window.api.udpStream.onError((error: string) => {
      console.error('[UDP] 错误:', error)
      udpStreamStatus.value = 'error'
      videoStatus.value = `UDP 错误: ${error}`
    })
  }

  // 监听 MQTT 状态变化
  if (window.api?.mqtt?.onStatus) {
    mqttStatusCleanup = window.api.mqtt.onStatus((data: { status: string; connected: boolean }) => {
      console.log('[MQTT] 状态变化:', data.status)
      mqttStatus.value = data.status as 'disconnected' | 'connecting' | 'connected' | 'error'
      if (!data.connected) {
        mqttConnectedClientId = null
      } else if (!mqttConnectedClientId) {
        mqttConnectedClientId = getMqttClientIdForConnection() ?? null
      }
      // 同步到 MQTT Data Store
      mqttDataStore.setConnectionStatus(data.connected)
    })
  }

  // 监听 MQTT 消息
  if (window.api?.mqtt?.onMessage) {
    mqttMessageCleanup = window.api.mqtt.onMessage(
      (data: {
        topic: string
        messageType: string
        data: object | string
        raw: string
        timestamp: number
        parseSuccess?: boolean
      }) => {
        enqueueDashboardMqttMessage(data)
      }
    )
  }

  // 获取 MQTT 初始状态
  if (window.api?.mqtt?.getStatus) {
    try {
      const status = await window.api.mqtt.getStatus()
      mqttStatus.value = status.status as 'disconnected' | 'connecting' | 'connected' | 'error'
      mqttDataStore.setConnectionStatus(status.connected)
      mqttConnectedClientId = status.connected ? getMqttClientIdForConnection() ?? null : null
    } catch (error) {
      console.warn('[Dashboard] 获取 MQTT 状态失败:', error)
    }
  }

  if (window.api?.mqtt?.onLocalBrokerStatus) {
    mqttBrokerStatusCleanup = window.api.mqtt.onLocalBrokerStatus(
      (data: { status: string; port: number }) => {
        console.log('[Local Broker] 状态变化:', data)
        localBrokerStatus.value = data.status as 'stopped' | 'starting' | 'running' | 'error'
        localBrokerPort.value = data.port
      }
    )
  }

  // 获取本地 Broker 初始状态
  if (window.api?.mqtt?.getLocalBrokerStatus) {
    try {
      const brokerState = await window.api.mqtt.getLocalBrokerStatus()
      localBrokerStatus.value = brokerState.status as 'stopped' | 'starting' | 'running' | 'error'
      localBrokerPort.value = brokerState.port
    } catch (error) {
      console.warn('[Dashboard] 获取本地 Broker 状态失败:', error)
    }
  }

  // 注册全局快捷键
  window.addEventListener('keydown', handleKeyDown)

  // 加载摄像头设备列表
  await loadCameraDevices()

  // 加载机器人配置文件
  try {
    if (window.api?.getRobotConfig) {
      robotConfig.value = await window.api.getRobotConfig()
      console.log('[Dashboard] 机器人配置加载成功:', robotConfig.value)
    }
  } catch (error) {
    console.warn('[Dashboard] 无法加载机器人配置:', error)
  }

  // 加载机器人类型列表
  try {
    if (window.api?.getRobotTypes) {
      robotTypes.value = await window.api.getRobotTypes()
      if (robotTypes.value.length > 0) {
        selectedRobot.value = robotTypes.value[0]
        console.log('[Dashboard] 默认选择机器人:', selectedRobot.value)
        // 配置加载由 RobotStateManager 组件通过 watch robotName prop 自动处理
      }
    }
  } catch (error) {
    console.warn('[Dashboard] 无法加载机器人类型:', error)
  }

  if (window.api?.mqtt && !mqttAutoConnectAttempted && mqttStatus.value !== 'connected') {
    mqttAutoConnectAttempted = true
    void connectMqtt({ auto: true })
  }

  // 加载 HUD 模板
  await hudTemplatesStore.loadTemplates()
})

onUnmounted(() => {
  console.log('[Dashboard] 组件卸载中...')

  // 清理 UDP 错误监听
  if (udpErrorCleanup) {
    udpErrorCleanup()
    udpErrorCleanup = null
  }

  // 清理 MQTT 监听
  if (mqttStatusCleanup) {
    mqttStatusCleanup()
    mqttStatusCleanup = null
  }
  if (mqttMessageCleanup) {
    mqttMessageCleanup()
    mqttMessageCleanup = null
  }
  cleanupDashboardMqttQueue()
  clearMqttClientIdReconnectTimer()
  if (mqttBrokerStatusCleanup) {
    mqttBrokerStatusCleanup()
    mqttBrokerStatusCleanup = null
  }

  // 移除事件监听
  window.removeEventListener('keydown', handleKeyDown)

  // 清理资源
  cleanup()
  stopHeatSimulation()
  stopDetection()
})

onActivated(() => {
  console.log('[Dashboard] 组件激活')

  // 重新添加键盘事件监听（确保先移除再添加，避免重复）
  window.removeEventListener('keydown', handleKeyDown)
  window.addEventListener('keydown', handleKeyDown)

  // 自动重连（如果之前已连接）
  if (wasConnected.value) {
    console.log('[Dashboard] 自动重连视频源...')
    connect()
  }

  // 性能优化：不自动启动模拟，由用户或视频连接触发
})

onDeactivated(() => {
  console.log('[Dashboard] 组件失活')

  // 移除键盘事件监听，避免在其他页面触发（如 3D 地图页面）
  window.removeEventListener('keydown', handleKeyDown)

  // 清理资源（保留 wasConnected 状态）
  cleanup()
})

// ==================== HUD 上下文菜单逻辑 ====================
const contextMenu = ref({
  visible: false,
  x: 0,
  y: 0,
  type: 'create',
  target: ''
})

const handleHudContextMenu = (event: MouseEvent): void => {
  if (!isHudInteractive.value) return

  // 阻止默认菜单
  event.preventDefault()

  // 显示自定义菜单
  contextMenu.value = {
    visible: true,
    x: event.clientX,
    y: event.clientY,
    type: 'create',
    target: ''
  }
}

const handlePanelContextMenu = (payload: { event: MouseEvent; title: string }): void => {
  if (!isHudInteractive.value) return

  const { event, title } = payload

  // 显示自定义菜单 (编辑)
  contextMenu.value = {
    visible: true,
    x: event.clientX,
    y: event.clientY,
    type: 'panel',
    target: title
  }
}

const closeContextMenu = (): void => {
  contextMenu.value.visible = false
}

// ==================== HUD 状态管理 ====================
const hudTemplatesStore = useHudTemplatesStore()

// 组件映射表
const componentMap = {
  VehicleAttitude,
  ModuleStatus,
  RobotStateManager,
  PanelWidgetContainer,
  MiniMap,
  ViewportFrame,
  MessageList,
  PitchIndicator,
  WeaponStatus,
  VideoZoomStatus
} as Record<string, Component>

const panelVisibility = reactive<Record<string, boolean>>({})

// 监听模板加载，自动更新 panelVisibility
hudTemplatesStore.$subscribe((_mutation, state) => {
  Object.values(state.templates).forEach((template) => {
    if (panelVisibility[template.title] === undefined) {
      // 使用 defaultVisible 配置，如果未定义则默认显示
      panelVisibility[template.title] = template.options.defaultVisible !== false
    }
  })
})

// ==================== 菜单动作处理 ====================

// 重命名模态框状态
const renameModal = reactive({
  visible: false,
  targetId: '',
  currentTitle: '',
  newTitle: ''
})

const handleRenamePanel = (title: string): void => {
  // Find template by title
  const entry = Object.entries(hudTemplatesStore.templates).find(([_, t]) => t.title === title)
  if (!entry) {
    console.error('Template not found for title:', title)
    return
  }
  const [id] = entry

  renameModal.targetId = id
  renameModal.currentTitle = title
  renameModal.newTitle = title
  renameModal.visible = true
}

const confirmRename = async (): Promise<void> => {
  if (renameModal.newTitle && renameModal.newTitle !== renameModal.currentTitle) {
    if (typeof hudTemplatesStore.renameTemplate !== 'function') {
      console.error('renameTemplate method is missing on store!', hudTemplatesStore)
      alert('功能未就绪，请刷新页面重试')
      return
    }
    await hudTemplatesStore.renameTemplate(renameModal.targetId, renameModal.newTitle)

    // Update panelVisibility key to prevent ghost entries
    const oldTitle = renameModal.currentTitle
    const newTitle = renameModal.newTitle
    if (panelVisibility[oldTitle] !== undefined) {
      const isVisible = panelVisibility[oldTitle]
      delete panelVisibility[oldTitle]
      panelVisibility[newTitle] = isVisible
    }
  }
  renameModal.visible = false
}

const handleCreateWidget = (payload: { panelName: string; styleId: string } | string): void => {
  // 兼容旧版接口（只有styleId）和新版接口（包含panelName和styleId）
  if (typeof payload === 'string') {
    console.log('创建新组件 (旧版):', payload)
    return
  }

  console.log('创建组件:', payload)

  const containerRef = panelContainerRefs[payload.panelName]
  if (!containerRef) {
    console.error(`未找到面板 "${payload.panelName}" 的容器`)
    console.log('可用的面板:', Object.keys(panelContainerRefs))
    return
  }

  containerRef.addWidget(payload.styleId)
  console.log(`已在 "${payload.panelName}" 中添加组件 "${payload.styleId}"`)
}

const handleEditPanel = (target: string): void => {
  console.log('编辑组件:', target)
  // TODO: 打开属性编辑面板
}

const handleDeletePanel = async (target: string): Promise<void> => {
  console.log('删除组件:', target)

  // 1. 检查是否为系统内置面板（vehicle-attitude, module-status, robot-status）
  const entry = Object.entries(hudTemplatesStore.templates).find(([_, t]) => t.title === target)
  if (entry) {
    const [id] = entry
    const isBuiltInPanel = ['vehicle-attitude', 'module-status', 'robot-status'].includes(id)

    if (isBuiltInPanel) {
      alert('系统内置窗口无法删除，只能隐藏')
      return
    }

    // 2. 检查该窗口是否被其他配置使用
    if (window.api?.dashboardConfig) {
      const usageResult = await window.api.dashboardConfig.checkPanelUsage(id)
      if (usageResult.success && usageResult.usedBy.length > 0) {
        // 获取当前配置文件名
        const currentConfig = dashboardConfigRef.value?.currentConfigFilename || ''
        // 过滤掉当前配置，检查是否有其他配置使用该窗口
        const otherConfigsUsingPanel = usageResult.usedBy.filter(
          (c: { filename: string; name: string }) => c.filename !== currentConfig
        )

        if (otherConfigsUsingPanel.length > 0) {
          const configNames = otherConfigsUsingPanel.map((c: { name: string }) => c.name).join('、')
          alert(
            `无法删除窗口 "${target}"，该窗口正被以下配置使用：\n${configNames}\n\n如需删除，请先从这些配置中移除该窗口。`
          )
          return
        }
      }
    }

    // 3. 确认对话框（仅用于自定义面板）
    if (!confirm(`确定要删除窗口 "${target}" 吗？此操作不可恢复。`)) {
      return
    }

    // Call store to delete file
    if (typeof hudTemplatesStore.deleteTemplate === 'function') {
      await hudTemplatesStore.deleteTemplate(id)
    }
    // Remove from visibility map
    if (panelVisibility[target] !== undefined) {
      delete panelVisibility[target]
    }
  } else {
    // Not found in templates, just hide
    if (panelVisibility[target] !== undefined) {
      panelVisibility[target] = false
    }
  }
}

const handleToggleDrawingMode = (): void => {
  store.setDrawingMode(!isDrawingMode.value)
  console.log('切换绘图模式:', !isDrawingMode.value)
}

// DrawingLayer 的 ref
const drawingLayerRef = ref<InstanceType<typeof DrawingLayer> | null>(null)

// 窗口内组件容器的 ref存储（使用reactive以便动态添加key）
const panelContainerRefs = reactive<
  Record<string, InstanceType<typeof PanelWidgetContainer> | null>
>({})

const handleTogglePanel = (target: string): void => {
  console.log('切换组件可见性:', target)
  if (panelVisibility[target] !== undefined) {
    panelVisibility[target] = !panelVisibility[target]
  }
}

const handleAddCustomPanel = async (): Promise<void> => {
  console.log('新建自定义窗口')
  if (typeof hudTemplatesStore.createCustomTemplate !== 'function') {
    console.error('createCustomTemplate method is missing on store!', hudTemplatesStore)
    alert('功能未就绪，请刷新页面重试')
    return
  }
  await hudTemplatesStore.createCustomTemplate()
  Object.values(hudTemplatesStore.templates).forEach((template) => {
    if (panelVisibility[template.title] === undefined) {
      panelVisibility[template.title] = template.options.defaultVisible !== false
    }
  })
}

const handleManageComponents = (target: string): void => {
  console.log('管理组件排布:', target)
  // TODO: 进入组件编辑模式
}

// 加载面板组件配置
const loadPanelWidgets = (): void => {
  Object.entries(hudTemplatesStore.templates).forEach(([_id, template]) => {
    if (template.widgets && template.widgets.length > 0) {
      const containerRef = panelContainerRefs[template.title]
      if (containerRef) {
        containerRef.setWidgets(template.widgets)
        console.log(`[Dashboard] 加载面板 "${template.title}" 的组件配置:`, template.widgets.length)
      }
    }
  })
}

// 处理组件更新事件（自动保存）
const handleWidgetsUpdated = async (panelTitle: string): Promise<void> => {
  const containerRef = panelContainerRefs[panelTitle]
  if (containerRef) {
    const widgets = containerRef.getWidgets()
    // 查找对应的模板 ID
    const template = Object.entries(hudTemplatesStore.templates).find(
      ([_, t]) => t.title === panelTitle
    )
    if (template) {
      await hudTemplatesStore.saveWidgetsToTemplate(template[0], widgets)
      console.log(`[Dashboard] 自动保存面板 "${panelTitle}" 的组件配置`)
    }
  }
}

// 保存面板组件配置
const savePanelWidgets = async (): Promise<void> => {
  for (const [title, containerRef] of Object.entries(panelContainerRefs)) {
    if (containerRef) {
      const widgets = containerRef.getWidgets()
      // 查找对应的模板 ID
      const template = Object.entries(hudTemplatesStore.templates).find(
        ([_, t]) => t.title === title
      )
      if (template && widgets.length > 0) {
        await hudTemplatesStore.saveWidgetsToTemplate(template[0], widgets)
        console.log(`[Dashboard] 保存面板 "${title}" 的组件配置:`, widgets.length)
      }
    }
  }
}

// 监听编辑模式变化，退出时自动保存
watch(isHudInteractive, async (newValue, oldValue) => {
  if (oldValue === true && newValue === false) {
    // 从编辑模式退出，保存所有面板的组件配置
    console.log('[Dashboard] 退出编辑模式，保存组件配置...')
    await savePanelWidgets()
  }
})

const handleCreateGraphic = (payload: unknown): void => {
  console.log('创建图形:', payload)
  // TODO: 创建全局图形
}

const handlePlaceGraphicTemplate = (payload: {
  category: string
  template: { filename: string; content: string }
}): void => {
  console.log('放置组件模板:', payload)

  if (!drawingLayerRef.value) {
    console.error('绘图层未初始化')
    return
  }

  // 如果未处于绘图模式，先切换到绘图模式
  if (!isDrawingMode.value) {
    store.setDrawingMode(true)
    // 等待下一帧再加载模板，确保 DrawingLayer 已渲染
    nextTick(() => {
      if (drawingLayerRef.value?.loadTemplateFromXML) {
        drawingLayerRef.value.loadTemplateFromXML(payload.template.content)
        console.log(`已加载模板: ${payload.template.filename}`)
      }
    })
  } else {
    // 已在绘图模式，直接加载
    if (drawingLayerRef.value.loadTemplateFromXML) {
      drawingLayerRef.value.loadTemplateFromXML(payload.template.content)
      console.log(`已加载模板: ${payload.template.filename}`)
    }
  }
}
</script>

<template>
  <div class="dashboard-root">
    <!-- 检测服务组件（内部管理检测通信，状态直接同步到 Pinia store） -->
    <DetectionService
      ref="detectionServiceRef"
      :video-source="videoSource"
      :video-element="videoEl"
      :source-canvas="udpCanvasEl"
      :source-canvas-active="udpDirectCanvasActive && !udpBackendMjpegActive"
      :source-image="udpMjpegImageEl"
      :source-image-active="udpBackendMjpegActive"
      :detection-config="detectionConfig"
      :encode-config="encodeConfig"
      :enabled="detectionEnabled"
      style="display: none"
      @communication-status-change="handleCommunicationStatusChange"
    />

    <!-- 性能优化组件（GPU编码、基准测试，状态直接同步到 Pinia store） -->
    <PerformanceOptimizer
      ref="performanceOptimizerRef"
      :video-element="videoEl"
      style="display: none"
    />

    <main class="video-stream-area">
      <video
        v-show="!udpDirectCanvasActive && !udpBackendMjpegActive"
        ref="videoEl"
        class="video-stream"
        :style="{ transform: `scale(${videoZoom})` }"
        autoplay
        playsinline
        muted
      ></video>

      <img
        ref="udpMjpegImageEl"
        v-show="udpBackendMjpegActive"
        class="video-stream udp-mjpeg-stream"
        crossorigin="anonymous"
        :src="udpMjpegStreamUrl"
        :style="{ transform: `scale(${videoZoom})` }"
        decoding="async"
        alt=""
        @load="handleMjpegStreamLoad"
      />

      <!-- UDP 图传帧渲染 Canvas（直接显示，绕过 captureStream + <video>） -->
      <canvas
        ref="udpCanvasEl"
        :class="udpDirectCanvasActive && !udpBackendMjpegActive ? 'video-stream' : 'udp-canvas-hidden'"
        :style="udpDirectCanvasActive && !udpBackendMjpegActive ? { transform: `scale(${videoZoom})` } : undefined"
        :aria-hidden="!udpDirectCanvasActive || udpBackendMjpegActive"
      ></canvas>

      <!-- 缩放指示器 -->
      <Transition name="fade">
        <div v-if="isZoomed" class="zoom-indicator">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            <line x1="11" y1="8" x2="11" y2="14"></line>
            <line x1="8" y1="11" x2="14" y2="11"></line>
          </svg>
          <span class="zoom-value">{{ videoZoomText }}</span>
          <span class="zoom-hint">
            按 <kbd>{{ formatHotkey(globalHotkeys.zoomReset) }}</kbd> 恢复
          </span>
        </div>
      </Transition>

      <!-- 低血量屏幕红色渐晕效果 -->
      <Transition name="fade">
        <div
          v-if="lowHealthVignetteOpacity > 0"
          class="low-health-vignette"
          :class="{ critical: isLowHealthCritical }"
          :style="{
            '--vignette-opacity': lowHealthVignetteOpacity
          }"
          aria-label="低血量警告"
        ></div>
      </Transition>

      <!-- 目标检测覆盖层 -->
      <DetectionOverlay />

      <!-- 全局绘图层 -->
      <DrawingLayer
        ref="drawingLayerRef"
        :visible="isDrawingMode"
        :video-size="videoSize"
        @close="store.setDrawingMode(false)"
      />

      <div v-if="videoStatus" class="video-status-overlay">{{ videoStatus }}</div>

      <!-- 动态准星（带环形热量进度） -->
      <div
        class="crosshair"
        :style="{
          '--crosshair-color': crosshairConfig.color,
          '--crosshair-outline': crosshairConfig.outlineColor,
          '--crosshair-size': crosshairConfig.size + 'px',
          '--crosshair-thickness': crosshairConfig.thickness + 'px',
          '--crosshair-gap': crosshairConfig.gap + 'px',
          '--crosshair-outline-thickness': crosshairConfig.outlineThickness + 'px',
          '--crosshair-opacity': crosshairConfig.opacity,
          '--center-dot-size': crosshairConfig.centerDotSize + 'px'
        }"
        :data-style="crosshairConfig.style"
      >
        <!-- 热量环 -->
        <svg class="crosshair-ring" viewBox="0 0 80 80" width="80" height="80" aria-hidden="true">
          <circle
            class="ring-bg"
            cx="40"
            cy="40"
            r="36"
            fill="none"
            stroke="rgba(255,255,255,0.06)"
            stroke-width="4"
          />
          <circle
            class="ring"
            cx="40"
            cy="40"
            r="36"
            fill="none"
            :stroke="ringColor"
            stroke-width="4"
            stroke-linecap="round"
            :style="{
              strokeDasharray: ringCircumference,
              strokeDashoffset: ringCircumference * (1 - heatPercent)
            }"
          />
        </svg>

        <!-- 准星图形 -->
        <div class="crosshair-shape">
          <template v-if="crosshairConfig.style === 'cross'">
            <div class="line line-top"></div>
            <div class="line line-bottom"></div>
            <div class="line line-left"></div>
            <div class="line line-right"></div>
          </template>
          <template v-else-if="crosshairConfig.style === 't-shape'">
            <div class="line line-top"></div>
            <div class="line line-left"></div>
            <div class="line line-right"></div>
          </template>
          <template v-else-if="crosshairConfig.style === 'circle'">
            <div class="shape-circle"></div>
          </template>
          <template v-else-if="crosshairConfig.style === 'square'">
            <div class="shape-square"></div>
          </template>
          <template v-else-if="crosshairConfig.style === 'dot'">
            <div class="center-dot" style="--center-dot-size: 6px"></div>
          </template>
          <div
            v-if="crosshairConfig.centerDot && crosshairConfig.style !== 'dot'"
            class="center-dot"
          ></div>
        </div>
      </div>

      <div class="hint">
        按 <kbd>{{ formatHotkey(globalHotkeys.toggleSettings) }}</kbd> 打开设置 | 按
        <kbd>{{ formatHotkey(globalHotkeys.toggleDetection) }}</kbd> 切换检测 | 按
        <kbd>{{ formatHotkey(globalHotkeys.crosshairSettings) }}</kbd> 准星设置 | 按
        <kbd>{{ formatHotkey(globalHotkeys.ammoPurchase) }}</kbd> 弹丸购买 | 按
        <kbd>{{ formatHotkey(globalHotkeys.remoteAmmoPurchase) }}</kbd> 远程补弹
      </div>
    </main>

    <!-- HUD 层：默认不可交互（控制模式），在设置菜单中开启编辑模式 -->
    <div
      class="hud-layer"
      :class="{ interactive: isHudInteractive }"
      v-show="!isDrawingMode"
      @contextmenu="handleHudContextMenu"
    >
      <!-- HUD 编辑模式指示器 -->
      <Transition name="fade">
        <div v-if="isHudInteractive" class="hud-edit-indicator">
          <div class="hud-edit-badge">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <rect x="3" y="3" width="7" height="7"></rect>
              <rect x="14" y="3" width="7" height="7"></rect>
              <rect x="14" y="14" width="7" height="7"></rect>
              <rect x="3" y="14" width="7" height="7"></rect>
            </svg>
            <span>HUD 编辑模式</span>
            <span class="hint">按 <kbd>ESC</kbd> 退出</span>
          </div>
        </div>
      </Transition>

      <!-- 动态加载的自定义面板 -->
      <template v-for="(template, id) in hudTemplatesStore.templates" :key="id">
        <HudPanel
          v-if="panelVisibility[template.title]"
          :title="template.title"
          :team="selectedTeam || 'red'"
          :initial-style="{
            bottom: template.position.bottom,
            left: template.position.left,
            right: template.position.right,
            top: template.position.top,
            width: template.size.width,
            height: template.size.height
          }"
          :resizable="template.options.resizable"
          :hide-title-bar="template.options.hideTitleBar"
          :transparent="template.options.transparent"
          @panel-context-menu="handlePanelContextMenu"
        >
          <!-- 判断是否为默认面板，默认面板使用原组件，自定义面板使用 PanelWidgetContainer -->
          <template v-if="template.content?.component && componentMap[template.content.component]">
            <!-- 默认面板：使用原组件渲染 -->
            <!-- VehicleAttitude 特殊处理 -->
            <VehicleAttitude
              v-if="template.content.component === 'VehicleAttitude'"
              :chassis-yaw="chassisYaw"
              :gimbal-yaw="gimbalYaw"
              :team="selectedTeam || 'red'"
              v-bind="template.content.props"
            />
            <!-- PitchIndicator 特殊处理 - 绑定云台俯仰角 -->
            <PitchIndicator
              v-else-if="template.content.component === 'PitchIndicator'"
              :pitch="gimbalPitch"
              v-bind="template.content.props"
            />
            <!-- WeaponStatus 特殊处理 - 枪口热量和弹药显示 -->
            <WeaponStatus
              v-else-if="template.content.component === 'WeaponStatus'"
              v-bind="template.content.props"
            />
            <VideoZoomStatus
              v-else-if="template.content.component === 'VideoZoomStatus'"
              :zoom="videoZoom"
              :min-zoom="MIN_ZOOM"
              :max-zoom="MAX_ZOOM"
              :step="ZOOM_STEP"
              @update:zoom="videoZoom = normalizeVideoZoom($event)"
              v-bind="template.content.props"
            />
            <!-- RobotStateManager 特殊处理 -->
            <RobotStateManager
              v-else-if="template.content.component === 'RobotStateManager'"
              ref="robotStateRef"
              :robot-name="selectedRobot"
              :team="selectedTeam || 'red'"
              :enable-simulation="enableSimulation"
              v-bind="template.content.props"
              @config-loaded="handleRobotConfigLoaded"
            />
            <!-- ModuleStatus 和其他通用组件 -->
            <component
              v-else
              :is="componentMap[template.content.component]"
              v-bind="template.content.props"
              :team="selectedTeam || 'red'"
            />
          </template>
          <template v-else>
            <!-- 自定义面板：使用 PanelWidgetContainer 管理窗口内组件 -->
            <PanelWidgetContainer
              :ref="
                (el) => {
                  if (el && typeof el !== 'string') {
                    panelContainerRefs[template.title] = el as InstanceType<
                      typeof PanelWidgetContainer
                    >
                  }
                }
              "
              :panel-id="id"
              :editable="isHudInteractive"
              @widgets-updated="handleWidgetsUpdated(template.title)"
            />
          </template>
        </HudPanel>
      </template>

      <!-- HUD 上下文菜单 -->
      <HudContextMenu
        :visible="contextMenu.visible"
        :x="contextMenu.x"
        :y="contextMenu.y"
        :type="contextMenu.type"
        :target="contextMenu.target"
        :panels="panelVisibility"
        @close="closeContextMenu"
        @create-widget="handleCreateWidget"
        @edit-panel="handleEditPanel"
        @toggle-panel="handleTogglePanel"
        @delete-panel="handleDeletePanel"
        @add-custom-panel="handleAddCustomPanel"
        @manage-components="handleManageComponents"
        @create-graphic="handleCreateGraphic"
        @rename-panel="handleRenamePanel"
        @toggle-drawing-mode="handleToggleDrawingMode"
        @place-graphic-template="handlePlaceGraphicTemplate"
      />

      <!-- 消息通知窗口 -->
      <MessageWindow />
    </div>
    <!-- 结束 hud-layer -->

    <!-- 重命名模态框 -->
    <Transition name="modal-fade">
      <div v-if="renameModal.visible" class="modal-backdrop" @click="renameModal.visible = false">
        <div class="modal-content rename-modal" @click.stop>
          <div class="settings-header">
            <h3>重命名窗口</h3>
          </div>
          <div class="rename-body">
            <input
              v-model="renameModal.newTitle"
              type="text"
              class="rename-input"
              placeholder="输入新名称"
              @keyup.enter="confirmRename"
              @keydown.esc="renameModal.visible = false"
            />
            <div class="rename-actions">
              <button class="btn-secondary" @click="renameModal.visible = false">取消</button>
              <button class="btn-primary" @click="confirmRename">确定</button>
            </div>
          </div>
        </div>
      </div>
    </Transition>

    <Transition name="modal-fade">
      <div v-if="isSettingsVisible" class="modal-backdrop" @click="isSettingsVisible = false">
        <div class="modal-content settings-modal" @click.stop>
          <button class="modal-close-btn" title="Close" @click="isSettingsVisible = false">
            ×
          </button>

          <div class="settings-header">
            <h3>图传设置</h3>
            <p class="settings-subtitle">配置视频源、网络参数和机器人类型</p>
          </div>

          <!-- 标签页导航 -->
          <div class="tabs-nav">
            <button
              class="tab-item"
              :class="{ active: activeTab === 'video' }"
              @click="activeTab = 'video'"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect>
                <path d="M16 3l-4 4-4-4"></path>
              </svg>
              <span>视频源</span>
            </button>
            <button
              class="tab-item"
              :class="{ active: activeTab === 'network' }"
              @click="activeTab = 'network'"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="2" y1="12" x2="22" y2="12"></line>
                <path
                  d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"
                ></path>
              </svg>
              <span>网络</span>
            </button>
            <button
              class="tab-item"
              :class="{ active: activeTab === 'robot' }"
              @click="activeTab = 'robot'"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
              </svg>
              <span>机器人</span>
            </button>
            <button
              class="tab-item"
              :class="{ active: activeTab === 'display' }"
              @click="activeTab = 'display'"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <circle cx="12" cy="12" r="3"></circle>
                <path
                  d="M12 1v6m0 6v6M5.64 5.64l4.24 4.24m4.24 4.24l4.24 4.24M1 12h6m6 0h6M5.64 18.36l4.24-4.24m4.24-4.24l4.24-4.24"
                ></path>
              </svg>
              <span>显示</span>
            </button>
            <button
              class="tab-item"
              :class="{ active: activeTab === 'hotkeys' }"
              @click="activeTab = 'hotkeys'"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <rect x="3" y="5" width="18" height="14" rx="2"></rect>
                <path d="M7 9h.01M11 9h.01M15 9h.01M19 9h.01M7 13h10"></path>
              </svg>
              <span>键位</span>
            </button>
          </div>

          <!-- 标签页内容 -->
          <div ref="tabsContentEl" class="tabs-content">
            <!-- 视频源标签页 -->
            <div v-show="activeTab === 'video'" class="tab-panel">
              <VideoSourceManager
                v-model:video-source="videoSource"
                v-model:selected-camera-id="selectedCameraId"
                v-model:video-file-path="videoFilePath"
                v-model:udp-config="udpConfig"
                :connected="wasConnected"
                @video-connected="handleVideoConnected"
              />

              <!-- 界面配置管理 -->
              <div class="config-divider"></div>
              <DashboardConfigManager
                ref="dashboardConfigRef"
                :get-current-config="getCurrentDashboardConfig"
                @config-loaded="handleDashboardConfigLoaded"
                @config-changed="handleDashboardConfigChanged"
              />
            </div>

            <!-- 网络标签页 -->
            <div v-show="activeTab === 'network'" class="tab-panel">
              <div class="panel-section">
                <h4 class="section-title">
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                  >
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="2" y1="12" x2="22" y2="12"></line>
                    <path
                      d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"
                    ></path>
                  </svg>
                  机器人连接
                </h4>
                <div class="form-item">
                  <label for="ip">IP 地址</label>
                  <input id="ip" v-model="ipAddress" type="text" placeholder="例: 192.168.12.1" />
                </div>
                <div class="hint-text">
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                  >
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="12" y1="16" x2="12" y2="12"></line>
                    <line x1="12" y1="8" x2="12.01" y2="8"></line>
                  </svg>
                  统一的机器人 IP 地址，UDP 和 MQTT 将使用此地址连接
                </div>
              </div>

              <!-- UDP 图传设置 -->
              <div class="panel-section">
                <h4 class="section-title">
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                  >
                    <path d="M5 12.55a11 11 0 0 1 14.08 0"></path>
                    <path d="M1.42 9a16 16 0 0 1 21.16 0"></path>
                    <path d="M8.53 16.11a6 6 0 0 1 6.95 0"></path>
                    <circle cx="12" cy="20" r="1"></circle>
                  </svg>
                  UDP 图传设置
                </h4>
                <div class="form-item">
                  <label for="udp-port">监听端口</label>
                  <input
                    id="udp-port"
                    v-model.number="udpConfig.port"
                    type="number"
                    min="1024"
                    max="65535"
                    placeholder="3334"
                  />
                </div>

                <!-- 编码类型和缓冲区大小 - 放在一排 -->
                <div class="form-row-group">
                  <div class="form-item flex-1">
                    <label for="udp-codec">编码类型</label>
                    <select id="udp-codec" v-model="udpConfig.codec" class="codec-select">
                      <option
                        v-for="opt in codecOptions"
                        :key="opt.value"
                        :value="opt.value"
                        :disabled="opt.disabled"
                      >
                        {{ opt.label }}
                      </option>
                    </select>
                  </div>
                  <div class="form-item flex-1">
                    <label for="udp-buffer">缓冲区大小</label>
                    <select
                      id="udp-buffer"
                      v-model.number="udpConfig.bufferSize"
                      class="buffer-select"
                    >
                      <option :value="65536">64 KB</option>
                      <option :value="131072">128 KB</option>
                      <option :value="262144">256 KB</option>
                      <option :value="524288">512 KB</option>
                      <option :value="1048576">1 MB</option>
                      <option :value="2097152">2 MB</option>
                      <option :value="4194304">4 MB</option>
                      <option :value="8388608">8 MB</option>
                    </select>
                  </div>
                </div>

                <div class="codec-hint">
                  <template v-if="udpConfig.codec === 'auto'"> 自动检测帧格式（推荐） </template>
                  <template v-else-if="udpConfig.codec === 'mjpeg'">
                    MJPEG: 低延迟，兼容性好
                  </template>
                  <template v-else-if="udpConfig.codec === 'h264'">
                    H.264: 前端解码已移除，当前不可用
                  </template>
                  <template v-else-if="udpConfig.codec === 'h265'">
                    H.265: 后端解码后以 MJPEG 本机流显示
                  </template>
                </div>

                <!-- UDP 连接状态 -->
                <div class="udp-status-section">
                  <div class="status-row-inline">
                    <span class="status-label">连接状态:</span>
                    <span
                      class="status-badge udp-status"
                      :class="{
                        connected: udpStreamStatus === 'connected',
                        connecting: udpStreamStatus === 'connecting',
                        disconnected: udpStreamStatus === 'disconnected',
                        error: udpStreamStatus === 'error'
                      }"
                    >
                      {{
                        udpStreamStatus === 'connected'
                          ? '已连接'
                          : udpStreamStatus === 'connecting'
                            ? '连接中...'
                            : udpStreamStatus === 'error'
                              ? '连接错误'
                              : '未连接'
                      }}
                    </span>
                  </div>
                  <template v-if="udpStreamStatus === 'connected'">
                    <div class="udp-stats">
                      <div class="stat-item">
                        <span class="stat-label">帧率:</span>
                        <span class="stat-value">{{ udpStats.fps }} FPS</span>
                      </div>
                      <div class="stat-item">
                        <span class="stat-label">码率:</span>
                        <span class="stat-value"
                          >{{ (udpStats.bitrate / 1024 / 1024).toFixed(2) }} Mbps</span
                        >
                      </div>
                      <div class="stat-item">
                        <span class="stat-label">已接收:</span>
                        <span class="stat-value">{{ udpStats.receivedFrames }} 帧</span>
                      </div>
                      <div class="stat-item">
                        <span class="stat-label">解码:</span>
                        <span class="stat-value">{{ udpDecoderBackendLabel }}</span>
                      </div>
                      <div class="stat-item">
                        <span class="stat-label">输出:</span>
                        <span class="stat-value">{{ udpOutputResolutionLabel }}</span>
                      </div>
                    </div>
                  </template>
                </div>

                <div class="hint-text">
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                  >
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="12" y1="16" x2="12" y2="12"></line>
                    <line x1="12" y1="8" x2="12.01" y2="8"></line>
                  </svg>
                  UDP 图传接收 H.265 格式的视频帧，需要在发送端配置相同的端口
                </div>
              </div>

              <!-- MQTT 设置区域 -->
              <div class="panel-section">
                <h4 class="section-title">
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                  >
                    <path d="M4 11a9 9 0 0 1 9 9"></path>
                    <path d="M4 4a16 16 0 0 1 16 16"></path>
                    <circle cx="5" cy="19" r="1"></circle>
                  </svg>
                  MQTT 通信
                </h4>

                <div class="form-item">
                  <label for="mqtt-broker">Broker 地址</label>
                  <div class="input-with-button">
                    <input
                      id="mqtt-broker"
                      v-model="mqttConfig.brokerUrl"
                      type="text"
                      placeholder="mqtt://127.0.0.1:1883"
                    />
                    <button
                      v-if="mqttStatus === 'disconnected' || mqttStatus === 'error'"
                      class="inline-action-btn"
                      @click="() => connectMqtt()"
                    >
                      连接
                    </button>
                    <button v-else class="inline-action-btn disconnect" @click="disconnectMqtt">
                      断开
                    </button>
                  </div>
                  <span class="input-hint"
                    >格式: mqtt://host:port 或 ws://host:port (WebSocket)</span
                  >
                  <span v-if="mqttNeedsManualReconnect" class="input-hint warning">
                    IP 或端口已修改，请手动重新连接 MQTT
                  </span>
                </div>

                <div class="form-item">
                  <label for="mqtt-port">MQTT 端口</label>
                  <input
                    id="mqtt-port"
                    v-model.number="mqttConfig.port"
                    type="number"
                    min="1024"
                    max="65535"
                    placeholder="1883"
                  />
                </div>

                <div class="form-grid-2col">
                  <div class="form-item">
                    <label for="mqtt-clientid">Client ID</label>
                    <input
                      id="mqtt-clientid"
                      :value="effectiveMqttClientId || '自动生成'"
                      type="text"
                      readonly
                    />
                    <span class="input-hint">
                      根据当前车辆 ID 自动设置，当前车辆 ID:
                      {{ selectedVehicleId > 0 ? selectedVehicleId : '未选择' }}
                    </span>
                  </div>
                  <div class="form-item">
                    <label for="mqtt-username">用户名 (可选)</label>
                    <input
                      id="mqtt-username"
                      v-model="mqttConfig.username"
                      type="text"
                      placeholder="无需认证留空"
                    />
                  </div>
                </div>

                <!-- MQTT 连接状态 -->
                <div class="mqtt-status-section">
                  <div class="status-row-inline">
                    <span class="status-label">连接状态:</span>
                    <span
                      class="status-badge mqtt-status"
                      :class="{
                        connected: mqttStatus === 'connected',
                        connecting: mqttStatus === 'connecting',
                        disconnected: mqttStatus === 'disconnected',
                        error: mqttStatus === 'error'
                      }"
                    >
                      {{
                        mqttStatus === 'connected'
                          ? '已连接'
                          : mqttStatus === 'connecting'
                            ? '连接中...'
                            : mqttStatus === 'error'
                              ? '连接错误'
                              : '未连接'
                      }}
                    </span>
                  </div>
                  <template v-if="mqttStatus === 'connected'">
                    <div class="mqtt-stats">
                      <div class="stat-item">
                        <span class="stat-label">已发送:</span>
                        <span class="stat-value">{{ mqttStats.messagesSent }} 条</span>
                      </div>
                      <div class="stat-item">
                        <span class="stat-label">已接收:</span>
                        <span class="stat-value">{{ mqttStats.messagesReceived }} 条</span>
                      </div>
                      <div class="stat-item" v-if="mqttStats.lastMessageTime > 0">
                        <span class="stat-label">最后消息:</span>
                        <span class="stat-value">{{
                          new Date(mqttStats.lastMessageTime).toLocaleTimeString()
                        }}</span>
                      </div>
                    </div>
                  </template>
                </div>

                <div class="hint-text">
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                  >
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="12" y1="16" x2="12" y2="12"></line>
                    <line x1="12" y1="8" x2="12.01" y2="8"></line>
                  </svg>
                  MQTT 使用 Protobuf 编码消息，用于机器人状态、比赛信息等实时通信
                </div>

                <!-- MQTT 指令发送面板（仅调试模式显示） -->
                <MqttCommandPanel
                  v-if="isDebugMode"
                  :connected="mqttStatus === 'connected'"
                />
              </div>
            </div>

            <!-- 机器人标签页 -->
            <div v-show="activeTab === 'robot'" class="tab-panel">
              <!-- 机器人模式设置组件 -->
              <RoboModeSettings
                v-model="selectedRobot"
                :robot-options="robotOptions"
                @robot-change="handleRobotChange"
              />

              <div class="hint-text" style="margin-top: 12px">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <circle cx="12" cy="12" r="10"></circle>
                  <line x1="12" y1="16" x2="12" y2="12"></line>
                  <line x1="12" y1="8" x2="12.01" y2="8"></line>
                </svg>
                选择的机器人类型将影响UI配色方案，性能模式仅英雄/步兵可用
              </div>
            </div>

            <!-- 显示标签页 -->
            <div v-show="activeTab === 'hotkeys'" class="tab-panel">
              <div class="panel-section">
                <h4 class="section-title">
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                  >
                    <rect x="3" y="5" width="18" height="14" rx="2"></rect>
                    <path d="M7 9h.01M11 9h.01M15 9h.01M19 9h.01M7 13h10"></path>
                  </svg>
                  全局键位设置
                </h4>
                <div class="hotkey-groups" @keydown.capture="handleHotkeyRecorderKeydown">
                  <div
                    v-for="group in GLOBAL_HOTKEY_GROUPS"
                    :key="group.title"
                    class="hotkey-group"
                  >
                    <div class="hotkey-group-title">{{ group.title }}</div>
                    <button
                      v-for="item in group.actions"
                      :key="item.action"
                      type="button"
                      class="hotkey-row"
                      :class="{ recording: recordingHotkeyAction === item.action }"
                      @click="startHotkeyRecording(item.action)"
                    >
                      <span class="hotkey-meta">
                        <strong>{{ item.label }}</strong>
                        <small>{{ item.description }}</small>
                      </span>
                      <kbd>
                        {{
                          recordingHotkeyAction === item.action
                            ? '按下新键...'
                            : formatHotkey(globalHotkeys[item.action])
                        }}
                      </kbd>
                    </button>
                  </div>
                </div>
                <div class="hotkey-actions">
                  <button class="modal-button-secondary" type="button" @click="resetGlobalHotkeys">
                    恢复默认键位
                  </button>
                </div>
                <div class="hint-text">
                  点击某一行后按下新键即可绑定；按 Esc 取消录入。若新键与已有动作冲突，会自动交换键位。
                </div>
              </div>
            </div>

            <div v-show="activeTab === 'display'" class="tab-panel">
              <div class="panel-section">
                <h4 class="section-title">
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                  >
                    <circle cx="12" cy="12" r="3"></circle>
                    <path
                      d="M12 1v6m0 6v6M5.64 5.64l4.24 4.24m4.24 4.24l4.24 4.24M1 12h6m6 0h6M5.64 18.36l4.24-4.24m4.24-4.24l4.24-4.24"
                    ></path>
                  </svg>
                  准星与界面
                </h4>
                <button class="action-card" @click="isCrosshairSettingsVisible = true">
                  <div class="action-icon">
                    <svg
                      width="24"
                      height="24"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                    >
                      <circle cx="12" cy="12" r="10"></circle>
                      <circle cx="12" cy="12" r="3"></circle>
                      <line x1="12" y1="2" x2="12" y2="5"></line>
                      <line x1="12" y1="19" x2="12" y2="22"></line>
                      <line x1="2" y1="12" x2="5" y2="12"></line>
                      <line x1="19" y1="12" x2="22" y2="12"></line>
                    </svg>
                  </div>
                  <div class="action-content">
                    <div class="action-title">自定义准星</div>
                    <div class="action-desc">调整准星样式、颜色和大小</div>
                  </div>
                  <svg
                    class="action-arrow"
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                  >
                    <polyline points="9 18 15 12 9 6"></polyline>
                  </svg>
                </button>
                <button class="action-card" @click="handleReload">
                  <div class="action-icon">
                    <svg
                      width="24"
                      height="24"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                    >
                      <polyline points="23 4 23 10 17 10"></polyline>
                      <polyline points="1 20 1 14 7 14"></polyline>
                      <path
                        d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"
                      ></path>
                    </svg>
                  </div>
                  <div class="action-content">
                    <div class="action-title">刷新界面</div>
                    <div class="action-desc">重新加载所有UI组件</div>
                  </div>
                  <svg
                    class="action-arrow"
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                  >
                    <polyline points="9 18 15 12 9 6"></polyline>
                  </svg>
                </button>
                <button class="action-card" @click="runEncodingBenchmark">
                  <div class="action-icon">
                    <svg
                      width="24"
                      height="24"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                    >
                      <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"></path>
                    </svg>
                  </div>
                  <div class="action-content">
                    <div class="action-title">编码性能测试</div>
                    <div class="action-desc">比较GPU与CPU JPEG编码性能</div>
                  </div>
                  <svg
                    class="action-arrow"
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                  >
                    <polyline points="9 18 15 12 9 6"></polyline>
                  </svg>
                </button>
              </div>

              <!-- WebRTC 网络分发 -->
              <div class="panel-section">
                <h4 class="section-title">
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                  >
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                    <circle cx="9" cy="7" r="4"></circle>
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                    <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                  </svg>
                  WebRTC 网络分发
                </h4>

                <div class="toggle-option">
                  <label class="toggle-label">
                    <input
                      type="checkbox"
                      v-model="webrtcDistributeEnabled"
                      class="toggle-input"
                      @change="toggleWebRTCDistribution"
                    />
                    <span class="toggle-switch"></span>
                    <span class="toggle-text">启用 WebRTC 分发</span>
                  </label>
                  <div class="slider-hint">允许其他设备通过网络观看视频流</div>
                </div>

                <!-- WebRTC 分发状态 (仅在启用时显示) -->
                <div v-if="webrtcDistributeEnabled" class="webrtc-distribute-status">
                  <div class="server-status-row">
                    <span class="status-label">信令服务器:</span>
                    <span
                      class="status-badge"
                      :class="{
                        running: webrtcSignalingStatus === 'running',
                        starting: webrtcSignalingStatus === 'starting',
                        stopped: webrtcSignalingStatus === 'stopped',
                        error: webrtcSignalingStatus === 'error'
                      }"
                    >
                      {{
                        webrtcSignalingStatus === 'running'
                          ? '运行中'
                          : webrtcSignalingStatus === 'starting'
                            ? '启动中...'
                            : webrtcSignalingStatus === 'error'
                              ? '错误'
                              : '已停止'
                      }}
                    </span>
                  </div>

                  <!-- 信令地址显示 -->
                  <div v-if="webrtcSignalingAddress" class="signaling-address">
                    <span class="address-label">连接地址:</span>
                    <code class="address-value">{{ webrtcSignalingAddress }}</code>
                    <button class="copy-btn" title="复制地址" @click="copySignalingAddress">
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                      >
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                      </svg>
                    </button>
                  </div>

                  <!-- 已连接客户端数 -->
                  <div class="connected-clients">
                    <span class="clients-label">已连接客户端:</span>
                    <span class="clients-count">{{ webrtcConnectedClients }}</span>
                  </div>
                </div>

                <div class="slider-hint">
                  WebRTC 分发可让其他设备（手机、平板等）通过浏览器观看实时视频流
                </div>
              </div>

              <!-- 性能优化：HUD 模拟开关 -->
              <div class="panel-section">
                <h4 class="section-title">
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                  >
                    <path d="M22 12h-4l-3 9L9 3l-3 9H2"></path>
                  </svg>
                  性能优化
                </h4>

                <div class="toggle-option">
                  <label class="toggle-label">
                    <input
                      type="checkbox"
                      v-model="enableSimulation"
                      class="toggle-input"
                      @change="
                        () => {
                          if (enableSimulation) {
                            startHeatSimulation()
                            // 状态模拟由 RobotStateManager 组件根据 enableSimulation prop 自动控制
                          } else {
                            stopHeatSimulation()
                          }
                        }
                      "
                    />
                    <span class="toggle-switch"></span>
                    <span class="toggle-text">启用 HUD 动态模拟</span>
                  </label>
                  <div class="slider-hint">
                    包括热量动画和状态模拟，关闭可大幅减少空闲时 CPU 占用
                  </div>
                </div>
              </div>

              <div class="panel-section">
                <h4 class="section-title">
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                  >
                    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
                  </svg>
                  性能预设
                </h4>

                <div class="preset-buttons">
                  <button
                    v-for="(config, key) in PERFORMANCE_PRESETS"
                    :key="key"
                    class="preset-btn"
                    :class="{ active: performancePreset === key }"
                    @click="applyPreset(key as PerformancePreset)"
                  >
                    <span class="preset-name">{{
                      key === 'quality'
                        ? '高质量'
                        : key === 'balanced'
                          ? '平衡'
                          : key === 'performance'
                            ? '高性能'
                            : '极速'
                    }}</span>
                    <span class="preset-fps">{{ config.desc.match(/\(.*\)/)?.[0] || '' }}</span>
                  </button>
                </div>
                <div class="slider-hint" style="margin-top: 8px">
                  极速模式使用480p+低质量压缩，可达100+ FPS（需TensorRT）
                </div>
              </div>

              <div class="panel-section">
                <h4 class="section-title">
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                  >
                    <path d="M12 2L2 7l10 5 10-5-10-5z"></path>
                    <path d="M2 17l10 5 10-5M2 12l10 5 10-5"></path>
                  </svg>
                  AI检测参数
                </h4>

                <div class="toggle-option">
                  <label class="toggle-label">
                    <input
                      type="checkbox"
                      v-model="detectionConfig.showBoxes"
                      class="toggle-input"
                    />
                    <span class="toggle-switch"></span>
                    <span class="toggle-text">显示检测框</span>
                  </label>
                  <div class="slider-hint">关闭后仅显示车辆血条，不绘制原始目标框和标签</div>
                </div>

                <div class="slider-group">
                  <label class="slider-label">
                    <span class="label-text">装甲板置信度</span>
                    <span class="label-value">{{ detectionConfig.armorConf.toFixed(2) }}</span>
                  </label>
                  <input
                    type="range"
                    v-model.number="detectionConfig.armorConf"
                    min="0.1"
                    max="0.9"
                    step="0.05"
                    class="slider"
                  />
                  <div class="slider-hint">值越低检测越灵敏，但可能增加误报</div>
                </div>

                <div class="slider-group">
                  <label class="slider-label">
                    <span class="label-text">车辆置信度</span>
                    <span class="label-value">{{ detectionConfig.carConf.toFixed(2) }}</span>
                  </label>
                  <input
                    type="range"
                    v-model.number="detectionConfig.carConf"
                    min="0.1"
                    max="0.9"
                    step="0.05"
                    class="slider"
                  />
                  <div class="slider-hint">车辆检测的置信度阈值</div>
                </div>

                <div class="slider-group">
                  <label class="slider-label">
                    <span class="label-text">NMS IoU阈值</span>
                    <span class="label-value">{{ detectionConfig.iouThreshold.toFixed(2) }}</span>
                  </label>
                  <input
                    type="range"
                    v-model.number="detectionConfig.iouThreshold"
                    min="0.3"
                    max="0.7"
                    step="0.05"
                    class="slider"
                  />
                  <div class="slider-hint">非极大值抑制阈值，控制重叠框过滤</div>
                </div>

                <div class="slider-group">
                  <label class="slider-label">
                    <span class="label-text">最大分辨率</span>
                    <span class="label-value">{{ detectionConfig.maxSize }}px</span>
                  </label>
                  <input
                    type="range"
                    v-model.number="detectionConfig.maxSize"
                    min="640"
                    max="1920"
                    step="160"
                    class="slider"
                  />
                  <div class="slider-hint">服务器端降采样，降低可提升性能</div>
                </div>
              </div>

              <!-- 配置面板组件：外置检测服务 + 图像编码配置（状态直接同步到 Pinia store） -->
              <ConfigPanels
                ref="configPanelsRef"
                :default-encode-config="encodeConfig"
                :pipe-server-status="pipeServerStatus"
                :encoding-method="encodingMethod"
                @start-pipe-server="startPipeServer"
                @stop-pipe-server="stopPipeServer"
              />
            </div>
          </div>

          <!-- 底部操作栏 -->
          <div class="settings-footer">
            <div class="footer-info">
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
              </svg>
              <span>按 <kbd>{{ formatHotkey(globalHotkeys.toggleSettings) }}</kbd> 关闭菜单</span>
            </div>
            <div class="footer-actions">
              <!-- HUD 编辑模式切换 -->
              <button
                class="modal-button-secondary hud-edit-btn"
                :class="{ active: isHudInteractive }"
                @click="isHudInteractive = !isHudInteractive"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <rect x="3" y="3" width="7" height="7"></rect>
                  <rect x="14" y="3" width="7" height="7"></rect>
                  <rect x="14" y="14" width="7" height="7"></rect>
                  <rect x="3" y="14" width="7" height="7"></rect>
                </svg>
                {{ isHudInteractive ? 'HUD 编辑中' : '编辑 HUD' }}
              </button>
              <button class="modal-button-secondary" @click="isSettingsVisible = false">
                关闭
              </button>
              <button class="modal-button-primary" @click="handleConnectAndClose">
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <polyline points="16 3 21 3 21 8"></polyline>
                  <line x1="4" y1="20" x2="21" y2="3"></line>
                  <polyline points="21 16 21 21 16 21"></polyline>
                  <line x1="15" y1="15" x2="21" y2="21"></line>
                  <line x1="4" y1="4" x2="9" y2="9"></line>
                </svg>
                应用并连接
              </button>
            </div>
          </div>
        </div>
      </div>
    </Transition>

    <!-- 准星设置弹窗 -->
    <Transition name="modal-fade">
      <div
        v-if="isCrosshairSettingsVisible"
        class="modal-backdrop"
        @click="isCrosshairSettingsVisible = false"
      >
        <div class="modal-content modal-wide" @click.stop>
          <button class="modal-close-btn" title="Close" @click="isCrosshairSettingsVisible = false">
            ×
          </button>
          <h3>准星配置</h3>
          <CrosshairSettings v-model="crosshairConfig" />
          <div class="modal-actions" style="margin-top: 20px">
            <button class="modal-button-primary" @click="isCrosshairSettingsVisible = false">
              确定
            </button>
          </div>
          <div class="key-hint-footer">
            <span>按 <kbd>{{ formatHotkey(globalHotkeys.crosshairSettings) }}</kbd> 关闭设置</span>
          </div>
        </div>
      </div>
    </Transition>

    <!-- 弹丸购买菜单 -->
    <AmmoPurchaseMenu
      v-if="isAmmoPurchaseVisible"
      :current-ammo="remainingAmmo"
      :exchangeable-ammo="exchangeableAmmo"
      @purchase="handleAmmoPurchase"
      @close="isAmmoPurchaseVisible = false"
    />

    <!-- 远程弹丸购买菜单 -->
    <RemoteAmmoPurchaseMenu
      v-if="isRemoteAmmoPurchaseVisible"
      @purchase="handleRemoteAmmoPurchase"
      @close="isRemoteAmmoPurchaseVisible = false"
    />

    <!-- 机器人操控组件 -->
    <RoboControl
      :enabled="!isAnyMenuOpen"
      :hud-edit-mode="isHudInteractive"
      @control-frame="handleRoboControlFrame"
      @capture-change="handleCaptureChange"
    />

    <!-- K 键机器人特殊操作提示 -->
    <RobotActionHint ref="robotActionHintRef" @action="handleRobotAction" />
  </div>
</template>

<style scoped>
.dashboard-root {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: #000;
  /* GPU 加速和性能优化 */
  transform: translateZ(0);
  contain: layout style paint;
}

/* HUD 交互层 */
.hud-layer {
  position: absolute;
  inset: 0;
  z-index: 50;
  pointer-events: none; /* 默认不响应鼠标事件 */
}

.hud-layer.interactive {
  pointer-events: auto; /* 交互模式下响应鼠标事件 */
}

/* HUD 内的面板需要能接收事件 */
.hud-layer.interactive :deep(.hud) {
  pointer-events: auto;
}

/* 非编辑模式下，允许 Buff/判罚图标悬停提示 */
.hud-layer :deep(.buff-icon),
.hud-layer :deep(.penalty-icon) {
  pointer-events: auto;
}

/* 车辆姿态容器样式 */
.vehicle-attitude-container {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 10px;
}

/* HUD 编辑模式指示器 - 与操控模式指示器风格统一 */
.hud-edit-indicator {
  position: fixed;
  top: 16px;
  right: 16px;
  z-index: 1000;
  pointer-events: none;
}

.hud-edit-badge {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  background: rgba(59, 130, 246, 0.9);
  color: white;
  font-size: 13px;
  font-weight: 500;
  border-radius: 20px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  white-space: nowrap;
  animation: pulse-glow-blue 2s ease-in-out infinite;
}

.hud-edit-badge svg {
  opacity: 0.9;
  flex-shrink: 0;
}

.hud-edit-badge .hint {
  opacity: 0.7;
  font-size: 11px;
  margin-left: 6px;
  padding-left: 10px;
  border-left: 1px solid rgba(255, 255, 255, 0.3);
}

.hud-edit-badge kbd {
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

@keyframes pulse-glow-blue {
  0%,
  100% {
    box-shadow: 0 4px 12px rgba(59, 130, 246, 0.4);
  }
  50% {
    box-shadow: 0 4px 20px rgba(59, 130, 246, 0.7);
  }
}

.video-stream-area {
  position: absolute;
  inset: 0;
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1;
  background: #000;
  /* GPU 加速优化 */
  transform: translateZ(0);
  will-change: contents;
  contain: strict;
}

.video-stream {
  width: 100%;
  height: 100%;
  object-fit: contain;
  /* GPU 加速渲染 */
  transform-origin: center center;
  will-change: transform;
  backface-visibility: hidden;
  transition: transform 0.15s ease-out;
}

.udp-mjpeg-stream {
  display: block;
  user-select: none;
  pointer-events: none;
}

/* ==================== 视频缩放指示器 ==================== */
.zoom-indicator {
  position: absolute;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  background: rgba(0, 0, 0, 0.7);
  color: white;
  font-size: 13px;
  font-weight: 500;
  border-radius: 20px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  z-index: 10;
  pointer-events: none;
  backdrop-filter: blur(10px);
}

.zoom-indicator svg {
  opacity: 0.9;
  color: #60a5fa;
}

.zoom-value {
  font-family: 'Consolas', 'Monaco', monospace;
  color: #60a5fa;
  font-weight: 600;
}

.zoom-hint {
  opacity: 0.7;
  font-size: 11px;
  margin-left: 6px;
  padding-left: 10px;
  border-left: 1px solid rgba(255, 255, 255, 0.3);
}

.zoom-indicator kbd {
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

/* ==================== 低血量屏幕渐晕效果 ==================== */
.low-health-vignette {
  position: absolute;
  inset: 0;
  z-index: 5;
  pointer-events: none;
  /* 径向渐变：从透明中心到红色边缘 */
  background: radial-gradient(
    ellipse at center,
    transparent 20%,
    rgba(139, 0, 0, calc(var(--vignette-opacity) * 0.4)) 50%,
    rgba(139, 0, 0, calc(var(--vignette-opacity) * 0.8)) 80%,
    rgba(139, 0, 0, var(--vignette-opacity)) 100%
  );
  /* 平滑过渡 */
  transition: opacity 0.5s ease-in-out;
  /* GPU 加速 */
  transform: translateZ(0);
  will-change: opacity;
}

/* 低血量临界状态 (< 25%)：添加脉搏动画 */
.low-health-vignette.critical {
  animation: health-pulse 1.5s ease-in-out infinite;
}

@keyframes health-pulse {
  0%,
  100% {
    opacity: 0.9;
  }
  50% {
    opacity: 1;
  }
}

/* 淡入淡出过渡 */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.5s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

/* UDP Canvas 隐藏样式（用于 captureStream 生成 MediaStream） */
.udp-canvas-hidden {
  position: absolute;
  width: 0;
  height: 0;
  opacity: 0;
  pointer-events: none;
  /* 不影响布局 */
  visibility: hidden;
}

.video-status-overlay {
  position: absolute;
  color: #888;
  font-size: 1.5rem;
  user-select: none;
  background: rgba(0, 0, 0, 0.2);
  padding: 8px 16px;
  border-radius: 8px;
}

.hint {
  position: absolute;
  bottom: 18px;
  left: 50%;
  transform: translateX(-50%);
  color: rgba(255, 255, 255, 0.28);
  font-size: 12px;
  z-index: 50;
}

.hint kbd {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  margin: 0 2px;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 3px;
  font-family: inherit;
  font-size: 11px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.5);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
}

/* 准星样式 */
.crosshair {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 100px;
  height: 100px;
  z-index: 10;
  pointer-events: none;
}

.crosshair-ring {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: 0;
}

.crosshair .ring {
  transform: rotate(90deg) scaleX(-1);
  transform-origin: 40px 40px;
  transition:
    stroke-dashoffset 0.25s cubic-bezier(0.4, 0, 0.2, 1),
    stroke 0.2s;
}

.crosshair-shape {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

/* 准星线条 */
.crosshair .line {
  position: absolute;
  background: var(--crosshair-color);
  opacity: var(--crosshair-opacity);
  box-shadow:
    0 0 calc(var(--crosshair-outline-thickness) * 2px) var(--crosshair-outline),
    inset 0 0 calc(var(--crosshair-outline-thickness) * 2px) var(--crosshair-outline);
}

.crosshair .line-top {
  top: calc(50% - var(--crosshair-gap) - var(--crosshair-size));
  left: 50%;
  width: var(--crosshair-thickness);
  height: var(--crosshair-size);
  transform: translateX(-50%);
}

.crosshair .line-bottom {
  top: calc(50% + var(--crosshair-gap));
  left: 50%;
  width: var(--crosshair-thickness);
  height: var(--crosshair-size);
  transform: translateX(-50%);
}

.crosshair .line-left {
  top: 50%;
  left: calc(50% - var(--crosshair-gap) - var(--crosshair-size));
  width: var(--crosshair-size);
  height: var(--crosshair-thickness);
  transform: translateY(-50%);
}

.crosshair .line-right {
  top: 50%;
  left: calc(50% + var(--crosshair-gap));
  width: var(--crosshair-size);
  height: var(--crosshair-thickness);
  transform: translateY(-50%);
}

/* 中心点 */
.crosshair .center-dot {
  position: absolute;
  top: 50%;
  left: 50%;
  width: var(--center-dot-size);
  height: var(--center-dot-size);
  background: var(--crosshair-color);
  border-radius: 50%;
  transform: translate(-50%, -50%);
  opacity: var(--crosshair-opacity);
  box-shadow: 0 0 calc(var(--crosshair-outline-thickness) * 2px) var(--crosshair-outline);
}

/* 圆形和方形样式 */
.crosshair .shape-circle,
.crosshair .shape-square {
  position: absolute;
  top: 50%;
  left: 50%;
  width: calc(var(--crosshair-size) * 2);
  height: calc(var(--crosshair-size) * 2);
  transform: translate(-50%, -50%);
  border: var(--crosshair-thickness) solid var(--crosshair-color);
  opacity: var(--crosshair-opacity);
  box-sizing: border-box;
  box-shadow:
    0 0 calc(var(--crosshair-outline-thickness) * 2px) var(--crosshair-outline),
    inset 0 0 calc(var(--crosshair-outline-thickness) * 2px) var(--crosshair-outline);
}

.crosshair .shape-circle {
  border-radius: 50%;
}

/* HUD 内部内容样式 */
.small-body {
  font-size: 14px;
  font-weight: 600;
  font-family: var(--font-tech-cn);
  letter-spacing: 0.5px;
}
.status-row {
  display: flex;
  justify-content: space-between;
  padding: 6px 0;
  border-bottom: 1px dashed rgba(255, 255, 255, 0.03);
}
.status-row:last-child {
  border-bottom: none;
}

.status-row.status-detail {
  padding: 4px 0;
  font-size: 12px;
  opacity: 0.85;
}

.status-row.status-detail span:first-child {
  color: rgba(255, 255, 255, 0.5);
  font-family: var(--font-tech-mono);
}

.status-row.status-detail .value {
  font-size: 11px;
  opacity: 0.9;
}

.status-divider {
  height: 1px;
  background: rgba(255, 255, 255, 0.1);
  margin: 8px 0;
}

/* 性能统计文本颜色 */
.text-success {
  color: #4ade80;
  font-weight: 600;
}

.text-info {
  color: #60a5fa;
  font-weight: 600;
}

.text-warning {
  color: #fbbf24;
  font-weight: 600;
}

.text-danger {
  color: #f87171;
  font-weight: 600;
}

/* 注意: 本车状态面板样式已移动到 RobotStateManager.vue 组件中 */

/* Settings Grid specific styles */
.settings-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin-top: 8px;
}
.settings-column {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* 新设置模态框样式 - 磨砂玻璃效果 */
.settings-modal {
  width: 720px !important;
  max-width: 95vw;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  /* 磨砂玻璃效果 - 与 StatusBar/HudPanel 统一 */
  background-color: rgba(25, 28, 38, 0.65);
  backdrop-filter: blur(30px) saturate(1.2);
  -webkit-backdrop-filter: blur(30px) saturate(1.2);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 16px;
  box-shadow:
    inset 0 1px 1px rgba(255, 255, 255, 0.05),
    0 25px 50px -12px rgba(0, 0, 0, 0.5);
  /* GPU 加速优化 */
  transform: translateZ(0);
  contain: layout style;
}

.settings-header {
  padding: 24px 28px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.settings-header h3 {
  margin: 0;
  font-size: 22px;
  font-weight: 700;
  color: #fff;
  letter-spacing: -0.02em;
}

.settings-subtitle {
  margin: 6px 0 0;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.5);
}

/* 标签页导航 */
.tabs-nav {
  display: flex;
  gap: 4px;
  padding: 0 24px;
  background: rgba(0, 0, 0, 0.15);
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.tab-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 18px;
  background: none;
  border: none;
  color: rgba(255, 255, 255, 0.5);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition:
    color 0.2s,
    background 0.2s;
  position: relative;
  border-radius: 8px 8px 0 0;
}

.tab-item svg {
  transition: transform 0.2s;
}

.tab-item:hover {
  color: rgba(255, 255, 255, 0.8);
  background: rgba(255, 255, 255, 0.03);
}

.tab-item.active {
  color: #fff;
  background: linear-gradient(180deg, rgba(59, 130, 246, 0.15) 0%, rgba(59, 130, 246, 0.05) 100%);
}

.tab-item.active::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: linear-gradient(90deg, transparent, #3b82f6, transparent);
}

.tab-item.active svg {
  transform: scale(1.1);
}

/* 标签页内容 */
.tabs-content {
  flex: 1;
  overflow-y: auto;
  padding: 24px 28px;
  min-height: 320px;
  /* 滚动性能优化 */
  overscroll-behavior-y: auto;
  -webkit-overflow-scrolling: touch;
  will-change: scroll-position;
  contain: layout paint;
  /* 滚动行为 */
  scroll-behavior: smooth;
  /* 隐藏滚动条但保持功能 */
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.15) transparent;
}

/* 滚动条样式优化 */
.tabs-content::-webkit-scrollbar {
  width: 6px;
}

.tabs-content::-webkit-scrollbar-track {
  background: transparent;
}

.tabs-content::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.15);
  border-radius: 3px;
}

.tabs-content::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.25);
}

.tab-panel {
  display: flex;
  flex-direction: column;
  gap: 24px;
  /* 渲染优化 */
  contain: content;
}

/* 配置管理分隔线 */
.config-divider {
  height: 1px;
  background: linear-gradient(
    90deg,
    transparent,
    rgba(255, 255, 255, 0.1) 20%,
    rgba(255, 255, 255, 0.1) 80%,
    transparent
  );
  margin: 8px 0;
}

.panel-section {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.hotkey-groups {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.hotkey-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.hotkey-group-title {
  color: rgba(255, 255, 255, 0.48);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0;
}

.hotkey-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 16px;
  width: 100%;
  min-height: 58px;
  padding: 10px 14px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.035);
  color: rgba(255, 255, 255, 0.86);
  cursor: pointer;
  text-align: left;
  transition:
    background 0.18s,
    border-color 0.18s;
}

.hotkey-row:hover,
.hotkey-row.recording {
  border-color: rgba(59, 130, 246, 0.5);
  background: rgba(59, 130, 246, 0.12);
}

.hotkey-meta {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.hotkey-meta strong {
  font-size: 14px;
  font-weight: 700;
  color: #fff;
}

.hotkey-meta small {
  overflow: hidden;
  color: rgba(255, 255, 255, 0.52);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.hotkey-row kbd {
  min-width: 86px;
  padding: 7px 10px;
  border: 1px solid rgba(125, 211, 252, 0.24);
  border-radius: 5px;
  background: rgba(15, 23, 42, 0.56);
  color: #d8f3ff;
  font: 700 12px/1 'JetBrains Mono', 'Consolas', monospace;
  text-align: center;
}

.hotkey-row.recording kbd {
  border-color: rgba(245, 158, 11, 0.55);
  background: rgba(245, 158, 11, 0.14);
  color: #fef3c7;
}

.hotkey-actions {
  display: flex;
  justify-content: flex-end;
}

.section-title {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.85);
  padding-bottom: 10px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.section-title svg {
  opacity: 0.7;
}

/* 视频源卡片选择器: moved to VideoSourceManager component */

/* .source-card style moved to VideoSourceManager component */

/* 操作卡片 */
.action-card {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px 18px;
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 10px;
  cursor: pointer;
  transition:
    background 0.25s,
    border-color 0.25s,
    transform 0.25s;
  will-change: transform;
  width: 100%;
  text-align: left;
  color: inherit;
}

.action-card:hover {
  background: rgba(59, 130, 246, 0.08);
  border-color: rgba(59, 130, 246, 0.3);
  transform: translateX(4px);
}

.action-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  flex-shrink: 0;
  background: rgba(255, 255, 255, 0.04);
  border-radius: 10px;
  transition: background 0.25s;
}

.action-card:hover .action-icon {
  background: rgba(59, 130, 246, 0.15);
}

.action-icon svg {
  opacity: 0.6;
  transition:
    opacity 0.25s,
    stroke 0.25s;
}

.action-card:hover .action-icon svg {
  opacity: 1;
  stroke: #3b82f6;
}

.action-content {
  flex: 1;
}

.action-title {
  font-size: 14px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.9);
  margin-bottom: 4px;
}

.action-desc {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.45);
}

.action-arrow {
  flex-shrink: 0;
  opacity: 0.3;
  transition:
    opacity 0.25s,
    transform 0.25s;
  will-change: transform;
}

.action-card:hover .action-arrow {
  opacity: 0.8;
  transform: translateX(4px);
}

/* 提示文本 */
.hint-text {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  background: rgba(59, 130, 246, 0.08);
  border: 1px solid rgba(59, 130, 246, 0.15);
  border-radius: 8px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.6);
  line-height: 1.5;
}

.hint-text svg {
  flex-shrink: 0;
  opacity: 0.6;
  stroke: #3b82f6;
}

/* 底部栏 */
.settings-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 28px;
  background: rgba(0, 0, 0, 0.3);
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.footer-info {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.5);
}

.footer-info svg {
  opacity: 0.5;
}

.footer-info kbd {
  display: inline-block;
  padding: 2px 6px;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 4px;
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 12px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.8);
}

.footer-actions {
  display: flex;
  gap: 10px;
}

/* modal-button classes are defined in assets/modals.css */

/* HUD 编辑模式按钮 */
.hud-edit-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  transition: all 0.2s;
}

.hud-edit-btn svg {
  width: 14px;
  height: 14px;
  opacity: 0.7;
}

.hud-edit-btn.active {
  background: rgba(59, 130, 246, 0.3);
  border-color: rgba(59, 130, 246, 0.5);
  color: #60a5fa;
}

.hud-edit-btn.active svg {
  opacity: 1;
}

/* 路径输入组 */
/* path-input styles are defined in assets/main.css */

.modal-wide {
  width: 900px !important;
  max-width: 95vw;
}

.form-item {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.form-row-group {
  display: flex;
  gap: 12px;
  width: 100%;
}

.form-item.flex-1 {
  flex: 1;
  min-width: 0;
}

.form-item label {
  color: rgba(255, 255, 255, 0.7);
  font-size: 13px;
  font-weight: 500;
}

.form-item input {
  padding: 10px 14px;
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: #fff;
  border-radius: 8px;
  font-size: 13px;
  transition:
    border-color 0.2s,
    background 0.2s;
}

.form-item input:focus {
  outline: none;
  border-color: rgba(59, 130, 246, 0.5);
  background: rgba(0, 0, 0, 0.35);
}

/* MQTT 地址输入框和按钮组合 */
.input-with-button {
  display: flex;
  gap: 8px;
  align-items: center;
}

.input-with-button input {
  flex: 1;
}

.inline-action-btn {
  padding: 10px 20px;
  background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
  border: none;
  color: #fff;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  white-space: nowrap;
  box-shadow: 0 2px 8px rgba(59, 130, 246, 0.3);
}

.inline-action-btn:hover {
  background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
  box-shadow: 0 4px 12px rgba(59, 130, 246, 0.4);
  transform: translateY(-1px);
}

.inline-action-btn:active {
  transform: translateY(0);
}

.inline-action-btn.disconnect {
  background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%);
  box-shadow: 0 2px 8px rgba(220, 38, 38, 0.3);
}

.inline-action-btn.disconnect:hover {
  background: linear-gradient(135deg, #b91c1c 0%, #991b1b 100%);
  box-shadow: 0 4px 12px rgba(220, 38, 38, 0.4);
}

.input-hint {
  display: block;
  margin-top: 4px;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.4);
  font-style: italic;
}

.input-hint.warning {
  color: #fbbf24;
}

.checkbox-item {
  display: flex;
  align-items: center;
  gap: 10px;
  user-select: none;
}

.checkbox-item label {
  color: var(--ev-c-text-2);
  cursor: pointer;
}

.checkbox-item input {
  cursor: pointer;
}

.radio-group {
  display: flex;
  gap: 16px;
  margin-top: 4px;
}

.radio-item {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  color: var(--ev-c-text-2);
}

.radio-item input[type='radio'] {
  cursor: pointer;
}

.radio-item span {
  font-size: 13px;
}

/* path-input-group, path-input and browse-btn styles are defined in assets/main.css */

/* 滑块组样式 */
.slider-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 16px;
}

.slider-label {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 13px;
  color: var(--ev-c-text-2);
  font-weight: 500;
}

.label-text {
  color: #e5e7eb;
}

.label-value {
  font-family: 'Courier New', monospace;
  color: #60a5fa;
  font-weight: 600;
  font-size: 14px;
}

.slider {
  width: 100%;
  height: 6px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.08);
  outline: none;
  -webkit-appearance: none;
  appearance: none;
  cursor: pointer;
  transition: background 0.2s;
}

.slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: linear-gradient(135deg, #3b82f6, #2563eb);
  cursor: pointer;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
  transition:
    transform 0.2s,
    box-shadow 0.2s;
}

.slider::-webkit-slider-thumb:hover {
  transform: scale(1.2);
  box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.2);
}

.slider::-moz-range-thumb {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: linear-gradient(135deg, #3b82f6, #2563eb);
  cursor: pointer;
  border: none;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
  transition:
    transform 0.2s,
    box-shadow 0.2s;
}

.slider::-moz-range-thumb:hover {
  transform: scale(1.2);
  box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.2);
}

.slider:hover {
  background: rgba(255, 255, 255, 0.12);
}

.slider-hint {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.4);
  font-style: italic;
}

/* 编码类型选择样式 -> 现在使用 main.css 中的 .codec-select */

/* codec-select option moved to assets/main.css */

.codec-hint {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.5);
  margin-top: 6px;
  line-height: 1.4;
}

.codec-warning {
  color: #f3c86a;
}

/* Toggle 开关样式 */
.toggle-option {
  margin-bottom: 12px;
}

.toggle-label {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
}

.toggle-input {
  display: none;
}

.toggle-switch {
  position: relative;
  width: 44px;
  height: 22px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 11px;
  transition: background 0.2s;
}

.toggle-switch::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 18px;
  height: 18px;
  background: rgba(255, 255, 255, 0.7);
  border-radius: 50%;
  transition: transform 0.2s;
}

.toggle-input:checked + .toggle-switch {
  background: rgba(102, 187, 106, 0.6);
}

.toggle-input:checked + .toggle-switch::after {
  transform: translateX(22px);
  background: #66bb6a;
}

.toggle-text {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.85);
}

/* 编码状态显示 */
.encode-status {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
  padding: 8px 12px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 6px;
}

.encode-status .status-label {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.6);
}

.encode-status .status-badge {
  font-size: 11px;
  font-weight: 600;
  padding: 3px 8px;
  border-radius: 4px;
}

.encode-status .status-badge.gpu {
  background: rgba(102, 187, 106, 0.2);
  color: #66bb6a;
}

.encode-status .status-badge.cpu {
  background: rgba(255, 193, 7, 0.2);
  color: #ffc107;
}

.encode-status .status-badge.pipe {
  background: rgba(33, 150, 243, 0.2);
  color: #2196f3;
}

/* 性能预设按钮 */
.preset-buttons {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
}

.preset-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 10px 8px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.05);
  cursor: pointer;
  transition:
    background 0.2s,
    border-color 0.2s;
}

.preset-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.25);
}

.preset-btn.active {
  background: rgba(102, 187, 106, 0.15);
  border-color: rgba(102, 187, 106, 0.5);
}

.preset-name {
  font-size: 13px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.9);
}

.preset-btn.active .preset-name {
  color: #66bb6a;
}

.preset-fps {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.5);
  margin-top: 2px;
}

.preset-btn.active .preset-fps {
  color: rgba(102, 187, 106, 0.8);
}

/* browse-btn:active moved to assets/main.css */

/* 外置检测服务和编码配置样式已迁移到 ConfigPanels.vue */

/* WebRTC 分发状态样式 */
.webrtc-distribute-status {
  margin-top: 12px;
  padding: 12px;
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 8px;
}

.signaling-address {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 10px 0;
  padding: 8px 12px;
  background: rgba(96, 165, 250, 0.1);
  border-radius: 6px;
}

.address-label {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.6);
}

.address-value {
  flex: 1;
  font-size: 13px;
  font-family: 'SF Mono', 'Monaco', 'Consolas', monospace;
  color: #60a5fa;
  background: transparent;
  border: none;
  word-break: break-all;
}

.copy-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 6px;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 4px;
  color: rgba(255, 255, 255, 0.7);
  cursor: pointer;
  transition:
    background 0.2s,
    color 0.2s;
}

.copy-btn:hover {
  background: rgba(255, 255, 255, 0.15);
  color: #fff;
}

.connected-clients {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 8px;
}

.clients-label {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.6);
}

.clients-count {
  font-size: 14px;
  font-weight: 600;
  color: #34d399;
  padding: 2px 10px;
  background: rgba(52, 211, 153, 0.15);
  border-radius: 12px;
}

/* UDP 图传设置样式 */
.form-grid-2col {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-bottom: 16px;
}

.udp-status-section {
  margin-top: 16px;
  padding: 12px 16px;
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 10px;
}

.status-row-inline {
  display: flex;
  align-items: center;
  gap: 10px;
}

.status-row-inline .status-label {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.6);
}

.udp-status {
  font-size: 12px;
  font-weight: 600;
  padding: 4px 12px;
  border-radius: 6px;
}

.udp-status.connected {
  background: rgba(34, 197, 94, 0.2);
  color: #4ade80;
}

.udp-status.connecting {
  background: rgba(251, 191, 36, 0.2);
  color: #fbbf24;
  animation: pulse 1.5s infinite;
}

.udp-status.disconnected {
  background: rgba(156, 163, 175, 0.2);
  color: #9ca3af;
}

.udp-status.error {
  background: rgba(239, 68, 68, 0.2);
  color: #f87171;
}

.udp-stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(72px, 1fr));
  gap: 12px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px dashed rgba(255, 255, 255, 0.08);
}

.stat-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.stat-label {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.45);
}

.stat-value {
  font-size: 14px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.9);
  font-family: 'Consolas', 'Monaco', monospace;
}

.udp-control-buttons {
  display: flex;
  gap: 10px;
  margin-top: 16px;
}

.udp-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 10px 16px;
  border: none;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition:
    background 0.2s,
    border-color 0.2s,
    transform 0.2s;
  will-change: transform;
}

.udp-btn.start {
  background: linear-gradient(135deg, rgba(34, 197, 94, 0.2), rgba(22, 163, 74, 0.3));
  color: #4ade80;
  border: 1px solid rgba(34, 197, 94, 0.3);
}

.udp-btn.start:hover:not(:disabled) {
  background: linear-gradient(135deg, rgba(34, 197, 94, 0.3), rgba(22, 163, 74, 0.4));
  border-color: rgba(34, 197, 94, 0.5);
  transform: translateY(-1px);
}

.udp-btn.stop {
  background: linear-gradient(135deg, rgba(239, 68, 68, 0.2), rgba(220, 38, 38, 0.3));
  color: #f87171;
  border: 1px solid rgba(239, 68, 68, 0.3);
}

.udp-btn.stop:hover:not(:disabled) {
  background: linear-gradient(135deg, rgba(239, 68, 68, 0.3), rgba(220, 38, 38, 0.4));
  border-color: rgba(239, 68, 68, 0.5);
  transform: translateY(-1px);
}

.udp-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
  transform: none !important;
}

/* MQTT 样式 */
.mqtt-status-section {
  margin-top: 16px;
  padding: 12px 16px;
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 10px;
}

.mqtt-status {
  font-size: 12px;
  font-weight: 600;
  padding: 4px 12px;
  border-radius: 6px;
}

.mqtt-status.connected {
  background: rgba(34, 197, 94, 0.2);
  color: #4ade80;
}

.mqtt-status.connecting {
  background: rgba(251, 191, 36, 0.2);
  color: #fbbf24;
  animation: pulse 1.5s infinite;
}

.mqtt-status.disconnected {
  background: rgba(156, 163, 175, 0.2);
  color: #9ca3af;
}

.mqtt-status.error {
  background: rgba(239, 68, 68, 0.2);
  color: #f87171;
}

.mqtt-stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px dashed rgba(255, 255, 255, 0.08);
}

.mqtt-control-buttons {
  display: flex;
  gap: 10px;
  margin-top: 16px;
}

.mqtt-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 10px 16px;
  border: none;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition:
    background 0.2s,
    border-color 0.2s,
    transform 0.2s;
  will-change: transform;
}

.mqtt-btn.start {
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.2), rgba(37, 99, 235, 0.3));
  color: #60a5fa;
  border: 1px solid rgba(59, 130, 246, 0.3);
}

.mqtt-btn.start:hover:not(:disabled) {
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.3), rgba(37, 99, 235, 0.4));
  border-color: rgba(59, 130, 246, 0.5);
  transform: translateY(-1px);
}

.mqtt-btn.stop {
  background: linear-gradient(135deg, rgba(239, 68, 68, 0.2), rgba(220, 38, 38, 0.3));
  color: #f87171;
  border: 1px solid rgba(239, 68, 68, 0.3);
}

.mqtt-btn.stop:hover:not(:disabled) {
  background: linear-gradient(135deg, rgba(239, 68, 68, 0.3), rgba(220, 38, 38, 0.4));
  border-color: rgba(239, 68, 68, 0.5);
  transform: translateY(-1px);
}

.mqtt-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
  transform: none !important;
}

.readonly-input {
  background: rgba(0, 0, 0, 0.3) !important;
  color: rgba(255, 255, 255, 0.5) !important;
  cursor: default !important;
}

.checkbox-item {
  margin-top: 8px;
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.8);
}

.checkbox-label input[type='checkbox'] {
  width: 16px;
  height: 16px;
  accent-color: #3b82f6;
  cursor: pointer;
}

/* 本地 Broker 样式 */
.local-broker-section {
  margin-bottom: 16px;
  padding: 12px;
  background: rgba(59, 130, 246, 0.08);
  border: 1px solid rgba(59, 130, 246, 0.2);
  border-radius: 8px;
}

.local-broker-config {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px dashed rgba(255, 255, 255, 0.1);
}

.inline-form {
  display: flex;
  align-items: center;
  gap: 10px;
}

.inline-form label {
  white-space: nowrap;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.7);
}

.port-input {
  width: 100px !important;
  text-align: center;
}

.broker-status-badge {
  font-size: 11px;
  font-weight: 600;
  padding: 3px 10px;
  border-radius: 4px;
  white-space: nowrap;
}

.broker-status-badge.running {
  background: rgba(34, 197, 94, 0.2);
  color: #4ade80;
}

.broker-status-badge.starting {
  background: rgba(251, 191, 36, 0.2);
  color: #fbbf24;
  animation: pulse 1.5s infinite;
}

.broker-status-badge.stopped {
  background: rgba(156, 163, 175, 0.2);
  color: #9ca3af;
}

.broker-status-badge.error {
  background: rgba(239, 68, 68, 0.2);
  color: #f87171;
}

.local-broker-hint {
  margin-top: 8px;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.45);
  line-height: 1.4;
}

/* 重命名模态框样式 */
.rename-modal {
  width: 360px !important;
  max-width: 90vw;
  padding: 20px !important;
}

.rename-body {
  display: flex;
  flex-direction: column;
  gap: 20px;
  margin-top: 10px;
}

.rename-input {
  width: 100%;
  padding: 10px;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 4px;
  color: #fff;
  font-size: 14px;
  outline: none;
  transition: border-color 0.2s;
}

.rename-input:focus {
  border-color: #3b82f6;
}

.rename-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.btn-secondary {
  padding: 8px 16px;
  background: rgba(255, 255, 255, 0.1);
  border: none;
  border-radius: 4px;
  color: #fff;
  cursor: pointer;
  transition: background 0.2s;
}

.btn-secondary:hover {
  background: rgba(255, 255, 255, 0.2);
}

.btn-primary {
  padding: 8px 16px;
  background: #3b82f6;
  border: none;
  border-radius: 4px;
  color: #fff;
  cursor: pointer;
  transition: background 0.2s;
}

.btn-primary:hover {
  background: #2563eb;
}

/* 底部按键提示 */
.key-hint-footer {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  font-size: 12px;
  color: #64748b;
}

.key-hint-footer kbd {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 4px;
  font-family: inherit;
  font-size: 11px;
  font-weight: 600;
  color: #94a3b8;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
}
</style>
