<template>
  <div class="message-list-container">
    <!-- 固定状态区域 -->
    <div class="status-section">
      <!-- Buff 效果行 -->
      <div class="buff-row">
        <div
          v-for="buff in activeBuffs"
          :key="buff.type"
          class="buff-icon"
          :class="getBuffClass(buff.type)"
          @mouseenter="showBuffTooltip($event, buff)"
          @mouseleave="hideTooltip"
        >
          <div class="buff-icon-inner">{{ getBuffIcon(buff.type) }}</div>
          <div v-if="buff.leftTime > 0" class="buff-timer">{{ Math.ceil(buff.leftTime) }}s</div>
        </div>
        <div v-if="activeBuffs.length === 0" class="no-buff">
          <span class="no-buff-text">无增益</span>
        </div>
      </div>

      <!-- 判罚状态行 -->
      <div class="penalty-row">
        <div
          v-for="penalty in activePenalties"
          :key="penalty.type"
          class="penalty-icon"
          :class="getPenaltyClass(penalty.type)"
          @mouseenter="showPenaltyTooltip($event, penalty)"
          @mouseleave="hideTooltip"
        >
          <div class="penalty-icon-inner">{{ getPenaltyIcon(penalty.type) }}</div>
        </div>
        <div v-if="activePenalties.length === 0" class="no-penalty">
          <span class="no-penalty-text">无判罚</span>
        </div>
      </div>
    </div>

    <!-- 悬停提示面板 -->
    <Teleport to="body">
      <Transition name="tooltip-fade">
        <div
          v-if="tooltipVisible"
          class="status-tooltip"
          :style="{ left: tooltipX + 'px', top: tooltipY + 'px' }"
        >
          <div class="tooltip-header">
            <span class="tooltip-icon">{{ tooltipData.icon }}</span>
            <span class="tooltip-name">{{ tooltipData.name }}</span>
          </div>
          <div class="tooltip-effect">{{ tooltipData.effect }}</div>
          <div v-if="tooltipData.duration" class="tooltip-duration">
            持续时间: {{ tooltipData.duration }}
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 经验条区域 -->
    <div class="experience-section">
      <div class="exp-label">
        <span class="exp-text">EXP</span>
        <span class="exp-value">{{ currentExperience }} / {{ experienceForUpgrade }}</span>
      </div>
      <div class="exp-bar-bg">
        <div class="exp-bar-fill" :style="{ width: expPercentage + '%' }"></div>
      </div>
    </div>

    <!-- 分隔线 -->
    <div class="section-divider"></div>

    <!-- 滚动消息区域 -->
    <div class="messages-section">
      <!-- 本车消息 -->
      <div class="message-category">
        <div class="category-header">
          <span class="category-icon">🤖</span>
          <span class="category-title">本车消息</span>
        </div>
        <div ref="robotMessagesRef" class="message-scroll-area">
          <TransitionGroup name="message-fade">
            <div
              v-for="msg in robotMessages"
              :key="msg.id"
              class="message-item"
              :class="'message-' + msg.level"
            >
              <span class="message-time">{{ formatTime(msg.timestamp) }}</span>
              <span class="message-content">{{ msg.content }}</span>
            </div>
          </TransitionGroup>
          <div v-if="robotMessages.length === 0" class="no-messages">暂无消息</div>
        </div>
      </div>

      <!-- 系统消息 -->
      <div class="message-category">
        <div class="category-header">
          <span class="category-icon">📢</span>
          <span class="category-title">系统消息</span>
        </div>
        <div ref="systemMessagesRef" class="message-scroll-area">
          <TransitionGroup name="message-fade">
            <div
              v-for="msg in systemMessages"
              :key="msg.id"
              class="message-item"
              :class="'message-' + msg.level"
            >
              <span class="message-time">{{ formatTime(msg.timestamp) }}</span>
              <span class="message-content">{{ msg.content }}</span>
            </div>
          </TransitionGroup>
          <div v-if="systemMessages.length === 0" class="no-messages">暂无消息</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useMqttDataStore } from '../store/modules/mqtt_data'

// ==================== 类型定义 ====================
interface BuffInfo {
  type: number
  level: number
  maxTime: number
  leftTime: number
}

interface PenaltyInfo {
  type: number
  timestamp: number
  duration?: number // 持续时间（秒）
}

interface MessageItem {
  id: string
  content: string
  level: 'info' | 'warning' | 'error' | 'success'
  timestamp: number
  category: 'robot' | 'system'
}

// ==================== Store ====================
const mqttDataStore = useMqttDataStore()

// ==================== Refs ====================
const robotMessagesRef = ref<HTMLElement | null>(null)
const systemMessagesRef = ref<HTMLElement | null>(null)

// ==================== 悬停提示状态 ====================
const tooltipVisible = ref(false)
const tooltipX = ref(0)
const tooltipY = ref(0)
const tooltipData = ref({
  icon: '',
  name: '',
  effect: '',
  duration: ''
})

// ==================== 消息列表 ====================
const robotMessages = ref<MessageItem[]>([])
const systemMessages = ref<MessageItem[]>([])
const maxMessages = 50

// ==================== 获取当前机器人数据 ====================
const currentRobot = computed(() => {
  const robotId = mqttDataStore.currentRobotId
  if (!robotId) return null
  return mqttDataStore.getRobot(robotId)
})

// ==================== Buff 数据 ====================
const activeBuffs = computed<BuffInfo[]>(() => {
  const robotId = mqttDataStore.currentRobotId
  if (!robotId) return []

  // 从 MQTT Store 的 activeBuffs 中获取当前机器人的 Buff
  const storeBuffs = mqttDataStore.activeBuffs
  if (!storeBuffs || storeBuffs.length === 0) return []

  // 过滤出当前机器人的 Buff 并转换格式
  return storeBuffs
    .filter((buff) => buff.robotId === robotId && buff.buffLeftTime > 0)
    .map((buff) => ({
      type: buff.buffType,
      level: buff.buffLevel || 1,
      maxTime: buff.buffMaxTime || 30,
      leftTime: buff.buffLeftTime
    }))
})

// ==================== 判罚数据 ====================
const activePenalties = computed<PenaltyInfo[]>(() => {
  const penalties: PenaltyInfo[] = []

  // 从 store 的 activePenalties Map 获取所有活跃判罚
  const storePenalties = mqttDataStore.activePenalties
  if (storePenalties && storePenalties.size > 0) {
    storePenalties.forEach((penalty, penaltyType) => {
      penalties.push({
        type: penaltyType,
        timestamp: penalty.startTime || Date.now(),
        duration: penalty.penaltyEffectSec
      })
    })
  }

  // 额外检查：从当前机器人状态检查超热量（实时状态）
  if (currentRobot.value) {
    const robot = currentRobot.value
    // 如果机器人热量超限且没有已存在的超热量判罚
    if (robot.maxHeat > 0 && robot.currentHeat > robot.maxHeat) {
      const hasHeatPenalty = penalties.some((p) => p.type === 5)
      if (!hasHeatPenalty) {
        penalties.push({
          type: 5, // 超热量
          timestamp: Date.now()
        })
      }
    }
  }

  return penalties
})

// ==================== 经验数据 ====================
const currentExperience = computed(() => {
  return currentRobot.value?.currentExperience || 0
})

const experienceForUpgrade = computed(() => {
  return currentRobot.value?.experienceForUpgrade || 100
})

const expPercentage = computed(() => {
  if (experienceForUpgrade.value <= 0) return 0
  return Math.min(100, (currentExperience.value / experienceForUpgrade.value) * 100)
})

// ==================== Buff 辅助函数 ====================
const buffConfig: Record<number, { name: string; icon: string; class: string; effect: string }> = {
  1: { name: '攻击增益', icon: '⚔️', class: 'buff-attack', effect: '提升攻击伤害' },
  2: { name: '防御增益', icon: '🛡️', class: 'buff-defense', effect: '减少受到的伤害' },
  3: { name: '热量冷却', icon: '❄️', class: 'buff-cooling', effect: '加速枪口热量冷却' },
  4: { name: '底盘功率', icon: '⚡', class: 'buff-power', effect: '提升底盘最大功率' },
  5: { name: '血量恢复', icon: '💚', class: 'buff-heal', effect: '持续恢复血量' },
  6: { name: '可兑换弹药', icon: '🎯', class: 'buff-ammo', effect: '增加弹药兑换额度' },
  7: { name: '地形跨越', icon: '🏃', class: 'buff-terrain', effect: '允许跨越特定地形' }
}

function getBuffIcon(type: number): string {
  return buffConfig[type]?.icon || '✨'
}

function getBuffClass(type: number): string {
  return buffConfig[type]?.class || 'buff-default'
}

// ==================== 判罚辅助函数 ====================
const penaltyConfig: Record<number, { name: string; icon: string; class: string; effect: string }> =
  {
    1: {
      name: '黄牌警告',
      icon: '🟨',
      class: 'penalty-yellow',
      effect: '警告处罚，累计可能导致停赛'
    },
    2: {
      name: '双黄牌',
      icon: '🟨🟨',
      class: 'penalty-double-yellow',
      effect: '累计两张黄牌，行动受限'
    },
    3: { name: '红牌', icon: '🟥', class: 'penalty-red', effect: '严重违规，机器人停赛' },
    4: { name: '超功率', icon: '⚡', class: 'penalty-power', effect: '底盘功率超出限制，扣血惩罚' },
    5: { name: '超热量', icon: '🔥', class: 'penalty-heat', effect: '枪口热量超限，扣血惩罚' },
    6: { name: '超射速', icon: '💨', class: 'penalty-speed', effect: '射速超出限制，扣血惩罚' }
  }

function getPenaltyIcon(type: number): string {
  return penaltyConfig[type]?.icon || '⚠️'
}

function getPenaltyClass(type: number): string {
  return penaltyConfig[type]?.class || 'penalty-default'
}

// ==================== 悬停提示函数 ====================
function showBuffTooltip(event: MouseEvent, buff: BuffInfo): void {
  const config = buffConfig[buff.type]
  tooltipData.value = {
    icon: config?.icon || '✨',
    name: config?.name || `增益 ${buff.type}`,
    effect: config?.effect || '未知效果',
    duration: buff.leftTime > 0 ? `${Math.ceil(buff.leftTime)}秒` : ''
  }
  updateTooltipPosition(event)
  tooltipVisible.value = true
}

function showPenaltyTooltip(event: MouseEvent, penalty: PenaltyInfo): void {
  const config = penaltyConfig[penalty.type]
  tooltipData.value = {
    icon: config?.icon || '⚠️',
    name: config?.name || `判罚 ${penalty.type}`,
    effect: config?.effect || '未知效果',
    duration: penalty.duration && penalty.duration > 0 ? `${penalty.duration}秒` : ''
  }
  updateTooltipPosition(event)
  tooltipVisible.value = true
}

function updateTooltipPosition(event: MouseEvent): void {
  // 在图标右上方显示
  tooltipX.value = event.clientX + 10
  tooltipY.value = event.clientY - 60

  // 防止超出屏幕右侧
  if (tooltipX.value + 180 > window.innerWidth) {
    tooltipX.value = event.clientX - 190
  }
  // 防止超出屏幕顶部
  if (tooltipY.value < 10) {
    tooltipY.value = event.clientY + 20
  }
}

function hideTooltip(): void {
  tooltipVisible.value = false
}

// ==================== 消息辅助函数 ====================
function formatTime(timestamp: number): string {
  const date = new Date(timestamp)
  return date.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
}

function addMessage(
  content: string,
  category: 'robot' | 'system',
  level: 'info' | 'warning' | 'error' | 'success' = 'info'
): void {
  const msg: MessageItem = {
    id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    content,
    level,
    timestamp: Date.now(),
    category
  }

  if (category === 'robot') {
    robotMessages.value.unshift(msg)
    if (robotMessages.value.length > maxMessages) {
      robotMessages.value.pop()
    }
  } else {
    systemMessages.value.unshift(msg)
    if (systemMessages.value.length > maxMessages) {
      systemMessages.value.pop()
    }
  }
}

// ==================== 监听数据变化生成消息 ====================
let previousHealth = 0
let previousPenaltyType = 0

// 监听血量变化
watch(
  () => currentRobot.value?.currentHealth,
  (newHealth, oldHealth) => {
    if (oldHealth !== undefined && newHealth !== undefined) {
      if (newHealth < oldHealth) {
        const damage = oldHealth - newHealth
        addMessage(`受到 ${damage} 点伤害`, 'robot', 'warning')
      } else if (newHealth > oldHealth && previousHealth > 0) {
        const heal = newHealth - oldHealth
        addMessage(`恢复 ${heal} 点血量`, 'robot', 'success')
      }
      previousHealth = newHealth
    }
  }
)

// 监听判罚变化
watch(
  () => mqttDataStore.penaltyInfo?.penaltyType || 0,
  (newType) => {
    if (newType && newType > 0 && newType !== previousPenaltyType) {
      const config = penaltyConfig[newType]
      const penaltyName = config?.name || `判罚 ${newType}`
      addMessage(`收到判罚：${penaltyName}`, 'robot', 'error')
      previousPenaltyType = newType
    }
  }
)

// 监听比赛阶段变化
watch(
  () => mqttDataStore.gameStatus.currentStage,
  (newStage, oldStage) => {
    if (newStage !== oldStage) {
      const stageNames: Record<number, string> = {
        0: '未开始',
        1: '准备阶段',
        2: '自检阶段',
        3: '5秒倒计时',
        4: '比赛进行中',
        5: '结算阶段'
      }
      const stageName = stageNames[newStage] || `阶段 ${newStage}`
      addMessage(`比赛阶段：${stageName}`, 'system', 'info')
    }
  }
)

// ==================== 生命周期 ====================
onMounted(() => {
  // 添加初始消息
  addMessage('消息列表已加载', 'system', 'info')

  // 初始化 previousHealth
  previousHealth = currentRobot.value?.currentHealth || 0
})

// 暴露添加消息的方法供外部调用
defineExpose({
  addMessage
})
</script>

<style scoped>
.message-list-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 8px;
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 11px;
  color: #e0e0e0;
  background: transparent;
  border-radius: 8px;
  overflow: hidden;
}

/* 状态区域 */
.status-section {
  flex-shrink: 0;
  padding: 6px 0;
}

.buff-row,
.penalty-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 6px;
  min-height: 28px;
  align-items: center;
}

.buff-icon,
.penalty-icon {
  position: relative;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  cursor: help;
  transition:
    transform 0.2s,
    box-shadow 0.2s;
}

.buff-icon:hover,
.penalty-icon:hover {
  transform: scale(1.15);
}

.buff-icon-inner,
.penalty-icon-inner {
  z-index: 1;
}

.buff-timer {
  position: absolute;
  bottom: -4px;
  right: -4px;
  font-size: 8px;
  background: rgba(0, 0, 0, 0.8);
  padding: 1px 3px;
  border-radius: 4px;
  color: #fff;
}

/* Buff 样式 */
.buff-attack {
  background: linear-gradient(135deg, #ef4444, #dc2626);
  box-shadow: 0 0 8px rgba(239, 68, 68, 0.5);
}
.buff-defense {
  background: linear-gradient(135deg, #3b82f6, #2563eb);
  box-shadow: 0 0 8px rgba(59, 130, 246, 0.5);
}
.buff-cooling {
  background: linear-gradient(135deg, #06b6d4, #0891b2);
  box-shadow: 0 0 8px rgba(6, 182, 212, 0.5);
}
.buff-power {
  background: linear-gradient(135deg, #eab308, #ca8a04);
  box-shadow: 0 0 8px rgba(234, 179, 8, 0.5);
}
.buff-heal {
  background: linear-gradient(135deg, #22c55e, #16a34a);
  box-shadow: 0 0 8px rgba(34, 197, 94, 0.5);
}
.buff-ammo {
  background: linear-gradient(135deg, #a855f7, #9333ea);
  box-shadow: 0 0 8px rgba(168, 85, 247, 0.5);
}
.buff-terrain {
  background: linear-gradient(135deg, #f97316, #ea580c);
  box-shadow: 0 0 8px rgba(249, 115, 22, 0.5);
}
.buff-default {
  background: linear-gradient(135deg, #6b7280, #4b5563);
}

/* 判罚样式 */
.penalty-yellow {
  background: linear-gradient(135deg, #fbbf24, #f59e0b);
  box-shadow: 0 0 8px rgba(251, 191, 36, 0.6);
}
.penalty-double-yellow {
  background: linear-gradient(135deg, #f59e0b, #d97706);
  box-shadow: 0 0 10px rgba(245, 158, 11, 0.7);
}
.penalty-red {
  background: linear-gradient(135deg, #ef4444, #b91c1c);
  box-shadow: 0 0 10px rgba(239, 68, 68, 0.7);
  animation: pulse-red 1s infinite;
}
.penalty-power {
  background: linear-gradient(135deg, #f97316, #ea580c);
  box-shadow: 0 0 8px rgba(249, 115, 22, 0.5);
}
.penalty-heat {
  background: linear-gradient(135deg, #dc2626, #991b1b);
  box-shadow: 0 0 8px rgba(220, 38, 38, 0.5);
}
.penalty-speed {
  background: linear-gradient(135deg, #8b5cf6, #7c3aed);
  box-shadow: 0 0 8px rgba(139, 92, 246, 0.5);
}
.penalty-default {
  background: linear-gradient(135deg, #6b7280, #4b5563);
}

@keyframes pulse-red {
  0%,
  100% {
    box-shadow: 0 0 10px rgba(239, 68, 68, 0.7);
  }
  50% {
    box-shadow: 0 0 20px rgba(239, 68, 68, 0.9);
  }
}

.no-buff,
.no-penalty {
  color: #6b7280;
  font-size: 10px;
  font-style: italic;
}

/* 经验条区域 */
.experience-section {
  flex-shrink: 0;
  padding: 4px 0;
}

.exp-label {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}

.exp-text {
  color: #a855f7;
  font-weight: bold;
  font-size: 10px;
}

.exp-value {
  color: #9ca3af;
  font-size: 9px;
}

.exp-bar-bg {
  height: 6px;
  background: rgba(168, 85, 247, 0.2);
  border-radius: 3px;
  overflow: hidden;
}

.exp-bar-fill {
  height: 100%;
  background: linear-gradient(90deg, #a855f7, #c084fc);
  border-radius: 3px;
  transition: width 0.3s ease;
}

/* 分隔线 */
.section-divider {
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.2), transparent);
  margin: 8px 0;
}

/* 消息区域 */
.messages-section {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
  overflow: hidden;
}

.message-category {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.category-header {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  flex-shrink: 0;
}

.category-icon {
  font-size: 12px;
}

.category-title {
  font-size: 10px;
  color: #9ca3af;
  font-weight: 500;
}

.message-scroll-area {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 4px 0;
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.2) transparent;
}

.message-scroll-area::-webkit-scrollbar {
  width: 4px;
}

.message-scroll-area::-webkit-scrollbar-track {
  background: transparent;
}

.message-scroll-area::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.2);
  border-radius: 2px;
}

.message-item {
  display: flex;
  gap: 6px;
  padding: 6px 4px;
  border-radius: 0;
  margin-bottom: 0;
  background: transparent;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  transition: background 0.2s;
}

.message-item:last-child {
  border-bottom: none;
}

.message-item:hover {
  background: rgba(255, 255, 255, 0.05);
}

.message-time {
  color: #6b7280;
  font-size: 9px;
  flex-shrink: 0;
}

.message-content {
  flex: 1;
  word-break: break-word;
  line-height: 1.4;
}

/* 消息等级样式 */
.message-info .message-content {
  color: #9ca3af;
}
.message-warning .message-content {
  color: #fbbf24;
}
.message-error .message-content {
  color: #ef4444;
}
.message-success .message-content {
  color: #22c55e;
}

.no-messages {
  color: #4b5563;
  font-size: 10px;
  text-align: center;
  padding: 8px;
  font-style: italic;
}

/* 消息动画 */
.message-fade-enter-active {
  transition: all 0.3s ease;
}

.message-fade-leave-active {
  transition: all 0.2s ease;
}

.message-fade-enter-from {
  opacity: 0;
  transform: translateX(-10px);
}

.message-fade-leave-to {
  opacity: 0;
  transform: translateX(10px);
}
</style>

<!-- 非 scoped 样式 - 用于 Teleport 到 body 的元素 -->
<style>
/* 悬停提示面板样式 - 必须非 scoped 因为 Teleport 到 body */
.status-tooltip {
  position: fixed;
  z-index: 10000;
  min-width: 160px;
  max-width: 220px;
  padding: 10px 12px;
  background: rgba(15, 20, 30, 0.95);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  pointer-events: none;
}

.status-tooltip .tooltip-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
  padding-bottom: 6px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.status-tooltip .tooltip-icon {
  font-size: 18px;
}

.status-tooltip .tooltip-name {
  font-size: 13px;
  font-weight: 600;
  color: #e2e8f0;
}

.status-tooltip .tooltip-effect {
  font-size: 11px;
  color: #94a3b8;
  line-height: 1.5;
  margin-bottom: 4px;
}

.status-tooltip .tooltip-duration {
  font-size: 10px;
  color: #60a5fa;
  font-weight: 500;
}

/* 悬停提示动画 - 非 scoped */
.tooltip-fade-enter-active {
  transition: all 0.15s ease-out;
}

.tooltip-fade-leave-active {
  transition: all 0.1s ease-in;
}

.tooltip-fade-enter-from,
.tooltip-fade-leave-to {
  opacity: 0;
  transform: translateY(4px);
}
</style>
