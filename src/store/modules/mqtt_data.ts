/**
 * MQTT 数据 Pinia Store
 * 基于 RoboMaster 2026 完整协议 (messages.proto V1.0.0)
 * 管理所有通过 MQTT 接收的比赛数据
 */

import { defineStore } from 'pinia'
import { ref, computed, reactive } from 'vue'
import { showWarning, dismissMessage } from './message_service'
import {
  CurrentStage,
  BaseStatus,
  OutpostStatus,
  EventId,
  BuffType,
  PenaltyType,
  SentinelPosture,
  RuneStatus,
  AirSupportStatus,
  getCurrentStageName,
  getBaseStatusName,
  getOutpostStatusName
} from '../../utils/mqtt_protocol_constants'
import type {
  GameStatus,
  GlobalUnitStatus,
  GlobalLogisticsStatus,
  GlobalSpecialMechanism,
  Event,
  RobotStaticStatus,
  RobotDynamicStatus,
  RobotModuleStatus,
  RobotPosition,
  RobotInjuryStat,
  RobotRespawnStatus,
  Buff,
  PenaltyInfo,
  RaderInfoToClient,
  SentinelStatusSync,
  RuneStatusSync,
  AirSupportStatusSync,
  CustomByteBlock,
  MessageType
} from '../../utils/mqtt_protocol'

// ==================== 常量定义 ====================

/** 最大保留的历史消息数 */
const MAX_MESSAGE_HISTORY = 80

/** 最大保留的事件数 */
const MAX_EVENT_HISTORY = 100

/** 机器人数量（每队） */
const ROBOTS_PER_TEAM = 7

const mqttVerboseLogs =
  import.meta.env.DEV &&
  typeof window !== 'undefined' &&
  window.localStorage?.getItem('shark.mqtt.verbose') === '1'
const mqttHistoryEnabled =
  import.meta.env.DEV &&
  typeof window !== 'undefined' &&
  window.localStorage?.getItem('shark.mqtt.history') === '1'

function mqttDebugLog(...args: unknown[]): void {
  if (mqttVerboseLogs) {
    console.debug(...args)
  }
}

/**
 * 机器人类型名称到 ID 的映射表
 * 初始默认值，会在运行时从配置文件动态加载更新
 */
const ROBOT_TYPE_TO_ID: Record<string, number> = {
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

// ==================== 类型定义 ====================

/**
 * 完整的机器人数据（合并静态+动态+位置+模块）
 */
interface RobotData {
  // 静态属性（由 RobotStaticStatus 消息提供）
  robotId: number
  robotType: number
  team: 'red' | 'blue'
  connectionState: number // 连接状态(0=未连接, 1=连接)
  fieldState: number // 上场状态(0=已上场,1=未上场)
  performanceSystemShooter: number // 性能体系-发射机构
  performanceSystemChassis: number // 性能体系-底盘

  // 动态状态
  currentHealth: number
  maxHealth: number // 由服务器提供
  currentHeat: number
  maxHeat: number // 由服务器提供
  heatCooldownRate: number // 热量冷却速率(每秒) - 由服务器提供
  currentChassisEnergy: number
  maxChassisEnergy: number // 由服务器提供
  currentBufferEnergy: number
  maxBufferEnergy: number // 由服务器提供
  maxPower: number // 最大功率 - 由服务器提供
  remainingAmmo: number
  level: number // 当前等级 - 由服务器提供
  currentExperience: number
  experienceForUpgrade: number // 升级所需经验

  // 位置
  x: number
  y: number
  z: number
  yaw: number

  // 模块状态
  moduleStatus: RobotModuleStatus | null

  // 其他状态
  isAlive: boolean
  isPendingRespawn: boolean
  isOutOfCombat: boolean
  outOfCombatCountdown: number // 脱战倒计时（秒）
  canRemoteHeal: boolean // 是否可以远程补血
  canRemoteAmmo: boolean // 是否可以远程补弹

  // 时间戳
  lastUpdate: number
}

/**
 * 消息历史记录
 */
interface MessageHistoryItem {
  id: number
  topic: string
  type: MessageType
  timestamp: number
  data: unknown
}

/**
 * 连接状态
 */
interface ConnectionStats {
  isConnected: boolean
  totalMessages: number
  messagesPerSecond: number
  lastMessageTime: number
  reconnectCount: number
}

// ==================== Store 定义 ====================

export const useMqttDataStore = defineStore('mqttData', () => {
  // ==================== 比赛状态 ====================

  /** 比赛全局状态 */
  const gameStatus = ref<GameStatus>({
    currentRound: 1,
    totalRounds: 3,
    redScore: 0,
    blueScore: 0,
    currentStage: CurrentStage.NOT_STARTED,
    stageCountdownSec: 0,
    stageElapsedSec: 0,
    isPaused: false
  })

  /** 全局单位状态 */
  const globalUnitStatus = ref<GlobalUnitStatus>({
    baseHealth: 5000,
    baseStatus: BaseStatus.INVINCIBLE,
    baseShield: 0,
    outpostHealth: 1500,
    outpostStatus: OutpostStatus.INVINCIBLE,
    robotHealth: [],
    robotBullets: [],
    totalDamageRed: 0,
    totalDamageBlue: 0
  })

  /** 后勤状态 */
  const logisticsStatus = ref<GlobalLogisticsStatus>({
    remainingEconomy: 0,
    totalEconomyObtained: BigInt(0),
    techLevel: 0,
    encryptionLevel: 0
  })

  /** 特殊机制 */
  const specialMechanisms = ref<GlobalSpecialMechanism>({
    mechanismId: [],
    mechanismTimeSec: []
  })

  // ==================== 机器人数据 ====================

  /** 红队机器人数据 Map (robotId -> RobotData) */
  const redRobots = reactive<Map<number, RobotData>>(new Map())

  /** 蓝队机器人数据 Map (robotId -> RobotData) */
  const blueRobots = reactive<Map<number, RobotData>>(new Map())

  /** 机器人受伤统计 Map (robotId -> RobotInjuryStat) */
  const injuryStats = reactive<Map<number, RobotInjuryStat>>(new Map())

  /** 机器人复活状态 Map (robotId -> RobotRespawnStatus) */
  const respawnStatus = reactive<Map<number, RobotRespawnStatus>>(new Map())

  /** 当前选中的机器人类型名称 */
  const currentRobotType = ref<string>('')
  const serverSelectedRobotId = ref<number>(0)

  /** ID 不匹配警告状态（避免重复弹窗） */
  const idMismatchWarned = ref<boolean>(false)

  /** 当前选中机器人的 ID */
  const currentRobotId = computed(() => {
    if (serverSelectedRobotId.value > 0) return serverSelectedRobotId.value
    if (!currentRobotType.value) return 0
    return ROBOT_TYPE_TO_ID[currentRobotType.value] || 0
  })

  type RobotIdMapping = {
    id?: number
  }

  function findRobotNameById(robotId: number): string | null {
    const match = Object.entries(ROBOT_TYPE_TO_ID).find(([, id]) => id === robotId)
    return match?.[0] ?? null
  }

  /**
   * 从配置文件加载 ID 映射
   * 异步加载，更新 ROBOT_TYPE_TO_ID 映射表
   */
  async function loadRobotIdMappings(): Promise<void> {
    try {
      if (window.api?.getRobotConfig) {
        const config = await window.api.getRobotConfig()
        if (config?.robotMappings) {
          // 更新映射表
          for (const [name, mapping] of Object.entries(
            config.robotMappings as Record<string, RobotIdMapping>
          )) {
            if (mapping.id !== undefined) {
              ROBOT_TYPE_TO_ID[name] = mapping.id
            }
          }
          console.log('[MQTT Store] 已从配置文件加载机器人 ID 映射')
        }
      }
    } catch (error) {
      console.error('[MQTT Store] 加载机器人 ID 映射失败:', error)
    }
  }

  /**
   * 清除所有机器人数据（切换 ID 时调用）
   */
  function clearAllRobotData(): void {
    customDataEpoch += 1
    pendingCustomByteBlocks.clear()
    // 清除红队数据
    redRobots.clear()
    // 清除蓝队数据
    blueRobots.clear()
    // 清除受伤统计
    injuryStats.clear()
    // 清除复活状态
    respawnStatus.clear()
    // 清除自定义数据
    customData.clear()
    // 重置 ID 不匹配警告状态
    idMismatchWarned.value = false

    console.log('[MQTT Store] 已清除所有机器人数据')
  }

  /** ID 不匹配警告消息的 ID（用于关闭弹窗） */
  let idMismatchMessageId: string | null = null

  function dismissIdMismatchWarning(): void {
    if (idMismatchMessageId) {
      dismissMessage(idMismatchMessageId)
      idMismatchMessageId = null
    }
    idMismatchWarned.value = false
  }

  function applyServerRobotName(robotId: number, robotName: string): void {
    if (currentRobotType.value !== robotName) {
      currentRobotType.value = robotName
      void loadRobotProtoConfig(robotName)
    }

    getOrCreateRobot(robotId, getRobotTeam(robotId))
  }

  function selectCurrentRobotFromServerId(serverRobotId: number): void {
    const robotId = Math.trunc(Number(serverRobotId))
    if (!Number.isFinite(robotId) || robotId <= 0) return

    const selectionChanged = serverSelectedRobotId.value !== robotId
    if (selectionChanged) {
      serverSelectedRobotId.value = robotId
      dismissIdMismatchWarning()
    }

    const robotName = findRobotNameById(robotId)
    if (robotName) {
      applyServerRobotName(robotId, robotName)
      if (selectionChanged) {
        console.log(`[MQTT Store] Auto-selected robot from server: ${robotName} (ID: ${robotId})`)
      }
      return
    }

    getOrCreateRobot(robotId, getRobotTeam(robotId))
    if (selectionChanged) {
      console.warn(`[MQTT Store] Server robot ID ${robotId} has no local robot name mapping`)
      void loadRobotIdMappings().then(() => {
        const mappedName = findRobotNameById(robotId)
        if (mappedName && serverSelectedRobotId.value === robotId) {
          applyServerRobotName(robotId, mappedName)
          console.log(
            `[MQTT Store] Auto-selected robot from loaded mapping: ${mappedName} (ID: ${robotId})`
          )
        }
      })
    }
  }

  /**
   * 检测服务器 ID 与本地 ID 是否匹配
   * @param serverRobotId 服务器返回的机器人 ID
   * @returns 是否匹配
   */
  function checkRobotIdMatch(serverRobotId: number): boolean {
    const localId = currentRobotId.value
    if (localId === 0) return true // 本地未选择机器人，不检测

    // 检查服务器 ID 是否与本地选择的 ID 匹配
    if (serverRobotId !== localId) {
      // 仅在未警告过时弹出消息
      if (!idMismatchWarned.value) {
        idMismatchWarned.value = true

        // 使用全局消息服务显示警告
          idMismatchMessageId = showWarning(
            '机器人 ID 不匹配',
            `服务器端和本地机器人配置不匹配，请检查 ID 设置是否正确。\n本地 ID: ${localId}，服务器 ID: ${serverRobotId}`,
            0 // 不自动关闭
          )

        console.warn(
          `[MQTT Store] ⚠️ 机器人 ID 不匹配! 本地 ID: ${localId}, 服务器 ID: ${serverRobotId}`
        )
      }
      return false
    }

    // ID 匹配，如果之前有警告弹窗则关闭它
    if (idMismatchWarned.value && idMismatchMessageId) {
        if (idMismatchMessageId) {
          dismissMessage(idMismatchMessageId)
          idMismatchMessageId = null
        }
      idMismatchWarned.value = false
      console.log('[MQTT Store] ✓ ID 匹配成功，关闭警告弹窗')
    }

    return true
  }

  /**
   * 初始化当前选中机器人的数据槽位
   *
   * MQTT 协议说明：
   * - ID 由用户预先与服务器协商确定
   * - 切换机器人类型时，清除所有旧数据，仅初始化新 ID 的数据槽位
   */
  function initializeCurrentRobot(robotTypeName: string): void {
    const robotId = ROBOT_TYPE_TO_ID[robotTypeName]
    if (!robotId) {
      console.warn(`[MQTT Store] 未知的机器人类型: ${robotTypeName}`)
      return
    }

    const team = robotId < 100 ? 'red' : 'blue'
    const robotMap = team === 'red' ? redRobots : blueRobots

    // 🔑 关键变更：清除所有机器人数据，仅保留当前选中的 ID
    clearAllRobotData()

    // 初始化当前机器人的数据槽位
    robotMap.set(robotId, {
      robotId,
      robotType: 0,
      team,
      // 连接和状态信息（等待服务器同步）
      connectionState: 0,
      fieldState: 1,
      performanceSystemShooter: 0,
      performanceSystemChassis: 0,
      // 动态状态
      currentHealth: 0,
      maxHealth: 600, // 服务器会更新
      currentHeat: 0,
      maxHeat: 240, // 服务器会更新
      heatCooldownRate: 10, // 服务器会更新
      currentChassisEnergy: 0,
      maxChassisEnergy: 150, // 服务器会更新
      currentBufferEnergy: 0,
      maxBufferEnergy: 60, // 服务器会更新
      maxPower: 45, // 服务器会更新
      remainingAmmo: 0,
      level: 1, // 服务器会更新
      currentExperience: 0,
      experienceForUpgrade: 100, // 默认升级所需经验
      x: 0,
      y: 0,
      z: 0,
      yaw: 0,
      moduleStatus: {
        powerManager: 0,
        rfid: 0,
        lightStrip: 0,
        smallShooter: 0,
        bigShooter: 0,
        uwb: 0,
        armor: 0,
        videoTransmission: 0,
        capacitor: 0,
        mainController: 0
      },
      isAlive: false,
      isPendingRespawn: false,
      isOutOfCombat: false,
      outOfCombatCountdown: 0,
      canRemoteHeal: false,
      canRemoteAmmo: false,
      lastUpdate: Date.now()
    })

    // 初始化受伤统计
    injuryStats.set(robotId, {
      totalDamage: 0,
      collisionDamage: 0,
      smallProjectileDamage: 0,
      largeProjectileDamage: 0,
      dartSplashDamage: 0,
      moduleOfflineDamage: 0,
      wifiOfflineDamage: 0,
      penaltyDamage: 0,
      serverKillDamage: 0,
      killerId: 0
    })

    // 初始化复活状态
    respawnStatus.set(robotId, {
      isPendingRespawn: false,
      totalRespawnProgress: 0,
      currentRespawnProgress: 0,
      canFreeRespawn: false,
      goldCostForRespawn: 0,
      canPayForRespawn: false
    })

    console.log(`[MQTT Store] 已切换到机器人: ${robotTypeName} (ID: ${robotId})`)
  }

  /**
   * 更新当前选中的机器人类型
   * 会清除所有旧数据并初始化新的数据槽位
   * @param robotTypeName 机器人类型名称（如"红方3号步兵"）
   * @param loadFromConfig 是否先从配置文件加载 ID 映射（默认 true）
   */
  async function updateCurrentRobotType(
    robotTypeName: string,
    loadFromConfig = true
  ): Promise<void> {
    if (currentRobotType.value === robotTypeName && serverSelectedRobotId.value === 0) return

    // 先从配置文件加载 ID 映射
    if (loadFromConfig) {
      await loadRobotIdMappings()
    }

    serverSelectedRobotId.value = 0
    dismissIdMismatchWarning()
    currentRobotType.value = robotTypeName
    initializeCurrentRobot(robotTypeName)
    console.log(`[MQTT Store] 切换机器人类型: ${robotTypeName}, 当前 ID: ${currentRobotId.value}`)
  }

  // 不自动初始化，等待 Dashboard 传递当前选中的机器人类型
  // 这样避免初始化不需要的数据

  /** 自定义数据 Map (robotId -> parsedData) */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const customData = reactive<Map<number, any>>(new Map())
  const pendingCustomByteBlocks = new Map<number, CustomByteBlock>()
  const parsingCustomByteBlocks = new Set<number>()
  let customDataEpoch = 0

  // ==================== Buff 和判罚 ====================

  /** 当前激活的 Buff 列表 */
  const activeBuffs = ref<Buff[]>([])

  /** 判罚信息列表 - 支持多个判罚同时生效 */
  const activePenalties = ref<Map<PenaltyType, PenaltyInfo & { startTime: number }>>(new Map())

  /** 兼容旧 API - 返回第一个判罚 */
  const penaltyInfo = computed<PenaltyInfo | null>(() => {
    if (activePenalties.value.size === 0) return null
    const first = activePenalties.value.values().next().value
    return first
      ? {
          penaltyType: first.penaltyType,
          penaltyEffectSec: first.penaltyEffectSec,
          totalPenaltyNum: first.totalPenaltyNum
        }
      : null
  })

  // ==================== 雷达和地图 ====================

  /** 雷达检测到的敌方机器人位置 */
  const radarDetections = ref<RaderInfoToClient[]>([])

  // ==================== 特殊单位状态 ====================

  /** 哨兵状态 */
  const sentinelStatus = ref<SentinelStatusSync | null>(null)

  /** 能量机关状态 */
  const runeStatus = ref<RuneStatusSync>({
    runeStatus: RuneStatus.NOT_ACTIVATED,
    activatedArms: 0,
    averageRings: 0
  })

  /** 空中支援状态 */
  const airSupportStatus = ref<AirSupportStatusSync>({
    airsupportStatus: AirSupportStatus.NOT_IN_PROGRESS,
    leftTime: 0,
    costCoins: 0
  })

  // ==================== 事件和消息 ====================

  /** 事件历史 */
  const eventHistory = ref<Event[]>([])

  /** 消息历史 */
  const messageHistory = ref<MessageHistoryItem[]>([])

  /** 消息计数器 */
  let messageIdCounter = 0

  // ==================== 连接状态 ====================

  /** 连接统计 */
  const connectionStats = ref<ConnectionStats>({
    isConnected: false,
    totalMessages: 0,
    messagesPerSecond: 0,
    lastMessageTime: 0,
    reconnectCount: 0
  })

  /** 每秒消息计数 */
  let messagesThisSecond = 0
  let totalMessagesReceived = 0
  let lastMessageTimestamp = 0

  /** MPS 统计定时器 */
  let mpsTimer: ReturnType<typeof setInterval> | null = null

  // ==================== 计算属性 ====================

  /** 比赛阶段名称 */
  const gameStageName = computed(() => getCurrentStageName(gameStatus.value.currentStage))

  /** 比赛是否进行中 */
  const isGameRunning = computed(() => gameStatus.value.currentStage === CurrentStage.FIGHTING)

  /** 基地状态名称 */
  const baseStatusName = computed(() => getBaseStatusName(globalUnitStatus.value.baseStatus))

  /** 前哨站状态名称 */
  const outpostStatusName = computed(() =>
    getOutpostStatusName(globalUnitStatus.value.outpostStatus)
  )

  /** 红队机器人列表 */
  const redRobotList = computed(() => Array.from(redRobots.values()))

  /** 蓝队机器人列表 */
  const blueRobotList = computed(() => Array.from(blueRobots.values()))

  /** 所有机器人列表 */
  const allRobots = computed(() => [...redRobotList.value, ...blueRobotList.value])

  /** 存活的红队机器人数量 */
  const aliveRedCount = computed(() => redRobotList.value.filter((r) => r.isAlive).length)

  /** 存活的蓝队机器人数量 */
  const aliveBlueCount = computed(() => blueRobotList.value.filter((r) => r.isAlive).length)

  /** 红队总血量 */
  const redTotalHealth = computed(() =>
    redRobotList.value.reduce((sum, r) => sum + r.currentHealth, 0)
  )

  /** 蓝队总血量 */
  const blueTotalHealth = computed(() =>
    blueRobotList.value.reduce((sum, r) => sum + r.currentHealth, 0)
  )

  /** 红队总血量百分比 */
  const redHealthPercentage = computed(() => {
    const maxHealth = redRobotList.value.reduce((sum, r) => sum + r.maxHealth, 0)
    return maxHealth > 0 ? (redTotalHealth.value / maxHealth) * 100 : 0
  })

  /** 蓝队总血量百分比 */
  const blueHealthPercentage = computed(() => {
    const maxHealth = blueRobotList.value.reduce((sum, r) => sum + r.maxHealth, 0)
    return maxHealth > 0 ? (blueTotalHealth.value / maxHealth) * 100 : 0
  })

  /** 当前激活的 Buff 数量 */
  const activeBuffCount = computed(() => activeBuffs.value.length)

  /** 最近的事件 */
  const recentEvents = computed(() => eventHistory.value.slice(0, 10))

  // ==================== 辅助函数 ====================

  /**
   * 获取或创建机器人数据
   */
  function getOrCreateRobot(robotId: number, team: 'red' | 'blue'): RobotData {
    const robotMap = team === 'red' ? redRobots : blueRobots
    let robot = robotMap.get(robotId)

    if (!robot) {
      robot = {
        robotId,
        robotType: 0,
        team,
        // 连接和状态信息（等待服务器同步）
        connectionState: 0,
        fieldState: 1,
        performanceSystemShooter: 0,
        performanceSystemChassis: 0,
        // 动态状态（默认值）
        currentHealth: 0,
        maxHealth: 600, // 服务器会更新
        currentHeat: 0,
        maxHeat: 240, // 服务器会更新
        heatCooldownRate: 10, // 服务器会更新
        currentChassisEnergy: 0,
        maxChassisEnergy: 150, // 服务器会更新
        currentBufferEnergy: 0,
        maxBufferEnergy: 60, // 服务器会更新
        maxPower: 45, // 服务器会更新
        remainingAmmo: 0,
        level: 1, // 服务器会更新
        currentExperience: 0,
        experienceForUpgrade: 100, // 默认升级所需经验
        // 位置
        x: 0,
        y: 0,
        z: 0,
        yaw: 0,
        // 模块状态
        moduleStatus: null,
        // 其他状态
        isAlive: false,
        isPendingRespawn: false,
        isOutOfCombat: false,
        outOfCombatCountdown: 0,
        canRemoteHeal: false,
        canRemoteAmmo: false,
        lastUpdate: Date.now()
      }
      robotMap.set(robotId, robot)
    }

    return robot
  }

  /**
   * 根据机器人 ID 判断队伍
   */
  function getRobotTeam(robotId: number): 'red' | 'blue' {
    // RoboMaster 规则: 1-7 红队, 101-107 蓝队
    return robotId < 100 ? 'red' : 'blue'
  }

  // ==================== 消息处理方法 ====================

  /**
   * 更新比赛状态
   */
  function updateGameStatus(status: GameStatus): void {
    gameStatus.value = status
    mqttDebugLog('[MQTT] 比赛状态更新:', gameStageName.value, status)
  }

  /**
   * 更新全局单位状态
   */
  function updateGlobalUnitStatus(status: GlobalUnitStatus): void {
    globalUnitStatus.value = status

    // 同步机器人血量到机器人数据
    status.robotHealth.forEach((hp, index) => {
      const robotId = index < ROBOTS_PER_TEAM ? index + 1 : index - ROBOTS_PER_TEAM + 101
      const team = getRobotTeam(robotId)
      const robot = getOrCreateRobot(robotId, team)
      robot.currentHealth = hp
      robot.isAlive = hp > 0
    })

    mqttDebugLog('[MQTT] 全局单位状态更新:', status)
  }

  /**
   * 更新后勤状态
   */
  function updateLogisticsStatus(status: GlobalLogisticsStatus): void {
    logisticsStatus.value = status
    mqttDebugLog('[MQTT] 后勤状态更新:', status)
  }

  /**
   * 更新特殊机制
   */
  function updateSpecialMechanisms(mechanisms: GlobalSpecialMechanism): void {
    specialMechanisms.value = mechanisms
    mqttDebugLog('[MQTT] 特殊机制更新:', mechanisms)
  }

  /**
   * 添加事件
   */
  function addEvent(event: Event): void {
    eventHistory.value.unshift(event)
    if (eventHistory.value.length > MAX_EVENT_HISTORY) {
      eventHistory.value.pop()
    }
    mqttDebugLog('[MQTT] 事件:', EventId[event.eventId], event.param)
  }

  /**
   * 更新机器人静态状态
   * 注意：机器人 ID 由服务器在此消息中提供，连接后以服务器 ID 作为当前机器人。
   */
  function updateRobotStaticStatus(status: RobotStaticStatus): void {
    selectCurrentRobotFromServerId(status.robotId)

    const robotId = Math.trunc(Number(status.robotId))
    if (robotId <= 0) return

    const team = getRobotTeam(robotId)
    const robot = getOrCreateRobot(robotId, team)

    // 连接和状态信息（服务器提供）
    robot.connectionState = status.connectionState
    robot.fieldState = status.fieldState
    robot.isAlive = status.aliveState === 1

    // 机器人基本信息（服务器提供）
    robot.robotType = status.robotType
    robot.level = status.level

    // 性能体系（服务器提供）
    robot.performanceSystemShooter = status.performanceSystemShooter
    robot.performanceSystemChassis = status.performanceSystemChassis

    // 最大值配置（服务器提供，不再从配置文件读取）
    robot.maxHealth = status.maxHealth
    robot.maxHeat = status.maxHeat
    robot.heatCooldownRate = status.heatCooldownRate
    robot.maxPower = status.maxPower
    robot.maxBufferEnergy = status.maxBufferEnergy
    robot.maxChassisEnergy = status.maxChassisEnergy

    robot.lastUpdate = Date.now()

    mqttDebugLog(
      '[MQTT] 机器人静态状态更新 (ID:',
      robotId,
      ', 类型:',
      status.robotType,
      ', 等级:',
      status.level,
      ')'
    )
  }

  /**
   * 更新机器人动态状态
   */
  function updateRobotDynamicStatus(status: RobotDynamicStatus, robotId: number): void {
    const team = getRobotTeam(robotId)
    const robot = getOrCreateRobot(robotId, team)

    robot.currentHealth = status.currentHealth
    robot.currentHeat = status.currentHeat
    robot.currentChassisEnergy = status.currentChassisEnergy
    robot.currentBufferEnergy = status.currentBufferEnergy
    robot.remainingAmmo = status.remainingAmmo
    robot.currentExperience = status.currentExperience
    robot.experienceForUpgrade = status.experienceForUpgrade
    robot.isOutOfCombat = status.isOutOfCombat
    robot.outOfCombatCountdown = status.outOfCombatCountdown ?? 0
    robot.canRemoteHeal = status.canRemoteHeal ?? false
    robot.canRemoteAmmo = status.canRemoteAmmo ?? false
    robot.lastUpdate = Date.now()
  }

  /**
   * 更新机器人位置
   */
  function updateRobotPosition(position: RobotPosition, robotId: number): void {
    const team = getRobotTeam(robotId)
    const robot = getOrCreateRobot(robotId, team)

    robot.x = position.x
    robot.y = position.y
    robot.z = position.z
    robot.yaw = position.yaw
    robot.lastUpdate = Date.now()
  }

  /**
   * 更新机器人模块状态
   */
  function updateRobotModuleStatus(status: RobotModuleStatus, robotId: number): void {
    const team = getRobotTeam(robotId)
    const robot = getOrCreateRobot(robotId, team)

    robot.moduleStatus = status
    robot.lastUpdate = Date.now()
    mqttDebugLog(
      `[MQTT] 机器人模块状态更新 (ID: ${robotId}, 当前选中: ${currentRobotId.value})`,
      status
    )
  }

  /**
   * 更新机器人受伤统计
   */
  function updateRobotInjuryStat(stat: RobotInjuryStat, robotId: number): void {
    injuryStats.set(robotId, stat)
    mqttDebugLog('[MQTT] 机器人受伤统计:', robotId, stat)
  }

  /**
   * 更新机器人复活状态
   */
  function updateRobotRespawnStatus(status: RobotRespawnStatus, robotId: number): void {
    const team = getRobotTeam(robotId)
    const robot = getOrCreateRobot(robotId, team)

    robot.isPendingRespawn = status.isPendingRespawn
    respawnStatus.set(robotId, status)
  }

  /**
   * 添加或更新 Buff
   */
  function updateBuff(buff: Buff): void {
    // 查找是否已存在相同机器人和类型的 Buff
    const existingIndex = activeBuffs.value.findIndex(
      (b) => b.robotId === buff.robotId && b.buffType === buff.buffType
    )

    if (existingIndex >= 0) {
      // 更新现有 Buff
      activeBuffs.value[existingIndex] = buff
    } else {
      // 添加新 Buff
      activeBuffs.value.push(buff)
    }

    // 移除时间为 0 的 Buff
    activeBuffs.value = activeBuffs.value.filter((b) => b.buffLeftTime > 0)

    mqttDebugLog('[MQTT] Buff 更新:', BuffType[buff.buffType], buff)
  }

  /** 判罚倒计时定时器 */
  let penaltyCountdownTimer: ReturnType<typeof setInterval> | null = null

  /**
   * 更新判罚信息
   * 支持多个判罚同时生效，按类型存储
   */
  function updatePenaltyInfo(penalty: PenaltyInfo): void {
    mqttDebugLog('[MQTT] 判罚:', PenaltyType[penalty.penaltyType], penalty)

    // 按类型存储判罚，更新或新增
    activePenalties.value.set(penalty.penaltyType, {
      ...penalty,
      startTime: Date.now()
    })

    // 启动全局倒计时（如果还没启动）
    if (!penaltyCountdownTimer) {
      penaltyCountdownTimer = setInterval(() => {
        let hasActive = false
        activePenalties.value.forEach((p, type) => {
          if (p.penaltyEffectSec > 0) {
            p.penaltyEffectSec -= 1
            hasActive = true
            if (p.penaltyEffectSec <= 0) {
              mqttDebugLog('[MQTT] 判罚倒计时结束:', PenaltyType[type])
              activePenalties.value.delete(type)
            }
          }
        })
        // 如果没有活动判罚，停止定时器
        if (!hasActive || activePenalties.value.size === 0) {
          if (penaltyCountdownTimer) {
            clearInterval(penaltyCountdownTimer)
            penaltyCountdownTimer = null
          }
        }
      }, 1000)
    }
  }

  /**
   * 更新雷达数据
   */
  function updateRadarData(data: RaderInfoToClient): void {
    // 查找是否已存在该机器人的雷达数据
    const existingIndex = radarDetections.value.findIndex(
      (r) => r.targetRobotId === data.targetRobotId
    )

    if (existingIndex >= 0) {
      radarDetections.value[existingIndex] = data
    } else {
      radarDetections.value.push(data)
    }
  }

  /**
   * 更新哨兵状态
   */
  function updateSentinelStatus(status: SentinelStatusSync): void {
    sentinelStatus.value = status
    mqttDebugLog('[MQTT] 哨兵状态:', SentinelPosture[status.postureId], status)
  }

  /**
   * 更新能量机关状态
   */
  function updateRuneStatus(status: RuneStatusSync): void {
    runeStatus.value = status
    mqttDebugLog('[MQTT] 能量机关状态:', RuneStatus[status.runeStatus], status)
  }

  /**
   * 更新空中支援状态
   */
  function updateAirSupportStatus(status: AirSupportStatusSync): void {
    airSupportStatus.value = status
    mqttDebugLog('[MQTT] 空中支援状态:', AirSupportStatus[status.airsupportStatus], status)
  }

  /** 机器人配置缓存类型 */
  interface RobotConfigCacheType {
    robotTypes: Record<string, { customDataProto?: string }>
    robotMappings: Record<string, { type: string; team: string; number: number; id?: number }>
  }

  /** 机器人配置缓存 */
  let robotConfigCache: RobotConfigCacheType | null = null

  /** 当前加载的 Proto 配置 */
  let currentProtoConfig: { robotName: string; robotType: string; protoPath: string } | null = null

  /**
   * 预加载机器人 Proto 配置
   * @param robotName 机器人名称（如 "蓝方3号步兵"）
   */
  async function loadRobotProtoConfig(robotName: string): Promise<void> {
    console.log(`[MQTT] 开始加载机器人 Proto 配置: "${robotName}"`)

    // 1. 获取配置
    if (!robotConfigCache) {
      try {
        robotConfigCache = await window.api.getRobotConfig()
      } catch (e) {
        console.error('[MQTT] 获取机器人配置失败:', e)
        return
      }
    }

    if (!robotConfigCache) {
      console.error('[MQTT] 机器人配置缓存为空')
      return
    }

    // 2. 查找机器人映射
    const mapping = robotConfigCache.robotMappings[robotName]
    if (!mapping) {
      console.warn(`[MQTT] 未找到机器人 "${robotName}" 的配置映射`)
      currentProtoConfig = null
      return
    }

    const robotType = mapping.type

    // 3. 获取 Proto 路径
    const typeConfig = robotConfigCache.robotTypes[robotType]
    if (!typeConfig || !typeConfig.customDataProto) {
      console.warn(`[MQTT] 机器人类型 "${robotType}" 没有配置 customDataProto`)
      currentProtoConfig = null
      return
    }

    // 4. 保存配置
    currentProtoConfig = {
      robotName,
      robotType,
      protoPath: typeConfig.customDataProto
    }

    console.log(
      `[MQTT] Proto 配置加载成功: 机器人="${robotName}", 类型="${robotType}", 文件="${typeConfig.customDataProto}"`
    )
  }

  /**
   * 处理自定义数据块
   */
  function handleCustomByteBlock(data: CustomByteBlock, robotId: number): void {
    pendingCustomByteBlocks.set(robotId, data)
    if (!parsingCustomByteBlocks.has(robotId)) {
      void drainCustomByteBlock(robotId, customDataEpoch)
    }
  }

  async function drainCustomByteBlock(robotId: number, epoch: number): Promise<void> {
    parsingCustomByteBlocks.add(robotId)

    try {
      while (pendingCustomByteBlocks.has(robotId) && epoch === customDataEpoch) {
        const data = pendingCustomByteBlocks.get(robotId)
        pendingCustomByteBlocks.delete(robotId)
        if (data) {
          await parseCustomByteBlock(data, robotId, epoch)
        }
      }
    } finally {
      parsingCustomByteBlocks.delete(robotId)
      if (pendingCustomByteBlocks.has(robotId) && epoch === customDataEpoch) {
        void drainCustomByteBlock(robotId, epoch)
      }
    }
  }

  async function parseCustomByteBlock(
    data: CustomByteBlock,
    robotId: number,
    epoch: number
  ): Promise<void> {
    // data.data 可能是数组（bytes: Array）或 Uint8Array
    const rawData = data.data
    const dataLength = Array.isArray(rawData) ? rawData.length : (rawData?.length ?? 0)
    mqttDebugLog(
      `[MQTT] 收到 CustomByteBlock: Robot ID=${robotId}, 数据长度=${dataLength}, 类型=${typeof rawData}, isArray=${Array.isArray(rawData)}`
    )

    // 检查是否已加载 Proto 配置
    if (!currentProtoConfig) {
      console.warn('[MQTT] 未加载 Proto 配置，请先选择机器人')
      return
    }

    if (dataLength === 0) {
      console.warn('[MQTT] CustomByteBlock 数据为空')
      return
    }

    mqttDebugLog(
      `[MQTT] 使用预加载的 Proto 配置: 机器人="${currentProtoConfig.robotName}", 类型="${currentProtoConfig.robotType}", 文件="${currentProtoConfig.protoPath}"`
    )

    // 解析数据 - 确保转换为 Uint8Array
    try {
      const buffer = Array.isArray(rawData) ? new Uint8Array(rawData) : rawData
      const parsed = await window.api.parseCustomData(currentProtoConfig.protoPath, buffer)
      if (epoch !== customDataEpoch) return

      // 更新状态
      customData.set(robotId, parsed)
      mqttDebugLog(`[MQTT] CustomByteBlock 解析成功:`, parsed)
    } catch (e) {
      console.error(
        `[MQTT] 解析自定义数据失败 (Robot ${robotId}, Type ${currentProtoConfig.robotType}):`,
        e
      )
    }
  }

  /**
   * 通用消息处理
   */
  function handleMessage(topic: string, type: MessageType, data: unknown): void {
    mqttDebugLog(`[MQTT Store] 收到消息: topic=${topic}, type=${type}`)

    // 更新统计
    totalMessagesReceived++
    lastMessageTimestamp = Date.now()
    messagesThisSecond++

    if (mqttHistoryEnabled) {
      messageHistory.value.unshift({
        id: ++messageIdCounter,
        topic,
        type,
        timestamp: Date.now(),
        data
      })

      if (messageHistory.value.length > MAX_MESSAGE_HISTORY) {
        messageHistory.value.pop()
      }
    }

    // 根据类型分发处理
    switch (type) {
      case 'game_status':
        updateGameStatus(data as GameStatus)
        break
      case 'global_unit_status':
        updateGlobalUnitStatus(data as GlobalUnitStatus)
        break
      case 'global_logistics_status':
        updateLogisticsStatus(data as GlobalLogisticsStatus)
        break
      case 'global_special_mechanism':
        updateSpecialMechanisms(data as GlobalSpecialMechanism)
        break
      case 'event':
        addEvent(data as Event)
        break
      case 'robot_static_status':
        // RobotStaticStatus 消息自带 robotId，用于 ID 匹配检测
        updateRobotStaticStatus(data as RobotStaticStatus)
        break
      // ==================== 以下消息都是当前机器人的数据（一对一通信） ====================
      case 'robot_dynamic_status':
        if (currentRobotId.value > 0) {
          updateRobotDynamicStatus(data as RobotDynamicStatus, currentRobotId.value)
        }
        break
      case 'robot_position':
        if (currentRobotId.value > 0) {
          updateRobotPosition(data as RobotPosition, currentRobotId.value)
        }
        break
      case 'custom_byte_block':
        if (currentRobotId.value > 0) {
          handleCustomByteBlock(data as CustomByteBlock, currentRobotId.value)
        }
        break
      case 'robot_module_status':
        if (currentRobotId.value > 0) {
          updateRobotModuleStatus(data as RobotModuleStatus, currentRobotId.value)
        }
        break
      case 'robot_injury_stat':
        if (currentRobotId.value > 0) {
          updateRobotInjuryStat(data as RobotInjuryStat, currentRobotId.value)
        }
        break
      case 'robot_respawn_status':
        if (currentRobotId.value > 0) {
          updateRobotRespawnStatus(data as RobotRespawnStatus, currentRobotId.value)
        }
        break
      // ==================== 结束：当前机器人消息 ====================
      case 'buff':
        updateBuff(data as Buff)
        break
      case 'penalty_info':
        updatePenaltyInfo(data as PenaltyInfo)
        break
      case 'rader_info_to_client':
        updateRadarData(data as RaderInfoToClient)
        break
      case 'sentinel_status_sync':
        updateSentinelStatus(data as SentinelStatusSync)
        break
      case 'rune_status_sync':
        updateRuneStatus(data as RuneStatusSync)
        break
      case 'air_support_status_sync':
        updateAirSupportStatus(data as AirSupportStatusSync)
        break
      default:
        mqttDebugLog('[MQTT] 未处理的消息类型:', type, topic)
    }
  }

  // ==================== 工具方法 ====================

  /**
   * 获取指定机器人数据
   */
  function getRobot(robotId: number): RobotData | undefined {
    const team = getRobotTeam(robotId)
    const robotMap = team === 'red' ? redRobots : blueRobots
    return robotMap.get(robotId)
  }

  /**
   * 获取机器人受伤统计
   */
  function getRobotInjuryStat(robotId: number): RobotInjuryStat | undefined {
    return injuryStats.get(robotId)
  }

  /**
   * 获取机器人复活状态
   */
  function getRobotRespawnStatus(robotId: number): RobotRespawnStatus | undefined {
    return respawnStatus.get(robotId)
  }

  /**
   * 清空所有数据
   */
  function clearAll(): void {
    // 重置比赛状态
    gameStatus.value = {
      currentRound: 1,
      totalRounds: 3,
      redScore: 0,
      blueScore: 0,
      currentStage: CurrentStage.NOT_STARTED,
      stageCountdownSec: 0,
      stageElapsedSec: 0,
      isPaused: false
    }

    // 重置全局状态
    globalUnitStatus.value = {
      baseHealth: 5000,
      baseStatus: BaseStatus.INVINCIBLE,
      baseShield: 0,
      outpostHealth: 1500,
      outpostStatus: OutpostStatus.INVINCIBLE,
      robotHealth: [],
      robotBullets: [],
      totalDamageRed: 0,
      totalDamageBlue: 0
    }

    // 清空机器人数据
    redRobots.clear()
    blueRobots.clear()
    injuryStats.clear()
    respawnStatus.clear()

    // 清空其他数据
    activeBuffs.value = []
    activePenalties.value.clear()
    radarDetections.value = []
    eventHistory.value = []
    messageHistory.value = []

    // 重置连接状态
    connectionStats.value.totalMessages = 0
    connectionStats.value.messagesPerSecond = 0
    totalMessagesReceived = 0
    lastMessageTimestamp = 0

    console.log('[MQTT] 已清空所有数据')
  }

  /**
   * 启动 MPS 统计
   */
  function startMpsCounter(): void {
    if (mpsTimer) return

    mpsTimer = setInterval(() => {
      connectionStats.value.totalMessages = totalMessagesReceived
      connectionStats.value.lastMessageTime = lastMessageTimestamp
      connectionStats.value.messagesPerSecond = messagesThisSecond
      messagesThisSecond = 0

      // 更新 Buff 剩余时间（简单递减，实际应由服务器更新）
      activeBuffs.value = activeBuffs.value
        .map((buff) => ({
          ...buff,
          buffLeftTime: Math.max(0, buff.buffLeftTime - 1)
        }))
        .filter((buff) => buff.buffLeftTime > 0)
    }, 1000)
  }

  /**
   * 停止 MPS 统计
   */
  function stopMpsCounter(): void {
    if (mpsTimer) {
      clearInterval(mpsTimer)
      mpsTimer = null
    }
  }

  /**
   * 设置连接状态
   */
  function setConnectionStatus(connected: boolean): void {
    connectionStats.value.isConnected = connected
    if (connected) {
      startMpsCounter()
    } else {
      stopMpsCounter()
      serverSelectedRobotId.value = 0
      dismissIdMismatchWarning()
    }
  }

  // ==================== 返回 ====================

  return {
    // 比赛状态
    gameStatus,
    globalUnitStatus,
    logisticsStatus,
    specialMechanisms,

    // 机器人数据
    redRobots,
    blueRobots,
    injuryStats,
    respawnStatus,
    customData,

    // Buff 和判罚
    activeBuffs,
    activePenalties,
    penaltyInfo, // 兼容旧 API

    // 雷达和地图
    radarDetections,

    // 特殊单位
    sentinelStatus,
    runeStatus,
    airSupportStatus,

    // 事件和消息
    eventHistory,
    messageHistory,

    // 连接状态
    connectionStats,

    // 计算属性
    gameStageName,
    isGameRunning,
    baseStatusName,
    outpostStatusName,
    redRobotList,
    blueRobotList,
    allRobots,
    aliveRedCount,
    aliveBlueCount,
    redTotalHealth,
    blueTotalHealth,
    redHealthPercentage,
    blueHealthPercentage,
    activeBuffCount,
    recentEvents,

    // 方法
    handleMessage,
    getRobot,
    getRobotInjuryStat,
    getRobotRespawnStatus,
    clearAll,
    setConnectionStatus,
    startMpsCounter,
    stopMpsCounter,
    loadRobotProtoConfig,
    updateCurrentRobotType,
    loadRobotIdMappings,
    clearAllRobotData,
    checkRobotIdMatch,
    selectCurrentRobotFromServerId,

    // 当前机器人状态
    currentRobotType,
    currentRobotId,
    serverSelectedRobotId,
    idMismatchWarned
  }
})
