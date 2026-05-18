<template>
  <div class="message-list-container">
    <!-- 固定状态区域: Buff 和判罚效果 -->
    <div class="status-section">
      <div class="section-title">状态效果</div>

      <!-- Buff 效果列表 -->
      <div class="buff-list">
        <div
          v-for="buff in activeBuffs"
          :key="`buff-${buff.robotId}-${buff.buffType}`"
          class="buff-item"
          :class="getBuffClass(buff.buffType)"
        >
          <div class="buff-icon">{{ getBuffIcon(buff.buffType) }}</div>
          <div class="buff-info">
            <div class="buff-name">{{ getBuffName(buff.buffType) }}</div>
            <div class="buff-timer">
              <div class="buff-timer-fill" :style="{ width: getBuffTimePercent(buff) + '%' }"></div>
            </div>
            <div class="buff-time">{{ buff.buffLeftTime }}s</div>
          </div>
        </div>

        <!-- 判罚效果显示 -->
        <div
          v-if="hasPenalty && currentPenalty"
          class="buff-item penalty-item"
          :class="getPenaltyClass(currentPenalty.penaltyType)"
        >
          <div class="buff-icon">{{ getPenaltyIcon(currentPenalty.penaltyType) }}</div>
          <div class="buff-info">
            <div class="buff-name">{{ getPenaltyName(currentPenalty.penaltyType) }}</div>
            <div v-if="currentPenalty.penaltyEffectSec > 0" class="buff-time penalty-time">
              {{ currentPenalty.penaltyEffectSec }}s
            </div>
          </div>
        </div>

        <!-- 无状态提示 -->
        <div v-if="activeBuffs.length === 0 && !hasPenalty" class="no-status">无激活状态</div>
      </div>
    </div>

    <!-- 经验条 -->
    <div class="exp-section">
      <div class="exp-header">
        <span class="exp-label">EXP</span>
        <span class="exp-value">{{ currentExperience }} / {{ experienceForUpgrade }}</span>
      </div>
      <div class="exp-bar">
        <div class="exp-fill" :style="{ width: expPercent + '%' }"></div>
      </div>
    </div>

    <!-- 消息滚动区域 -->
    <div class="message-scroll-section">
      <!-- 本车消息 Tab -->
      <div class="message-tabs">
        <button
          class="tab-btn"
          :class="{ active: activeTab === 'robot' }"
          @click="activeTab = 'robot'"
        >
          本车消息
        </button>
        <button
          class="tab-btn"
          :class="{ active: activeTab === 'system' }"
          @click="activeTab = 'system'"
        >
          系统消息
        </button>
      </div>

      <!-- 消息列表 -->
      <div class="message-scroll-area" ref="messageScrollRef">
        <TransitionGroup name="message-fade" tag="div" class="message-items">
          <div
            v-for="msg in displayMessages"
            :key="msg.id"
            class="message-item"
            :class="[`level-${msg.level}`]"
          >
            <span class="msg-time">{{ formatTime(msg.timestamp) }}</span>
            <span class="msg-content">{{ msg.content }}</span>
          </div>
        </TransitionGroup>
        <div v-if="displayMessages.length === 0" class="no-messages">暂无消息</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useMqttDataStore } from '../../store/modules/mqtt_data'
import { BuffType, PenaltyType } from '../../utils/mqtt_protocol_constants'

// ==================== Store ====================
const mqttStore = useMqttDataStore()

// ==================== 状态 ====================
const activeTab = ref<'robot' | 'system'>('robot')
const messageScrollRef = ref<HTMLElement | null>(null)

// 消息记录
interface MessageRecord {
  id: number
  level: 'info' | 'warning' | 'danger'
  content: string
  timestamp: number
  type: 'robot' | 'system'
}

const robotMessages = ref<MessageRecord[]>([])
const systemMessages = ref<MessageRecord[]>([])
let messageIdCounter = 0

// ==================== 计算属性 ====================
// 当前机器人数据
const currentRobot = computed(() => {
  const robotId = mqttStore.currentRobotId
  if (robotId > 100) {
    return mqttStore.blueRobots.get(robotId)
  } else {
    return mqttStore.redRobots.get(robotId)
  }
})

// 当前机器人的 Buff（过滤当前机器人）
const activeBuffs = computed(() => {
  const robotId = mqttStore.currentRobotId
  return mqttStore.activeBuffs.filter((b) => b.robotId === robotId && b.buffLeftTime > 0)
})

// 当前判罚信息
const currentPenalty = computed(() => mqttStore.penaltyInfo)

// 是否有判罚（用于检测判罚状态）
const hasPenalty = computed(() => {
  return currentPenalty.value != null && currentPenalty.value.penaltyEffectSec > 0
})

// 经验值
const currentExperience = computed(() => currentRobot.value?.currentExperience ?? 0)
const experienceForUpgrade = computed(() => currentRobot.value?.experienceForUpgrade ?? 100)
const expPercent = computed(() => {
  if (experienceForUpgrade.value === 0) return 0
  return Math.min(100, (currentExperience.value / experienceForUpgrade.value) * 100)
})

// 显示的消息
const displayMessages = computed(() => {
  const msgs = activeTab.value === 'robot' ? robotMessages.value : systemMessages.value
  return msgs.slice(-50) // 最多显示50条
})

// ==================== Buff 辅助函数 ====================
function getBuffIcon(type: BuffType): string {
  const icons: Record<number, string> = {
    [BuffType.ATTACK_BOOST]: '⚔️',
    [BuffType.DEFENSE_BOOST]: '🛡️',
    [BuffType.HEAT_COOLING_BOOST]: '❄️',
    [BuffType.CHASSIS_POWER_BOOST]: '⚡',
    [BuffType.HEALTH_REGEN]: '💚',
    [BuffType.EXCHANGEABLE_AMMO]: '🎯',
    [BuffType.TERRAIN_CROSSING]: '🏃'
  }
  return icons[type] || '✨'
}

function getBuffName(type: BuffType): string {
  const names: Record<number, string> = {
    [BuffType.ATTACK_BOOST]: '攻击增益',
    [BuffType.DEFENSE_BOOST]: '防御增益',
    [BuffType.HEAT_COOLING_BOOST]: '冷却增益',
    [BuffType.CHASSIS_POWER_BOOST]: '功率增益',
    [BuffType.HEALTH_REGEN]: '回血增益',
    [BuffType.EXCHANGEABLE_AMMO]: '发弹增益',
    [BuffType.TERRAIN_CROSSING]: '地形跨越'
  }
  return names[type] || '未知增益'
}

function getBuffClass(type: BuffType): string {
  const classes: Record<number, string> = {
    [BuffType.ATTACK_BOOST]: 'buff-attack',
    [BuffType.DEFENSE_BOOST]: 'buff-defense',
    [BuffType.HEAT_COOLING_BOOST]: 'buff-cooling',
    [BuffType.CHASSIS_POWER_BOOST]: 'buff-power',
    [BuffType.HEALTH_REGEN]: 'buff-heal',
    [BuffType.EXCHANGEABLE_AMMO]: 'buff-ammo',
    [BuffType.TERRAIN_CROSSING]: 'buff-terrain'
  }
  return classes[type] || ''
}

function getBuffTimePercent(buff: { buffMaxTime: number; buffLeftTime: number }): number {
  if (buff.buffMaxTime === 0) return 100
  return (buff.buffLeftTime / buff.buffMaxTime) * 100
}

// ==================== 判罚辅助函数 ====================
function getPenaltyIcon(type: PenaltyType): string {
  const icons: Record<number, string> = {
    [PenaltyType.YELLOW_CARD]: '🟨',
    [PenaltyType.BOTH_YELLOW_CARDS]: '🟨🟨',
    [PenaltyType.RED_CARD]: '🟥',
    [PenaltyType.OVER_POWER]: '⚡',
    [PenaltyType.OVER_HEAT]: '🔥',
    [PenaltyType.OVER_FIRE_RATE]: '💨'
  }
  return icons[type] || '⚠️'
}

function getPenaltyName(type: PenaltyType): string {
  const names: Record<number, string> = {
    [PenaltyType.YELLOW_CARD]: '黄牌警告',
    [PenaltyType.BOTH_YELLOW_CARDS]: '双黄牌',
    [PenaltyType.RED_CARD]: '红牌罚下',
    [PenaltyType.OVER_POWER]: '超功率',
    [PenaltyType.OVER_HEAT]: '超热量',
    [PenaltyType.OVER_FIRE_RATE]: '超射速'
  }
  return names[type] || '未知判罚'
}

function getPenaltyClass(type: PenaltyType): string {
  if (type === PenaltyType.YELLOW_CARD || type === PenaltyType.BOTH_YELLOW_CARDS) {
    return 'penalty-yellow'
  }
  if (type === PenaltyType.RED_CARD) {
    return 'penalty-red'
  }
  return 'penalty-warning'
}

// ==================== 时间格式化 ====================
function formatTime(timestamp: number): string {
  const date = new Date(timestamp)
  return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}:${date.getSeconds().toString().padStart(2, '0')}`
}

// ==================== 添加消息 ====================
function addRobotMessage(level: 'info' | 'warning' | 'danger', content: string): void {
  robotMessages.value.push({
    id: ++messageIdCounter,
    level,
    content,
    timestamp: Date.now(),
    type: 'robot'
  })
  // 限制消息数量
  if (robotMessages.value.length > 100) {
    robotMessages.value = robotMessages.value.slice(-100)
  }
  scrollToBottom()
}

function addSystemMessage(level: 'info' | 'warning' | 'danger', content: string): void {
  systemMessages.value.push({
    id: ++messageIdCounter,
    level,
    content,
    timestamp: Date.now(),
    type: 'system'
  })
  if (systemMessages.value.length > 100) {
    systemMessages.value = systemMessages.value.slice(-100)
  }
  scrollToBottom()
}

function scrollToBottom(): void {
  setTimeout(() => {
    if (messageScrollRef.value) {
      messageScrollRef.value.scrollTop = messageScrollRef.value.scrollHeight
    }
  }, 50)
}

// ==================== 监听状态变化 ====================
// 监听 Buff 变化
watch(
  () => mqttStore.activeBuffs,
  (newBuffs, oldBuffs) => {
    const robotId = mqttStore.currentRobotId
    // 检测新获得的 Buff
    for (const buff of newBuffs) {
      if (buff.robotId !== robotId) continue
      const existed = oldBuffs?.find(
        (b) => b.robotId === buff.robotId && b.buffType === buff.buffType
      )
      if (!existed) {
        addRobotMessage('info', `获得 ${getBuffName(buff.buffType)}`)
      }
    }
  },
  { deep: true }
)

// 监听判罚变化
watch(
  () => mqttStore.penaltyInfo,
  (newPenalty, oldPenalty) => {
    if (newPenalty && newPenalty.penaltyType > 0) {
      if (!oldPenalty || oldPenalty.penaltyType !== newPenalty.penaltyType) {
        const level = newPenalty.penaltyType <= 3 ? 'danger' : 'warning'
        addRobotMessage(level, getPenaltyName(newPenalty.penaltyType))
      }
    }
  },
  { deep: true }
)

// 监听等级提升
watch(
  () => currentRobot.value?.level,
  (newLevel, oldLevel) => {
    if (newLevel && oldLevel && newLevel > oldLevel) {
      addRobotMessage('info', `等级提升至 Lv.${newLevel}`)
    }
  }
)

// ==================== 暴露方法 ====================
defineExpose({
  addRobotMessage,
  addSystemMessage
})

// ==================== 生命周期 ====================
onMounted(() => {
  // 初始化一些示例消息
  addSystemMessage('info', '消息系统已启动')
})
</script>

<style scoped>
.message-list-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: rgba(0, 0, 0, 0.4);
  border-radius: 8px;
  overflow: hidden;
}

/* ==================== 状态效果区域 ==================== */
.status-section {
  padding: 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.section-title {
  font-size: 11px;
  color: #64748b;
  margin-bottom: 6px;
  text-transform: uppercase;
  letter-spacing: 1px;
}

.buff-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.buff-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  background: rgba(0, 0, 0, 0.4);
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  min-width: 100px;
}

.buff-icon {
  font-size: 16px;
  flex-shrink: 0;
}

.buff-info {
  flex: 1;
  min-width: 0;
}

.buff-name {
  font-size: 10px;
  color: #e2e8f0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.buff-timer {
  height: 3px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 2px;
  margin-top: 2px;
  overflow: hidden;
}

.buff-timer-fill {
  height: 100%;
  border-radius: 2px;
  transition: width 0.3s linear;
}

.buff-time {
  font-size: 9px;
  color: #94a3b8;
  text-align: right;
}

/* Buff 颜色 */
.buff-attack .buff-timer-fill {
  background: linear-gradient(90deg, #ef4444, #f97316);
}
.buff-defense .buff-timer-fill {
  background: linear-gradient(90deg, #3b82f6, #6366f1);
}
.buff-cooling .buff-timer-fill {
  background: linear-gradient(90deg, #06b6d4, #22d3ee);
}
.buff-power .buff-timer-fill {
  background: linear-gradient(90deg, #eab308, #fbbf24);
}
.buff-heal .buff-timer-fill {
  background: linear-gradient(90deg, #22c55e, #4ade80);
}
.buff-ammo .buff-timer-fill {
  background: linear-gradient(90deg, #f97316, #fb923c);
}
.buff-terrain .buff-timer-fill {
  background: linear-gradient(90deg, #8b5cf6, #a78bfa);
}

/* 判罚样式 */
.penalty-item {
  border-color: rgba(239, 68, 68, 0.4);
}

.penalty-yellow {
  background: rgba(234, 179, 8, 0.2);
  border-color: rgba(234, 179, 8, 0.4);
}

.penalty-red {
  background: rgba(239, 68, 68, 0.2);
  border-color: rgba(239, 68, 68, 0.4);
}

.penalty-warning {
  background: rgba(249, 115, 22, 0.2);
  border-color: rgba(249, 115, 22, 0.4);
}

.penalty-time {
  color: #f87171;
  font-weight: 600;
}

.no-status {
  font-size: 11px;
  color: #64748b;
  padding: 8px;
  text-align: center;
}

/* ==================== 经验条区域 ==================== */
.exp-section {
  padding: 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.exp-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}

.exp-label {
  font-size: 10px;
  font-weight: 600;
  color: #a78bfa;
  letter-spacing: 1px;
}

.exp-value {
  font-size: 10px;
  color: #94a3b8;
  font-family: 'Orbitron', monospace;
}

.exp-bar {
  height: 6px;
  background: rgba(0, 0, 0, 0.5);
  border-radius: 3px;
  overflow: hidden;
}

.exp-fill {
  height: 100%;
  background: linear-gradient(90deg, #8b5cf6, #a78bfa, #c4b5fd);
  border-radius: 3px;
  transition: width 0.3s ease;
  box-shadow: 0 0 8px rgba(139, 92, 246, 0.5);
}

/* ==================== 消息滚动区域 ==================== */
.message-scroll-section {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.message-tabs {
  display: flex;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.tab-btn {
  flex: 1;
  padding: 6px 12px;
  background: transparent;
  border: none;
  color: #64748b;
  font-size: 11px;
  cursor: pointer;
  transition: all 0.2s;
}

.tab-btn:hover {
  color: #94a3b8;
  background: rgba(255, 255, 255, 0.05);
}

.tab-btn.active {
  color: #60a5fa;
  background: rgba(96, 165, 250, 0.1);
  border-bottom: 2px solid #60a5fa;
}

.message-scroll-area {
  flex: 1;
  overflow-y: auto;
  padding: 4px;
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

.message-items {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.message-item {
  display: flex;
  gap: 6px;
  padding: 4px 6px;
  border-radius: 4px;
  font-size: 11px;
  background: rgba(0, 0, 0, 0.3);
}

.message-item.level-info {
  border-left: 2px solid #22c55e;
}

.message-item.level-warning {
  border-left: 2px solid #eab308;
  background: rgba(234, 179, 8, 0.1);
}

.message-item.level-danger {
  border-left: 2px solid #ef4444;
  background: rgba(239, 68, 68, 0.1);
}

.msg-time {
  flex-shrink: 0;
  color: #64748b;
  font-family: 'Consolas', monospace;
  font-size: 10px;
}

.msg-content {
  flex: 1;
  color: #e2e8f0;
  word-break: break-all;
}

.no-messages {
  text-align: center;
  color: #64748b;
  font-size: 11px;
  padding: 20px;
}

/* 消息动画 */
.message-fade-enter-active {
  animation: fade-in 0.3s ease;
}

.message-fade-leave-active {
  animation: fade-out 0.2s ease;
}

@keyframes fade-in {
  from {
    opacity: 0;
    transform: translateY(-10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes fade-out {
  from {
    opacity: 1;
  }
  to {
    opacity: 0;
  }
}
</style>
