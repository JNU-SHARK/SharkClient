<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useDashboardStore } from '@/store'
import { useMqttDataStore } from '@/store/modules/mqtt_data'
import { CurrentStage } from '@/utils/mqtt_protocol_constants'
import { storeToRefs } from 'pinia'

// 获取 store
const store = useDashboardStore()
const mqttStore = useMqttDataStore()
const { robotStatusFlags } = storeToRefs(store)

// 从 MQTT 数据获取比分
const score = computed(() => ({
  red: mqttStore.gameStatus.redScore,
  blue: mqttStore.gameStatus.blueScore
}))

// 从 MQTT 数据获取当前金币
const remainingEconomy = computed(() => mqttStore.logisticsStatus.remainingEconomy ?? 0)

// ==================== 比赛时间管理 ====================
/** 本地比赛倒计时（整秒） */
const localMatchTime = ref<number>(0)
/** 上次本地递减的时间戳 */
const lastTickTime = ref<number>(0)
/** 本地计时器 */
let matchTimerInterval: ReturnType<typeof setInterval> | null = null

// 状态标签定义（动态，根据是否有超电调整）
const STATUS_LABELS = computed<Record<string, string>>(() => {
  const labels: Record<string, string> = {
    aimAssist: '自瞄',
    gyro: '小陀螺',
    deployed: '部署',
    noAmmo: '无弹'
  }
  // 只有有超级电容的机器人才显示超电状态
  if (robotStatusFlags.value.hasCapacitor !== false) {
    labels.overcharge = '超电'
  }
  return labels
})

// 动态最大值
const maxBufferEnergy = computed(() => robotStatusFlags.value.maxBufferEnergy || 60)
const maxActualEnergy = computed(() => robotStatusFlags.value.maxActualEnergy || 150)
const totalMaxEnergy = computed(() => maxBufferEnergy.value + maxActualEnergy.value)

// 计算缓冲能量宽度百分比（相对于总能量条）
const bufferEnergyWidth = computed(() => {
  const energy = Math.max(
    0,
    Math.min(robotStatusFlags.value.bufferEnergy || 0, maxBufferEnergy.value)
  )
  return (energy / totalMaxEnergy.value) * 100
})

// 计算超电实际能量宽度百分比（相对于总能量条）
const actualEnergyWidth = computed(() => {
  const energy = Math.max(
    0,
    Math.min(robotStatusFlags.value.actualEnergy || 0, maxActualEnergy.value)
  )
  return (energy / totalMaxEnergy.value) * 100
})

// ==================== 比赛状态计算属性 ====================
/** 是否处于比赛中阶段 */
const isInFightingStage = computed(() => {
  return mqttStore.gameStatus.currentStage === CurrentStage.FIGHTING
})

/** 比赛是否暂停 */
const isMatchPaused = computed(() => {
  return mqttStore.gameStatus.isPaused
})

/** 格式化比赛时间 MM:SS */
const formattedMatchTime = computed(() => {
  const seconds = Math.max(0, localMatchTime.value)
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
})

/** 是否显示比赛时间（在比赛中阶段显示） */
const showMatchTime = computed(() => {
  // 只要在比赛阶段就显示，showRemainingTime 用于控制是否在 Dashboard 外隐藏
  return isInFightingStage.value
})

// ==================== 时间同步逻辑 ====================
/** 启动本地计时器（每秒减1） */
function startLocalTimer(): void {
  if (matchTimerInterval) return

  lastTickTime.value = Date.now()

  matchTimerInterval = setInterval(() => {
    if (localMatchTime.value > 0) {
      const now = Date.now()
      // 每过 1000ms 减少 1 秒
      if (now - lastTickTime.value >= 1000) {
        localMatchTime.value = Math.max(0, localMatchTime.value - 1)
        lastTickTime.value = now
      }
    }
  }, 100)
}

/** 停止本地计时器 */
function stopLocalTimer(): void {
  if (matchTimerInterval) {
    clearInterval(matchTimerInterval)
    matchTimerInterval = null
  }
}

// 监听比赛阶段变化
watch(
  () => mqttStore.gameStatus.currentStage,
  (newStage) => {
    if (newStage === CurrentStage.FIGHTING) {
      // 进入比赛阶段，同步服务器时间并启动本地计时器
      localMatchTime.value = Math.floor(mqttStore.gameStatus.stageCountdownSec)
      lastTickTime.value = Date.now()
      startLocalTimer()
    } else {
      stopLocalTimer()
      localMatchTime.value = 0
    }
  },
  { immediate: true }
)

// 监听服务器时间变化，直接同步（每次收到消息都同步）
watch(
  () => mqttStore.gameStatus.stageCountdownSec,
  (newTime) => {
    if (isInFightingStage.value) {
      localMatchTime.value = Math.floor(newTime)
      lastTickTime.value = Date.now()
    }
  }
)

// 监听主进程状态变化（保持向后兼容）
onMounted(() => {
  if (window.api?.onMatchStatusChanged) {
    window.api.onMatchStatusChanged((status) => {
      console.log('[StatusBar] 比赛状态变化:', status)
      store.setMatchStatus(status)
    })
  }

  // 初始同步
  if (isInFightingStage.value) {
    localMatchTime.value = Math.floor(mqttStore.gameStatus.stageCountdownSec)
    lastTickTime.value = Date.now()
    startLocalTimer()
  }
})

onUnmounted(() => {
  stopLocalTimer()
  store.stopMatchTimer()
})

// 暴露方法给父组件（保持向后兼容）
defineExpose({
  setMatchStatus: store.setMatchStatus,
  updateScore: store.updateScore,
  resetScore: store.resetScore
})
</script>

<template>
  <div class="status-bar-container">
    <div class="status-bar">
      <!-- 最左侧比分显示 - 醒目样式 -->
      <div class="score-display">
        <div class="score-box score-box-red">
          <span class="score-value">{{ score.red }}</span>
        </div>
        <span class="score-separator">:</span>
        <div class="score-box score-box-blue">
          <span class="score-value">{{ score.blue }}</span>
        </div>
      </div>

      <!-- 中间状态项 -->
      <div class="status-items-left">
        <div v-for="(label, key) in STATUS_LABELS" :key="key" class="status-item">
          <!-- 常规 LED 指示灯 -->
          <template v-if="key !== 'overcharge'">
            <div
              class="led"
              :class="{ on: robotStatusFlags[key as keyof typeof robotStatusFlags] }"
            ></div>
            <div class="status-name">{{ label }}</div>
          </template>
          <!-- 超电能量条 - 双段显示（缓冲能量 + 超电实际能量） -->
          <template v-else>
            <div class="capacitor-bar">
              <!-- 超电实际能量（橙色，在底层） -->
              <div
                class="capacitor-fill actual-energy"
                :style="{ width: `${bufferEnergyWidth + actualEnergyWidth}%` }"
              ></div>
              <!-- 缓冲能量（青色，在上层） -->
              <div
                class="capacitor-fill buffer-energy"
                :style="{ width: `${bufferEnergyWidth}%` }"
              ></div>
            </div>
            <div class="status-name capacitor-label">
              <span class="buffer-label">缓冲</span>
              <span class="energy-value buffer-value">{{
                robotStatusFlags.bufferEnergy || 0
              }}</span>
              <span class="separator">+</span>
              <span class="actual-label">超电</span>
              <span class="energy-value actual-value">{{
                robotStatusFlags.actualEnergy || 0
              }}</span>
              <span class="unit">J</span>
            </div>
          </template>
        </div>
      </div>

      <!-- 比赛时间显示 - 仅在比赛中阶段显示 -->
      <div v-if="showMatchTime" class="match-time-display">
        <div class="time-badge" :class="{ paused: isMatchPaused }">
          <span class="time-text">{{ formattedMatchTime }}</span>
        </div>
      </div>

      <!-- 金币显示 -->
      <div class="economy-display">
        <div class="economy-badge">
          <svg
            class="coin-icon"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <circle cx="12" cy="12" r="10"></circle>
            <path d="M12 6v12M9 9h6M9 15h6"></path>
          </svg>
          <span class="economy-value">{{ remainingEconomy }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.status-bar-container {
  position: fixed;
  top: 10px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 100;
  pointer-events: none; /* 允许鼠标穿透容器 */
}

.status-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 12px 20px;
  min-height: 56px;
  background-color: rgba(25, 28, 38, 0.3);
  backdrop-filter: blur(30px) saturate(1.2);
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow:
    inset 0 1px 1px rgba(255, 255, 255, 0.05),
    0 4px 12px rgba(0, 0, 0, 0.2);
  border-radius: 14px;
  pointer-events: auto; /* 恢复状态栏本身的鼠标事件 */
  font-family: var(--font-tech);
  letter-spacing: 0.5px;
}

.score-display {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 16px;
  font-weight: 600;
  white-space: nowrap;
  font-family: var(--font-tech-display);
  text-transform: uppercase;
}

/* 醒目的比分盒子 */
.score-box {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 38px;
  height: 34px;
  padding: 0 10px;
  border-radius: 8px;
  font-weight: 700;
  font-size: 18px;
  transition: all 0.3s ease;
  font-family: var(--font-tech-display);
}

.score-box-red {
  background: linear-gradient(135deg, rgba(239, 68, 68, 0.25) 0%, rgba(220, 38, 38, 0.15) 100%);
  border: 1px solid rgba(239, 68, 68, 0.5);
  box-shadow:
    inset 0 1px 1px rgba(255, 255, 255, 0.1),
    0 0 12px rgba(239, 68, 68, 0.3);
}

.score-box-red .score-value {
  color: #ef4444;
  text-shadow: 0 0 8px rgba(239, 68, 68, 0.6);
}

.score-box-blue {
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.25) 0%, rgba(37, 99, 235, 0.15) 100%);
  border: 1px solid rgba(59, 130, 246, 0.5);
  box-shadow:
    inset 0 1px 1px rgba(255, 255, 255, 0.1),
    0 0 12px rgba(59, 130, 246, 0.3);
}

.score-box-blue .score-value {
  color: #3b82f6;
  text-shadow: 0 0 8px rgba(59, 130, 246, 0.6);
}

.score-separator {
  color: rgba(255, 255, 255, 0.5);
  font-weight: 700;
  font-size: 20px;
}

.status-items-left {
  display: flex;
  gap: 16px;
  flex: 1;
}

.status-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  color: rgba(235, 245, 255, 0.9);
  white-space: nowrap;
}

.led {
  width: 18px;
  height: 14px;
  background: rgba(255, 255, 255, 0.08);
  transform: skewX(-25deg);
  border-radius: 2px;
  box-shadow: none;
  transition: all 0.2s ease-in-out;
}

.led.on {
  background: linear-gradient(90deg, #34d399, #10b981);
  box-shadow: 0 0 10px rgba(16, 185, 129, 0.7);
}

.status-name {
  font-size: 15px;
  font-weight: 600;
  opacity: 1;
  font-family: var(--font-tech-cn);
  letter-spacing: 1px;
}

/* 新增：超电能量条样式 */
.capacitor-bar {
  width: 110px; /* 拉长后的宽度 */
  height: 14px;
  background-color: rgba(255, 255, 255, 0.08);
  border-radius: 2px;
  transform: skewX(-25deg);
  overflow: hidden;
  position: relative;
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.capacitor-fill {
  position: absolute;
  top: 0;
  left: 0;
  height: 100%;
  transition: width 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

/* 超电实际能量 - 橙色 */
.capacitor-fill.actual-energy {
  background: linear-gradient(90deg, #f59e0b, #fbbf24);
  box-shadow: 0 0 12px rgba(245, 158, 11, 0.8);
  z-index: 1;
}

/* 缓冲能量 - 青色 */
.capacitor-fill.buffer-energy {
  background: linear-gradient(90deg, #06b6d4, #22d3ee);
  box-shadow: 0 0 12px rgba(6, 182, 212, 0.8);
  z-index: 2;
}

/* 能量条标签样式 */
.capacitor-label {
  display: flex;
  align-items: center;
  gap: 3px;
  font-size: 13px !important;
}

.buffer-label {
  color: #22d3ee;
  font-weight: 600;
}

.actual-label {
  color: #fbbf24;
  font-weight: 600;
}

.energy-value {
  font-family: var(--font-tech-mono);
  font-weight: 600;
  min-width: 32px;
  text-align: center;
  display: inline-block;
}

.buffer-value {
  color: #22d3ee;
}

.actual-value {
  color: #fbbf24;
}

.separator {
  color: rgba(255, 255, 255, 0.5);
  font-weight: 400;
}

.unit {
  color: rgba(255, 255, 255, 0.6);
  font-size: 12px;
  margin-left: 1px;
}

/* 剩余时间样式 */
.remaining-time {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 100px;
}

.time-display {
  font-size: 16px;
  font-weight: 600;
  opacity: 0.95;
  animation: timeGlow 2s ease-in-out infinite alternate;
  font-family: var(--font-tech-display);
  letter-spacing: 1px;
}

.time-display-large {
  font-size: 22px;
  font-weight: 700;
  font-family: var(--font-tech-display);
  letter-spacing: 2px;
}

@keyframes timeGlow {
  from {
    filter: brightness(1);
  }
  to {
    filter: brightness(1.2);
  }
}

/* 比赛状态显示 - 醒目徽章样式 */
.match-status-display {
  display: flex;
  align-items: center;
  justify-content: center;
}

.status-badge {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 8px 16px;
  min-width: 130px;
  height: 40px;
  border-radius: 10px;
  font-weight: 600;
  font-size: 15px;
  transition:
    background 0.3s ease,
    border-color 0.3s ease,
    box-shadow 0.3s ease;
  position: relative;
  overflow: hidden;
  box-sizing: border-box;
}

.status-indicator {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
  animation: pulse 2s ease-in-out infinite;
}

.status-text {
  letter-spacing: 0.02em;
  font-size: 16px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  line-height: 1;
  display: flex;
  align-items: center;
}

/* 等待开始 - 蓝色 */
.status-waiting {
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.2) 0%, rgba(37, 99, 235, 0.1) 100%);
  border: 1px solid rgba(59, 130, 246, 0.4);
  color: #60a5fa;
  box-shadow: 0 0 15px rgba(59, 130, 246, 0.2);
}

.status-waiting .status-indicator {
  background: #3b82f6;
  box-shadow: 0 0 8px rgba(59, 130, 246, 0.8);
}

/* 技术暂停 - 橙色 */
.status-technical_pause {
  background: linear-gradient(135deg, rgba(245, 158, 11, 0.2) 0%, rgba(217, 119, 6, 0.1) 100%);
  border: 1px solid rgba(245, 158, 11, 0.4);
  color: #fbbf24;
  box-shadow: 0 0 15px rgba(245, 158, 11, 0.2);
}

.status-technical_pause .status-indicator {
  background: #f59e0b;
  box-shadow: 0 0 8px rgba(245, 158, 11, 0.8);
}

/* 比赛暂停 - 红色 */
.status-paused {
  background: linear-gradient(135deg, rgba(239, 68, 68, 0.2) 0%, rgba(220, 38, 38, 0.1) 100%);
  border: 1px solid rgba(239, 68, 68, 0.4);
  color: #f87171;
  box-shadow: 0 0 15px rgba(239, 68, 68, 0.2);
}

.status-paused .status-indicator {
  background: #ef4444;
  box-shadow: 0 0 8px rgba(239, 68, 68, 0.8);
}

/* 进行中 - 绿色 */
.status-running {
  background: linear-gradient(135deg, rgba(16, 185, 129, 0.2) 0%, rgba(5, 150, 105, 0.1) 100%);
  border: 1px solid rgba(16, 185, 129, 0.4);
  color: #34d399;
  box-shadow: 0 0 20px rgba(16, 185, 129, 0.25);
}

.status-running .status-indicator {
  background: #10b981;
  box-shadow: 0 0 10px rgba(16, 185, 129, 0.9);
  animation: pulseRunning 1s ease-in-out infinite;
}

.status-running .status-text {
  font-size: 24px;
  font-weight: 700;
  text-shadow: 0 0 12px rgba(16, 185, 129, 0.5);
  margin-top: -2px;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.6;
    transform: scale(0.9);
  }
}

@keyframes pulseRunning {
  0%,
  100% {
    opacity: 1;
    transform: scale(1);
    box-shadow: 0 0 10px rgba(16, 185, 129, 0.9);
  }
  50% {
    opacity: 0.8;
    transform: scale(1.1);
    box-shadow: 0 0 16px rgba(16, 185, 129, 1);
  }
}

/* ==================== 新版比赛时间显示 ==================== */
.match-time-display {
  display: flex;
  align-items: center;
  justify-content: center;
}

.time-badge {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px 20px;
  min-width: 100px;
  height: 44px;
  border-radius: 10px;
  background: linear-gradient(135deg, rgba(16, 185, 129, 0.25) 0%, rgba(5, 150, 105, 0.15) 100%);
  border: 1px solid rgba(16, 185, 129, 0.5);
  box-shadow:
    0 0 20px rgba(16, 185, 129, 0.3),
    inset 0 1px 0 rgba(255, 255, 255, 0.1);
  transition: all 0.3s ease;
}

.time-badge.paused {
  background: linear-gradient(135deg, rgba(239, 68, 68, 0.25) 0%, rgba(220, 38, 38, 0.15) 100%);
  border: 1px solid rgba(239, 68, 68, 0.5);
  box-shadow: 0 0 20px rgba(239, 68, 68, 0.3);
  animation: pauseBlink 1s ease-in-out infinite;
}

.time-text {
  font-size: 26px;
  font-weight: 700;
  font-family: 'Consolas', 'Monaco', var(--font-tech-mono), monospace;
  color: #34d399;
  text-shadow: 0 0 15px rgba(16, 185, 129, 0.6);
  letter-spacing: 2px;
  font-variant-numeric: tabular-nums;
}

.time-badge.paused .time-text {
  color: #f87171;
  text-shadow: 0 0 15px rgba(239, 68, 68, 0.6);
}

@keyframes pauseBlink {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.7;
  }
}

/* ==================== 金币显示 ==================== */
.economy-display {
  display: flex;
  align-items: center;
  justify-content: center;
}

.economy-badge {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  height: 38px;
  border-radius: 10px;
  background: linear-gradient(135deg, rgba(234, 179, 8, 0.2) 0%, rgba(202, 138, 4, 0.1) 100%);
  border: 1px solid rgba(234, 179, 8, 0.4);
  box-shadow:
    0 0 12px rgba(234, 179, 8, 0.2),
    inset 0 1px 0 rgba(255, 255, 255, 0.1);
  transition: all 0.3s ease;
}

.economy-badge:hover {
  box-shadow: 0 0 16px rgba(234, 179, 8, 0.3);
}

.coin-icon {
  color: #fbbf24;
  filter: drop-shadow(0 0 4px rgba(251, 191, 36, 0.5));
}

.economy-value {
  font-size: 16px;
  font-weight: 700;
  font-family: 'Consolas', 'Monaco', var(--font-tech-mono), monospace;
  color: #fbbf24;
  text-shadow: 0 0 8px rgba(251, 191, 36, 0.4);
  letter-spacing: 1px;
  font-variant-numeric: tabular-nums;
  min-width: 50px;
  text-align: center;
}
</style>
