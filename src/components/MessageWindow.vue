<template>
  <Teleport to="body">
    <!-- 复活面板 - 独立显示在中间 -->
    <Transition name="respawn-fade">
      <div v-if="showRespawnPanel" class="respawn-panel-overlay">
        <div class="respawn-panel">
          <div class="respawn-header">
            <span class="respawn-title">机器人阵亡</span>
          </div>

          <!-- 复活进度条 -->
          <div class="respawn-progress-section">
            <div class="respawn-progress-label">
              复活倒计时: {{ formatRespawnTime(respawnProgress.current) }} /
              {{ formatRespawnTime(respawnProgress.total) }}
            </div>
            <div class="respawn-progress-bar">
              <div
                class="respawn-progress-fill"
                :style="{ width: respawnProgressPercent + '%' }"
              ></div>
            </div>
            <div class="respawn-countdown">
              {{
                canConfirmRespawn
                  ? '可以复活！'
                  : `还需 ${Math.ceil(respawnProgress.total - respawnProgress.current)} 秒`
              }}
            </div>
          </div>

          <!-- 复活按钮组 -->
          <div class="respawn-buttons">
            <div class="respawn-buttons-row">
              <button
                class="respawn-btn free-btn"
                :class="{ disabled: !respawnStatus.canFreeRespawn }"
                :disabled="!respawnStatus.canFreeRespawn"
                @click="handleFreeRespawn"
              >
                <span class="btn-icon">🆓</span>
                <span class="btn-text">免费复活</span>
              </button>
              <button
                class="respawn-btn pay-btn"
                :class="{ disabled: !respawnStatus.canPayForRespawn }"
                :disabled="!respawnStatus.canPayForRespawn"
                @click="handlePayRespawn"
              >
                <span class="btn-icon">💰</span>
                <span class="btn-text">
                  花费复活
                  <span v-if="respawnStatus.canPayForRespawn" class="gold-cost">
                    ({{ respawnStatus.goldCostForRespawn }} 金币)
                  </span>
                </span>
              </button>
            </div>
            <button
              class="respawn-btn confirm-btn"
              :class="{ disabled: !canConfirmRespawn }"
              :disabled="!canConfirmRespawn"
              @click="handleConfirmRespawn"
            >
              <span class="btn-icon">⚡</span>
              <span class="btn-text">{{ canConfirmRespawn ? '立即复活' : '等待读条完成...' }}</span>
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- 普通消息通知 -->
    <TransitionGroup name="message-slide" tag="div" class="message-container">
      <div
        v-for="message in visibleMessages"
        :key="message.id"
        class="message-window"
        :class="[`level-${message.level}`, { 'has-sub-text': message.subText }]"
        :style="{ top: `${message.top}px` }"
      >
        <div class="message-content">
          <div class="message-icon">
            <span v-if="message.level === 'info'">ℹ</span>
            <span v-else-if="message.level === 'warning'">⚠</span>
            <span v-else-if="message.level === 'danger'">✕</span>
          </div>
          <div class="message-body">
            <div class="message-title">{{ message.title }}</div>

            <!-- 倒计时类型显示 -->
            <template v-if="message.specialType === 'gameStageCountdown'">
              <div class="countdown-display">{{ formatCountdown(message.countdown ?? 0) }}</div>
              <div class="message-sub-text">{{ message.subText }}</div>
            </template>

            <!-- 已过时间类型显示（自检阶段） -->
            <template v-else-if="message.specialType === 'gameStageElapsed'">
              <div class="elapsed-time-display">
                已过 {{ formatCountdown(message.countdown ?? 0) }}
              </div>
              <div class="progress-bar-container" :class="{ blinking: message.isBlinking }">
                <div
                  class="progress-bar-fill"
                  :style="{ width: `${message.progress ?? 0}%` }"
                ></div>
              </div>
              <div class="message-sub-text">{{ message.subText }}</div>
            </template>

            <!-- 进度条类型显示（旧版兼容） -->
            <template v-else-if="message.specialType === 'gameStageProgress'">
              <div class="progress-bar-container">
                <div
                  class="progress-bar-fill"
                  :style="{ width: `${message.progress ?? 0}%` }"
                ></div>
              </div>
              <div class="message-text">{{ message.text }}</div>
            </template>

            <!-- 普通类型显示 -->
            <template v-else>
              <div class="message-text">{{ message.text }}</div>
            </template>
          </div>
          <button
            v-if="message.duration > 0"
            class="message-close"
            @click="dismissMessage(message.id)"
          >
            ×
          </button>
        </div>
        <div
          v-if="message.duration > 0"
          class="message-progress"
          :style="{ animationDuration: `${message.duration}ms` }"
        ></div>
      </div>
    </TransitionGroup>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, reactive } from 'vue'
import { useMqttDataStore } from '../store/modules/mqtt_data'
import { onMessage, onDismiss, type GlobalMessage } from '../store/modules/message_service'
import { CurrentStage } from '../utils/mqtt_protocol_constants'

// ==================== 类型定义 ====================
type MessageLevel = 'info' | 'warning' | 'danger'
type SpecialType =
  | 'gameStage'
  | 'gameStageCountdown'
  | 'gameStageProgress'
  | 'gameStageElapsed'
  | undefined

interface MessageConfig {
  id: string
  mqttPath: string
  trigger: 'changed' | 'equals' | 'greater' | 'less' | 'not_equals'
  triggerValue?: unknown
  previousValue?: unknown
  level: MessageLevel
  title: string
  messageTemplate: string
  subText?: string
  duration: number
  cooldown?: number
  stageNameMap?: Record<number, string>
  specialType?: SpecialType
  countdownPath?: string
  progressPath?: string
  totalTime?: number
}

interface ActiveMessage {
  id: string
  configId: string
  level: MessageLevel
  title: string
  text: string
  subText?: string
  duration: number
  top: number
  createdAt: number
  specialType?: SpecialType
  countdown?: number
  progress?: number
  countdownPath?: string
  progressPath?: string
  totalTime?: number
  // 新增：本地计时器相关
  localTimer?: number // 本地倒计时/计时值
  localTimerPaused?: boolean // 是否暂停计时
  lastSyncTime?: number // 上次同步时间戳
  isBlinking?: boolean // 进度条是否闪烁
}

interface MessageYamlConfig {
  messages: MessageConfig[]
  display: {
    maxMessages: number
    messageGap: number
    topOffset: number
    messageWidth: number
    animationDuration: number
  }
}

// ==================== Store ====================
const mqttStore = useMqttDataStore()

// ==================== 复活状态 ====================
const respawnStatus = reactive({
  isPendingRespawn: false,
  totalRespawnProgress: 100,
  currentRespawnProgress: 0,
  canFreeRespawn: true,
  goldCostForRespawn: 50,
  canPayForRespawn: true
})

// 检查是否在比赛中 (FIGHTING 阶段)
const isInMatch = computed(() => {
  // CurrentStage.FIGHTING = 4
  return mqttStore.gameStatus.currentStage === 4
})

// 检查当前机器人是否阵亡（从 RobotStaticStatus 中获取）
const isCurrentRobotDead = computed(() => {
  const robotId = mqttStore.currentRobotId
  if (!robotId) return false
  const robot = mqttStore.getRobot(robotId)
  return robot?.isAlive === false
})

// 显示复活面板的条件：
// 1. 必须在比赛中
// 2. 机器人已阵亡（RobotStaticStatus.isAlive === false）
// 3. 正在等待复活（RespawnStatus.isPendingRespawn === true）
const showRespawnPanel = computed(() => {
  // 必须在比赛中才显示复活面板
  if (!isInMatch.value) {
    return false
  }

  // 必须同时满足：机器人阵亡 + 正在等待复活
  return isCurrentRobotDead.value && respawnStatus.isPendingRespawn
})

const respawnProgress = computed(() => ({
  current: respawnStatus.currentRespawnProgress,
  total: respawnStatus.totalRespawnProgress
}))

const respawnProgressPercent = computed(() => {
  if (respawnStatus.totalRespawnProgress === 0) return 0
  return Math.min(
    100,
    (respawnStatus.currentRespawnProgress / respawnStatus.totalRespawnProgress) * 100
  )
})

const canConfirmRespawn = computed(() => {
  return respawnStatus.currentRespawnProgress >= respawnStatus.totalRespawnProgress
})

// 格式化复活时间 (秒数)
const formatRespawnTime = (seconds: number): string => {
  return Math.floor(seconds).toString() + 's'
}

// 复活操作处理
const handleFreeRespawn = (): void => {
  if (!respawnStatus.canFreeRespawn) return
  console.log('[MessageWindow] 请求免费复活')
  // TODO: 发送免费复活指令
}

const handlePayRespawn = (): void => {
  if (!respawnStatus.canPayForRespawn) return
  console.log('[MessageWindow] 请求付费复活, 花费:', respawnStatus.goldCostForRespawn)
  // TODO: 发送付费复活指令
}

const handleConfirmRespawn = (): void => {
  if (!canConfirmRespawn.value) return
  console.log('[MessageWindow] 确认复活')
  // TODO: 发送确认复活指令
}

// 更新复活状态
const updateRespawnStatus = (): void => {
  const robotId = mqttStore.currentRobotId
  const status = mqttStore.getRobotRespawnStatus(robotId)

  if (status) {
    // 有 MQTT RespawnStatus 数据，使用它
    respawnStatus.isPendingRespawn = status.isPendingRespawn
    respawnStatus.totalRespawnProgress = status.totalRespawnProgress
    respawnStatus.currentRespawnProgress = status.currentRespawnProgress
    respawnStatus.canFreeRespawn = status.canFreeRespawn
    respawnStatus.goldCostForRespawn = status.goldCostForRespawn
    respawnStatus.canPayForRespawn = status.canPayForRespawn
  } else {
    // 没有 MQTT RespawnStatus 数据，重置状态
    // 不再模拟复活进度，完全依赖服务器数据
    respawnStatus.isPendingRespawn = false
    respawnStatus.totalRespawnProgress = 100
    respawnStatus.currentRespawnProgress = 0
    respawnStatus.canFreeRespawn = true
    respawnStatus.goldCostForRespawn = 50
    respawnStatus.canPayForRespawn = true
  }
}

// ==================== 配置 ====================
const config = ref<MessageYamlConfig | null>(null)
const messages = ref<ActiveMessage[]>([])
const lastTriggerTime = ref<Record<string, number>>({})
const previousValues = ref<Record<string, unknown>>({})
const gameStageMessageId = ref<string | null>(null)
const pauseMessageId = ref<string | null>(null)
let messageIdCounter = 0

// ==================== 比赛阶段状态管理 ====================
/** 当前阶段的本地时间（秒）- 用于倒计时或已过时间 */
const localStageTime = ref<number>(0)
/** 进度条是否闪烁（超过5秒未同步） */
const progressBlinking = ref<boolean>(false)
/** 5秒倒计时是否已完成 */
const countdown5sFinished = ref<boolean>(false)
/** 是否显示"比赛即将开始" */
const showMatchStartingSoon = ref<boolean>(false)

// ==================== 计算属性 ====================
const visibleMessages = computed(() => {
  const maxMessages = config.value?.display.maxMessages ?? 5
  return messages.value.slice(0, maxMessages)
})

// ==================== 格式化倒计时 ====================
const formatCountdown = (seconds: number): string => {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

// ==================== 加载配置 ====================
const loadConfig = async (): Promise<void> => {
  try {
    if (window.api?.readYamlConfig) {
      const yamlContent = await window.api.readYamlConfig('MessageMQTTConfig.yaml')
      if (yamlContent) {
        config.value = yamlContent as MessageYamlConfig
        console.log('[MessageWindow] 配置加载成功:', config.value?.messages.length, '条规则')
      }
    }
  } catch (error) {
    console.error('[MessageWindow] 配置加载失败:', error)
    config.value = getDefaultConfig()
  }
}

const getDefaultConfig = (): MessageYamlConfig => ({
  messages: [],
  display: {
    maxMessages: 5,
    messageGap: 8,
    topOffset: 120,
    messageWidth: 360,
    animationDuration: 300
  }
})

// ==================== 消息管理 ====================
const addMessage = (msgConfig: MessageConfig): void => {
  const displayConfig = config.value?.display ?? getDefaultConfig().display

  if (msgConfig.cooldown) {
    const lastTime = lastTriggerTime.value[msgConfig.id] ?? 0
    if (Date.now() - lastTime < msgConfig.cooldown) {
      return
    }
  }

  lastTriggerTime.value[msgConfig.id] = Date.now()

  const text = msgConfig.messageTemplate
  const top = displayConfig.topOffset + messages.value.length * (70 + displayConfig.messageGap)
  const now = Date.now()

  const newMessage: ActiveMessage = {
    id: `msg-${++messageIdCounter}`,
    configId: msgConfig.id,
    level: msgConfig.level,
    title: msgConfig.title,
    text,
    subText: msgConfig.subText,
    duration: msgConfig.duration,
    top,
    createdAt: now,
    specialType: msgConfig.specialType,
    countdownPath: msgConfig.countdownPath,
    progressPath: msgConfig.progressPath,
    totalTime: msgConfig.totalTime
  }

  // 初始化本地计时器（对于需要倒计时/已过时间的消息）
  if (msgConfig.specialType === 'gameStageCountdown' && msgConfig.countdownPath) {
    // 5秒倒计时阶段：始终从5开始
    if (msgConfig.id === 'game_stage_countdown_5s') {
      newMessage.localTimer = 5
      newMessage.countdown = 5
      newMessage.lastSyncTime = now
      newMessage.localTimerPaused = false
    } else {
      // 准备阶段：从服务器数据初始化
      const serverCountdown = mqttStore.gameStatus.stageCountdownSec
      newMessage.localTimer = serverCountdown
      newMessage.countdown = serverCountdown
      newMessage.lastSyncTime = now
      newMessage.localTimerPaused = mqttStore.gameStatus.isPaused
    }
  } else if (msgConfig.specialType === 'gameStageElapsed' && msgConfig.progressPath) {
    // 自检阶段：初始化已过时间
    const serverElapsed = mqttStore.gameStatus.stageElapsedSec
    newMessage.localTimer = serverElapsed
    newMessage.countdown = serverElapsed
    newMessage.lastSyncTime = now
    newMessage.localTimerPaused = mqttStore.gameStatus.isPaused
  }

  if (msgConfig.specialType?.startsWith('gameStage')) {
    if (gameStageMessageId.value) {
      dismissMessage(gameStageMessageId.value)
    }
    gameStageMessageId.value = newMessage.id
  }

  if (msgConfig.id === 'game_stage_pause') {
    if (pauseMessageId.value) {
      dismissMessage(pauseMessageId.value)
    }
    pauseMessageId.value = newMessage.id
    if (gameStageMessageId.value && gameStageMessageId.value !== newMessage.id) {
      const stageMsg = messages.value.find((m) => m.id === gameStageMessageId.value)
      if (stageMsg) {
        stageMsg.top = -1000
      }
    }
  }

  messages.value.push(newMessage)

  if (msgConfig.duration > 0) {
    setTimeout(() => {
      dismissMessage(newMessage.id)
    }, msgConfig.duration)
  }
}

const dismissMessage = (id: string): void => {
  const index = messages.value.findIndex((m) => m.id === id)
  if (index !== -1) {
    const msg = messages.value[index]

    if (msg.id === gameStageMessageId.value) {
      gameStageMessageId.value = null
    }
    if (msg.id === pauseMessageId.value) {
      pauseMessageId.value = null
      if (gameStageMessageId.value) {
        updateMessagePositions()
      }
    }

    messages.value.splice(index, 1)
    updateMessagePositions()
  }
}

const updateMessagePositions = (): void => {
  const displayConfig = config.value?.display ?? getDefaultConfig().display
  messages.value.forEach((msg, index) => {
    if (msg.top !== -1000) {
      msg.top = displayConfig.topOffset + index * (70 + displayConfig.messageGap)
    }
  })
}

// ==================== 获取 MQTT 值 ====================
const getMqttValue = (path: string): unknown => {
  const parts = path.split('.')
  let value: unknown = mqttStore

  // 处理 currentRobot 前缀
  if (parts[0] === 'currentRobot') {
    const robotId = mqttStore.currentRobotId
    const robot =
      robotId > 100 ? mqttStore.blueRobots.get(robotId) : mqttStore.redRobots.get(robotId)
    if (!robot) return undefined
    value = robot
    parts.shift()
  }

  // 处理 penaltyInfo 路径 - 直接从 store 获取
  if (parts[0] === 'penaltyInfo') {
    value = mqttStore.penaltyInfo
    parts.shift()
  }

  for (const part of parts) {
    if (value === null || value === undefined) return undefined
    if (typeof value === 'object') {
      value = (value as Record<string, unknown>)[part]
    } else {
      return undefined
    }
  }

  return value
}

// ==================== 检查触发条件 ====================
const checkTrigger = (msgConfig: MessageConfig, currentValue: unknown): boolean => {
  const prevValue = previousValues.value[msgConfig.mqttPath]

  switch (msgConfig.trigger) {
    case 'changed':
      return prevValue !== undefined && prevValue !== currentValue
    case 'equals':
      if (msgConfig.previousValue !== undefined) {
        return currentValue === msgConfig.triggerValue && prevValue === msgConfig.previousValue
      }
      return currentValue === msgConfig.triggerValue && prevValue !== msgConfig.triggerValue
    case 'not_equals':
      return currentValue !== msgConfig.triggerValue
    case 'greater':
      return typeof currentValue === 'number' && currentValue > (msgConfig.triggerValue as number)
    case 'less':
      return (
        typeof currentValue === 'number' &&
        currentValue < (msgConfig.triggerValue as number) &&
        (prevValue === undefined ||
          typeof prevValue !== 'number' ||
          prevValue >= (msgConfig.triggerValue as number))
      )
    default:
      return false
  }
}

// ==================== 上一次服务器数据记录 ====================
let lastServerCountdown: number | null = null
let lastServerElapsed: number | null = null
let lastPausedState: boolean | null = null

// ==================== 更新实时数据 ====================
const updateRealtimeData = (): void => {
  const currentStage = mqttStore.gameStatus.currentStage
  const serverCountdown = mqttStore.gameStatus.stageCountdownSec
  const serverElapsed = mqttStore.gameStatus.stageElapsedSec
  const isPaused = mqttStore.gameStatus.isPaused
  const now = Date.now()

  // 检测服务器数据是否更新（用于同步）
  const serverCountdownChanged = serverCountdown !== lastServerCountdown
  const serverElapsedChanged = serverElapsed !== lastServerElapsed
  const pauseStateChanged = isPaused !== lastPausedState

  for (const msg of messages.value) {
    // 准备阶段：倒计时，从服务器同步并本地倒计时
    if (msg.specialType === 'gameStageCountdown' && msg.countdownPath) {
      if (currentStage === CurrentStage.PREPARATION) {
        // 暂停状态变化时的处理
        if (pauseStateChanged) {
          if (isPaused) {
            // 进入暂停：记录当前显示的倒计时值，停止本地计时
            msg.localTimerPaused = true
            // 保持当前 countdown 值不变
          } else {
            // 取消暂停：用服务器当前值重新开始本地倒计时
            msg.localTimer = serverCountdown
            msg.lastSyncTime = now
            msg.localTimerPaused = false
          }
        }
        // 服务器数据更新时同步（非暂停状态）
        else if (serverCountdownChanged && !isPaused) {
          msg.localTimer = serverCountdown
          msg.lastSyncTime = now
          msg.localTimerPaused = false
        }

        // 本地倒计时计算
        if (msg.localTimerPaused) {
          // 暂停时保持当前值不变（已经设置过了）
          // countdown 保持上一次的值
        } else if (msg.localTimer !== undefined && msg.localTimer > 0) {
          // 正常倒计时：从同步时间点开始计算已过时间
          const elapsed = (now - (msg.lastSyncTime || now)) / 1000
          msg.countdown = Math.max(0, msg.localTimer - elapsed)
        } else {
          msg.countdown = msg.localTimer || 0
        }

        // 更新标题和样式
        if (isPaused && msg.configId === 'game_stage_prepare') {
          msg.title = '技术暂停'
          msg.subText = '暂停中，请等待'
          msg.level = 'warning'
        } else if (msg.configId === 'game_stage_prepare') {
          msg.title = '准备阶段'
          msg.subText = '准备阶段倒计时'
          msg.level = 'info'
        }
      }
      // 5秒倒计时阶段 - 始终从5开始倒计时，不依赖服务器数据
      else if (
        currentStage === CurrentStage.COUNTDOWN_5S &&
        msg.configId === 'game_stage_countdown_5s'
      ) {
        // 初始化5秒倒计时（只在第一次进入时设置）
        if (msg.localTimer === undefined) {
          msg.localTimer = 5
          msg.lastSyncTime = now
          msg.localTimerPaused = false
        }

        // 本地倒计时
        if (!msg.localTimerPaused) {
          const elapsed = (now - (msg.lastSyncTime || now)) / 1000
          msg.countdown = Math.max(0, msg.localTimer - elapsed)
        }

        // 5秒后检查是否进入比赛中状态
        if (msg.countdown !== undefined && msg.countdown <= 0 && !countdown5sFinished.value) {
          countdown5sFinished.value = true
        }
      }
    }

    // 自检阶段：显示已过时间，进度条
    if (msg.specialType === 'gameStageElapsed' && msg.progressPath) {
      if (currentStage === CurrentStage.SELF_CHECK) {
        // 暂停状态变化时的处理
        if (pauseStateChanged) {
          if (isPaused) {
            // 进入暂停：停止本地计时
            msg.localTimerPaused = true
          } else {
            // 取消暂停：用服务器当前值重新开始本地计时
            msg.localTimer = serverElapsed
            msg.lastSyncTime = now
            msg.localTimerPaused = false
            progressBlinking.value = false
          }
        }
        // 服务器数据更新时同步（非暂停状态）
        else if (serverElapsedChanged && !isPaused) {
          msg.localTimer = serverElapsed
          msg.lastSyncTime = now
          msg.localTimerPaused = false
          progressBlinking.value = false
        }

        // 检查是否超过5秒没有同步（只在非暂停状态下）
        if (!isPaused && !msg.localTimerPaused) {
          const timeSinceSync = (now - (msg.lastSyncTime || now)) / 1000
          if (timeSinceSync > 5) {
            msg.localTimerPaused = true
            progressBlinking.value = true
          }
        }

        // 本地计时计算
        if (msg.localTimerPaused || isPaused) {
          // 暂停时保持当前值
          msg.countdown = msg.localTimer || 0
        } else if (msg.localTimer !== undefined) {
          const elapsed = (now - (msg.lastSyncTime || now)) / 1000
          msg.countdown = msg.localTimer + elapsed // 已过时间增加
        } else {
          msg.countdown = 0
        }

        // 计算进度条（假设自检总时间15秒）
        const totalTime = msg.totalTime || 15
        msg.progress = Math.min(((msg.countdown || 0) / totalTime) * 100, 100)
        msg.isBlinking = progressBlinking.value

        // 更新标题
        if (isPaused) {
          msg.title = '暂停：裁判系统正在发力'
          msg.subText = '等待裁判系统恢复'
        } else if (progressBlinking.value) {
          msg.title = '系统自检'
          msg.subText = '等待服务器同步...'
        } else {
          msg.title = '系统自检'
          msg.subText = '系统自检中，请等待'
        }
      }
    }
  }

  // 处理"比赛即将开始"状态
  if (
    currentStage === CurrentStage.COUNTDOWN_5S &&
    countdown5sFinished.value &&
    !showMatchStartingSoon.value
  ) {
    showMatchStartingSoon.value = true
    // 找到当前5秒倒计时消息并更新
    const countdownMsg = messages.value.find((m) => m.configId === 'game_stage_countdown_5s')
    if (countdownMsg) {
      countdownMsg.title = '比赛即将开始'
      countdownMsg.countdown = 0
      countdownMsg.subText = '等待比赛开始...'
    }
  }

  // 更新上一次的服务器数据记录
  lastServerCountdown = serverCountdown
  lastServerElapsed = serverElapsed
  lastPausedState = isPaused
}

// ==================== 检查比赛阶段变化 ====================
const checkGameStageMessages = (): void => {
  if (!config.value) return

  const currentStage = mqttStore.gameStatus.currentStage as number

  // 注意：准备阶段和自检阶段的暂停处理已在 updateRealtimeData 中完成
  // 这里只处理阶段切换逻辑

  // 比赛中阶段：不显示弹窗，通过 StatusBar 显示倒计时
  if (currentStage === CurrentStage.FIGHTING) {
    // 清除所有比赛阶段消息
    const stageMessageIds = config.value.messages
      .filter((m) => m.specialType?.startsWith('gameStage'))
      .map((m) => m.id)
    messages.value = messages.value.filter((m) => !stageMessageIds.includes(m.configId))
    updateMessagePositions()

    // 重置状态
    countdown5sFinished.value = false
    showMatchStartingSoon.value = false
    localStageTime.value = 0
    gameStageMessageId.value = null
    return
  }

  // 结算阶段：显示结算消息
  if (currentStage === CurrentStage.SETTLEMENT) {
    const settlementConfig = config.value.messages.find((m) => m.id === 'game_stage_settlement')
    const existingMsg = messages.value.find((m) => m.configId === 'game_stage_settlement')
    if (settlementConfig && !existingMsg) {
      // 清除其他阶段消息
      const otherStageIds = config.value.messages
        .filter(
          (m) =>
            m.specialType?.startsWith('gameStage') &&
            m.id !== 'game_stage_settlement' &&
            m.id !== 'game_stage_pause'
        )
        .map((m) => m.id)
      messages.value = messages.value.filter((m) => !otherStageIds.includes(m.configId))
      updateMessagePositions()
      addMessage(settlementConfig)
    }
    return
  }

  // 其他阶段正常处理
  const stageConfigs = config.value.messages.filter(
    (m) =>
      m.specialType?.startsWith('gameStage') &&
      m.id !== 'game_stage_pause' &&
      m.trigger === 'equals' &&
      m.triggerValue === currentStage
  )

  if (stageConfigs.length > 0) {
    const stageConfig = stageConfigs[0]
    const existingMsg = messages.value.find((m) => m.configId === stageConfig.id)
    if (!existingMsg) {
      // 阶段切换时重置本地状态
      localStageTime.value = 0
      countdown5sFinished.value = false
      showMatchStartingSoon.value = false
      progressBlinking.value = false

      const otherStageIds = config.value.messages
        .filter(
          (m) =>
            m.specialType?.startsWith('gameStage') &&
            m.id !== stageConfig.id &&
            m.id !== 'game_stage_pause'
        )
        .map((m) => m.id)

      messages.value = messages.value.filter((m) => !otherStageIds.includes(m.configId))
      updateMessagePositions()

      addMessage(stageConfig)
    }
  }
}

// ==================== 监听 MQTT 数据变化 ====================
const checkMessages = (): void => {
  if (!config.value) return

  updateRealtimeData()
  updateRespawnStatus()
  checkGameStageMessages()

  for (const msgConfig of config.value.messages) {
    if (msgConfig.specialType?.startsWith('gameStage')) continue

    const currentValue = getMqttValue(msgConfig.mqttPath)

    if (checkTrigger(msgConfig, currentValue)) {
      addMessage(msgConfig)
    }

    previousValues.value[msgConfig.mqttPath] = currentValue
  }
}

// ==================== 生命周期 ====================
let checkInterval: ReturnType<typeof setInterval> | null = null
let unsubscribeGlobalMessages: (() => void) | null = null
let unsubscribeGlobalDismiss: (() => void) | null = null

/** 全局消息 ID 到本地消息 ID 的映射 */
const globalToLocalIdMap = ref<Map<string, string>>(new Map())

/**
 * 显示消息
 */
function showMessageInternal(
  level: MessageLevel,
  title: string,
  text: string,
  duration = 3000,
  globalMsgId?: string
): void {
  const displayConfig = config.value?.display ?? getDefaultConfig().display
  const top = displayConfig.topOffset + messages.value.length * (70 + displayConfig.messageGap)

  const newMessage: ActiveMessage = {
    id: `msg-${++messageIdCounter}`,
    configId: 'manual',
    level,
    title,
    text,
    duration,
    top,
    createdAt: Date.now()
  }

  messages.value.push(newMessage)

  // 如果是全局消息，建立 ID 映射
  if (globalMsgId) {
    globalToLocalIdMap.value.set(globalMsgId, newMessage.id)
  }

  if (duration > 0) {
    setTimeout(() => {
      dismissMessage(newMessage.id)
      // 清理 ID 映射
      if (globalMsgId) {
        globalToLocalIdMap.value.delete(globalMsgId)
      }
    }, duration)
  }
}

onMounted(async () => {
  await loadConfig()
  if (config.value) {
    for (const msgConfig of config.value.messages) {
      previousValues.value[msgConfig.mqttPath] = getMqttValue(msgConfig.mqttPath)
    }
  }
  checkInterval = setInterval(checkMessages, 100)

  // 订阅全局消息服务
  unsubscribeGlobalMessages = onMessage((globalMsg: GlobalMessage) => {
    showMessageInternal(
      globalMsg.level,
      globalMsg.title,
      globalMsg.text,
      globalMsg.duration,
      globalMsg.id
    )
  })

  // 订阅全局消息删除事件
  unsubscribeGlobalDismiss = onDismiss((globalMsgId: string) => {
    const localId = globalToLocalIdMap.value.get(globalMsgId)
    if (localId) {
      dismissMessage(localId)
      globalToLocalIdMap.value.delete(globalMsgId)
      console.log(`[MessageWindow] 收到删除事件，删除消息: ${globalMsgId} -> ${localId}`)
    }
  })
})

onUnmounted(() => {
  if (checkInterval) {
    clearInterval(checkInterval)
  }
  // 取消订阅全局消息
  if (unsubscribeGlobalMessages) {
    unsubscribeGlobalMessages()
  }
  // 取消订阅全局消息删除事件
  if (unsubscribeGlobalDismiss) {
    unsubscribeGlobalDismiss()
  }
})

// ==================== 暴露方法 ====================
defineExpose({
  showMessage: showMessageInternal
})
</script>

<style scoped>
/* ==================== 复活面板样式 ==================== */
.respawn-panel-overlay {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  z-index: 10000;
  pointer-events: auto;
}

.respawn-panel {
  width: 400px;
  background: linear-gradient(
    135deg,
    rgba(127, 29, 29, 0.75) 0%,
    rgba(153, 27, 27, 0.65) 50%,
    rgba(127, 29, 29, 0.75) 100%
  );
  border: 1px solid rgba(248, 113, 113, 0.4);
  border-radius: 16px;
  padding: 24px;
  backdrop-filter: blur(24px) saturate(1.2);
  -webkit-backdrop-filter: blur(24px) saturate(1.2);
  box-shadow:
    0 8px 32px rgba(0, 0, 0, 0.4),
    0 0 80px rgba(239, 68, 68, 0.15),
    inset 0 1px 0 rgba(255, 255, 255, 0.1),
    inset 0 -1px 0 rgba(0, 0, 0, 0.2);
}

.respawn-header {
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 20px;
}

.respawn-title {
  font-size: 22px;
  font-weight: 600;
  color: #fecaca;
  text-shadow:
    0 0 20px rgba(239, 68, 68, 0.6),
    0 2px 4px rgba(0, 0, 0, 0.5);
  letter-spacing: 2px;
}

.respawn-progress-section {
  margin-bottom: 20px;
}

.respawn-progress-label {
  font-size: 14px;
  color: #94a3b8;
  margin-bottom: 8px;
  text-align: center;
}

.respawn-progress-bar {
  height: 16px;
  background: rgba(0, 0, 0, 0.5);
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.respawn-progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #ef4444, #f97316, #eab308);
  border-radius: 8px;
  transition: width 0.3s ease;
  box-shadow: 0 0 10px rgba(239, 68, 68, 0.5);
}

.respawn-countdown {
  font-size: 16px;
  font-weight: bold;
  color: #fbbf24;
  text-align: center;
  margin-top: 8px;
}

.respawn-buttons {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.respawn-buttons-row {
  display: flex;
  gap: 12px;
}

.respawn-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 12px 16px;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
}

.respawn-btn .btn-icon {
  font-size: 18px;
}

.respawn-btn .btn-text {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.respawn-btn .gold-cost {
  font-size: 11px;
  opacity: 0.8;
}

.free-btn {
  background: linear-gradient(135deg, #22c55e, #16a34a);
  color: white;
}

.free-btn:hover:not(.disabled) {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(34, 197, 94, 0.4);
}

.pay-btn {
  background: linear-gradient(135deg, #eab308, #ca8a04);
  color: white;
}

.pay-btn:hover:not(.disabled) {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(234, 179, 8, 0.4);
}

.confirm-btn {
  background: linear-gradient(135deg, #3b82f6, #2563eb);
  color: white;
  padding: 16px;
  font-size: 16px;
}

.confirm-btn:hover:not(.disabled) {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(59, 130, 246, 0.4);
}

.respawn-btn.disabled {
  background: #374151;
  color: #6b7280;
  cursor: not-allowed;
  opacity: 0.6;
}

/* 复活面板动画 */
.respawn-fade-enter-active,
.respawn-fade-leave-active {
  transition: all 0.3s ease;
}

.respawn-fade-enter-from,
.respawn-fade-leave-to {
  opacity: 0;
  transform: translate(-50%, -50%) scale(0.9);
}

/* ==================== 消息通知样式 ==================== */
.message-container {
  position: fixed;
  top: 0;
  left: 50%;
  transform: translateX(-50%);
  z-index: 9999;
  pointer-events: none;
  width: 360px;
}

.message-window {
  position: absolute;
  left: 0;
  width: 100%;
  pointer-events: auto;
  border-radius: 8px;
  overflow: hidden;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  box-shadow:
    0 4px 20px rgba(0, 0, 0, 0.3),
    0 0 1px rgba(255, 255, 255, 0.1) inset;
  transition: top 0.3s ease;
}

.message-window.level-info {
  background: rgba(34, 197, 94, 0.25);
  border: 1px solid rgba(34, 197, 94, 0.4);
}

.message-window.level-warning {
  background: rgba(234, 179, 8, 0.25);
  border: 1px solid rgba(234, 179, 8, 0.4);
}

.message-window.level-danger {
  background: rgba(239, 68, 68, 0.25);
  border: 1px solid rgba(239, 68, 68, 0.4);
}

.message-content {
  display: flex;
  align-items: flex-start;
  padding: 12px 16px;
  gap: 12px;
}

.message-icon {
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  font-size: 14px;
  font-weight: bold;
}

.level-info .message-icon {
  background: rgba(34, 197, 94, 0.3);
  color: #22c55e;
}

.level-warning .message-icon {
  background: rgba(234, 179, 8, 0.3);
  color: #eab308;
}

.level-danger .message-icon {
  background: rgba(239, 68, 68, 0.3);
  color: #ef4444;
}

.message-body {
  flex: 1;
  min-width: 0;
}

.message-title {
  font-size: 14px;
  font-weight: 600;
  color: #fff;
  margin-bottom: 4px;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
}

.message-text {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.85);
  line-height: 1.4;
}

.countdown-display {
  font-size: 28px;
  font-weight: bold;
  color: #fff;
  font-family: 'Consolas', 'Monaco', monospace;
  text-shadow: 0 2px 4px rgba(0, 0, 0, 0.5);
  margin: 4px 0;
}

.elapsed-time-display {
  font-size: 20px;
  font-weight: bold;
  color: #fbbf24;
  font-family: 'Consolas', 'Monaco', monospace;
  text-shadow: 0 2px 4px rgba(0, 0, 0, 0.5);
  margin: 4px 0;
}

.message-sub-text {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.6);
  margin-top: 2px;
}

.progress-bar-container {
  height: 8px;
  background: rgba(255, 255, 255, 0.15);
  border-radius: 4px;
  overflow: hidden;
  margin: 8px 0;
}

.progress-bar-container.blinking {
  animation: blink-border 0.8s ease-in-out infinite;
}

.progress-bar-container.blinking .progress-bar-fill {
  animation: blink-fill 0.8s ease-in-out infinite;
}

@keyframes blink-border {
  0%,
  100% {
    background: rgba(255, 255, 255, 0.15);
    border: 1px solid transparent;
  }
  50% {
    background: rgba(234, 179, 8, 0.3);
    border: 1px solid rgba(234, 179, 8, 0.6);
  }
}

@keyframes blink-fill {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}

.progress-bar-fill {
  height: 100%;
  background: linear-gradient(90deg, #22c55e, #4ade80);
  border-radius: 4px;
  transition: width 0.3s ease;
}

.level-warning .progress-bar-fill {
  background: linear-gradient(90deg, #eab308, #facc15);
}

.message-close {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.1);
  border: none;
  border-radius: 4px;
  color: rgba(255, 255, 255, 0.6);
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s;
}

.message-close:hover {
  background: rgba(255, 255, 255, 0.2);
  color: #fff;
}

.message-progress {
  height: 3px;
  background: rgba(255, 255, 255, 0.3);
  animation: progress-shrink linear forwards;
}

.level-info .message-progress {
  background: #22c55e;
}

.level-warning .message-progress {
  background: #eab308;
}

.level-danger .message-progress {
  background: #ef4444;
}

@keyframes progress-shrink {
  from {
    width: 100%;
  }
  to {
    width: 0%;
  }
}

.message-slide-enter-active {
  animation: slide-in 0.3s ease-out;
}

.message-slide-leave-active {
  animation: slide-out 0.3s ease-in;
}

@keyframes slide-in {
  from {
    opacity: 0;
    transform: translateY(-20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes slide-out {
  from {
    opacity: 1;
    transform: translateX(0);
  }
  to {
    opacity: 0;
    transform: translateX(100%);
  }
}
</style>
