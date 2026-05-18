<template>
  <div class="robo-mode-settings">
    <!-- 机器人型号选择 -->
    <div class="setting-section">
      <div class="section-header">
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
        <span>机器人型号</span>
      </div>
      <div class="robot-selector">
        <select v-model="selectedRobotType" class="robot-select">
          <option v-for="robot in robotOptions" :key="robot.value" :value="robot.value">
            {{ robot.label }}
          </option>
        </select>
      </div>
    </div>

    <!-- 性能模式选择 (仅英雄/步兵显示) -->
    <div v-if="showPerformanceSettings" class="setting-section performance-section">
      <div class="section-header">
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
        </svg>
        <span>性能模式</span>
      </div>

      <!-- 英雄: 整车模式选择 -->
      <template v-if="isHero">
        <div class="performance-group">
          <label class="group-label">整车模式</label>
          <div class="mode-buttons hero-mode-buttons">
            <button
              v-for="mode in heroModes"
              :key="mode.value"
              class="mode-btn hero-btn"
              :class="{ active: performanceSelection.shooter === mode.value }"
              @click="setHeroMode(mode.value)"
            >
              <span class="mode-icon">{{ mode.icon }}</span>
              <span class="mode-label">{{ mode.label }}</span>
            </button>
          </div>
          <div class="mode-hint">整车模式将同步设置发射和底盘系统</div>
        </div>
      </template>

      <!-- 步兵: 分离的发射/底盘选择 -->
      <template v-else>
        <!-- 发射机构 -->
        <div class="performance-group">
          <label class="group-label">发射机构</label>
          <div class="mode-buttons">
            <button
              v-for="mode in shooterModes"
              :key="mode.value"
              class="mode-btn"
              :class="{ active: performanceSelection.shooter === mode.value }"
              @click="setShooterMode(mode.value)"
            >
              {{ mode.label }}
            </button>
          </div>
        </div>

        <!-- 底盘系统 -->
        <div class="performance-group">
          <label class="group-label">底盘系统</label>
          <div class="mode-buttons">
            <button
              v-for="mode in chassisModes"
              :key="mode.value"
              class="mode-btn"
              :class="{ active: performanceSelection.chassis === mode.value }"
              @click="setChassisMode(mode.value)"
            >
              {{ mode.label }}
            </button>
          </div>
        </div>
      </template>

      <!-- 发送按钮 -->
      <button class="send-btn" :disabled="isSending" @click="sendPerformanceCommand">
        <svg
          v-if="!isSending"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <line x1="22" y1="2" x2="11" y2="13"></line>
          <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
        </svg>
        <span v-if="isSending" class="loading-spinner"></span>
        {{ isSending ? '发送中...' : '发送指令' }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'

// ==================== Props ====================
interface Props {
  robotOptions?: Array<{ value: string; label: string }>
  modelValue?: string
}

const props = withDefaults(defineProps<Props>(), {
  robotOptions: () => [],
  modelValue: ''
})

// ==================== Emits ====================
const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
  (e: 'robot-change', value: string): void
}>()

// ==================== 状态 ====================
const selectedRobotType = ref(props.modelValue)
const isSending = ref(false)

const performanceSelection = ref({
  shooter: 1, // 默认冷却优先
  chassis: 1 // 默认血量优先
})

// ==================== 计算属性 ====================
/** 是否显示性能设置 (仅英雄/步兵) */
const showPerformanceSettings = computed(() => {
  const robotName = selectedRobotType.value.toLowerCase()
  return (
    robotName.includes('英雄') ||
    robotName.includes('步兵') ||
    robotName.includes('hero') ||
    robotName.includes('infantry')
  )
})

/** 是否是英雄机器人 */
const isHero = computed(() => {
  const robotName = selectedRobotType.value.toLowerCase()
  return robotName.includes('英雄') || robotName.includes('hero')
})

/** 英雄整车模式选项 (近战/远程) */
const heroModes = computed(() => [
  { value: 3, label: '近战优先', icon: '⚔️' },
  { value: 4, label: '远程优先', icon: '🎯' }
])

/** 步兵发射机构模式选项 (爆发/冷却) */
const shooterModes = computed(() => [
  { value: 2, label: '爆发优先' },
  { value: 1, label: '冷却优先' }
])

/** 步兵底盘系统模式选项 (功率/血量) */
const chassisModes = computed(() => [
  { value: 2, label: '功率优先' },
  { value: 1, label: '血量优先' }
])

// ==================== 监听 ====================
watch(selectedRobotType, (newValue) => {
  emit('update:modelValue', newValue)
  emit('robot-change', newValue)

  // 重置性能选择为默认值
  if (isHero.value) {
    performanceSelection.value = { shooter: 3, chassis: 3 }
  } else {
    performanceSelection.value = { shooter: 1, chassis: 1 }
  }
})

watch(
  () => props.modelValue,
  (newValue) => {
    if (newValue !== selectedRobotType.value) {
      selectedRobotType.value = newValue
    }
  }
)

// ==================== 方法 ====================
/** 设置英雄整车模式 (同步发射和底盘) */
const setHeroMode = (mode: number): void => {
  performanceSelection.value.shooter = mode
  performanceSelection.value.chassis = mode
}

const setShooterMode = (mode: number): void => {
  performanceSelection.value.shooter = mode
}

const setChassisMode = (mode: number): void => {
  performanceSelection.value.chassis = mode
}

const sendPerformanceCommand = async (): Promise<void> => {
  if (isSending.value) return

  isSending.value = true

  try {
    // 通过 MQTT 发送 RobotPerformanceSelectionCommand
    console.log('[RoboModeSettings] 发送性能指令:', performanceSelection.value)

    if (window.api?.mqtt?.publish) {
      await window.api.mqtt.publish({
        topic: 'RobotPerformanceSelectionCommand',
        messageType: 'RobotPerformanceSelectionCommand',
        payload: {
          shooter: performanceSelection.value.shooter,
          chassis: performanceSelection.value.chassis
        }
      })
      console.log('[RoboModeSettings] 指令发送成功')
    } else {
      console.warn('[RoboModeSettings] MQTT 未连接，无法发送指令')
    }
  } catch (error) {
    console.error('[RoboModeSettings] 发送失败:', error)
  } finally {
    isSending.value = false
  }
}
</script>

<style scoped>
.robo-mode-settings {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
  background: rgba(0, 0, 0, 0.3);
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.setting-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.section-header {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 500;
  color: #e2e8f0;
}

.section-header svg {
  color: #60a5fa;
}

.robot-selector {
  width: 100%;
}

.robot-select {
  width: 100%;
  padding: 8px 12px;
  background: rgba(0, 0, 0, 0.4);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  color: #e2e8f0;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s;
}

.robot-select:hover {
  border-color: rgba(96, 165, 250, 0.4);
}

.robot-select:focus {
  outline: none;
  border-color: #60a5fa;
  box-shadow: 0 0 0 2px rgba(96, 165, 250, 0.2);
}

.robot-select option {
  background: #1e293b;
  color: #e2e8f0;
}

.performance-section {
  padding-top: 12px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}

.performance-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.group-label {
  font-size: 12px;
  color: #94a3b8;
  font-weight: 500;
}

.mode-buttons {
  display: flex;
  gap: 6px;
}

.mode-btn {
  flex: 1;
  padding: 6px 10px;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 4px;
  color: #94a3b8;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s;
}

.mode-btn:hover {
  background: rgba(96, 165, 250, 0.1);
  border-color: rgba(96, 165, 250, 0.3);
  color: #e2e8f0;
}

.mode-btn.active {
  background: rgba(96, 165, 250, 0.2);
  border-color: #60a5fa;
  color: #60a5fa;
  font-weight: 500;
}

/* 英雄整车模式按钮样式 */
.hero-mode-buttons {
  gap: 10px;
}

.hero-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 12px 16px;
  min-height: 60px;
}

.hero-btn .mode-icon {
  font-size: 20px;
}

.hero-btn .mode-label {
  font-size: 12px;
}

.hero-btn.active {
  background: linear-gradient(135deg, rgba(96, 165, 250, 0.25) 0%, rgba(59, 130, 246, 0.25) 100%);
  border-color: #60a5fa;
  box-shadow: 0 0 12px rgba(96, 165, 250, 0.3);
}

.mode-hint {
  font-size: 11px;
  color: #64748b;
  text-align: center;
  margin-top: 4px;
}

.send-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  margin-top: 8px;
  padding: 8px 16px;
  background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
  border: none;
  border-radius: 6px;
  color: #fff;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.send-btn:hover:not(:disabled) {
  background: linear-gradient(135deg, #60a5fa 0%, #3b82f6 100%);
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);
}

.send-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.loading-spinner {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
