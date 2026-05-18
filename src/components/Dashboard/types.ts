/**
 * Dashboard 组件类型定义
 * 包含视频源、通信模式、检测状态等核心类型
 */

// ==================== 基础类型定义 ====================

/**
 * 视频源类型
 */
export type VideoSource = 'camera' | 'file' | 'udp'

/**
 * 标签页类型
 */
export type TabType = 'video' | 'network' | 'robot' | 'display' | 'hotkeys'

/**
 * 队伍类型
 */
export type TeamType = 'red' | 'blue' | null

/**
 * UDP 编码类型
 */
export type UdpCodecType = 'mjpeg' | 'h264' | 'h265' | 'auto'

/**
 * 性能预设类型
 */
export type PerformancePreset = 'quality' | 'balanced' | 'performance' | 'ultra'

/**
 * Pipe 服务器状态
 */
export type PipeServerStatus = 'stopped' | 'starting' | 'running' | 'error'

/**
 * 比赛状态类型
 */
export type MatchStatus = 'waiting' | 'technical_pause' | 'paused' | 'running'

/**
 * 比分接口
 */
export interface Score {
  red: number
  blue: number
}

/**
 * 机器人状态接口 (StatusBar 用)
 */
export interface RobotStatusFlags {
  aimAssist: boolean
  gyro: boolean
  deployed: boolean
  noAmmo: boolean
  overcharge: number
  bufferEnergy: number
  actualEnergy: number
  maxBufferEnergy: number
  maxActualEnergy: number
  hasCapacitor: boolean
}

// ==================== 配置接口定义 ====================

/**
 * UDP 配置接口
 */
export interface UdpConfig {
  host: string
  sourceHost?: string
  port: number
  bufferSize: number
  codec: UdpCodecType
}

/**
 * UDP 统计信息接口
 */
export interface UdpStats {
  receivedFrames: number
  fps: number
  bitrate: number
  lastFrameTime: number
  totalBytes?: number
  droppedFrames?: number
  droppedOldFrames?: number
  errors?: number
  decodeQueueDepth?: number
  decoderWaitingKeyframe?: boolean
  decoderBackend?: string
  decodedWidth?: number
  decodedHeight?: number
  outputWidth?: number
  outputHeight?: number
}

/**
 * MQTT 配置接口
 */
export interface MqttConfig {
  brokerUrl: string
  port: number
  clientId: string
  username: string
  password: string
  topics: string[]
}

/**
 * MQTT 消息接口
 */
export interface MqttMessage {
  topic: string
  messageType: string
  data: object | string
  timestamp: number
}

/**
 * MQTT 统计信息接口
 */
export interface MqttStats {
  messagesSent: number
  messagesReceived: number
  lastMessageTime: number
}

/**
 * 检测配置接口
 */
export interface DetectionConfig {
  armorConf: number
  carConf: number
  iouThreshold: number
  maxSize: number
  roiExpand: number
  showBoxes: boolean
}

/**
 * 编码配置接口
 */
export interface EncodeConfig {
  quality: number
  maxSize: number
  enableDownsample: boolean
}

/**
 * 检测统计信息接口
 */
export interface DetectionStats {
  processingTime: number
  inferenceTime: number
  currentFPS: number
  totalLatency: number
  captureTime: number
  encodeTime: number
  networkTime: number
  renderTime: number
  lastUpdateTime: number
}

/**
 * 视频尺寸接口
 */
export interface VideoSize {
  width: number
  height: number
}

/**
 * 功率状态接口
 */
export interface PowerStatus {
  mode: 'normal' | 'boost'
  vehiclePower: number
  chargingPower: number
  boostPower: number
  totalPower: number
  maxPower: number
  capacitorPercent: number
}

/**
 * 性能预设配置接口
 */
export interface PerformancePresetConfig {
  encode: {
    quality: number
    maxSize: number
    enableDownsample: boolean
  }
  detect: {
    armorConf: number
    carConf: number
    maxSize: number
  }
  desc: string
}

/**
 * 编码选项接口
 */
export interface CodecOption {
  value: string
  label: string
}

// ==================== 全局配置接口 ====================

/**
 * 全局配置接口
 * 统一管理 Dashboard 中的所有配置状态
 */
export interface GlobalConfig {
  /** 编码配置 */
  encode: EncodeConfig
  /** 检测配置 */
  detection: DetectionConfig
  /** UDP 图传配置 */
  udp: UdpConfig
  /** MQTT 通信配置 */
  mqtt: MqttConfig
  /** 性能预设 */
  performancePreset: PerformancePreset
  /** 编码方式 */
  encodingMethod: 'gpu' | 'cpu'
  /** GPU 支持状态 */
  gpuSupported: boolean
}

/**
 * 全局状态接口
 * 统一管理 Dashboard 中的所有运行时状态
 */
export interface GlobalState {
  /** 视频源类型 */
  videoSource: VideoSource
  /** 视频是否已连接 */
  videoConnected: boolean
  /** 检测是否启用 */
  detectionEnabled: boolean
  /** Pipe 服务器状态 */
  pipeServerStatus: PipeServerStatus
  /** UDP 流状态 */
  udpStreamStatus: 'disconnected' | 'connecting' | 'connected' | 'error'
  /** MQTT 连接状态 */
  mqttStatus: 'disconnected' | 'connecting' | 'connected' | 'error'
}

// ==================== 外部导入类型 ====================

/**
 * 重新导出 DetectionOverlay 的 Detection 类型
 */
export type { Detection } from '@/utils/mqtt_protocol'

/**
 * 重新导出 CrosshairSettings 的 CrosshairConfig 类型
 */
export type { CrosshairConfig } from '@/components/CrosshairSettings.vue'

/**
 * 重新导出 CustomSelect 的 SelectOption 类型
 */
export type { SelectOption } from '@/components/CustomSelect.vue'
