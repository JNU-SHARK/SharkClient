/**
 * Dashboard 组件常量定义
 * 包含检测URL、视频约束、性能预设等配置常量
 */

// ==================== 网络配置常量 ====================

/**
 * 检测 WebSocket URL
 */
export const DETECTION_WS_URL = 'ws://127.0.0.1:8000/ws/detect'

/**
 * 默认 IP 地址
 */
export const DEFAULT_IP_ADDRESS = '192.168.1.10'

/**
 * 默认串口配置
 */
export const DEFAULT_SERIAL_PORT = 'COM3'

// ==================== 视频配置常量 ====================

/**
 * 视频约束配置
 */
export const VIDEO_CONSTRAINTS = {
  width: { ideal: 1280 },
  height: { ideal: 720 }
} as const

/**
 * 默认视频文件路径
 */
export const DEFAULT_VIDEO_FILE_PATH = 'e:\\download\\QQ20251121-132437.mp4'

// ==================== 热量模拟常量 ====================

/**
 * 枪口热量最大值
 */
export const MAX_MUZZLE_HEAT = 100

/**
 * 环形半径
 */
export const RING_RADIUS = 36

/**
 * 热量模拟间隔 (毫秒)
 */
export const HEAT_SIMULATION_INTERVAL = 200

// ==================== UDP 图传配置常量 ====================

/**
 * 默认 UDP 配置
 */
export const DEFAULT_UDP_CONFIG = {
  host: '0.0.0.0',
  sourceHost: '',
  port: 3334,
  bufferSize: 4 * 1024 * 1024,
  codec: 'auto' as const
}

/**
 * UDP 编码类型选项
 */
export const UDP_CODEC_OPTIONS = [
  { value: 'auto', label: '自动检测' },
  { value: 'mjpeg', label: 'MJPEG' },
  { value: 'h264', label: 'H.264（前端解码已移除）', disabled: true },
  { value: 'h265', label: 'H.265 (HEVC，后端解码)' }
] as const

// ==================== MQTT 配置常量 ====================

/**
 * 默认 MQTT 配置
 * 主题名称直接使用 Proto 消息名称，无前缀
 */
export const DEFAULT_MQTT_CONFIG = {
  brokerUrl: 'mqtt://192.168.12.1:3333',
  port: 3333,
  clientId: '',
  username: '',
  password: '',
  topics: [
    // 下行消息 (服务器 -> 客户端)
    'GameStatus',
    'GlobalUnitStatus',
    'GlobalLogisticsStatus',
    'GlobalSpecialMechanism',
    'Event',
    'RobotInjuryStat',
    'RobotRespawnStatus',
    'RobotStaticStatus',
    'RobotDynamicStatus',
    'RobotModuleStatus',
    'RobotPosition',
    'Buff',
    'PenaltyInfo',
    'RobotPathPlanInfo',
    'RadarInfoToClient',
    'CustomByteBlock',
    'TechCoreMotionStateSync',
    'RobotPerformanceSelectionSync',
    'DeployModeStatusSync',
    'RuneStatusSync',
    'SentryStatusSync',
    'DartSelectTargetStatusSync',
    'SentryCtrlResult',
    'AirSupportStatusSync',
    'MapClickInfoNotify',
    'CommonCommand'
  ]
}

/**
 * 默认本地 MQTT Broker 端口
 */
export const DEFAULT_LOCAL_BROKER_PORT = 1883

/**
 * 最大 MQTT 消息数量
 */
export const MAX_MQTT_MESSAGES = 50

// ==================== 检测配置常量 ====================

/**
 * 默认检测配置
 */
export const DEFAULT_DETECTION_CONFIG = {
  armorConf: 0.3,
  carConf: 0.3,
  iouThreshold: 0.45,
  maxSize: 640,
  roiExpand: 0.15,
  showBoxes: true
}

/**
 * 默认编码配置
 */
export const DEFAULT_ENCODE_CONFIG = {
  quality: 0.5,
  maxSize: 640,
  enableDownsample: true
}

// ==================== 性能预设配置 ====================

/**
 * 性能预设配置映射
 */
export const PERFORMANCE_PRESETS = {
  quality: {
    encode: { quality: 0.8, maxSize: 1280, enableDownsample: true },
    detect: { armorConf: 0.2, carConf: 0.2, maxSize: 1280 },
    desc: '高质量 (~20 FPS)'
  },
  balanced: {
    encode: { quality: 0.6, maxSize: 720, enableDownsample: true },
    detect: { armorConf: 0.25, carConf: 0.25, maxSize: 720 },
    desc: '平衡模式 (~30 FPS)'
  },
  performance: {
    encode: { quality: 0.5, maxSize: 640, enableDownsample: true },
    detect: { armorConf: 0.3, carConf: 0.3, maxSize: 640 },
    desc: '高性能 (~60 FPS)'
  },
  ultra: {
    encode: { quality: 0.4, maxSize: 480, enableDownsample: true },
    detect: { armorConf: 0.35, carConf: 0.35, maxSize: 480 },
    desc: '极速模式 (~100+ FPS)'
  }
} as const

// ==================== 机器人状态常量 ====================

/**
 * 默认机器人血量
 */
export const DEFAULT_ROBOT_HEALTH = 200

/**
 * 默认机器人等级
 */
export const DEFAULT_ROBOT_LEVEL = 1

/**
 * 默认机器人弹药
 */
export const DEFAULT_ROBOT_AMMO = 500

/**
 * 默认机器人功率
 */
export const DEFAULT_ROBOT_POWER = 35

/**
 * 默认超电容量
 */
export const DEFAULT_CAPACITOR_ENERGY = 0

/**
 * 默认最大超电容量
 */
export const DEFAULT_MAX_CAPACITOR_ENERGY = 150

/**
 * 默认缓冲能量
 */
export const DEFAULT_BUFFER_ENERGY = 60

/**
 * 默认最大缓冲能量
 */
export const DEFAULT_MAX_BUFFER_ENERGY = 60

// ==================== 状态模拟常量 ====================

/**
 * 状态模拟间隔 (毫秒)
 */
export const STATUS_SIMULATION_INTERVAL = 200

/**
 * 默认可兑换弹量
 */
export const DEFAULT_EXCHANGEABLE_AMMO = 100

// ==================== UI 常量 ====================

/**
 * 默认视频状态文本
 */
export const DEFAULT_VIDEO_STATUS = '按 P 键打开菜单，选择视频源后连接'

/**
 * 默认摄像头状态
 */
export const DEFAULT_CAMERA_STATUS = '未连接'

// ==================== 虚拟摄像头过滤关键词 ====================

/**
 * 虚拟摄像头过滤关键词
 */
export const VIRTUAL_CAMERA_KEYWORDS = ['virtual', 'obs', 'eshare', 'snap camera'] as const

// ==================== WebRTC 常量 ====================

/**
 * 最大等待视频块数量
 */
export const MAX_PENDING_VIDEO_CHUNKS = 30

/**
 * WebSocket 重连延迟 (毫秒)
 */
export const WEBSOCKET_RECONNECT_DELAY = 3000

// ==================== 检测统计常量 ====================

/**
 * 默认检测统计信息
 */
export const DEFAULT_DETECTION_STATS = {
  processingTime: 0,
  inferenceTime: 0,
  currentFPS: 0,
  totalLatency: 0,
  captureTime: 0,
  encodeTime: 0,
  networkTime: 0,
  renderTime: 0,
  lastUpdateTime: 0
}

// ==================== UDP 统计常量 ====================

/**
 * 默认 UDP 统计信息
 */
export const DEFAULT_UDP_STATS = {
  receivedFrames: 0,
  fps: 0,
  bitrate: 0,
  lastFrameTime: 0,
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

// ==================== MQTT 统计常量 ====================

/**
 * 默认 MQTT 统计信息
 */
export const DEFAULT_MQTT_STATS = {
  messagesSent: 0,
  messagesReceived: 0,
  lastMessageTime: 0
}

// ==================== 比赛状态常量 ====================

/**
 * 默认比赛时长 (秒)
 */
export const DEFAULT_MATCH_DURATION = 10 * 60

/**
 * 默认比分
 */
export const DEFAULT_SCORE = {
  red: 0,
  blue: 0
}

/**
 * 默认机器人状态标志
 */
export const DEFAULT_ROBOT_STATUS_FLAGS = {
  aimAssist: false,
  gyro: false,
  deployed: false,
  noAmmo: false,
  overcharge: 0,
  bufferEnergy: 60,
  actualEnergy: 0,
  maxBufferEnergy: 60,
  maxActualEnergy: 150,
  hasCapacitor: true
}
