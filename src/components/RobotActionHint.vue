<script setup lang="ts">
/**
 * RobotActionHint - 机器人特殊操作提示组件
 * 根据机器人类型显示不同的 K 键功能提示
 * - 英雄: 部署模式
 * - 步兵: 激活能量机关
 * - 工程: 装配菜单
 * - 无人机: 空中支援/飞镖
 */
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useMqttDataStore } from '@/store/modules/mqtt_data'

const mqttStore = useMqttDataStore()

const emit = defineEmits<{
  (e: 'action', action: string, params?: Record<string, unknown>): void
}>()

// 当前机器人 ID
const currentRobotId = computed(() => mqttStore.currentRobotId)

// 机器人类型（1=英雄, 2=工程, 3/4/5=步兵, 6=无人机, 7=哨兵）
const robotType = computed(() => {
  const id = currentRobotId.value
  if (id <= 0) return 0
  // 取模获取类型编号 (1-7 红队, 101-107 蓝队)
  return id < 100 ? id : id - 100
})

// 机器人类型名称
const robotTypeName = computed(() => {
  const typeMap: Record<number, string> = {
    1: '英雄',
    2: '工程',
    3: '步兵',
    4: '步兵',
    5: '步兵',
    6: '无人机',
    7: '哨兵'
  }
  return typeMap[robotType.value] || '未知'
})

// ==================== 英雄部署状态 ====================
const isDeployed = ref(false)

// ==================== 工程装配状态 ====================
const isAssemblyMenuOpen = ref(false)
const selectedDifficulty = ref<1 | 2 | 3 | 4>(2) // 1-4级难度
const isAssembling = ref(false)

// ==================== 无人机状态 ====================
const isAirSupporting = ref(false) // 空中支援状态
const isDartTargeting = ref(false) // 飞镖瞄准状态
// 飞镖目标（与 MQTT 协议 DartTarget 一致）
const dartTargets = [
  { id: 1, name: '前哨站' },
  { id: 2, name: '基地(固定)' },
  { id: 3, name: '基地(随机固定)' },
  { id: 4, name: '基地(随机移动)' },
  { id: 5, name: '基地(结束移动)' }
]
const selectedDartTarget = ref(0)

// K 键功能描述
const kKeyDescription = computed(() => {
  switch (robotType.value) {
    case 1: // 英雄
      return isDeployed.value ? '退出部署模式' : '进入部署模式'
    case 2: // 工程
      return isAssemblyMenuOpen.value ? '关闭装配菜单' : '打开装配菜单'
    case 3:
    case 4:
    case 5: // 步兵
      return '激活能量机关'
    case 6: // 无人机 - K 键是飞镖
      if (isDartTargeting.value) {
        return `发射飞镖 → ${dartTargets[selectedDartTarget.value].name}`
      }
      return '开启飞镖'
    default:
      return ''
  }
})

// 是否显示 K 键提示
const showKKeyHint = computed(() => {
  // 哨兵没有 K 键功能
  return robotType.value >= 1 && robotType.value <= 6 && robotType.value !== 7
})

// 处理 K 键按下
function handleKKeyPress(): void {
  switch (robotType.value) {
    case 1: // 英雄 - 切换部署模式
      isDeployed.value = !isDeployed.value
      emit('action', 'hero-deploy', { deployed: isDeployed.value })
      console.log(`[RobotAction] 英雄${isDeployed.value ? '进入' : '退出'}部署模式`)
      break

    case 2: // 工程 - 切换装配菜单
      isAssemblyMenuOpen.value = !isAssemblyMenuOpen.value
      emit('action', 'engineer-assembly-menu', { open: isAssemblyMenuOpen.value })
      console.log(`[RobotAction] 工程${isAssemblyMenuOpen.value ? '打开' : '关闭'}装配菜单`)
      break

    case 3:
    case 4:
    case 5: // 步兵 - 激活能量机关
      emit('action', 'infantry-power-rune')
      console.log('[RobotAction] 步兵激活能量机关')
      break

    case 6: // 无人机 - K 键是飞镖
      if (!isDartTargeting.value) {
        // 进入飞镖瞄准模式
        isDartTargeting.value = true
        emit('action', 'drone-dart-open', { open: true })
        console.log('[RobotAction] 无人机进入飞镖瞄准模式')
      } else {
        // 发射飞镖
        const target = dartTargets[selectedDartTarget.value]
        emit('action', 'drone-dart-fire', { targetId: target.id, targetName: target.name })
        console.log(`[RobotAction] 无人机发射飞镖 → ${target.name}`)
        isDartTargeting.value = false
      }
      break
  }
}

// 处理 F 键按下
function handleFKeyPress(): void {
  // 工程装配
  if (robotType.value === 2 && isAssemblyMenuOpen.value) {
    if (!isAssembling.value) {
      isAssembling.value = true
      // 关闭菜单，便于操作手观察
      isAssemblyMenuOpen.value = false
      emit('action', 'engineer-assembly-menu', { open: false })
      emit('action', 'engineer-start-assembly', { difficulty: selectedDifficulty.value })
      console.log(`[RobotAction] 工程开始装配 (难度: ${selectedDifficulty.value}级)，关闭菜单`)
    }
    return
  }

  // 无人机空中支援
  if (robotType.value === 6) {
    if (!isAirSupporting.value) {
      isAirSupporting.value = true
      emit('action', 'drone-air-support', { active: true })
      console.log('[RobotAction] 无人机开始空中支援')
    } else {
      isAirSupporting.value = false
      emit('action', 'drone-air-support', { active: false })
      console.log('[RobotAction] 无人机退出空中支援')
    }
  }
}

// 切换飞镖目标（方向键或滚轮）
function cycleDartTarget(direction: 1 | -1): void {
  if (!isDartTargeting.value) return
  selectedDartTarget.value =
    (selectedDartTarget.value + direction + dartTargets.length) % dartTargets.length
}

// 取消装配
function cancelAssembly(): void {
  isAssembling.value = false
  emit('action', 'engineer-cancel-assembly')
  console.log('[RobotAction] 工程取消装配')
}

// 选择装配难度
function selectDifficulty(difficulty: 1 | 2 | 3 | 4): void {
  selectedDifficulty.value = difficulty
}

// 键盘事件处理
function handleKeyDown(event: KeyboardEvent): void {
  // 如果在输入框中，忽略
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
    return
  }

  const key = event.key.toLowerCase()

  if (key === 'k') {
    handleKKeyPress()
  } else if (key === 'f') {
    handleFKeyPress()
  } else if (isDartTargeting.value) {
    // 飞镖瞄准模式下的方向键
    if (key === 'arrowup' || key === 'arrowleft') {
      cycleDartTarget(-1)
    } else if (key === 'arrowdown' || key === 'arrowright') {
      cycleDartTarget(1)
    } else if (key === 'escape') {
      isDartTargeting.value = false
      emit('action', 'drone-dart-open', { open: false })
    }
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleKeyDown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeyDown)
})

// 暴露方法
defineExpose({
  isDeployed,
  isAssemblyMenuOpen,
  isAirSupporting,
  isDartTargeting,
  cancelAssembly
})
</script>

<template>
  <!-- K 键功能提示 (底部) -->
  <Transition name="slide-up">
    <div v-if="showKKeyHint" class="robot-action-hint">
      <div class="action-badge" :class="robotTypeName">
        <span class="key-hint"> 按 <kbd>K</kbd> {{ kKeyDescription }} </span>

        <!-- 工程额外提示 -->
        <span v-if="robotType === 2 && isAssemblyMenuOpen" class="extra-hint">
          | 按 <kbd>F</kbd> 开始装配
        </span>

        <!-- 无人机空中支援提示 -->
        <span v-if="robotType === 6" class="extra-hint">
          | 按 <kbd>F</kbd> {{ isAirSupporting ? '退出支援' : '空中支援' }}
        </span>
      </div>
    </div>
  </Transition>

  <!-- 工程装配菜单弹窗 -->
  <Transition name="modal-fade">
    <div v-if="robotType === 2 && isAssemblyMenuOpen" class="assembly-menu-backdrop">
      <div class="assembly-menu">
        <h3 class="menu-title">
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <path
              d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"
            ></path>
          </svg>
          装配设置
        </h3>

        <!-- 难度选择 -->
        <div class="difficulty-section">
          <span class="section-label">装配难度</span>
          <div class="difficulty-options">
            <button
              v-for="diff in [1, 2, 3, 4] as const"
              :key="diff"
              class="difficulty-btn"
              :class="{ selected: selectedDifficulty === diff }"
              @click="selectDifficulty(diff)"
            >
              {{ diff }}级
            </button>
          </div>
        </div>

        <!-- 取消装配按钮（装配进行中时可用） -->
        <div v-if="isAssembling" class="assembly-actions">
          <button class="cancel-btn" @click="cancelAssembly">取消装配</button>
        </div>

        <!-- 操作提示 -->
        <div class="menu-footer">
          <span v-if="!isAssembling">
            按 <kbd>F</kbd> 开始装配（关闭窗口） | 按 <kbd>K</kbd> 关闭菜单
          </span>
          <span v-else>装配进行中 | 按 <kbd>K</kbd> 打开菜单取消</span>
        </div>
      </div>
    </div>
  </Transition>

  <!-- 无人机飞镖瞄准 UI -->
  <Transition name="fade">
    <div v-if="robotType === 6 && isDartTargeting" class="dart-targeting-ui">
      <div class="targeting-panel">
        <h4>飞镖目标选择</h4>
        <div class="target-list">
          <div
            v-for="(target, index) in dartTargets"
            :key="target.id"
            class="target-item"
            :class="{ selected: selectedDartTarget === index }"
            @click="selectedDartTarget = index"
          >
            {{ target.name }}
          </div>
        </div>
        <div class="targeting-hint">
          按 <kbd>↑</kbd><kbd>↓</kbd> 切换目标 | 按 <kbd>K</kbd> 发射 | 按 <kbd>ESC</kbd> 取消
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
/* K 键功能提示 */
.robot-action-hint {
  position: fixed;
  bottom: 50px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 100;
  pointer-events: none;
}

.action-badge {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 20px;
  background: rgba(25, 28, 38, 0.85);
  backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 25px;
  font-size: 14px;
  color: #e2e8f0;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
}

.action-badge.英雄 {
  border-color: rgba(239, 68, 68, 0.5);
  box-shadow: 0 4px 20px rgba(239, 68, 68, 0.2);
}

.action-badge.工程 {
  border-color: rgba(251, 191, 36, 0.5);
  box-shadow: 0 4px 20px rgba(251, 191, 36, 0.2);
}

.action-badge.步兵 {
  border-color: rgba(59, 130, 246, 0.5);
  box-shadow: 0 4px 20px rgba(59, 130, 246, 0.2);
}

.action-badge.无人机 {
  border-color: rgba(168, 85, 247, 0.5);
  box-shadow: 0 4px 20px rgba(168, 85, 247, 0.2);
}

.key-hint kbd,
.extra-hint kbd,
.menu-footer kbd,
.targeting-hint kbd {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  margin: 0 3px;
  background: rgba(255, 255, 255, 0.15);
  border: 1px solid rgba(255, 255, 255, 0.25);
  border-radius: 4px;
  font-family: inherit;
  font-size: 12px;
  font-weight: 600;
  color: #f1f5f9;
}

.extra-hint {
  opacity: 0.7;
  padding-left: 8px;
  border-left: 1px solid rgba(255, 255, 255, 0.2);
}

/* 工程装配菜单 */
.assembly-menu-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.assembly-menu {
  background: rgba(25, 28, 38, 0.95);
  backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 16px;
  padding: 24px;
  min-width: 320px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
}

.menu-title {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0 0 20px 0;
  font-size: 18px;
  font-weight: 600;
  color: #fbbf24;
}

.menu-title svg {
  stroke: #fbbf24;
}

.difficulty-section {
  margin-bottom: 20px;
}

.section-label {
  display: block;
  margin-bottom: 10px;
  font-size: 13px;
  color: #94a3b8;
}

.difficulty-options {
  display: flex;
  gap: 10px;
}

.difficulty-btn {
  flex: 1;
  padding: 12px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  color: #e2e8f0;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.difficulty-btn:hover {
  background: rgba(255, 255, 255, 0.1);
}

.difficulty-btn.selected {
  background: rgba(251, 191, 36, 0.2);
  border-color: #fbbf24;
  color: #fbbf24;
}

.assembly-status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 8px;
  margin-bottom: 16px;
}

.status-indicator {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #fbbf24;
}

.status-indicator.assembling svg {
  animation: spin 2s linear infinite;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

.assembly-actions {
  display: flex;
  justify-content: center;
  padding: 12px 0;
  margin-top: 8px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}

.cancel-btn {
  padding: 6px 12px;
  background: rgba(239, 68, 68, 0.2);
  border: 1px solid rgba(239, 68, 68, 0.5);
  border-radius: 6px;
  color: #ef4444;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.cancel-btn:hover {
  background: rgba(239, 68, 68, 0.3);
}

.menu-footer {
  text-align: center;
  padding-top: 16px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  font-size: 12px;
  color: #64748b;
}

/* 无人机飞镖瞄准 */
.dart-targeting-ui {
  position: fixed;
  top: 50%;
  right: 50px;
  transform: translateY(-50%);
  z-index: 500;
}

.targeting-panel {
  background: rgba(25, 28, 38, 0.95);
  backdrop-filter: blur(20px);
  border: 1px solid rgba(168, 85, 247, 0.3);
  border-radius: 12px;
  padding: 16px;
  min-width: 200px;
  box-shadow: 0 0 30px rgba(168, 85, 247, 0.3);
}

.targeting-panel h4 {
  margin: 0 0 12px 0;
  font-size: 14px;
  font-weight: 600;
  color: #a855f7;
  text-align: center;
}

.target-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 12px;
}

.target-item {
  padding: 10px 16px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  color: #e2e8f0;
  font-size: 14px;
  text-align: center;
  cursor: pointer;
  transition: all 0.2s ease;
}

.target-item:hover {
  background: rgba(168, 85, 247, 0.15);
}

.target-item.selected {
  background: rgba(168, 85, 247, 0.3);
  border-color: #a855f7;
  color: #fff;
  box-shadow: 0 0 15px rgba(168, 85, 247, 0.3);
}

.targeting-hint {
  text-align: center;
  font-size: 11px;
  color: #64748b;
}

/* 过渡动画 */
.slide-up-enter-active,
.slide-up-leave-active {
  transition: all 0.3s ease;
}

.slide-up-enter-from,
.slide-up-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(20px);
}

.modal-fade-enter-active,
.modal-fade-leave-active {
  transition: opacity 0.2s ease;
}

.modal-fade-enter-from,
.modal-fade-leave-to {
  opacity: 0;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
