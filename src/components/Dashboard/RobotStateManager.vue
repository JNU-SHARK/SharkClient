<template>
  <div class="robot-state-container">
    <!-- 左侧：头像与等级 -->
    <div class="avatar-section">
      <div class="avatar-circle">
        <!-- 机器人图片 -->
        <img
          v-if="!imageLoadError"
          :src="robotAvatarUrl"
          class="robot-avatar-img"
          @error="handleImageError"
          alt="Robot Avatar"
        />
        <div v-else class="robot-img-placeholder"></div>
        <!-- 机器人 ID (类型) -->
        <div class="robot-id-badge">{{ robotId % 100 }}</div>
      </div>
      <!-- 等级指示器 (叠加在左上角) -->
      <div class="level-overlay">
        <RobotLevelDisplay :current-level="robotLevel" />
      </div>
      <!-- 战斗状态指示器 -->
      <div class="combat-status-badge" :class="combatStatusClass">
        {{ combatStatusText }}
      </div>
    </div>

    <!-- 右侧：信息区域 -->
    <div class="info-section">
      <!-- 上半部分：状态条 (血量、能量、功率) -->
      <div class="bars-row">
        <div class="health-power-group">
          <RobotHealthBar :current-health="robotHealth" :max-health="robotMaxHealth" />
          <RobotPowerDisplay
            :current-power="currentPower"
            :max-power="robotMaxPower"
            :current-buffer-energy="robotBufferEnergy"
            :max-buffer-energy="robotMaxBufferEnergy"
            :current-chassis-energy="robotChassisEnergy"
            :max-chassis-energy="robotMaxChassisEnergy"
          />
        </div>
      </div>

      <!-- 下半部分：模块状态 (紧凑版) -->
      <div class="modules-row">
        <RobotModuleStatus :module-status="robotModuleStatus" :compact="true" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useMqttDataStore } from '../../store/modules/mqtt_data'
import RobotHealthBar from './RobotStatus/RobotHealthBar.vue'
import RobotLevelDisplay from './RobotStatus/RobotLevelDisplay.vue'
import RobotPowerDisplay from './RobotStatus/RobotPowerDisplay.vue'
import RobotModuleStatus from './RobotStatus/RobotModuleStatus.vue'

// ==================== Props ====================
interface Props {
  /** 机器人名称（如 "红方1号英雄"） */
  robotName?: string
  /** 队伍 */
  team?: 'red' | 'blue'
  /** 是否启用模拟 */
  enableSimulation?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  robotName: '',
  team: 'red',
  enableSimulation: false
})

// ==================== MQTT Store ====================
const mqttStore = useMqttDataStore()

// ==================== 计算机器人 ID ====================
/** 根据机器人名称获取 ID */
const robotId = computed(() => {
  // 优先使用 MQTT Store 中的 currentRobotId
  if (mqttStore.currentRobotId > 0) {
    return mqttStore.currentRobotId
  }
  // 如果没有设置，尝试从 props 构造
  if (!props.robotName) return 1

  // 机器人类型映射
  const typeMap: Record<string, number> = {
    英雄: 1,
    工程: 2,
    步兵: 3,
    平衡步兵: 5,
    无人机: 6,
    哨兵: 7,
    雷达站: 9
  }

  // 尝试从名称中提取类型
  for (const [typeName, typeId] of Object.entries(typeMap)) {
    if (props.robotName.includes(typeName)) {
      return props.team === 'blue' ? typeId + 100 : typeId
    }
  }

  return props.team === 'blue' ? 101 : 1
})

// ==================== 计算属性 - 从 MQTT Store 获取数据 ====================
/** 当前机器人数据 */
const currentRobot = computed(() => {
  const team = robotId.value < 100 ? 'red' : 'blue'
  const robotMap = team === 'red' ? mqttStore.redRobots : mqttStore.blueRobots
  return robotMap.get(robotId.value) || null
})

/** 血量 - 来自 RobotDynamicStatus.currentHealth / RobotStaticStatus.maxHealth */
const robotHealth = computed(() => currentRobot.value?.currentHealth ?? 0)
const robotMaxHealth = computed(() => currentRobot.value?.maxHealth ?? 600)

/** 等级 - 来自 RobotStaticStatus.level */
const robotLevel = computed(() => currentRobot.value?.level ?? 1)

/** 功率 - 来自 RobotStaticStatus.maxPower (实际功率待后续实现，暂时显示为0) */
const currentPower = computed(() => 0) // TODO: 等待实际功率数据
const robotMaxPower = computed(() => currentRobot.value?.maxPower ?? 120)

/** 缓冲能量 - 来自 RobotDynamicStatus.currentBufferEnergy / RobotStaticStatus.maxBufferEnergy */
const robotBufferEnergy = computed(() => currentRobot.value?.currentBufferEnergy ?? 0)
const robotMaxBufferEnergy = computed(() => currentRobot.value?.maxBufferEnergy ?? 60)

/** 底盘能量 - 来自 RobotDynamicStatus.currentChassisEnergy / RobotStaticStatus.maxChassisEnergy */
const robotChassisEnergy = computed(() => currentRobot.value?.currentChassisEnergy ?? 0)
const robotMaxChassisEnergy = computed(() => currentRobot.value?.maxChassisEnergy ?? 200)

/** 模块状态 - 来自 RobotModuleStatus */
const robotModuleStatus = computed(() => currentRobot.value?.moduleStatus ?? null)

/** 战斗状态 - 来自 RobotDynamicStatus.isOutOfCombat 和 outOfCombatCountdown */
const isOutOfCombat = computed(() => currentRobot.value?.isOutOfCombat ?? false)
const outOfCombatCountdown = computed(() => currentRobot.value?.outOfCombatCountdown ?? 0)

/** 战斗状态文本 */
const combatStatusText = computed(() => {
  if (isOutOfCombat.value) {
    return '已脱战'
  }
  if (outOfCombatCountdown.value > 0) {
    return `脱离中(${outOfCombatCountdown.value}s)`
  }
  return '战斗中'
})

/** 战斗状态样式类 */
const combatStatusClass = computed(() => {
  if (isOutOfCombat.value) {
    return 'status-out-of-combat'
  }
  if (outOfCombatCountdown.value > 0) {
    return 'status-disengaging'
  }
  return 'status-in-combat'
})

/** 机器人头像 URL */
const imageLoadError = ref(false)
const robotAvatarUrl = computed(() => {
  // 重置错误状态，以便尝试加载新图片
  imageLoadError.value = false

  const id = robotId.value
  const isRed = id < 100
  const color = isRed ? 'red' : 'blue'
  const typeId = id % 100

  let type = 'infantry'
  if (typeId === 1) type = 'hero'
  else if (typeId === 2) type = 'engineer'
  else if ([3, 4, 5].includes(typeId)) type = 'infantry'
  else if (typeId === 6) type = 'drone'
  else if (typeId === 7) type = 'sentry'
  else if (typeId === 9) type = 'radar'

  // 使用 / 访问 public/robots_pic 目录
  return `/robots_pic/${color}_teammate_avatar_${type}.png`
})

const handleImageError = () => {
  console.warn(`[RobotStateManager] Failed to load avatar: ${robotAvatarUrl.value}`)
  imageLoadError.value = true
}

// ==================== 监听机器人名称变化 ====================
watch(
  () => props.robotName,
  async (newName) => {
    console.log('[RobotStateManager] 机器人名称切换:', newName, '-> ID:', robotId.value)
    // 通知 MQTT Store 更新当前选中的机器人（异步加载 ID 映射）
    if (newName) {
      await mqttStore.updateCurrentRobotType(newName)
      console.log('[RobotStateManager] ID 更新完成, 当前 ID:', mqttStore.currentRobotId)
    }
  },
  { immediate: true }
)

// ==================== 生命周期 ====================
onMounted(async () => {
  console.log('[RobotStateManager] 组件挂载, 机器人:', props.robotName, 'ID:', robotId.value)
  // 初始化时也要通知 MQTT Store
  if (props.robotName) {
    await mqttStore.updateCurrentRobotType(props.robotName)
  }
})
</script>

<style scoped>
.robot-state-container {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  padding: 10px;
  font-family: 'Microsoft YaHei', sans-serif;
  width: fit-content;
}

.avatar-section {
  position: relative;
  width: 84px;
  height: 84px;
  flex-shrink: 0;
  margin-top: 2px;
}

.avatar-circle {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.8);
  /* 无边框设计 - 仅保留微妙的发光效果 */
  box-shadow:
    0 0 20px rgba(59, 130, 246, 0.2),
    inset 0 0 30px rgba(0, 0, 0, 0.5);
  position: relative;
  overflow: hidden;
}

/* 底部渐变光晕 */
.avatar-circle::before {
  content: '';
  position: absolute;
  bottom: -20%;
  left: -20%;
  width: 140%;
  height: 60%;
  background: radial-gradient(
    ellipse at center bottom,
    rgba(59, 130, 246, 0.15) 0%,
    transparent 70%
  );
  pointer-events: none;
  z-index: 1;
}

.robot-avatar-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 50%;
  /* 图片自带视觉效果，不需要额外处理 */
}

.robot-img-placeholder {
  width: 100%;
  height: 100%;
  background: radial-gradient(circle at 30% 30%, rgba(255, 255, 255, 0.1), transparent);
}

.robot-id-badge {
  position: absolute;
  bottom: -2px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(0, 0, 0, 0.9);
  color: #e2e8f0;
  font-size: 18px;
  font-weight: bold;
  width: 26px;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  /* 无边框 - 仅使用阴影 */
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.8);
  font-family: 'Orbitron', 'Arial', monospace;
  z-index: 5;
}

.level-overlay {
  position: absolute;
  top: -2px;
  left: -2px;
  z-index: 10;
  filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.5));
}

/* 战斗状态徽章 */
.combat-status-badge {
  position: absolute;
  bottom: -18px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 10px;
  font-weight: 600;
  padding: 2px 6px;
  border-radius: 4px;
  white-space: nowrap;
  z-index: 5;
  font-family: 'Microsoft YaHei', sans-serif;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.5);
}

.combat-status-badge.status-in-combat {
  background: linear-gradient(135deg, #dc2626, #b91c1c);
  color: #fff;
  border: 1px solid rgba(255, 100, 100, 0.3);
  animation: combat-pulse 1.5s ease-in-out infinite;
}

.combat-status-badge.status-disengaging {
  background: linear-gradient(135deg, #ea580c, #c2410c);
  color: #fff;
  border: 1px solid rgba(255, 180, 100, 0.3);
  animation: disengaging-pulse 0.8s ease-in-out infinite;
}

.combat-status-badge.status-out-of-combat {
  background: linear-gradient(135deg, #16a34a, #15803d);
  color: #fff;
  border: 1px solid rgba(100, 255, 150, 0.3);
}

@keyframes combat-pulse {
  0%,
  100% {
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.5);
  }
  50% {
    box-shadow:
      0 2px 8px rgba(220, 38, 38, 0.6),
      0 0 12px rgba(220, 38, 38, 0.4);
  }
}

@keyframes disengaging-pulse {
  0%,
  100% {
    opacity: 1;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.5);
  }
  50% {
    opacity: 0.8;
    box-shadow:
      0 2px 8px rgba(234, 88, 12, 0.6),
      0 0 12px rgba(234, 88, 12, 0.4);
  }
}

.info-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-top: 4px;
  flex: 1;
  min-width: 0; /* 防止 flex 子项溢出 */
}

.bars-row {
  display: flex;
  align-items: flex-start;
  width: 100%;
}

.health-power-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
  min-width: 280px;
}

.modules-row {
  margin-top: 2px;
  width: 100%;
}
</style>
