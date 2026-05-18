/**
 * MQTT 协议解析模块 (主进程版本)
 * 基于 messages.proto V1.0.0 (20251127) 定义
 * 支持 RoboMaster 2026 完整通信协议
 */

// ==================== 2.2.1 RemoteControl ====================

export interface RemoteControl {
  mouseX: number
  mouseY: number
  mouseZ: number
  leftButtonDown: boolean
  rightButtonDown: boolean
  keyboardValue: number
  midButtonDown: boolean
  data: Uint8Array
}

// ==================== 2.2.2 GameStatus ====================

export enum CurrentStage {
  NOT_STARTED = 0,
  PREPARATION = 1,
  SELF_CHECK = 2,
  COUNTDOWN_5S = 3,
  FIGHTING = 4,
  SETTLEMENT = 5
}

export interface GameStatus {
  currentRound: number
  totalRounds: number
  redScore: number
  blueScore: number
  currentStage: CurrentStage
  stageCountdownSec: number
  stageElapsedSec: number
  isPaused: boolean
}

// ==================== 2.2.3 GlobalUnitStatus ====================

export enum BaseStatus {
  INVINCIBLE = 0,
  VULNERABLE_ARMOR_CLOSED = 1,
  VULNERABLE_ARMOR_OPEN = 2
}

export enum OutpostStatus {
  INVINCIBLE = 0,
  ALIVE_ROTATING = 1,
  ALIVE_STOPPED = 2,
  DESTROYED_NO_REBUILD = 3,
  DESTROYED_CAN_REBUILD = 4
}

export interface GlobalUnitStatus {
  baseHealth: number
  baseStatus: BaseStatus
  baseShield: number
  outpostHealth: number
  outpostStatus: OutpostStatus
  robotHealth: number[] // 所有机器人血量 (先己方后对方)
  robotBullets: number[] // 己方机器人剩余累计发弹量
  totalDamageRed: number
  totalDamageBlue: number
}

// ==================== 2.2.4 GlobalLogisticsStatus ====================

export interface GlobalLogisticsStatus {
  remainingEconomy: number
  totalEconomyObtained: bigint
  techLevel: number
  encryptionLevel: number
}

// ==================== 2.2.5 GlobalSpecialMechanism ====================

export enum MechanismId {
  OWN_FORTRESS_OCCUPIED = 1,
  ENEMY_FORTRESS_OCCUPIED = 2
}

export interface GlobalSpecialMechanism {
  mechanismId: number[]
  mechanismTimeSec: number[]
}

// ==================== 2.2.6 Event ====================

export enum EventId {
  KILL = 1,
  BASE_OUTPOST_DESTROYED = 2,
  RUNE_ACTIVATION_COUNT_CHANGE = 3,
  RUNE_UNIT_READY = 4,
  RUNE_ARMS_STATS = 5,
  RUNE_ACTIVATED = 6,
  OWN_HERO_DEPLOY = 7,
  OWN_HERO_SNIPE_DAMAGE = 8,
  ENEMY_HERO_SNIPE_DAMAGE = 9,
  OWN_AIR_SUPPORT_CALL = 10,
  OWN_AIR_SUPPORT_INTERRUPTED = 11,
  ENEMY_AIR_SUPPORT_CALL = 12,
  ENEMY_AIR_SUPPORT_INTERRUPTED = 13,
  DART_HIT = 14,
  DART_GATE_OPEN = 15,
  OWN_BASE_ATTACKED = 16,
  OUTPOST_STOP_ROTATING = 17,
  BASE_ARMOR_DEPLOY = 18
}

export interface Event {
  eventId: EventId
  param: string
}

// ==================== 2.2.7 RobotInjuryStat ====================

export interface RobotInjuryStat {
  totalDamage: number
  collisionDamage: number
  smallProjectileDamage: number
  largeProjectileDamage: number
  dartSplashDamage: number
  moduleOfflineDamage: number
  wifiOfflineDamage: number
  penaltyDamage: number
  serverKillDamage: number
  killerId: number
}

// ==================== 2.2.8 RobotRespawnStatus ====================

export interface RobotRespawnStatus {
  isPendingRespawn: boolean
  totalRespawnProgress: number
  currentRespawnProgress: number
  canFreeRespawn: boolean
  goldCostForRespawn: number
  canPayForRespawn: boolean
}

// ==================== 2.2.9 RobotStaticStatus ====================

export enum PerformanceSystemShooter {
  COOLING_PRIORITY = 1,
  BURST_PRIORITY = 2,
  HERO_MELEE_PRIORITY = 3,
  HERO_RANGED_PRIORITY = 4
}

export enum PerformanceSystemChassis {
  HEALTH_PRIORITY = 1,
  POWER_PRIORITY = 2,
  HERO_MELEE_PRIORITY = 3,
  HERO_RANGED_PRIORITY = 4
}

export interface RobotStaticStatus {
  connectionState: number // 0=未连接, 1=已连接
  fieldState: number // 0=已上场, 1=未上场
  aliveState: number // 0=未知, 1=存活, 2=战亡
  robotId: number
  robotType: number
  performanceSystemShooter: PerformanceSystemShooter
  performanceSystemChassis: PerformanceSystemChassis
  level: number
  maxHealth: number
  maxHeat: number
  heatCooldownRate: number
  maxPower: number
  maxBufferEnergy: number
  maxChassisEnergy: number
}

// ==================== 2.2.10 RobotDynamicStatus ====================

export interface RobotDynamicStatus {
  currentHealth: number
  currentHeat: number
  lastProjectileFireRate: number
  currentChassisEnergy: number
  currentBufferEnergy: number
  currentExperience: number
  experienceForUpgrade: number
  totalProjectilesFired: number
  remainingAmmo: number
  isOutOfCombat: boolean
  outOfCombatCountdown: number
  canRemoteHeal: boolean
  canRemoteAmmo: boolean
}

// ==================== 2.2.11 RobotModuleStatus ====================

export interface RobotModuleStatus {
  powerManager: number // 0=离线, 1=在线
  rfid: number
  lightStrip: number
  smallShooter: number
  bigShooter: number
  uwb: number
  armor: number
  videoTransmission: number
  capacitor: number
  mainController: number
}

// ==================== 2.2.12 RobotPosition ====================

export interface RobotPosition {
  x: number
  y: number
  z: number
  yaw: number
}

// ==================== 2.2.13 Buff ====================

export enum BuffType {
  ATTACK_BOOST = 1,
  DEFENSE_BOOST = 2,
  HEAT_COOLING_BOOST = 3,
  CHASSIS_POWER_BOOST = 4,
  HEALTH_REGEN = 5,
  EXCHANGEABLE_AMMO = 6,
  TERRAIN_CROSSING = 7
}

export interface Buff {
  robotId: number
  buffType: BuffType
  buffLevel: number
  buffMaxTime: number
  buffLeftTime: number
  msgParams: string
}

// ==================== 2.2.14 PenaltyInfo ====================

export enum PenaltyType {
  YELLOW_CARD = 1,
  BOTH_YELLOW_CARDS = 2,
  RED_CARD = 3,
  OVER_POWER = 4,
  OVER_HEAT = 5,
  OVER_FIRE_RATE = 6
}

export interface PenaltyInfo {
  penaltyType: PenaltyType
  penaltyEffectSec: number
  totalPenaltyNum: number
}

// ==================== 2.2.15 RobotPathPlanInfo ====================

export enum SentinelIntention {
  ATTACK = 1,
  DEFENSE = 2,
  MOVE = 3
}

export interface RobotPathPlanInfo {
  intention: SentinelIntention
  startPosX: number
  startPosY: number
  offsetX: number[]
  offsetY: number[]
  senderId: number
}

// ==================== 2.2.16 MapClickInfoNotify ====================

export enum MapClickSendMode {
  SPECIFIC = 0,
  ALL_EXCEPT_SENTINEL = 1,
  ALL_INCLUDING_SENTINEL = 2
}

export enum MapClickMarkType {
  ATTACK = 1,
  DEFENSE = 2,
  WARNING = 3,
  CUSTOM = 4
}

export enum MapClickMode {
  MAP = 1,
  ENEMY_ROBOT = 2
}

export interface MapClickInfoNotify {
  isSendAll: MapClickSendMode
  robotId: Uint8Array // 7字节
  mode: MapClickMode
  enemyId: number
  ascii: number
  type: MapClickMarkType
  screenX: number
  screenY: number
  mapX: number
  mapY: number
}

// ==================== 2.2.17 RaderInfoToClient ====================

export interface RaderInfoToClient {
  targetRobotId: number
  targetPosX: number
  targetPosY: number
  torwardAngle: number
  isHighLight: number // 0=否, 1=是
}

// ==================== 2.2.18 CustomByteBlock ====================

export interface CustomByteBlock {
  data: Uint8Array // 最大 1.2 kbit
}

// ==================== 2.2.19 AssemblyCommand ====================

export enum AssemblyOperation {
  CONFIRM = 1,
  CANCEL = 2
}

export interface AssemblyCommand {
  operation: AssemblyOperation
  difficulty: number
}

// ==================== 2.2.20 TechCoreMotionStateSync ====================

export enum TechCoreStatus {
  NOT_IN_ASSEMBLY = 1,
  CORE_MOVING = 2,
  FIRST_STEP_READY = 3,
  NEXT_STEP_READY = 4,
  ALL_STEPS_COMPLETED = 5,
  CONFIRMED_MOVING = 6
}

export interface TechCoreMotionStateSync {
  maximumDifficultyLevel: number
  status: TechCoreStatus
}

// ==================== 2.2.21 RobotPerformanceSelectionCommand ====================

export interface RobotPerformanceSelectionCommand {
  shooter: PerformanceSystemShooter
  chassis: PerformanceSystemChassis
}

// ==================== 2.2.22 RobotPerformanceSelectionSync ====================

export interface RobotPerformanceSelectionSync {
  shooter: PerformanceSystemShooter
  chassis: PerformanceSystemChassis
}

// ==================== 2.2.23 HeroDeployModeEventCommand ====================

export enum DeployMode {
  EXIT = 0,
  ENTER = 1
}

export interface HeroDeployModeEventCommand {
  mode: DeployMode
}

// ==================== 2.2.24 DeployModeStatusSync ====================

export interface DeployModeStatusSync {
  status: number // 0=未部署, 1=已部署
}

// ==================== 2.2.25 RuneActivateCommand ====================

export interface RuneActivateCommand {
  activate: number // 1=开启
}

// ==================== 2.2.26 RuneStatusSync ====================

export enum RuneStatus {
  NOT_ACTIVATED = 1,
  ACTIVATING = 2,
  ACTIVATED = 3
}

export interface RuneStatusSync {
  runeStatus: RuneStatus
  activatedArms: number
  averageRings: number
}

// ==================== 2.2.27 SentinelStatusSync ====================

export enum SentinelPosture {
  ATTACK = 1,
  DEFENSE = 2,
  MOVE = 3
}

export interface SentinelStatusSync {
  postureId: SentinelPosture
  isWeakened: boolean
}

// ==================== 2.2.28 DartCommand ====================

export enum DartTarget {
  OUTPOST = 1,
  BASE_FIXED = 2,
  BASE_RANDOM_FIXED = 3,
  BASE_RANDOM_MOVING = 4,
  BASE_END_MOVING = 5
}

export interface DartCommand {
  targetId: DartTarget
  open: boolean
}

// ==================== 2.2.29 DartSelectTargetStatusSync ====================

export interface DartSelectTargetStatusSync {
  targetId: DartTarget
  open: boolean
}

// ==================== 2.2.30 GuardCtrlCommand ====================

export enum GuardCommandId {
  INVALID = 0,
  BUFF_POINT_AMMO = 1,
  SUPPLY_STATION_AMMO = 2,
  REMOTE_AMMO = 3,
  REMOTE_HEAL = 4,
  CONFIRM_RESPAWN = 5,
  PAY_FOR_RESPAWN = 6,
  MAP_MARK = 7,
  SWITCH_TO_ATTACK = 8,
  SWITCH_TO_DEFENSE = 9,
  SWITCH_TO_MOVE = 10
}

export interface GuardCtrlCommand {
  commandId: GuardCommandId
}

// ==================== 2.2.31 GuardCtrlResult ====================

export enum GuardResultCode {
  SUCCESS = 0,
  FAILED = 1
}

export interface GuardCtrlResult {
  commandId: GuardCommandId
  resultCode: GuardResultCode
}

// ==================== 2.2.32 AirSupportCommand ====================

export enum AirSupportCommandId {
  FREE_CALL = 1,
  PAID_CALL = 2,
  INTERRUPT = 3
}

export interface AirSupportCommand {
  commandId: AirSupportCommandId
}

// ==================== 2.2.33 AirSupportStatusSync ====================

export enum AirSupportStatus {
  NOT_IN_PROGRESS = 0,
  IN_PROGRESS = 1,
  LOCKED_BY_ENEMY = 2
}

export interface AirSupportStatusSync {
  airsupportStatus: AirSupportStatus
  leftTime: number
  costCoins: number
}

// ==================== 消息类型枚举 ====================

export type MessageType =
  | 'remote_control'
  | 'game_status'
  | 'global_unit_status'
  | 'global_logistics_status'
  | 'global_special_mechanism'
  | 'event'
  | 'robot_injury_stat'
  | 'robot_respawn_status'
  | 'robot_static_status'
  | 'robot_dynamic_status'
  | 'robot_module_status'
  | 'robot_position'
  | 'buff'
  | 'penalty_info'
  | 'robot_path_plan_info'
  | 'map_click_info_notify'
  | 'rader_info_to_client'
  | 'custom_byte_block'
  | 'assembly_command'
  | 'tech_core_motion_state_sync'
  | 'robot_performance_selection_command'
  | 'robot_performance_selection_sync'
  | 'hero_deploy_mode_event_command'
  | 'deploy_mode_status_sync'
  | 'rune_activate_command'
  | 'rune_status_sync'
  | 'sentinel_status_sync'
  | 'dart_command'
  | 'dart_select_target_status_sync'
  | 'guard_ctrl_command'
  | 'guard_ctrl_result'
  | 'air_support_command'
  | 'air_support_status_sync'
  | 'common_command'
  // 向后兼容的旧类型
  | 'robot_status' // @deprecated 使用 robot_dynamic_status + robot_static_status + robot_position
  | 'detection_list' // @deprecated 检测功能将使用独立协议
  | 'radar_data' // @deprecated 使用 game_status + global_unit_status 组合
  | 'control_command' // @deprecated 使用具体的命令类型
  | 'heartbeat' // @deprecated 使用应用层心跳
  | 'unknown'

// ==================== 联合类型 ====================

export type AnyMessage =
  | RemoteControl
  | GameStatus
  | GlobalUnitStatus
  | GlobalLogisticsStatus
  | GlobalSpecialMechanism
  | Event
  | RobotInjuryStat
  | RobotRespawnStatus
  | RobotStaticStatus
  | RobotDynamicStatus
  | RobotModuleStatus
  | RobotPosition
  | Buff
  | PenaltyInfo
  | RobotPathPlanInfo
  | MapClickInfoNotify
  | RaderInfoToClient
  | CustomByteBlock
  | AssemblyCommand
  | TechCoreMotionStateSync
  | RobotPerformanceSelectionCommand
  | RobotPerformanceSelectionSync
  | HeroDeployModeEventCommand
  | DeployModeStatusSync
  | RuneActivateCommand
  | RuneStatusSync
  | SentinelStatusSync
  | DartCommand
  | DartSelectTargetStatusSync
  | GuardCtrlCommand
  | GuardCtrlResult
  | AirSupportCommand
  | AirSupportStatusSync

// ==================== 解析后的消息接口 ====================

export interface ParsedMqttMessage {
  topic: string
  messageType: MessageType
  data: AnyMessage | null
  raw: string
  timestamp: number
  parseSuccess: boolean
}

// ==================== Topic 到消息类型映射 ====================

/**
 * PascalCase proto 消息名 → 内部 MessageType 小写标识符 映射表。
 * 发布端约定 topic 名就是消息名（如 `GameStatus`），因此直接查表。
 * 同时保留若干 snake_case 路径做后向兼容。
 */
const PASCAL_TO_MESSAGE_TYPE: Record<string, MessageType> = {
  // 上行
  KeyboardMouseControl: 'remote_control',
  CustomControl: 'custom_byte_block',
  RemoteControl: 'remote_control',
  MapClickInfo: 'map_click_info_notify',
  MapClickInfoNotify: 'map_click_info_notify',
  AssemblyCommand: 'assembly_command',
  RobotPerformanceSelectionCommand: 'robot_performance_selection_command',
  HeroDeployModeEventCommand: 'hero_deploy_mode_event_command',
  RuneActivateCommand: 'rune_activate_command',
  DartCommand: 'dart_command',
  SentryCtrlCommand: 'guard_ctrl_command',
  GuardCtrlCommand: 'guard_ctrl_command',
  AirSupportCommand: 'air_support_command',
  CommonCommand: 'common_command',

  // 下行
  GameStatus: 'game_status',
  GlobalUnitStatus: 'global_unit_status',
  GlobalLogisticsStatus: 'global_logistics_status',
  GlobalSpecialMechanism: 'global_special_mechanism',
  Event: 'event',
  RobotInjuryStat: 'robot_injury_stat',
  RobotRespawnStatus: 'robot_respawn_status',
  RobotStaticStatus: 'robot_static_status',
  RobotDynamicStatus: 'robot_dynamic_status',
  RobotModuleStatus: 'robot_module_status',
  RobotPosition: 'robot_position',
  Buff: 'buff',
  PenaltyInfo: 'penalty_info',
  RobotPathPlanInfo: 'robot_path_plan_info',
  RadarInfoToClient: 'rader_info_to_client',
  RaderInfoToClient: 'rader_info_to_client',
  CustomByteBlock: 'custom_byte_block',
  TechCoreMotionStateSync: 'tech_core_motion_state_sync',
  RobotPerformanceSelectionSync: 'robot_performance_selection_sync',
  DeployModeStatusSync: 'deploy_mode_status_sync',
  RuneStatusSync: 'rune_status_sync',
  SentryStatusSync: 'sentinel_status_sync',
  SentinelStatusSync: 'sentinel_status_sync',
  DartSelectTargetStatusSync: 'dart_select_target_status_sync',
  SentryCtrlResult: 'guard_ctrl_result',
  GuardCtrlResult: 'guard_ctrl_result',
  AirSupportStatusSync: 'air_support_status_sync',
}

/**
 * 根据 MQTT topic 推断消息类型。
 *
 * 服务端约定：`topic === proto message name`（例如 `GameStatus`）。
 * 解析策略：
 * 1. 取 topic 最后一段（按 `/` 分割），去除前缀
 * 2. 在 PASCAL_TO_MESSAGE_TYPE 中直接查表
 * 3. 回退：对 snake_case 路径做模糊匹配（向后兼容旧的 `/robot/dynamic` 等）
 */
export function parseTopicType(topic: string): MessageType {
  if (!topic) return 'unknown'

  // 取最后一段，去掉 QoS 等可能尾缀
  const lastSegment = topic.split('/').pop()?.trim() ?? topic
  const direct = PASCAL_TO_MESSAGE_TYPE[lastSegment]
  if (direct) return direct

  // 有些部署会前缀 `rm_client_up.` / `rm_client_down.`，再剥一层
  const dotSegment = lastSegment.split('.').pop()?.trim() ?? lastSegment
  const afterDot = PASCAL_TO_MESSAGE_TYPE[dotSegment]
  if (afterDot) return afterDot

  // ---- 向后兼容：snake_case 路径 ----
  const lowerTopic = topic.toLowerCase()

  if (lowerTopic.includes('remote_control') || lowerTopic.includes('/control/input')) {
    return 'remote_control'
  }
  if (lowerTopic.includes('game_status') || lowerTopic.includes('/game/status')) {
    return 'game_status'
  }
  if (lowerTopic.includes('global_unit') || lowerTopic.includes('/global/unit')) {
    return 'global_unit_status'
  }
  if (lowerTopic.includes('global_logistics') || lowerTopic.includes('/global/logistics')) {
    return 'global_logistics_status'
  }
  if (lowerTopic.includes('global_special') || lowerTopic.includes('/global/mechanism')) {
    return 'global_special_mechanism'
  }
  if (lowerTopic.includes('/event')) {
    return 'event'
  }
  if (lowerTopic.includes('injury_stat') || lowerTopic.includes('/robot/injury')) {
    return 'robot_injury_stat'
  }
  if (lowerTopic.includes('respawn_status') || lowerTopic.includes('/robot/respawn')) {
    return 'robot_respawn_status'
  }
  if (lowerTopic.includes('static_status') || lowerTopic.includes('/robot/static')) {
    return 'robot_static_status'
  }
  if (lowerTopic.includes('dynamic_status') || lowerTopic.includes('/robot/dynamic')) {
    return 'robot_dynamic_status'
  }
  if (lowerTopic.includes('module_status') || lowerTopic.includes('/robot/module')) {
    return 'robot_module_status'
  }
  if (lowerTopic.includes('position') || lowerTopic.includes('/robot/pos')) {
    return 'robot_position'
  }
  if (lowerTopic.includes('/buff')) return 'buff'
  if (lowerTopic.includes('penalty')) return 'penalty_info'
  if (lowerTopic.includes('path_plan') || lowerTopic.includes('/sentinel/path')) {
    return 'robot_path_plan_info'
  }
  if (lowerTopic.includes('map_click') || lowerTopic.includes('/map/mark')) {
    return 'map_click_info_notify'
  }
  if (lowerTopic.includes('rader') || lowerTopic.includes('radar')) {
    return 'rader_info_to_client'
  }
  if (lowerTopic.includes('custom_byte') || lowerTopic.includes('/custom/data')) {
    return 'custom_byte_block'
  }
  if (lowerTopic.includes('assembly')) return 'assembly_command'
  if (lowerTopic.includes('tech_core')) return 'tech_core_motion_state_sync'
  if (lowerTopic.includes('performance')) {
    return lowerTopic.includes('command')
      ? 'robot_performance_selection_command'
      : 'robot_performance_selection_sync'
  }
  if (lowerTopic.includes('deploy')) {
    return lowerTopic.includes('command')
      ? 'hero_deploy_mode_event_command'
      : 'deploy_mode_status_sync'
  }
  if (lowerTopic.includes('rune')) {
    return lowerTopic.includes('command') ? 'rune_activate_command' : 'rune_status_sync'
  }
  if (lowerTopic.includes('sentry') || lowerTopic.includes('sentinel')) {
    if (lowerTopic.includes('command')) return 'guard_ctrl_command'
    if (lowerTopic.includes('result')) return 'guard_ctrl_result'
    return 'sentinel_status_sync'
  }
  if (lowerTopic.includes('guard')) {
    return lowerTopic.includes('result') ? 'guard_ctrl_result' : 'guard_ctrl_command'
  }
  if (lowerTopic.includes('dart')) {
    return lowerTopic.includes('command') ? 'dart_command' : 'dart_select_target_status_sync'
  }
  if (lowerTopic.includes('air')) {
    return lowerTopic.includes('command') ? 'air_support_command' : 'air_support_status_sync'
  }
  if (lowerTopic.includes('common_command')) return 'common_command'

  return 'unknown'
}

// ==================== Protobuf 转换函数 ====================

const warnedUnimplementedMessageTypes = new Set<MessageType>()

/**
 * 从 Protobuf 解码后的对象转换为标准格式
 * @param type 消息类型
 * @param decoded Protobuf 解码后的对象
 * @returns 转换后的消息对象
 */
export function convertProtobufData(type: MessageType, decoded: any): AnyMessage | null {
  try {
    switch (type) {
      case 'game_status':
        return convertGameStatus(decoded)
      case 'global_unit_status':
        return convertGlobalUnitStatus(decoded)
      case 'global_logistics_status':
        return convertGlobalLogisticsStatus(decoded)
      case 'global_special_mechanism':
        return convertGlobalSpecialMechanism(decoded)
      case 'robot_injury_stat':
        return convertRobotInjuryStat(decoded)
      case 'robot_respawn_status':
        return convertRobotRespawnStatus(decoded)
      case 'robot_dynamic_status':
        return convertRobotDynamicStatus(decoded)
      case 'robot_static_status':
        return convertRobotStaticStatus(decoded)
      case 'robot_module_status':
        return convertRobotModuleStatus(decoded)
      case 'robot_position':
        return convertRobotPosition(decoded)
      case 'custom_byte_block':
        // 不进行转换，直接返回 decoded 对象
        return decoded
      case 'event':
        return convertEvent(decoded)
      case 'buff':
        return convertBuff(decoded)
      case 'penalty_info':
        return convertPenaltyInfo(decoded)
      case 'rader_info_to_client':
        return convertRaderInfoToClient(decoded)
      case 'rune_status_sync':
        return convertRuneStatusSync(decoded)
      case 'sentinel_status_sync':
        return convertSentinelStatusSync(decoded)
      case 'air_support_status_sync':
        return convertAirSupportStatusSync(decoded)
      case 'tech_core_motion_state_sync':
        return convertTechCoreMotionStateSync(decoded)
      case 'robot_performance_selection_command':
        return convertRobotPerformanceSelectionCommand(decoded)
      case 'robot_performance_selection_sync':
        return convertRobotPerformanceSelectionSync(decoded)
      case 'hero_deploy_mode_event_command':
        return convertHeroDeployModeEventCommand(decoded)
      case 'deploy_mode_status_sync':
        return convertDeployModeStatusSync(decoded)
      case 'rune_activate_command':
        return convertRuneActivateCommand(decoded)
      case 'dart_command':
        return convertDartCommand(decoded)
      case 'dart_select_target_status_sync':
        return convertDartSelectTargetStatusSync(decoded)
      case 'guard_ctrl_command':
        return convertGuardCtrlCommand(decoded)
      case 'guard_ctrl_result':
        return convertGuardCtrlResult(decoded)
      case 'air_support_command':
        return convertAirSupportCommand(decoded)
      // 其他类型的转换器可以按需添加
      default:
        if (!warnedUnimplementedMessageTypes.has(type)) {
          warnedUnimplementedMessageTypes.add(type)
          console.warn(`[MQTT Protocol] 未实现的消息类型转换: ${type}`)
        }
        return null
    }
  } catch (error) {
    console.error('[MQTT Protocol] 转换 Protobuf 数据失败:', error)
    return null
  }
}

function convertGameStatus(decoded: any): GameStatus {
  return {
    currentRound: Number(decoded.currentRound ?? decoded.current_round ?? 1),
    totalRounds: Number(decoded.totalRounds ?? decoded.total_rounds ?? 3),
    redScore: Number(decoded.redScore ?? decoded.red_score ?? 0),
    blueScore: Number(decoded.blueScore ?? decoded.blue_score ?? 0),
    currentStage: Number(decoded.currentStage ?? decoded.current_stage ?? 0) as CurrentStage,
    stageCountdownSec: Number(decoded.stageCountdownSec ?? decoded.stage_countdown_sec ?? 0),
    stageElapsedSec: Number(decoded.stageElapsedSec ?? decoded.stage_elapsed_sec ?? 0),
    isPaused: Boolean(decoded.isPaused ?? decoded.is_paused ?? false)
  }
}

function convertGlobalLogisticsStatus(decoded: any): GlobalLogisticsStatus {
  return {
    remainingEconomy: Number(decoded.remainingEconomy ?? decoded.remaining_economy ?? 0),
    totalEconomyObtained: BigInt(
      decoded.totalEconomyObtained ?? decoded.total_economy_obtained ?? 0
    ),
    techLevel: Number(decoded.techLevel ?? decoded.tech_level ?? 0),
    encryptionLevel: Number(decoded.encryptionLevel ?? decoded.encryption_level ?? 0)
  }
}

function convertGlobalSpecialMechanism(decoded: any): GlobalSpecialMechanism {
  return {
    mechanismId: Array.isArray(decoded.mechanismId)
      ? decoded.mechanismId.map(Number)
      : Array.isArray(decoded.mechanism_id)
        ? decoded.mechanism_id.map(Number)
        : [],
    mechanismTimeSec: Array.isArray(decoded.mechanismTimeSec)
      ? decoded.mechanismTimeSec.map(Number)
      : Array.isArray(decoded.mechanism_time_sec)
        ? decoded.mechanism_time_sec.map(Number)
        : []
  }
}

function convertGlobalUnitStatus(decoded: any): GlobalUnitStatus {
  return {
    baseHealth: Number(decoded.baseHealth ?? decoded.base_health ?? 0),
    baseStatus: Number(decoded.baseStatus ?? decoded.base_status ?? 0) as BaseStatus,
    baseShield: Number(decoded.baseShield ?? decoded.base_shield ?? 0),
    outpostHealth: Number(decoded.outpostHealth ?? decoded.outpost_health ?? 0),
    outpostStatus: Number(decoded.outpostStatus ?? decoded.outpost_status ?? 0) as OutpostStatus,
    robotHealth: Array.isArray(decoded.robotHealth)
      ? decoded.robotHealth.map(Number)
      : Array.isArray(decoded.robot_health)
        ? decoded.robot_health.map(Number)
        : [],
    robotBullets: Array.isArray(decoded.robotBullets)
      ? decoded.robotBullets.map(Number)
      : Array.isArray(decoded.robot_bullets)
        ? decoded.robot_bullets.map(Number)
        : [],
    totalDamageRed: Number(decoded.totalDamageRed ?? decoded.total_damage_red ?? decoded.totalDamageAlly ?? decoded.total_damage_ally ?? 0),
    totalDamageBlue: Number(decoded.totalDamageBlue ?? decoded.total_damage_blue ?? decoded.totalDamageEnemy ?? decoded.total_damage_enemy ?? 0)
  }
}

function convertRobotInjuryStat(decoded: any): RobotInjuryStat {
  return {
    totalDamage: Number(decoded.totalDamage ?? decoded.total_damage ?? 0),
    collisionDamage: Number(decoded.collisionDamage ?? decoded.collision_damage ?? 0),
    smallProjectileDamage: Number(
      decoded.smallProjectileDamage ?? decoded.small_projectile_damage ?? 0
    ),
    largeProjectileDamage: Number(
      decoded.largeProjectileDamage ?? decoded.large_projectile_damage ?? 0
    ),
    dartSplashDamage: Number(decoded.dartSplashDamage ?? decoded.dart_splash_damage ?? 0),
    moduleOfflineDamage: Number(
      decoded.moduleOfflineDamage ?? decoded.module_offline_damage ?? 0
    ),
    wifiOfflineDamage: Number(decoded.wifiOfflineDamage ?? decoded.wifi_offline_damage ?? decoded.offlineDamage ?? decoded.offline_damage ?? 0),
    penaltyDamage: Number(decoded.penaltyDamage ?? decoded.penalty_damage ?? 0),
    serverKillDamage: Number(decoded.serverKillDamage ?? decoded.server_kill_damage ?? 0),
    killerId: Number(decoded.killerId ?? decoded.killer_id ?? 0)
  }
}

function convertRobotRespawnStatus(decoded: any): RobotRespawnStatus {
  return {
    isPendingRespawn: Boolean(decoded.isPendingRespawn ?? decoded.is_pending_respawn ?? false),
    totalRespawnProgress: Number(
      decoded.totalRespawnProgress ?? decoded.total_respawn_progress ?? 0
    ),
    currentRespawnProgress: Number(
      decoded.currentRespawnProgress ?? decoded.current_respawn_progress ?? 0
    ),
    canFreeRespawn: Boolean(decoded.canFreeRespawn ?? decoded.can_free_respawn ?? false),
    goldCostForRespawn: Number(decoded.goldCostForRespawn ?? decoded.gold_cost_for_respawn ?? 0),
    canPayForRespawn: Boolean(decoded.canPayForRespawn ?? decoded.can_pay_for_respawn ?? false)
  }
}

function convertRobotDynamicStatus(decoded: any): RobotDynamicStatus {
  return {
    currentHealth: Number(decoded.currentHealth ?? decoded.current_health ?? 0),
    currentHeat: Number(decoded.currentHeat ?? decoded.current_heat ?? 0),
    lastProjectileFireRate: Number(
      decoded.lastProjectileFireRate ?? decoded.last_projectile_fire_rate ?? 0
    ),
    currentChassisEnergy: Number(
      decoded.currentChassisEnergy ?? decoded.current_chassis_energy ?? 0
    ),
    currentBufferEnergy: Number(decoded.currentBufferEnergy ?? decoded.current_buffer_energy ?? 0),
    currentExperience: Number(decoded.currentExperience ?? decoded.current_experience ?? 0),
    experienceForUpgrade: Number(
      decoded.experienceForUpgrade ?? decoded.experience_for_upgrade ?? 0
    ),
    totalProjectilesFired: Number(
      decoded.totalProjectilesFired ?? decoded.total_projectiles_fired ?? 0
    ),
    remainingAmmo: Number(decoded.remainingAmmo ?? decoded.remaining_ammo ?? 0),
    isOutOfCombat: Boolean(decoded.isOutOfCombat ?? decoded.is_out_of_combat ?? false),
    outOfCombatCountdown: Number(
      decoded.outOfCombatCountdown ?? decoded.out_of_combat_countdown ?? 0
    ),
    canRemoteHeal: Boolean(decoded.canRemoteHeal ?? decoded.can_remote_heal ?? false),
    canRemoteAmmo: Boolean(decoded.canRemoteAmmo ?? decoded.can_remote_ammo ?? false)
  }
}

function convertRobotStaticStatus(decoded: any): RobotStaticStatus {
  return {
    connectionState: Number(decoded.connectionState ?? decoded.connection_state ?? 0),
    fieldState: Number(decoded.fieldState ?? decoded.field_state ?? 0),
    aliveState: Number(decoded.aliveState ?? decoded.alive_state ?? 0),
    robotId: Number(decoded.robotId ?? decoded.robot_id ?? 0),
    robotType: Number(decoded.robotType ?? decoded.robot_type ?? 0),
    performanceSystemShooter: Number(
      decoded.performanceSystemShooter ?? decoded.performance_system_shooter ?? 0
    ) as PerformanceSystemShooter,
    performanceSystemChassis: Number(
      decoded.performanceSystemChassis ?? decoded.performance_system_chassis ?? 0
    ) as PerformanceSystemChassis,
    level: Number(decoded.level ?? 1),
    maxHealth: Number(decoded.maxHealth ?? decoded.max_health ?? 600),
    maxHeat: Number(decoded.maxHeat ?? decoded.max_heat ?? 240),
    heatCooldownRate: Number(decoded.heatCooldownRate ?? decoded.heat_cooldown_rate ?? 10),
    maxPower: Number(decoded.maxPower ?? decoded.max_power ?? 80),
    maxBufferEnergy: Number(decoded.maxBufferEnergy ?? decoded.max_buffer_energy ?? 60),
    maxChassisEnergy: Number(decoded.maxChassisEnergy ?? decoded.max_chassis_energy ?? 150)
  }
}

function convertRobotModuleStatus(decoded: any): RobotModuleStatus {
  return {
    powerManager: Number(decoded.powerManager ?? decoded.power_manager ?? 0),
    rfid: Number(decoded.rfid ?? 0),
    lightStrip: Number(decoded.lightStrip ?? decoded.light_strip ?? 0),
    smallShooter: Number(decoded.smallShooter ?? decoded.small_shooter ?? 0),
    bigShooter: Number(decoded.bigShooter ?? decoded.big_shooter ?? 0),
    uwb: Number(decoded.uwb ?? 0),
    armor: Number(decoded.armor ?? 0),
    videoTransmission: Number(
      decoded.videoTransmission ?? decoded.video_transmission ?? 0
    ),
    capacitor: Number(decoded.capacitor ?? 0),
    mainController: Number(decoded.mainController ?? decoded.main_controller ?? 0)
  }
}

function convertRobotPosition(decoded: any): RobotPosition {
  return {
    x: Number(decoded.x ?? 0),
    y: Number(decoded.y ?? 0),
    z: Number(decoded.z ?? 0),
    yaw: Number(decoded.yaw ?? 0)
  }
}

function convertEvent(decoded: any): Event {
  return {
    eventId: Number(decoded.eventId ?? decoded.event_id ?? 0) as EventId,
    param: String(decoded.param ?? '')
  }
}

function convertBuff(decoded: any): Buff {
  return {
    robotId: Number(decoded.robotId ?? decoded.robot_id ?? 0),
    buffType: Number(decoded.buffType ?? decoded.buff_type ?? 0) as BuffType,
    buffLevel: Number(decoded.buffLevel ?? decoded.buff_level ?? 0),
    buffMaxTime: Number(decoded.buffMaxTime ?? decoded.buff_max_time ?? 0),
    buffLeftTime: Number(decoded.buffLeftTime ?? decoded.buff_left_time ?? 0),
    msgParams: String(decoded.msgParams ?? decoded.msg_params ?? '')
  }
}

function convertPenaltyInfo(decoded: any): PenaltyInfo {
  return {
    penaltyType: Number(decoded.penaltyType ?? decoded.penalty_type ?? 0) as PenaltyType,
    penaltyEffectSec: Number(decoded.penaltyEffectSec ?? decoded.penalty_effect_sec ?? 0),
    totalPenaltyNum: Number(decoded.totalPenaltyNum ?? decoded.total_penalty_num ?? 0)
  }
}

function convertRaderInfoToClient(decoded: any): RaderInfoToClient {
  // 新 proto：RadarInfoToClient { repeated RadarSingleRobotInfo ... }
  // 每条 RadarSingleRobotInfo { target_pos_x, target_pos_y, is_high_light }
  // 无 target_robot_id / torward_angle —— 这些字段以默认值填充以兼容旧订阅者。
  const singles = decoded.RadarSingleRobotInfo ?? decoded.radarSingleRobotInfo ?? decoded.radar_single_robot_info
  if (Array.isArray(singles) && singles.length > 0) {
    const first = singles[0] ?? {}
    return {
      targetRobotId: Number(first.targetRobotId ?? first.target_robot_id ?? 0),
      targetPosX: Number(first.targetPosX ?? first.target_pos_x ?? 0),
      targetPosY: Number(first.targetPosY ?? first.target_pos_y ?? 0),
      torwardAngle: Number(first.torwardAngle ?? first.torward_angle ?? 0),
      isHighLight: Number(first.isHighLight ?? first.is_high_light ?? 0)
    }
  }
  return {
    targetRobotId: Number(decoded.targetRobotId ?? decoded.target_robot_id ?? 0),
    targetPosX: Number(decoded.targetPosX ?? decoded.target_pos_x ?? 0),
    targetPosY: Number(decoded.targetPosY ?? decoded.target_pos_y ?? 0),
    torwardAngle: Number(decoded.torwardAngle ?? decoded.torward_angle ?? 0),
    isHighLight: Number(decoded.isHighLight ?? decoded.is_high_light ?? 0)
  }
}

function convertTechCoreMotionStateSync(decoded: any): TechCoreMotionStateSync {
  return {
    maximumDifficultyLevel: Number(
      decoded.maximumDifficultyLevel ?? decoded.maximum_difficulty_level ?? 0
    ),
    // The 2026 proto split this into several state fields. Keep the older
    // compact field populated from the first/basic state so existing widgets
    // can consume it without console spam.
    status: Number(decoded.status ?? decoded.basicState ?? decoded.basic_state ?? 0) as TechCoreStatus
  }
}

function convertRobotPerformanceSelectionCommand(decoded: any): RobotPerformanceSelectionCommand {
  return {
    shooter: Number(decoded.shooter ?? 0) as PerformanceSystemShooter,
    chassis: Number(decoded.chassis ?? 0) as PerformanceSystemChassis
  }
}

function convertRobotPerformanceSelectionSync(decoded: any): RobotPerformanceSelectionSync {
  return {
    shooter: Number(decoded.shooter ?? 0) as PerformanceSystemShooter,
    chassis: Number(decoded.chassis ?? 0) as PerformanceSystemChassis
  }
}

function convertHeroDeployModeEventCommand(decoded: any): HeroDeployModeEventCommand {
  return {
    mode: Number(decoded.mode ?? 0) as DeployMode
  }
}

function convertDeployModeStatusSync(decoded: any): DeployModeStatusSync {
  return {
    status: Number(decoded.status ?? 0)
  }
}

function convertRuneActivateCommand(decoded: any): RuneActivateCommand {
  return {
    activate: Number(decoded.activate ?? 0)
  }
}

function convertRuneStatusSync(decoded: any): RuneStatusSync {
  return {
    runeStatus: Number(decoded.runeStatus ?? decoded.rune_status ?? 0) as RuneStatus,
    activatedArms: Number(decoded.activatedArms ?? decoded.activated_arms ?? 0),
    averageRings: Number(decoded.averageRings ?? decoded.average_rings ?? 0)
  }
}

function convertSentinelStatusSync(decoded: any): SentinelStatusSync {
  return {
    postureId: Number(decoded.postureId ?? decoded.posture_id ?? 0) as SentinelPosture,
    isWeakened: Boolean(decoded.isWeakened ?? decoded.is_weakened ?? false)
  }
}

function convertDartCommand(decoded: any): DartCommand {
  return {
    targetId: Number(decoded.targetId ?? decoded.target_id ?? 0) as DartTarget,
    open: Boolean(decoded.open ?? false)
  }
}

function convertDartSelectTargetStatusSync(decoded: any): DartSelectTargetStatusSync {
  return {
    targetId: Number(decoded.targetId ?? decoded.target_id ?? 0) as DartTarget,
    open: Boolean(decoded.open ?? false)
  }
}

function convertGuardCtrlCommand(decoded: any): GuardCtrlCommand {
  return {
    commandId: Number(decoded.commandId ?? decoded.command_id ?? 0) as GuardCommandId
  }
}

function convertGuardCtrlResult(decoded: any): GuardCtrlResult {
  return {
    commandId: Number(decoded.commandId ?? decoded.command_id ?? 0) as GuardCommandId,
    resultCode: Number(decoded.resultCode ?? decoded.result_code ?? 0) as GuardResultCode
  }
}

function convertAirSupportCommand(decoded: any): AirSupportCommand {
  return {
    commandId: Number(decoded.commandId ?? decoded.command_id ?? 0) as AirSupportCommandId
  }
}

function convertAirSupportStatusSync(decoded: any): AirSupportStatusSync {
  return {
    airsupportStatus: Number(
      decoded.airsupportStatus ?? decoded.airsupport_status ?? 0
    ) as AirSupportStatus,
    leftTime: Number(decoded.leftTime ?? decoded.left_time ?? 0),
    costCoins: Number(decoded.costCoins ?? decoded.cost_coins ?? 0)
  }
}

// ==================== 主解析函数 ====================

/**
 * 解析 MQTT 消息（支持 Protobuf）
 * @param topic MQTT topic
 * @param message 消息体 (Buffer)
 * @param protobufDecoder Protobuf 解码函数
 * @returns 解析后的消息对象
 */
export function parseIncomingMessage(
  topic: string,
  message: Buffer,
  protobufDecoder?: (type: string, data: Buffer) => any
): ParsedMqttMessage {
  const messageType = parseTopicType(topic)
  const timestamp = Date.now()

  // 尝试 Protobuf 解码
  if (protobufDecoder) {
    try {
      const decoded = protobufDecoder(messageType, message)
      const data = convertProtobufData(messageType, decoded)

      return {
        topic,
        messageType,
        data,
        raw: message.toString('base64'),
        timestamp,
        parseSuccess: data !== null
      }
    } catch (error) {
      console.error('[MQTT Protocol] Protobuf 解码失败:', error)
    }
  }

  // Protobuf 失败，返回失败结果
  return {
    topic,
    messageType,
    data: null,
    raw: message.toString('base64'),
    timestamp,
    parseSuccess: false
  }
}

// ==================== 辅助函数 ====================

/**
 * 获取比赛阶段名称
 */
export function getCurrentStageName(stage: CurrentStage): string {
  const names: Record<CurrentStage, string> = {
    [CurrentStage.NOT_STARTED]: '未开始',
    [CurrentStage.PREPARATION]: '准备阶段',
    [CurrentStage.SELF_CHECK]: '自检阶段',
    [CurrentStage.COUNTDOWN_5S]: '5秒倒计时',
    [CurrentStage.FIGHTING]: '比赛中',
    [CurrentStage.SETTLEMENT]: '结算中'
  }
  return names[stage] ?? '未知'
}

/**
 * 获取基地状态名称
 */
export function getBaseStatusName(status: BaseStatus): string {
  const names: Record<BaseStatus, string> = {
    [BaseStatus.INVINCIBLE]: '无敌',
    [BaseStatus.VULNERABLE_ARMOR_CLOSED]: '解除无敌（护甲未展开）',
    [BaseStatus.VULNERABLE_ARMOR_OPEN]: '解除无敌（护甲展开）'
  }
  return names[status] ?? '未知'
}

/**
 * 获取前哨站状态名称
 */
export function getOutpostStatusName(status: OutpostStatus): string {
  const names: Record<OutpostStatus, string> = {
    [OutpostStatus.INVINCIBLE]: '无敌',
    [OutpostStatus.ALIVE_ROTATING]: '存活（装甲旋转）',
    [OutpostStatus.ALIVE_STOPPED]: '存活（装甲停转）',
    [OutpostStatus.DESTROYED_NO_REBUILD]: '被击毁（不可重建）',
    [OutpostStatus.DESTROYED_CAN_REBUILD]: '被击毁（可重建）'
  }
  return names[status] ?? '未知'
}

// ==================== 向后兼容层 ====================
// 为旧代码提供兼容接口

/**
 * @deprecated 使用 CurrentStage 替代
 */
export const GameStage = CurrentStage

/**
 * @deprecated 使用 RobotDynamicStatus + RobotStaticStatus + RobotPosition 替代
 */
export interface RobotStatus {
  robotId: number
  team: 'red' | 'blue'
  hp: number
  maxHp: number
  x: number
  y: number
  yaw: number
  isAlive: boolean
  timestamp: number
}

/**
 * @deprecated 目标检测相关功能将使用独立协议
 */
export interface Detection {
  x1: number
  y1: number
  x2: number
  y2: number
  classId: number
  className: string
  confidence: number
  team: 'red' | 'blue' | 'neutral'
}

/**
 * @deprecated 使用独立检测协议
 */
export interface DetectionList {
  detections: Detection[]
  frameId: number
  timestamp: number
  inferenceTime: number
}

/**
 * @deprecated 使用 GameStatus + GlobalUnitStatus + RobotDynamicStatus 组合替代
 */
export interface RadarData {
  robots: RobotStatus[]
  timestamp: number
  gameStage: CurrentStage
  remainingTime: number
}

/**
 * @deprecated 使用各种具体指令类型替代
 */
export interface ControlCommand {
  commandType: 'move' | 'attack' | 'mark' | 'unmark' | 'custom'
  targetRobotId: number
  param1: number
  param2: number
  extra: string
}

/**
 * @deprecated 心跳应使用应用层协议
 */
export interface Heartbeat {
  clientId: string
  timestamp: number
  version: string
}

/**
 * 创建默认雷达数据
 * @deprecated 使用新的消息类型
 */
export function createDefaultRadarData(): RadarData {
  return {
    robots: [],
    timestamp: Date.now(),
    gameStage: CurrentStage.NOT_STARTED,
    remainingTime: 0
  }
}

/**
 * 获取比赛阶段名称
 * @deprecated 使用 getCurrentStageName 替代
 */
export function getGameStageName(stage: CurrentStage): string {
  return getCurrentStageName(stage)
}

/**
 * 获取机器人类型名称
 * @deprecated 应根据 RobotStaticStatus.robotType 查询
 */
export function getRobotTypeName(robotId: number): string {
  const types: Record<number, string> = {
    1: '英雄',
    2: '工程',
    3: '步兵',
    4: '步兵',
    5: '步兵',
    6: '哨兵',
    7: '空中'
  }
  return types[robotId] ?? '未知'
}

/**
 * 解析 MQTT 消息（兼容旧接口）
 * @deprecated 使用 parseIncomingMessage 替代
 */
export function parseMqttMessage(
  topic: string,
  payload: string | object
): { type: MessageType; data: any } {
  const messageType = parseTopicType(topic)

  // 简单的 JSON 解析（旧接口）
  let data: any = null
  try {
    if (typeof payload === 'string') {
      data = JSON.parse(payload)
    } else {
      data = payload
    }
  } catch (error) {
    console.error('[MQTT Protocol] JSON 解析失败:', error)
  }

  return { type: messageType, data }
}

/**
 * 编码控制命令
 * @deprecated 使用具体的命令类型
 */
export function encodeControlCommand(command: ControlCommand): Record<string, unknown> {
  return command as unknown as Record<string, unknown>
}

/**
 * 编码心跳消息
 * @deprecated 使用应用层心跳
 */
export function encodeHeartbeat(heartbeat: Heartbeat): Record<string, unknown> {
  return heartbeat as unknown as Record<string, unknown>
}
