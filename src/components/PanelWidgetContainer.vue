<script setup lang="ts">
import { ref, reactive } from 'vue'
import { useWidgetStylesStore, type WidgetStyle } from '../store/modules/widget-styles'
import { useMqttDataStore } from '../store/modules/mqtt_data'
import DataBar from './Shared/Styles/DataBar.vue'
import DataRing from './Shared/Styles/DataRing.vue'
import DataNumber from './Shared/Styles/DataNumber.vue'
import DataText from './Shared/Styles/DataText.vue'
import DataWaveform from './Shared/Styles/DataWaveform.vue'
import StatusIndicator from './Shared/Styles/StatusIndicator.vue'
import MultiStatusIndicator from './Shared/Styles/MultiStatusIndicator.vue'
import WidgetContextMenu from './WidgetContextMenu.vue'

// 组件映射
const componentMap = {
  DataBar,
  DataRing,
  DataNumber,
  DataText,
  DataWaveform,
  StatusIndicator,
  MultiStatusIndicator
}

interface WidgetInstance {
  id: string
  styleId: string
  position: { x: number; y: number }
  size: { width: number; height: number }
  props: Record<string, unknown>
  zIndex: number
  name?: string // 可选的自定义名称
  mqttBinding?: string // MQTT 数据绑定路径
  mqttBinding2?: string // MQTT 数据绑定路径 (通道2)
  mqttBinding3?: string // MQTT 数据绑定路径 (通道3)
  unit?: string // 显示单位（仅数据条/环形条）
  formula?: string // 计算公式（仅数据条/环形条）
}

const props = defineProps({
  panelId: { type: String, required: true },
  editable: { type: Boolean, default: false }
})

const emit = defineEmits(['widget-selected', 'widget-deleted', 'widgets-updated'])

const widgetStylesStore = useWidgetStylesStore()
const mqttDataStore = useMqttDataStore()
const widgets = ref<WidgetInstance[]>([])
const selectedWidgetId = ref<string | null>(null)
const containerRef = ref<HTMLDivElement | null>(null)

// 拖动状态
const dragState = reactive({
  active: false,
  widgetId: '',
  startPos: { x: 0, y: 0 },
  initialPos: { x: 0, y: 0 }
})

// 调整尺寸状态
const resizeState = reactive({
  active: false,
  widgetId: '',
  startPos: { x: 0, y: 0 },
  initialSize: { width: 0, height: 0 },
  handle: '' // 'se' = 右下角
})

// 网格配置
const gridSize = 10 // 网格大小（像素）
const snapToGrid = true // 是否吸附到网格

// 对齐辅助线状态
const alignmentGuides = reactive({
  horizontal: [] as number[], // Y 坐标
  vertical: [] as number[] // X 坐标
})

// 右键菜单状态
const contextMenu = reactive({
  visible: false,
  x: 0,
  y: 0,
  widgetId: '',
  styleId: ''
})

// 模态框状态
const modal = reactive({
  visible: false,
  type: '' as 'rename' | 'rename-display' | 'bind-mqtt' | 'configure-mqtt' | 'edit-style' | '',
  title: '',
  placeholder: '',
  value: '',
  widgetId: '',
  targetBinding: 'default' as 'default' | '2' | '3', // 当前绑定的目标通道
  mqttOptions: [] as Array<{ label: string; value: string; description?: string }>,
  unit: '',
  max: '', // 最大值配置
  max2: '', // 通道2最大值
  max3: '', // 通道3最大值
  formula: '',
  styleProps: {} as Record<string, unknown>, // 用于编辑样式的属性
  position: { x: 0, y: 0 }, // 模态框位置
  isDragging: false
})

// 模态框拖动状态
const modalDrag = reactive({
  startX: 0,
  startY: 0,
  initialX: 0,
  initialY: 0
})

// 生成MQTT数据选项列表
const generateMqttOptions = (): Array<{ label: string; value: string; description?: string }> => {
  const options: Array<{ label: string; value: string; description?: string }> = []

  // ==================== 游戏状态 (GameStatus) ====================
  options.push(
    { label: '📊 比赛阶段', value: 'gameStatus.currentStage', description: '当前比赛阶段' },
    { label: '📊 当前回合', value: 'gameStatus.currentRound', description: '当前回合数' },
    { label: '📊 总回合数', value: 'gameStatus.totalRounds', description: '总回合数' },
    { label: '🔴 红队分数', value: 'gameStatus.redScore', description: '红队当前分数' },
    { label: '🔵 蓝队分数', value: 'gameStatus.blueScore', description: '蓝队当前分数' },
    {
      label: '⏱️ 阶段倒计时',
      value: 'gameStatus.stageCountdownSec',
      description: '当前阶段剩余时间(秒)'
    },
    {
      label: '⏱️ 阶段已用时间',
      value: 'gameStatus.stageElapsedSec',
      description: '当前阶段已经过时间(秒)'
    },
    { label: '⏸️ 比赛暂停', value: 'gameStatus.isPaused', description: '比赛是否暂停' }
  )

  // ==================== 全局单位状态 (GlobalUnitStatus) ====================
  options.push(
    { label: '🏰 基地血量', value: 'globalUnitStatus.baseHealth', description: '基地当前血量' },
    {
      label: '🏰 基地状态',
      value: 'globalUnitStatus.baseStatus',
      description: '基地状态(无敌/装甲)'
    },
    { label: '🛡️ 基地护盾', value: 'globalUnitStatus.baseShield', description: '基地护盾值' },
    {
      label: '🗼 前哨站血量',
      value: 'globalUnitStatus.outpostHealth',
      description: '前哨站当前血量'
    },
    {
      label: '🗼 前哨站状态',
      value: 'globalUnitStatus.outpostStatus',
      description: '前哨站状态'
    },
    {
      label: '💥 红队总伤害',
      value: 'globalUnitStatus.totalDamageRed',
      description: '红队造成的总伤害'
    },
    {
      label: '💥 蓝队总伤害',
      value: 'globalUnitStatus.totalDamageBlue',
      description: '蓝队造成的总伤害'
    }
  )

  // ==================== 后勤状态 (GlobalLogisticsStatus) ====================
  options.push(
    {
      label: '💰 剩余经济',
      value: 'logisticsStatus.remainingEconomy',
      description: '当前剩余经济值'
    },
    {
      label: '💰 累计获得经济',
      value: 'logisticsStatus.totalEconomyObtained',
      description: '累计获得的总经济'
    },
    { label: '🔬 科技等级', value: 'logisticsStatus.techLevel', description: '当前科技等级' },
    {
      label: '🔐 加密等级',
      value: 'logisticsStatus.encryptionLevel',
      description: '当前加密等级'
    }
  )

  // ==================== 特殊机制 (GlobalSpecialMechanism) ====================
  if (mqttDataStore.specialMechanisms.mechanismId.length > 0) {
    mqttDataStore.specialMechanisms.mechanismId.forEach((id, index) => {
      options.push({
        label: `⚙️ 特殊机制${index + 1}`,
        value: `specialMechanisms.mechanismTimeSec[${index}]`,
        description: `机制ID: ${id} 的剩余时间`
      })
    })
  }

  // ==================== 红队机器人数据 ====================
  mqttDataStore.redRobotList.forEach((robot) => {
    const prefix = `robot.red.${robot.robotId}`
    options.push(
      {
        label: `🔴 红${robot.robotId} - 血量`,
        value: `${prefix}.currentHealth`,
        description: `当前血量 / 最大血量`
      },
      {
        label: `🔴 红${robot.robotId} - 最大血量`,
        value: `${prefix}.maxHealth`,
        description: `最大血量`
      },
      {
        label: `🔴 红${robot.robotId} - 枪口热量`,
        value: `${prefix}.currentHeat`,
        description: `当前枪口热量`
      },
      {
        label: `🔴 红${robot.robotId} - 最大热量`,
        value: `${prefix}.maxHeat`,
        description: `最大枪口热量`
      },
      {
        label: `🔴 红${robot.robotId} - 底盘功率`,
        value: `${prefix}.currentChassisEnergy`,
        description: `当前底盘功率`
      },
      {
        label: `🔴 红${robot.robotId} - 最大底盘能量`,
        value: `${prefix}.maxChassisEnergy`,
        description: `最大底盘能量`
      },
      {
        label: `🔴 红${robot.robotId} - 缓冲能量`,
        value: `${prefix}.currentBufferEnergy`,
        description: `当前缓冲能量`
      },
      {
        label: `🔴 红${robot.robotId} - 最大缓冲能量`,
        value: `${prefix}.maxBufferEnergy`,
        description: `最大缓冲能量`
      },
      {
        label: `🔴 红${robot.robotId} - 剩余弹药`,
        value: `${prefix}.remainingAmmo`,
        description: `剩余弹药数`
      },
      {
        label: `🔴 红${robot.robotId} - 等级`,
        value: `${prefix}.level`,
        description: `当前等级`
      },
      {
        label: `🔴 红${robot.robotId} - 经验值`,
        value: `${prefix}.currentExperience`,
        description: `当前经验值`
      },
      {
        label: `🔴 红${robot.robotId} - 机器人类型`,
        value: `${prefix}.robotType`,
        description: `机器人类型编号`
      },
      {
        label: `🔴 红${robot.robotId} - 脱战状态`,
        value: `${prefix}.isOutOfCombat`,
        description: `是否处于脱战状态`
      },
      {
        label: `🔴 红${robot.robotId} - X坐标`,
        value: `${prefix}.x`,
        description: `机器人X坐标`
      },
      {
        label: `🔴 红${robot.robotId} - Y坐标`,
        value: `${prefix}.y`,
        description: `机器人Y坐标`
      },
      {
        label: `🔴 红${robot.robotId} - Z坐标`,
        value: `${prefix}.z`,
        description: `机器人Z坐标`
      },
      {
        label: `🔴 红${robot.robotId} - 朝向`,
        value: `${prefix}.yaw`,
        description: `机器人朝向角度`
      },
      {
        label: `🔴 红${robot.robotId} - 存活状态`,
        value: `${prefix}.isAlive`,
        description: `是否存活`
      },
      {
        label: `🔴 红${robot.robotId} - 待复活状态`,
        value: `${prefix}.isPendingRespawn`,
        description: `是否待复活`
      }
    )
  })

  // ==================== 蓝队机器人数据 ====================
  mqttDataStore.blueRobotList.forEach((robot) => {
    const prefix = `robot.blue.${robot.robotId}`
    options.push(
      {
        label: `🔵 蓝${robot.robotId} - 血量`,
        value: `${prefix}.currentHealth`,
        description: `当前血量 / 最大血量`
      },
      {
        label: `🔵 蓝${robot.robotId} - 最大血量`,
        value: `${prefix}.maxHealth`,
        description: `最大血量`
      },
      {
        label: `🔵 蓝${robot.robotId} - 枪口热量`,
        value: `${prefix}.currentHeat`,
        description: `当前枪口热量`
      },
      {
        label: `🔵 蓝${robot.robotId} - 最大热量`,
        value: `${prefix}.maxHeat`,
        description: `最大枪口热量`
      },
      {
        label: `🔵 蓝${robot.robotId} - 底盘功率`,
        value: `${prefix}.currentChassisEnergy`,
        description: `当前底盘功率`
      },
      {
        label: `🔵 蓝${robot.robotId} - 最大底盘能量`,
        value: `${prefix}.maxChassisEnergy`,
        description: `最大底盘能量`
      },
      {
        label: `🔵 蓝${robot.robotId} - 缓冲能量`,
        value: `${prefix}.currentBufferEnergy`,
        description: `当前缓冲能量`
      },
      {
        label: `🔵 蓝${robot.robotId} - 最大缓冲能量`,
        value: `${prefix}.maxBufferEnergy`,
        description: `最大缓冲能量`
      },
      {
        label: `🔵 蓝${robot.robotId} - 剩余弹药`,
        value: `${prefix}.remainingAmmo`,
        description: `剩余弹药数`
      },
      {
        label: `🔵 蓝${robot.robotId} - 等级`,
        value: `${prefix}.level`,
        description: `当前等级`
      },
      {
        label: `🔵 蓝${robot.robotId} - 经验值`,
        value: `${prefix}.currentExperience`,
        description: `当前经验值`
      },
      {
        label: `🔵 蓝${robot.robotId} - 机器人类型`,
        value: `${prefix}.robotType`,
        description: `机器人类型编号`
      },
      {
        label: `🔵 蓝${robot.robotId} - 脱战状态`,
        value: `${prefix}.isOutOfCombat`,
        description: `是否处于脱战状态`
      },
      {
        label: `🔵 蓝${robot.robotId} - X坐标`,
        value: `${prefix}.x`,
        description: `机器人X坐标`
      },
      {
        label: `🔵 蓝${robot.robotId} - Y坐标`,
        value: `${prefix}.y`,
        description: `机器人Y坐标`
      },
      {
        label: `🔵 蓝${robot.robotId} - Z坐标`,
        value: `${prefix}.z`,
        description: `机器人Z坐标`
      },
      {
        label: `🔵 蓝${robot.robotId} - 朝向`,
        value: `${prefix}.yaw`,
        description: `机器人朝向角度`
      },
      {
        label: `🔵 蓝${robot.robotId} - 存活状态`,
        value: `${prefix}.isAlive`,
        description: `是否存活`
      },
      {
        label: `🔵 蓝${robot.robotId} - 待复活状态`,
        value: `${prefix}.isPendingRespawn`,
        description: `是否待复活`
      }
    )
  })

  // ==================== Buff状态 ====================
  mqttDataStore.activeBuffs.forEach((buff, index) => {
    options.push({
      label: `✨ Buff${index + 1} - 剩余时间`,
      value: `activeBuffs[${index}].buffLeftTime`,
      description: `Buff类型: ${buff.buffType}, 机器人ID: ${buff.robotId}`
    })
  })

  // ==================== 判罚信息 (PenaltyInfo) ====================
  if (mqttDataStore.penaltyInfo) {
    options.push(
      {
        label: '⚠️ 判罚类型',
        value: 'penaltyInfo.penaltyType',
        description: '当前判罚类型'
      },
      {
        label: '⚠️ 判罚剩余时间',
        value: 'penaltyInfo.penaltyLeftTime',
        description: '判罚剩余时间(秒)'
      }
    )
  }

  // ==================== 雷达检测数据 (RaderInfoToClient) ====================
  mqttDataStore.radarDetections.forEach((_detection, index) => {
    options.push(
      {
        label: `📡 雷达${index + 1} - 目标ID`,
        value: `radarDetections[${index}].targetRobotId`,
        description: '检测到的目标机器人ID'
      },
      {
        label: `📡 雷达${index + 1} - X坐标`,
        value: `radarDetections[${index}].x`,
        description: '目标X坐标'
      },
      {
        label: `📡 雷达${index + 1} - Y坐标`,
        value: `radarDetections[${index}].y`,
        description: '目标Y坐标'
      }
    )
  })

  // ==================== 哨兵状态 (SentinelStatusSync) ====================
  if (mqttDataStore.sentinelStatus) {
    options.push(
      {
        label: '🤖 哨兵姿态',
        value: 'sentinelStatus.postureId',
        description: '哨兵当前姿态ID(1进攻/2防御/3移动)'
      },
      {
        label: '🤖 哨兵弱化状态',
        value: 'sentinelStatus.isWeakened',
        description: '哨兵是否被弱化'
      }
    )
  }

  // ==================== 科技核心状态 (TechCoreMotionStateSync) ====================
  // 注意：此数据需要从 mqttDataStore 中添加对应字段
  // TODO: 在 mqtt_data.ts 中添加 techCoreStatus 字段

  // ==================== 性能体系状态 (RobotPerformanceSelectionSync) ====================
  // 注意：此数据已包含在 RobotStaticStatus 中
  // performance_system_shooter 和 performance_system_chassis

  // ==================== 英雄部署模式状态 (DeployModeStatusSync) ====================
  // 注意：此数据需要从 mqttDataStore 中添加对应字段
  // TODO: 在 mqtt_data.ts 中添加 deployModeStatus 字段

  // ==================== 飞镖目标状态 (DartSelectTargetStatusSync) ====================
  // 注意：此数据需要从 mqttDataStore 中添加对应字段
  // TODO: 在 mqtt_data.ts 中添加 dartTargetStatus 字段

  // ==================== 机器人受伤统计 (RobotInjuryStat) ====================
  mqttDataStore.allRobots.forEach((robot) => {
    const injuryStat = mqttDataStore.injuryStats.get(robot.robotId)
    if (injuryStat) {
      const prefix = `injuryStats.${robot.robotId}`
      const teamLabel = robot.team === 'red' ? '🔴' : '🔵'
      options.push(
        {
          label: `${teamLabel} ${robot.team === 'red' ? '红' : '蓝'}${robot.robotId} - 累计受伤`,
          value: `${prefix}.totalDamage`,
          description: '本次存活累计受伤总计'
        },
        {
          label: `${teamLabel} ${robot.team === 'red' ? '红' : '蓝'}${robot.robotId} - 撞击伤害`,
          value: `${prefix}.collisionDamage`,
          description: '撞击造成的伤害'
        },
        {
          label: `${teamLabel} ${robot.team === 'red' ? '红' : '蓝'}${robot.robotId} - 17mm伤害`,
          value: `${prefix}.smallProjectileDamage`,
          description: '17mm弹丸造成的伤害'
        },
        {
          label: `${teamLabel} ${robot.team === 'red' ? '红' : '蓝'}${robot.robotId} - 42mm伤害`,
          value: `${prefix}.largeProjectileDamage`,
          description: '42mm弹丸造成的伤害'
        },
        {
          label: `${teamLabel} ${robot.team === 'red' ? '红' : '蓝'}${robot.robotId} - 击杀者ID`,
          value: `${prefix}.killerId`,
          description: '击杀本机器人的ID(0=无)'
        }
      )
    }
  })

  // ==================== 机器人复活状态 (RobotRespawnStatus) ====================
  mqttDataStore.allRobots.forEach((robot) => {
    const respawn = mqttDataStore.respawnStatus.get(robot.robotId)
    if (respawn) {
      const prefix = `respawnStatus.${robot.robotId}`
      const teamLabel = robot.team === 'red' ? '🔴' : '🔵'
      options.push(
        {
          label: `${teamLabel} ${robot.team === 'red' ? '红' : '蓝'}${robot.robotId} - 待复活`,
          value: `${prefix}.isPendingRespawn`,
          description: '是否待复活'
        },
        {
          label: `${teamLabel} ${robot.team === 'red' ? '红' : '蓝'}${robot.robotId} - 复活进度`,
          value: `${prefix}.currentRespawnProgress`,
          description: '当前复活读条进度'
        },
        {
          label: `${teamLabel} ${robot.team === 'red' ? '红' : '蓝'}${robot.robotId} - 复活总进度`,
          value: `${prefix}.totalRespawnProgress`,
          description: '复活所需总读条'
        },
        {
          label: `${teamLabel} ${robot.team === 'red' ? '红' : '蓝'}${robot.robotId} - 可免费复活`,
          value: `${prefix}.canFreeRespawn`,
          description: '是否可免费复活'
        },
        {
          label: `${teamLabel} ${robot.team === 'red' ? '红' : '蓝'}${robot.robotId} - 付费复活金币`,
          value: `${prefix}.goldCostForRespawn`,
          description: '花费金币复活所需数量'
        }
      )
    }
  })

  // ==================== 机器人模块状态 (RobotModuleStatus) ====================
  mqttDataStore.allRobots.forEach((robot) => {
    if (robot.moduleStatus) {
      const prefix = `robot.${robot.team}.${robot.robotId}.moduleStatus`
      const teamLabel = robot.team === 'red' ? '🔴' : '🔵'
      options.push(
        {
          label: `${teamLabel} ${robot.team === 'red' ? '红' : '蓝'}${robot.robotId} - 电源模块`,
          value: `${prefix}.powerManager`,
          description: '电源管理模块状态(0离线/1在线)'
        },
        {
          label: `${teamLabel} ${robot.team === 'red' ? '红' : '蓝'}${robot.robotId} - 17mm发射`,
          value: `${prefix}.smallShooter`,
          description: '17mm发射机构状态'
        },
        {
          label: `${teamLabel} ${robot.team === 'red' ? '红' : '蓝'}${robot.robotId} - 42mm发射`,
          value: `${prefix}.bigShooter`,
          description: '42mm发射机构状态'
        },
        {
          label: `${teamLabel} ${robot.team === 'red' ? '红' : '蓝'}${robot.robotId} - 图传模块`,
          value: `${prefix}.videoTransmission`,
          description: '图传模块状态'
        },
        {
          label: `${teamLabel} ${robot.team === 'red' ? '红' : '蓝'}${robot.robotId} - 装甲模块`,
          value: `${prefix}.armor`,
          description: '装甲模块状态'
        },
        {
          label: `${teamLabel} ${robot.team === 'red' ? '红' : '蓝'}${robot.robotId} - 主控状态`,
          value: `${prefix}.mainController`,
          description: '主控状态'
        }
      )
    }
  })

  // ==================== 能量机关状态 (RuneStatusSync) ====================
  options.push(
    {
      label: '🎯 能量机关状态',
      value: 'runeStatus.runeStatus',
      description: '能量机关当前状态'
    },
    {
      label: '🎯 已激活臂数',
      value: 'runeStatus.activatedArms',
      description: '已激活的机关臂数量'
    },
    {
      label: '🎯 平均环数',
      value: 'runeStatus.averageRings',
      description: '平均击打环数'
    }
  )

  // ==================== 空中支援状态 (AirSupportStatusSync) ====================
  options.push(
    {
      label: '✈️ 空中支援状态',
      value: 'airSupportStatus.airsupportStatus',
      description: '空中支援当前状态'
    },
    {
      label: '✈️ 空中支援剩余时间',
      value: 'airSupportStatus.leftTime',
      description: '空中支援剩余时间(秒)'
    },
    {
      label: '✈️ 空中支援花费',
      value: 'airSupportStatus.costCoins',
      description: '空中支援花费的金币'
    }
  )

  // ==================== 统计数据 (计算属性) ====================
  options.push(
    { label: '📈 红队总血量', value: 'stats.redTotalHealth', description: '红队所有机器人总血量' },
    { label: '📈 蓝队总血量', value: 'stats.blueTotalHealth', description: '蓝队所有机器人总血量' },
    {
      label: '📈 红队血量百分比',
      value: 'stats.redHealthPercentage',
      description: '红队总血量百分比'
    },
    {
      label: '📈 蓝队血量百分比',
      value: 'stats.blueHealthPercentage',
      description: '蓝队总血量百分比'
    },
    { label: '📈 红队存活数', value: 'stats.aliveRedCount', description: '红队存活机器人数量' },
    { label: '📈 蓝队存活数', value: 'stats.aliveBlueCount', description: '蓝队存活机器人数量' },
    { label: '📈 激活Buff数量', value: 'stats.activeBuffCount', description: '当前激活的Buff数量' }
  )

  // ==================== 事件数据 ====================
  if (mqttDataStore.recentEvents.length > 0) {
    options.push({
      label: '📢 最新事件',
      value: 'recentEvents[0].eventId',
      description: '最新发生的事件ID'
    })
  }

  // ==================== 连接状态 ====================
  options.push(
    {
      label: '🔌 MQTT连接状态',
      value: 'connectionStats.isConnected',
      description: 'MQTT是否已连接'
    },
    {
      label: '🔌 总消息数',
      value: 'connectionStats.totalMessages',
      description: '接收的总消息数'
    },
    {
      label: '🔌 消息速率',
      value: 'connectionStats.messagesPerSecond',
      description: '每秒消息数(MPS)'
    }
  )

  return options
}

// 判断是否为波形图组件
const isWaveformWidget = (widgetId: string): boolean => {
  const widget = widgets.value.find((w) => w.id === widgetId)
  if (!widget) return false
  const style = widgetStylesStore.getStyleById(widget.styleId)
  return style?.component === 'DataWaveform'
}

// 切换绑定目标通道
const changeBindingTarget = (target: 'default' | '2' | '3'): void => {
  modal.targetBinding = target

  // 切换通道时更新显示为该通道的当前绑定值
  const widget = widgets.value.find((w) => w.id === modal.widgetId)
  if (!widget) return

  if (target === 'default') {
    modal.value = widget.mqttBinding || ''
  } else if (target === '2') {
    modal.value = widget.mqttBinding2 || ''
  } else if (target === '3') {
    modal.value = widget.mqttBinding3 || ''
  }
}

// 获取当前选中通道的已绑定数据
const getCurrentChannelBinding = (): string => {
  const widget = widgets.value.find((w) => w.id === modal.widgetId)
  if (!widget) return ''

  if (modal.targetBinding === 'default') return widget.mqttBinding || '未绑定'
  if (modal.targetBinding === '2') return widget.mqttBinding2 || '未绑定'
  if (modal.targetBinding === '3') return widget.mqttBinding3 || '未绑定'
  return ''
}

// 显示模态框
const showModal = (type: 'rename' | 'rename-display' | 'bind-mqtt', widgetId: string): void => {
  const widget = widgets.value.find((w) => w.id === widgetId)
  if (!widget) return

  modal.widgetId = widgetId
  modal.type = type
  modal.targetBinding = 'default' // 重置为默认通道

  if (type === 'rename') {
    const style = widgetStylesStore.getStyleById(widget.styleId)
    modal.title = '重命名组件'
    modal.placeholder = '请输入新的组件名称'
    modal.value = widget.name || style?.name || '组件'
    modal.mqttOptions = []
  } else if (type === 'rename-display') {
    modal.title = '重命名显示名称'
    modal.placeholder = '请输入显示名称（如：ENERGY）'
    modal.value = (widget.props.label as string) || ''
    modal.mqttOptions = []
  } else if (type === 'bind-mqtt') {
    modal.title = '绑定 MQTT 数据'
    modal.placeholder = '选择要绑定的 MQTT 数据'
    modal.value = widget.mqttBinding || ''
    // 生成MQTT数据选项列表
    modal.mqttOptions = generateMqttOptions()
  }

  // 居中显示模态框
  modal.position.x = (window.innerWidth - 500) / 2
  modal.position.y = (window.innerHeight - 600) / 2
  modal.visible = true
}

// 开始拖动模态框
const startModalDrag = (event: MouseEvent): void => {
  modal.isDragging = true
  modalDrag.startX = event.clientX
  modalDrag.startY = event.clientY
  modalDrag.initialX = modal.position.x
  modalDrag.initialY = modal.position.y

  document.addEventListener('mousemove', onModalDrag)
  document.addEventListener('mouseup', stopModalDrag)
}

const onModalDrag = (event: MouseEvent): void => {
  if (!modal.isDragging) return

  const dx = event.clientX - modalDrag.startX
  const dy = event.clientY - modalDrag.startY

  modal.position.x = modalDrag.initialX + dx
  modal.position.y = modalDrag.initialY + dy
}

const stopModalDrag = (): void => {
  modal.isDragging = false
  document.removeEventListener('mousemove', onModalDrag)
  document.removeEventListener('mouseup', stopModalDrag)
}

// 确认模态框
const confirmModal = (): void => {
  const widget = widgets.value.find((w) => w.id === modal.widgetId)
  if (!widget) return

  if (modal.type === 'rename') {
    if (modal.value && modal.value.trim()) {
      widget.name = modal.value.trim()
    }
  } else if (modal.type === 'rename-display') {
    if (modal.value !== undefined) {
      widget.props.label = modal.value.trim()
      console.log(`[Widget] ${widget.id} 显示名称更新为: ${widget.props.label}`)
    }
  } else if (modal.type === 'bind-mqtt') {
    const bindingValue = modal.value.trim() || undefined

    if (modal.targetBinding === '2') {
      widget.mqttBinding2 = bindingValue
      console.log(`[Widget] ${widget.id} 通道2绑定到: ${widget.mqttBinding2}`)
    } else if (modal.targetBinding === '3') {
      widget.mqttBinding3 = bindingValue
      console.log(`[Widget] ${widget.id} 通道3绑定到: ${widget.mqttBinding3}`)
    } else {
      widget.mqttBinding = bindingValue
      // 自动更新组件标签为 MQTT 数据的中文名称 (仅主通道)
      if (widget.mqttBinding) {
        const selectedOption = modal.mqttOptions.find((opt) => opt.value === modal.value)
        if (selectedOption) {
          // 提取 emoji 后的中文名称
          const labelText = selectedOption.label.replace(/^[\u{1F000}-\u{1F9FF}]\s*/u, '')
          widget.props.label = labelText
        }
      }
      console.log(`[Widget] ${widget.id} 绑定到 MQTT 路径: ${widget.mqttBinding}`)
    }
  } else if (modal.type === 'configure-mqtt') {
    widget.unit = modal.unit.trim() || undefined
    widget.formula = modal.formula.trim() || 'value'

    // 更新最大值
    if (modal.max && !isNaN(Number(modal.max))) {
      widget.props.max = Number(modal.max)
    } else {
      delete widget.props.max
    }

    // 更新通道2最大值
    if (modal.max2 && !isNaN(Number(modal.max2))) {
      widget.props.max2 = Number(modal.max2)
    } else {
      delete widget.props.max2
    }

    // 更新通道3最大值
    if (modal.max3 && !isNaN(Number(modal.max3))) {
      widget.props.max3 = Number(modal.max3)
    } else {
      delete widget.props.max3
    }

    console.log(
      `[Widget] ${widget.id} 配置单位: ${widget.unit}, 最大值: ${widget.props.max}, 公式: ${widget.formula}`
    )
  } else if (modal.type === 'edit-style') {
    // 应用编辑后的样式属性
    Object.assign(widget.props, modal.styleProps)
    console.log(`[Widget] ${widget.id} 样式已更新`)
  }

  emit('widgets-updated')
  closeModal()
}

// 关闭模态框
const closeModal = (): void => {
  modal.visible = false
  modal.value = ''
  modal.unit = ''
  modal.max = ''
  modal.max2 = ''
  modal.max3 = ''
  modal.formula = ''
  modal.widgetId = ''
  modal.styleProps = {}
  modal.isDragging = false
}

// 显示右键菜单
const showContextMenu = (event: MouseEvent, widgetId: string): void => {
  event.preventDefault()
  event.stopPropagation()

  const widget = widgets.value.find((w) => w.id === widgetId)
  if (!widget) return

  // 直接使用鼠标位置，菜单组件内部处理边界检测
  contextMenu.visible = true
  contextMenu.x = event.clientX
  contextMenu.y = event.clientY
  contextMenu.widgetId = widgetId
  contextMenu.styleId = widget.styleId

  selectWidget(widgetId)
}

// 关闭右键菜单
const closeContextMenu = (): void => {
  contextMenu.visible = false
}

// 切换组件样式
const changeWidgetStyle = (newStyleId: string): void => {
  const widget = widgets.value.find((w) => w.id === contextMenu.widgetId)
  if (!widget) return

  const newStyle = widgetStylesStore.getStyleById(newStyleId)
  if (!newStyle) return

  // 更新样式 ID
  widget.styleId = newStyleId

  // 重置为新样式的默认属性
  widget.props = newStyle.props.reduce(
    (acc, prop) => {
      acc[prop.name] = prop.default
      return acc
    },
    {} as Record<string, unknown>
  )

  // 更新默认尺寸
  widget.size = { ...newStyle.defaultSize }
  emit('widgets-updated')
}

// 重命名组件
const renameWidget = (): void => {
  showModal('rename', contextMenu.widgetId)
}

// 重命名显示名称
const renameDisplay = (): void => {
  showModal('rename-display', contextMenu.widgetId)
}

// 绑定 MQTT 数据
const bindMqttData = (): void => {
  showModal('bind-mqtt', contextMenu.widgetId)
}

// 配置 MQTT（单位和公式）
const configureMqttData = (): void => {
  const widget = widgets.value.find((w) => w.id === contextMenu.widgetId)
  if (!widget) return

  modal.visible = true
  modal.type = 'configure-mqtt'
  modal.title = '配置单位和计算公式'
  modal.widgetId = contextMenu.widgetId
  modal.unit = widget.unit || ''
  modal.max = widget.props.max !== undefined ? String(widget.props.max) : ''
  modal.max2 = widget.props.max2 !== undefined ? String(widget.props.max2) : ''
  modal.max3 = widget.props.max3 !== undefined ? String(widget.props.max3) : ''
  modal.formula = widget.formula || 'value'
}

// 编辑组件样式
const editWidgetStyle = (): void => {
  const widget = widgets.value.find((w) => w.id === contextMenu.widgetId)
  if (!widget) return

  const style = widgetStylesStore.getStyleById(widget.styleId)
  if (!style) return

  modal.visible = true
  modal.type = 'edit-style'
  modal.title = `编辑样式 - ${style.name}`
  modal.widgetId = contextMenu.widgetId
  // 复制当前组件的属性用于编辑
  modal.styleProps = JSON.parse(JSON.stringify(widget.props))
}

// 获取属性的中文标签
const getPropLabel = (key: string): string => {
  const labelMap: Record<string, string> = {
    label: '标签文本',
    color: '主要颜色',
    value: '数值',
    max: '最大值',
    min: '最小值',
    unit: '单位',
    showValue: '显示数值',
    segmented: '分段显示',
    size: '字体大小',
    bufferColor: '缓冲颜色',
    actualColor: '实际颜色',
    bufferValue: '缓冲值',
    bufferMax: '缓冲最大值',
    dualMode: '双段模式',
    active: '激活状态',
    text: '文本内容',
    fontSize: '字体大小',
    fontWeight: '字体粗细',
    color2: '通道2颜色',
    color3: '通道3颜色',
    label2: '通道2标签',
    label3: '通道3标签',
    value2: '通道2数值',
    value3: '通道3数值'
  }
  return labelMap[key] || key
}

// 判断是否为颜色属性
const isColorProp = (key: string): boolean => {
  return key.toLowerCase().includes('color') || key === 'backgroundColor'
}

// 添加组件
const addWidget = (styleId: string, position?: { x: number; y: number }): void => {
  const style = widgetStylesStore.getStyleById(styleId)
  if (!style) return

  const widget: WidgetInstance = {
    id: `widget-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    styleId,
    position: position || { x: 50, y: 50 },
    size: { ...style.defaultSize },
    props: style.props.reduce(
      (acc, prop) => {
        acc[prop.name] = prop.default
        return acc
      },
      {} as Record<string, unknown>
    ),
    zIndex: widgets.value.length
  }

  widgets.value.push(widget)
  emit('widgets-updated')
}

// 选中组件
const selectWidget = (widgetId: string): void => {
  selectedWidgetId.value = widgetId
  emit('widget-selected', widgetId)
}

// 取消选中组件
const deselectWidget = (): void => {
  if (!props.editable) return
  selectedWidgetId.value = null
}

// 删除组件
const deleteWidget = (widgetId: string): void => {
  const index = widgets.value.findIndex((w) => w.id === widgetId)
  if (index !== -1) {
    widgets.value.splice(index, 1)
    if (selectedWidgetId.value === widgetId) {
      selectedWidgetId.value = null
    }
    emit('widget-deleted', widgetId)
    emit('widgets-updated')
  }
}

// 开始拖动
const startDrag = (event: MouseEvent, widgetId: string): void => {
  if (!props.editable) return

  event.stopPropagation()
  const widget = widgets.value.find((w) => w.id === widgetId)
  if (!widget) return

  dragState.active = true
  dragState.widgetId = widgetId
  dragState.startPos = { x: event.clientX, y: event.clientY }
  dragState.initialPos = { ...widget.position }

  selectWidget(widgetId)

  document.addEventListener('mousemove', onDrag)
  document.addEventListener('mouseup', stopDrag)
}

const onDrag = (event: MouseEvent): void => {
  if (!dragState.active) return

  const widget = widgets.value.find((w) => w.id === dragState.widgetId)
  if (!widget) return

  const dx = event.clientX - dragState.startPos.x
  const dy = event.clientY - dragState.startPos.y

  let newX = dragState.initialPos.x + dx
  let newY = dragState.initialPos.y + dy

  // 组件对齐吸附（类似 PS/PPT）
  const snapThreshold = 5 // 吸附阈值（像素）
  const otherWidgets = widgets.value.filter((w) => w.id !== dragState.widgetId)

  // 当前组件的边界
  const currentLeft = newX
  const currentRight = newX + widget.size.width
  const currentTop = newY
  const currentBottom = newY + widget.size.height
  const currentCenterX = newX + widget.size.width / 2
  const currentCenterY = newY + widget.size.height / 2

  let snapX: number | null = null
  let snapY: number | null = null

  // 清空辅助线
  alignmentGuides.horizontal = []
  alignmentGuides.vertical = []

  // 检查与其他组件的对齐
  for (const other of otherWidgets) {
    const otherLeft = other.position.x
    const otherRight = other.position.x + other.size.width
    const otherTop = other.position.y
    const otherBottom = other.position.y + other.size.height
    const otherCenterX = other.position.x + other.size.width / 2
    const otherCenterY = other.position.y + other.size.height / 2

    // 左边对齐
    if (Math.abs(currentLeft - otherLeft) < snapThreshold) {
      snapX = otherLeft
      alignmentGuides.vertical.push(otherLeft)
    }
    // 右边对齐
    else if (Math.abs(currentRight - otherRight) < snapThreshold) {
      snapX = otherRight - widget.size.width
      alignmentGuides.vertical.push(otherRight)
    }
    // 左边对右边
    else if (Math.abs(currentLeft - otherRight) < snapThreshold) {
      snapX = otherRight
      alignmentGuides.vertical.push(otherRight)
    }
    // 右边对左边
    else if (Math.abs(currentRight - otherLeft) < snapThreshold) {
      snapX = otherLeft - widget.size.width
      alignmentGuides.vertical.push(otherLeft)
    }
    // 中心对齐（水平）
    else if (Math.abs(currentCenterX - otherCenterX) < snapThreshold) {
      snapX = otherCenterX - widget.size.width / 2
      alignmentGuides.vertical.push(otherCenterX)
    }

    // 顶部对齐
    if (Math.abs(currentTop - otherTop) < snapThreshold) {
      snapY = otherTop
      alignmentGuides.horizontal.push(otherTop)
    }
    // 底部对齐
    else if (Math.abs(currentBottom - otherBottom) < snapThreshold) {
      snapY = otherBottom - widget.size.height
      alignmentGuides.horizontal.push(otherBottom)
    }
    // 顶部对底部
    else if (Math.abs(currentTop - otherBottom) < snapThreshold) {
      snapY = otherBottom
      alignmentGuides.horizontal.push(otherBottom)
    }
    // 底部对顶部
    else if (Math.abs(currentBottom - otherTop) < snapThreshold) {
      snapY = otherTop - widget.size.height
      alignmentGuides.horizontal.push(otherTop)
    }
    // 中心对齐（垂直）
    else if (Math.abs(currentCenterY - otherCenterY) < snapThreshold) {
      snapY = otherCenterY - widget.size.height / 2
      alignmentGuides.horizontal.push(otherCenterY)
    }

    // 如果已找到吸附位置，跳出循环
    if (snapX !== null && snapY !== null) break
  }

  // 应用吸附或网格吸附
  if (snapX !== null) {
    newX = snapX
  } else if (snapToGrid) {
    newX = Math.round(newX / gridSize) * gridSize
  }

  if (snapY !== null) {
    newY = snapY
  } else if (snapToGrid) {
    newY = Math.round(newY / gridSize) * gridSize
  }

  widget.position.x = newX
  widget.position.y = newY
}

const stopDrag = (): void => {
  dragState.active = false
  dragState.widgetId = ''
  // 清空辅助线
  alignmentGuides.horizontal = []
  alignmentGuides.vertical = []
  document.removeEventListener('mousemove', onDrag)
  document.removeEventListener('mouseup', stopDrag)
  emit('widgets-updated')
}

// 开始调整尺寸
const startResize = (event: MouseEvent, widgetId: string, handle: string): void => {
  if (!props.editable) return

  event.stopPropagation()
  event.preventDefault()

  const widget = widgets.value.find((w) => w.id === widgetId)
  if (!widget) return

  resizeState.active = true
  resizeState.widgetId = widgetId
  resizeState.startPos = { x: event.clientX, y: event.clientY }
  resizeState.initialSize = { ...widget.size }
  resizeState.handle = handle

  selectWidget(widgetId)

  document.addEventListener('mousemove', onResize)
  document.addEventListener('mouseup', stopResize)
}

const onResize = (event: MouseEvent): void => {
  if (!resizeState.active) return

  const widget = widgets.value.find((w) => w.id === resizeState.widgetId)
  if (!widget) return

  const dx = event.clientX - resizeState.startPos.x
  const dy = event.clientY - resizeState.startPos.y

  let newWidth = resizeState.initialSize.width + dx
  let newHeight = resizeState.initialSize.height + dy

  // 最小尺寸限制
  newWidth = Math.max(50, newWidth)
  newHeight = Math.max(30, newHeight)

  // 网格吸附
  if (snapToGrid) {
    newWidth = Math.round(newWidth / gridSize) * gridSize
    newHeight = Math.round(newHeight / gridSize) * gridSize
  }

  widget.size.width = newWidth
  widget.size.height = newHeight

  // 计算缩放比例（用于内部元素等比缩放）
  const scaleX = newWidth / resizeState.initialSize.width
  const scaleY = newHeight / resizeState.initialSize.height
  widget.props.scale = Math.min(scaleX, scaleY) // 使用较小的缩放比例保持比例
}

const stopResize = (): void => {
  resizeState.active = false
  resizeState.widgetId = ''
  document.removeEventListener('mousemove', onResize)
  document.removeEventListener('mouseup', stopResize)
  emit('widgets-updated')
}

// 更新组件属性
const updateWidgetProp = (widgetId: string, propName: string, value: unknown): void => {
  const widget = widgets.value.find((w) => w.id === widgetId)
  if (widget) {
    widget.props[propName] = value
  }
}

// 获取组件样式定义
const getWidgetStyle = (styleId: string): WidgetStyle | undefined => {
  return widgetStylesStore.getStyleById(styleId)
}

// 解析 widget props，将 JSON 字符串转换为对象，并应用 MQTT 数据绑定
const parseWidgetProps = (widget: WidgetInstance): Record<string, unknown> => {
  const parsed: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(widget.props)) {
    if (typeof value === 'string' && (value.startsWith('[') || value.startsWith('{'))) {
      try {
        parsed[key] = JSON.parse(value)
      } catch {
        parsed[key] = value
      }
    } else {
      parsed[key] = value
    }
  }

  // 如果有 MQTT 数据绑定，获取实时数据
  if (widget.mqttBinding) {
    const mqttValue = getMqttValue(widget.mqttBinding)

    // 应用计算公式（仅数据条和环形条）
    let processedValue = mqttValue
    if (widget.formula && parsed.value !== undefined && typeof mqttValue === 'number') {
      try {
        // CSP 安全的公式计算：使用预定义函数而非动态执行
        processedValue = evaluateFormula(widget.formula, mqttValue)
      } catch (error) {
        console.error('[Widget] 公式计算错误:', error)
        processedValue = mqttValue
      }
    }

    // 更新 value 属性
    parsed.value = processedValue

    // 添加单位（如果有）
    if (widget.unit) {
      parsed.label = `${parsed.label || ''} (${widget.unit})`
    }

    // 状态指示器特殊处理（只能接受布尔值）
    const style = getWidgetStyle(widget.styleId)
    if (style?.component === 'StatusIndicator') {
      parsed.active = Boolean(mqttValue)
    }
  }

  // 处理多通道绑定 (仅波形图等支持)
  if (widget.mqttBinding2) {
    parsed.value2 = getMqttValue(widget.mqttBinding2)
  }
  if (widget.mqttBinding3) {
    parsed.value3 = getMqttValue(widget.mqttBinding3)
  }

  // 传递最大值配置 (如果存在)
  if (widget.props.max !== undefined) parsed.max = widget.props.max
  if (widget.props.max2 !== undefined) parsed.max2 = widget.props.max2
  if (widget.props.max3 !== undefined) parsed.max3 = widget.props.max3

  return parsed
}

// CSP 安全的公式计算函数（使用预定义操作而非动态执行）
const evaluateFormula = (formula: string, value: number): number => {
  if (!formula || formula === 'value') return value

  try {
    // 清理公式字符串
    const cleanFormula = formula.trim()

    // 支持的安全运算
    // 乘法: value * n
    const multiplyMatch = cleanFormula.match(/^value\s*\*\s*([\d.]+)$/)
    if (multiplyMatch) {
      return value * parseFloat(multiplyMatch[1])
    }

    // 除法: value / n
    const divideMatch = cleanFormula.match(/^value\s*\/\s*([\d.]+)$/)
    if (divideMatch) {
      const divisor = parseFloat(divideMatch[1])
      return divisor !== 0 ? value / divisor : value
    }

    // 加法: value + n
    const addMatch = cleanFormula.match(/^value\s*\+\s*([\d.]+)$/)
    if (addMatch) {
      return value + parseFloat(addMatch[1])
    }

    // 减法: value - n
    const subtractMatch = cleanFormula.match(/^value\s*-\s*([\d.]+)$/)
    if (subtractMatch) {
      return value - parseFloat(subtractMatch[1])
    }

    // 复合运算: value * n / m
    const multiplyDivideMatch = cleanFormula.match(/^value\s*\*\s*([\d.]+)\s*\/\s*([\d.]+)$/)
    if (multiplyDivideMatch) {
      const multiplier = parseFloat(multiplyDivideMatch[1])
      const divisor = parseFloat(multiplyDivideMatch[2])
      return divisor !== 0 ? (value * multiplier) / divisor : value
    }

    // 如果公式不匹配任何预定义模式，返回原值
    console.warn('[Widget] 不支持的公式格式:', formula)
    return value
  } catch (error) {
    console.error('[Widget] 公式解析错误:', error)
    return value
  }
}

// 从 MQTT store 获取数据
const getMqttValue = (path: string): unknown => {
  if (!path) return undefined

  try {
    // 1. 处理机器人路径: robot.red.1.currentHealth
    if (path.startsWith('robot.')) {
      const parts = path.split('.')
      if (parts.length >= 4) {
        // parts[0] = 'robot'
        // parts[1] = 'red' | 'blue'
        // parts[2] = id
        // parts[3...] = prop
        const id = parseInt(parts[2])
        const propPath = parts.slice(3).join('.')

        // 使用 store 方法获取机器人 (响应式)
        const robot = mqttDataStore.getRobot(id)
        if (!robot) return undefined

        return getObjectProperty(robot, propPath)
      }
    }

    // 2. 处理统计数据路径: stats.redTotalHealth
    if (path.startsWith('stats.')) {
      const prop = path.substring(6) // remove 'stats.'
      // 直接在 store 上访问计算属性
      return getObjectProperty(mqttDataStore, prop)
    }

    // 3. 处理标准路径 (gameStatus, etc.)
    return getObjectProperty(mqttDataStore, path)
  } catch (error) {
    console.error('[Widget] 获取 MQTT 数据失败:', path, error)
    return undefined
  }
}

// 辅助函数：通过路径访问对象属性 (支持数组下标)
const getObjectProperty = (obj: unknown, path: string): unknown => {
  if (obj === null || obj === undefined) return undefined

  // 将 [0] 替换为 .0 以便统一分割
  // e.g. "activeBuffs[0].buffLeftTime" -> "activeBuffs.0.buffLeftTime"
  const normalizedPath = path.replace(/\[(\d+)\]/g, '.$1')
  const keys = normalizedPath.split('.').filter((k) => k.length > 0)

  let current = obj
  for (const key of keys) {
    if (current === null || current === undefined) return undefined
    if (typeof current !== 'object') return undefined

    current = current[key as keyof typeof current]
  }
  return current
}

// 暴露方法供父组件调用
defineExpose({
  addWidget,
  deleteWidget,
  updateWidgetProp,
  getWidgets: () => widgets.value,
  setWidgets: (newWidgets: WidgetInstance[]) => {
    widgets.value = newWidgets
  },
  clearWidgets: () => {
    widgets.value = []
  }
})
</script>

<template>
  <div
    ref="containerRef"
    class="panel-widget-container"
    :class="{ editable }"
    @click="deselectWidget"
  >
    <!-- 网格背景 -->
    <div v-if="editable" class="grid-background"></div>

    <!-- 对齐辅助线 -->
    <div v-if="editable && dragState.active" class="alignment-guides">
      <div
        v-for="(y, index) in alignmentGuides.horizontal"
        :key="`h-${index}`"
        class="guide-line horizontal"
        :style="{ top: `${y}px` }"
      ></div>
      <div
        v-for="(x, index) in alignmentGuides.vertical"
        :key="`v-${index}`"
        class="guide-line vertical"
        :style="{ left: `${x}px` }"
      ></div>
    </div>

    <div
      v-for="widget in widgets"
      :key="widget.id"
      class="widget-wrapper"
      :class="{
        selected: selectedWidgetId === widget.id,
        dragging: dragState.active && dragState.widgetId === widget.id,
        resizing: resizeState.active && resizeState.widgetId === widget.id
      }"
      :style="{
        left: `${widget.position.x}px`,
        top: `${widget.position.y}px`,
        width: `${widget.size.width}px`,
        height: `${widget.size.height}px`,
        zIndex: widget.zIndex,
        cursor: editable ? 'move' : 'default',
        '--widget-scale': String(widget.props.scale || 1)
      }"
      @mousedown="editable && startDrag($event, widget.id)"
      @click.stop="editable && selectWidget(widget.id)"
      @contextmenu.prevent.stop="showContextMenu($event, widget.id)"
    >
      <component
        :is="componentMap[getWidgetStyle(widget.styleId)?.component as keyof typeof componentMap]"
        v-bind="parseWidgetProps(widget)"
      />

      <!-- 编辑模式下的控制按钮和调整手柄 -->
      <div v-if="editable && selectedWidgetId === widget.id" class="widget-controls">
        <button class="control-btn delete-btn" @click.stop="deleteWidget(widget.id)">×</button>
        <!-- 右下角调整尺寸手柄 -->
        <div class="resize-handle se" @mousedown.stop="startResize($event, widget.id, 'se')"></div>
      </div>
    </div>

    <!-- 空状态提示 -->
    <div v-if="editable && widgets.length === 0" class="empty-state">
      <p>右键点击窗口标题栏，选择"增加模块组件"</p>
    </div>

    <!-- 组件右键菜单 -->
    <WidgetContextMenu
      :visible="contextMenu.visible"
      :x="contextMenu.x"
      :y="contextMenu.y"
      :widget-id="contextMenu.widgetId"
      :current-style-id="contextMenu.styleId"
      @close="closeContextMenu"
      @change-style="changeWidgetStyle"
      @rename-widget="renameWidget"
      @rename-display="renameDisplay"
      @bind-mqtt="bindMqttData"
      @configure-mqtt="configureMqttData"
      @edit-style="editWidgetStyle"
      @delete-widget="deleteWidget(contextMenu.widgetId)"
    />

    <!-- 输入模态框 -->
    <div v-if="modal.visible" class="modal-overlay" @click.self="closeModal">
      <div
        class="modal-content"
        :class="{ dragging: modal.isDragging }"
        :style="{
          left: `${modal.position.x}px`,
          top: `${modal.position.y}px`
        }"
        @mousedown.stop
        @click.stop
      >
        <div class="modal-header" @mousedown="startModalDrag">
          <h3>{{ modal.title }}</h3>
          <div class="drag-hint">可拖动</div>
        </div>

        <div class="modal-body">
          <!-- 文本输入模式（rename和rename-display） -->
          <template v-if="modal.type === 'rename' || modal.type === 'rename-display'">
            <input
              v-model="modal.value"
              type="text"
              class="modal-input"
              :placeholder="modal.placeholder"
              autofocus
              @mousedown.stop
              @keyup.enter="confirmModal"
            />
          </template>

          <!-- MQTT数据选择器 -->
          <template v-else-if="modal.type === 'bind-mqtt'">
            <!-- 通道选择器 (仅波形图) -->
            <div v-if="isWaveformWidget(modal.widgetId)" class="channel-selector">
              <button
                class="channel-btn"
                :class="{ active: modal.targetBinding === 'default' }"
                @click="changeBindingTarget('default')"
              >
                通道 1
              </button>
              <button
                class="channel-btn"
                :class="{ active: modal.targetBinding === '2' }"
                @click="changeBindingTarget('2')"
              >
                通道 2
              </button>
              <button
                class="channel-btn"
                :class="{ active: modal.targetBinding === '3' }"
                @click="changeBindingTarget('3')"
              >
                通道 3
              </button>
            </div>

            <div v-if="isWaveformWidget(modal.widgetId)" class="current-binding-info">
              <span class="info-label">当前通道绑定:</span>
              <span class="info-value">{{ getCurrentChannelBinding() }}</span>
            </div>

            <div class="mqtt-selector">
              <div class="mqtt-search">
                <input
                  v-model="modal.value"
                  type="text"
                  class="modal-input"
                  placeholder="搜索或直接输入MQTT路径"
                  @mousedown.stop
                />
              </div>
              <div class="mqtt-options">
                <div
                  v-for="option in modal.mqttOptions.filter(
                    (opt) =>
                      !modal.value ||
                      opt.label.includes(modal.value) ||
                      opt.value.includes(modal.value)
                  )"
                  :key="option.value"
                  class="mqtt-option"
                  :class="{ selected: modal.value === option.value }"
                  @click="modal.value = option.value"
                >
                  <div class="option-label">{{ option.label }}</div>
                  <div class="option-value">{{ option.value }}</div>
                  <div v-if="option.description" class="option-desc">{{ option.description }}</div>
                </div>
                <div v-if="modal.mqttOptions.length === 0" class="mqtt-empty">
                  <p>暂无可用的MQTT数据</p>
                  <p class="mqtt-hint">请确保MQTT服务已连接并有数据传输</p>
                </div>
              </div>
            </div>
          </template>

          <!-- 配置 MQTT 单位和公式 -->
          <template v-if="modal.type === 'configure-mqtt'">
            <div class="config-section">
              <label class="config-label">最大值（可选）</label>
              <input
                v-model="modal.max"
                type="number"
                class="modal-input"
                placeholder="例如：100, 500"
                @mousedown.stop
              />
              <p class="config-hint">设置进度条或图表的最大量程，留空则使用默认值</p>
            </div>

            <!-- 波形图多通道最大值配置 -->
            <template v-if="isWaveformWidget(modal.widgetId)">
              <div class="config-section">
                <label class="config-label">通道2 最大值（可选）</label>
                <input
                  v-model="modal.max2"
                  type="number"
                  class="modal-input"
                  placeholder="例如：100, 500"
                  @mousedown.stop
                />
                <p class="config-hint">设置通道2的最大量程，留空则使用默认值</p>
              </div>

              <div class="config-section">
                <label class="config-label">通道3 最大值（可选）</label>
                <input
                  v-model="modal.max3"
                  type="number"
                  class="modal-input"
                  placeholder="例如：100, 500"
                  @mousedown.stop
                />
                <p class="config-hint">设置通道3的最大量程，留空则使用默认值</p>
              </div>
            </template>

            <div class="config-section">
              <label class="config-label">显示单位（可选）</label>
              <input
                v-model="modal.unit"
                type="text"
                class="modal-input"
                placeholder="例如：°C, m/s, %"
                @mousedown.stop
              />
              <p class="config-hint">显示在数值后面的单位，留空则不显示</p>
            </div>

            <div class="config-section">
              <label class="config-label">计算公式</label>
              <input
                v-model="modal.formula"
                type="text"
                class="modal-input"
                placeholder="例如：value * 100, value / 10"
                @mousedown.stop
              />
              <p class="config-hint">
                使用 <code>value</code> 表示 MQTT 原始数据，支持 JavaScript 表达式
              </p>
              <p class="config-example">
                示例：<code>value * 100</code>（转百分比）、<code>value / 1000</code>（千米转米）
              </p>
            </div>
          </template>

          <!-- 编辑组件样式 -->
          <template v-if="modal.type === 'edit-style'">
            <div class="style-editor">
              <div v-for="(value, key) in modal.styleProps" :key="key" class="style-prop-item">
                <label class="config-label">{{ getPropLabel(String(key)) }}</label>

                <!-- 颜色选择器 -->
                <div v-if="isColorProp(String(key))" class="color-input-group">
                  <input
                    v-model="modal.styleProps[key]"
                    type="color"
                    class="color-picker"
                    @mousedown.stop
                  />
                  <input
                    v-model="modal.styleProps[key]"
                    type="text"
                    class="modal-input color-text"
                    placeholder="#000000"
                    @mousedown.stop
                  />
                </div>

                <!-- 布尔值开关 -->
                <label v-else-if="typeof value === 'boolean'" class="switch-container">
                  <input
                    v-model="modal.styleProps[key]"
                    type="checkbox"
                    class="switch-input"
                    @mousedown.stop
                  />
                  <span class="switch-slider"></span>
                </label>

                <!-- 数字输入 -->
                <input
                  v-else-if="typeof value === 'number'"
                  v-model.number="modal.styleProps[key]"
                  type="number"
                  class="modal-input"
                  :placeholder="String(value)"
                  @mousedown.stop
                />

                <!-- 文本输入 -->
                <input
                  v-else
                  v-model="modal.styleProps[key]"
                  type="text"
                  class="modal-input"
                  :placeholder="String(value)"
                  @mousedown.stop
                />
              </div>
            </div>
          </template>
        </div>

        <div class="modal-actions">
          <button class="btn-cancel" @click="closeModal">取消</button>
          <button class="btn-confirm" @click="confirmModal">确定</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.panel-widget-container {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 100px;
  overflow: visible;
}

/* 网格背景 */
.grid-background {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-image:
    repeating-linear-gradient(
      0deg,
      rgba(255, 255, 255, 0.05) 0px,
      transparent 1px,
      transparent 10px
    ),
    repeating-linear-gradient(
      90deg,
      rgba(255, 255, 255, 0.05) 0px,
      transparent 1px,
      transparent 10px
    );
  pointer-events: none;
  z-index: 0;
}

/* 对齐辅助线 */
.alignment-guides {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 999;
}

.guide-line {
  position: absolute;
  background: #ef4444;
  pointer-events: none;
  animation: guide-fade-in 0.15s ease-out;
}

.guide-line.horizontal {
  width: 100%;
  height: 1px;
  left: 0;
  box-shadow: 0 0 4px rgba(239, 68, 68, 0.8);
}

.guide-line.vertical {
  width: 1px;
  height: 100%;
  top: 0;
  box-shadow: 0 0 4px rgba(239, 68, 68, 0.8);
}

@keyframes guide-fade-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

.widget-wrapper {
  position: absolute;
  user-select: none;
  transition: box-shadow 0.2s;
  z-index: 1;
}

/* 内部元素等比缩放 */
.widget-wrapper > :first-child {
  transform: scale(var(--widget-scale, 1));
  transform-origin: center center;
  width: 100%;
  height: 100%;
}

.widget-wrapper.selected {
  box-shadow: 0 0 0 2px #3b82f6;
  border-radius: 4px;
}

.widget-wrapper.dragging {
  opacity: 0.8;
  transition: none;
}

.widget-wrapper.resizing {
  transition: none;
}

.widget-controls {
  position: absolute;
  top: -8px;
  right: -8px;
  display: flex;
  gap: 4px;
}

.control-btn {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: none;
  background: rgba(0, 0, 0, 0.8);
  color: #fff;
  font-size: 14px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}

.control-btn:hover {
  transform: scale(1.1);
}

.delete-btn {
  background: #ef4444;
}

.delete-btn:hover {
  background: #dc2626;
}

/* 调整尺寸手柄 */
.resize-handle {
  position: absolute;
  width: 12px;
  height: 12px;
  background: #3b82f6;
  border: 2px solid #fff;
  border-radius: 2px;
  z-index: 10;
}

.resize-handle.se {
  right: -6px;
  bottom: -6px;
  cursor: nwse-resize;
}

.resize-handle:hover {
  background: #2563eb;
  transform: scale(1.2);
}

.empty-state {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.5);
  font-size: 12px;
  text-align: center;
  pointer-events: none;
}

/* 模态框样式 */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
  z-index: 10002;
  backdrop-filter: blur(4px);
}

.modal-content {
  position: absolute;
  background: rgba(25, 28, 38, 0.95);
  backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  padding: 0;
  width: 500px;
  max-width: 90vw;
  max-height: 90vh;
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5);
  animation: modal-pop 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.modal-content.dragging {
  cursor: move;
  user-select: none;
}

@keyframes modal-pop {
  from {
    opacity: 0;
    transform: scale(0.9);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

/* 模态框头部 */
.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px 24px;
  background: rgba(0, 0, 0, 0.2);
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  cursor: move;
  user-select: none;
}

.modal-header:active {
  cursor: grabbing;
}

.modal-header h3 {
  margin: 0;
  color: #fff;
  font-size: 16px;
  font-weight: 600;
  flex: 1;
}

.drag-hint {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.4);
  font-weight: 400;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

/* 模态框主体 */
.modal-body {
  padding: 24px;
  overflow-y: auto;
  flex: 1;
  min-height: 0;
}

.modal-body::-webkit-scrollbar {
  width: 8px;
}

.modal-body::-webkit-scrollbar-track {
  background: rgba(0, 0, 0, 0.2);
  border-radius: 4px;
}

.modal-body::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.2);
  border-radius: 4px;
}

.modal-body::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.3);
}

.modal-input {
  width: 100%;
  padding: 10px 14px;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  color: #fff;
  font-size: 14px;
  margin-bottom: 20px;
  outline: none;
  transition: border-color 0.2s;
}

.modal-input:focus {
  border-color: #3b82f6;
}

.modal-input::placeholder {
  color: rgba(255, 255, 255, 0.4);
}

.modal-actions {
  display: flex;
  gap: 12px;
  justify-content: flex-end;
  padding: 16px 24px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(30, 30, 30, 0.95);
}

.btn-cancel,
.btn-confirm {
  padding: 8px 16px;
  border-radius: 6px;
  border: none;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-cancel {
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.8);
}

.btn-cancel:hover {
  background: rgba(255, 255, 255, 0.15);
}

.btn-confirm {
  background: #3b82f6;
  color: #fff;
}

.btn-confirm:hover {
  background: #2563eb;
}

/* MQTT选择器样式 */
.mqtt-selector {
  margin-bottom: 20px;
}

.mqtt-search {
  margin-bottom: 12px;
}

.mqtt-options {
  max-height: 400px;
  overflow-y: auto;
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  padding: 4px;
}

.mqtt-option {
  padding: 10px 12px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s;
  margin-bottom: 4px;
}

.mqtt-option:hover {
  background: rgba(255, 255, 255, 0.1);
}

.mqtt-option.selected {
  background: rgba(59, 130, 246, 0.2);
  border: 1px solid rgba(59, 130, 246, 0.4);
}

.option-label {
  color: #fff;
  font-size: 13px;
  font-weight: 500;
  margin-bottom: 4px;
}

.option-value {
  color: rgba(255, 255, 255, 0.6);
  font-size: 11px;
  font-family: 'Courier New', monospace;
  margin-bottom: 2px;
}

.option-desc {
  color: rgba(255, 255, 255, 0.4);
  font-size: 11px;
  margin-top: 4px;
}

.mqtt-empty {
  text-align: center;
  padding: 40px 20px;
  color: rgba(255, 255, 255, 0.5);
}

.mqtt-empty p {
  margin: 0 0 8px;
}

.mqtt-hint {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.3);
}

/* 配置单位和公式样式 */
.config-section {
  margin-bottom: 20px;
}

.config-label {
  display: block;
  color: #fff;
  font-size: 13px;
  font-weight: 500;
  margin-bottom: 8px;
}

.config-hint {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.5);
  margin-top: 6px;
  margin-bottom: 0;
}

.config-example {
  font-size: 11px;
  color: rgba(59, 130, 246, 0.8);
  margin-top: 6px;
  margin-bottom: 0;
}

.config-example code {
  background: rgba(59, 130, 246, 0.1);
  padding: 2px 6px;
  border-radius: 3px;
  font-family: 'Courier New', monospace;
}

/* 样式编辑器 */
.style-editor {
  max-height: 500px;
  overflow-y: auto;
  margin-bottom: 20px;
}

.style-prop-item {
  margin-bottom: 16px;
  padding: 12px;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.05);
}

.style-prop-item .config-label {
  margin-bottom: 8px;
}

.color-input-group {
  display: flex;
  gap: 8px;
  align-items: center;
}

.color-picker {
  width: 50px;
  height: 38px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
}

.color-text {
  flex: 1;
  margin-bottom: 0;
}

/* 开关样式 */
.switch-container {
  position: relative;
  display: inline-block;
  width: 48px;
  height: 26px;
  cursor: pointer;
}

.switch-input {
  opacity: 0;
  width: 0;
  height: 0;
}

.switch-slider {
  position: absolute;
  cursor: pointer;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(255, 255, 255, 0.2);
  transition: 0.3s;
  border-radius: 26px;
}

.switch-slider:before {
  position: absolute;
  content: '';
  height: 18px;
  width: 18px;
  left: 4px;
  bottom: 4px;
  background-color: white;
  transition: 0.3s;
  border-radius: 50%;
}

.switch-input:checked + .switch-slider {
  background-color: #3b82f6;
}

.switch-input:checked + .switch-slider:before {
  transform: translateX(22px);
}

/* 通道选择器 */
.channel-selector {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
  padding: 4px;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 8px;
}

.channel-btn {
  flex: 1;
  padding: 8px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: rgba(255, 255, 255, 0.6);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s;
}

.channel-btn:hover {
  background: rgba(255, 255, 255, 0.05);
  color: #fff;
}

.channel-btn.active {
  background: rgba(59, 130, 246, 0.2);
  border-color: rgba(59, 130, 246, 0.5);
  color: #3b82f6;
  font-weight: 600;
}

.current-binding-info {
  margin-bottom: 16px;
  padding: 8px 12px;
  background: rgba(59, 130, 246, 0.1);
  border: 1px dashed rgba(59, 130, 246, 0.3);
  border-radius: 6px;
  font-size: 12px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.info-label {
  color: rgba(255, 255, 255, 0.6);
}

.info-value {
  color: #fff;
  font-family: 'Courier New', monospace;
  font-weight: 500;
}
</style>
