<template>
  <div class="mqtt-command-panel">
    <h4 class="section-title">
      <span class="icon">📡</span>
      MQTT 指令发送
    </h4>

    <!-- 指令类型选择 -->
    <div class="command-tabs">
      <button
        v-for="tab in commandTabs"
        :key="tab.id"
        :class="['tab-btn', { active: activeTab === tab.id }]"
        @click="activeTab = tab.id"
      >
        {{ tab.label }}
      </button>
    </div>

    <!-- RemoteControl - 遥控指令 -->
    <div v-if="activeTab === 'remote'" class="command-form">
      <div class="form-row">
        <label>鼠标 X/Y/Z</label>
        <div class="input-group">
          <input v-model.number="remoteControl.mouseX" type="number" placeholder="X" />
          <input v-model.number="remoteControl.mouseY" type="number" placeholder="Y" />
          <input v-model.number="remoteControl.mouseZ" type="number" placeholder="Z" />
        </div>
      </div>
      <div class="form-row">
        <label>鼠标按键</label>
        <div class="checkbox-group">
          <label><input v-model="remoteControl.leftButtonDown" type="checkbox" /> 左键</label>
          <label><input v-model="remoteControl.midButtonDown" type="checkbox" /> 中键</label>
          <label><input v-model="remoteControl.rightButtonDown" type="checkbox" /> 右键</label>
        </div>
      </div>
      <div class="form-row">
        <label>键盘掩码</label>
        <input
          v-model.number="remoteControl.keyboardValue"
          type="number"
          placeholder="键盘按键位掩码"
        />
      </div>
      <div class="form-row">
        <label>自定义数据</label>
        <input
          v-model="remoteControlDataHex"
          type="text"
          placeholder="十六进制字符串 (最多30字节)"
          maxlength="60"
        />
      </div>
      <button class="send-btn" @click="sendRemoteControl">发送遥控指令</button>
    </div>

    <!-- MapClickInfoNotify - 地图点击标记 -->
    <div v-if="activeTab === 'map'" class="command-form">
      <div class="form-row">
        <label>地图坐标</label>
        <div class="input-group">
          <input v-model.number="mapClick.mapX" type="number" step="0.1" placeholder="X (米)" />
          <input v-model.number="mapClick.mapY" type="number" step="0.1" placeholder="Y (米)" />
        </div>
      </div>
      <div class="form-row">
        <label>标记类型</label>
        <select v-model.number="mapClick.type">
          <option :value="1">攻击</option>
          <option :value="2">防御</option>
          <option :value="3">警戒</option>
          <option :value="4">自定义</option>
        </select>
      </div>
      <div class="form-row">
        <label>发送范围</label>
        <select v-model.number="mapClick.isSendAll">
          <option :value="0">指定客户端</option>
          <option :value="1">除哨兵外全体</option>
          <option :value="2">包含哨兵全体</option>
        </select>
      </div>
      <button class="send-btn" @click="sendMapClick">发送地图标记</button>
    </div>

    <!-- AssemblyCommand - 工程装配指令 -->
    <div v-if="activeTab === 'assembly'" class="command-form">
      <div class="form-row">
        <label>装配操作</label>
        <select v-model.number="assembly.operation">
          <option :value="1">确认装配</option>
          <option :value="2">取消装配</option>
        </select>
      </div>
      <div class="form-row">
        <label>装配难度</label>
        <select v-model.number="assembly.difficulty">
          <option :value="1">1级难度</option>
          <option :value="2">2级难度</option>
          <option :value="3">3级难度</option>
          <option :value="4">4级难度</option>
        </select>
      </div>
      <button class="send-btn" @click="sendAssembly">发送装配指令</button>
    </div>

    <!-- RobotPerformanceSelectionCommand - 性能体系选择 -->
    <div v-if="activeTab === 'performance'" class="command-form">
      <div class="form-row">
        <label>发射机构</label>
        <select v-model.number="performance.shooter">
          <option :value="1">冷却优先</option>
          <option :value="2">爆发优先</option>
          <option :value="3">英雄近战优先</option>
          <option :value="4">英雄远程优先</option>
        </select>
      </div>
      <div class="form-row">
        <label>底盘性能</label>
        <select v-model.number="performance.chassis">
          <option :value="1">血量优先</option>
          <option :value="2">功率优先</option>
          <option :value="3">英雄近战优先</option>
          <option :value="4">英雄远程优先</option>
        </select>
      </div>
      <button class="send-btn" @click="sendPerformance">发送性能选择</button>
    </div>

    <!-- HeroDeployModeEventCommand - 英雄部署模式 -->
    <div v-if="activeTab === 'hero'" class="command-form">
      <div class="form-row">
        <label>部署模式</label>
        <select v-model.number="heroMode.mode">
          <option :value="0">退出部署</option>
          <option :value="1">进入部署</option>
        </select>
      </div>
      <p class="hint">仅远程优先英雄机器人可用</p>
      <button class="send-btn" @click="sendHeroMode">发送部署指令</button>
    </div>

    <!-- RuneActivateCommand - 能量机关激活 -->
    <div v-if="activeTab === 'rune'" class="command-form">
      <div class="form-row">
        <label>激活状态</label>
        <select v-model.number="rune.activate">
          <option :value="1">激活能量机关</option>
        </select>
      </div>
      <p class="hint">仅步兵操作手或哨兵机器人可触发</p>
      <button class="send-btn" @click="sendRune">发送激活指令</button>
    </div>

    <!-- DartCommand - 飞镖控制 -->
    <div v-if="activeTab === 'dart'" class="command-form">
      <div class="form-row">
        <label>目标选择</label>
        <select v-model.number="dart.targetId">
          <option :value="1">前哨站</option>
          <option :value="2">基地固定目标</option>
          <option :value="3">随机固定目标</option>
          <option :value="4">随机移动目标</option>
          <option :value="5">末端移动目标</option>
        </select>
      </div>
      <div class="form-row">
        <label>闸门控制</label>
        <div class="checkbox-group">
          <label><input v-model="dart.open" type="checkbox" /> 开启闸门</label>
        </div>
      </div>
      <button class="send-btn" @click="sendDart">发送飞镖指令</button>
    </div>

    <!-- GuardCtrlCommand - 哨兵控制 -->
    <div v-if="activeTab === 'guard'" class="command-form">
      <div class="form-row">
        <label>控制指令</label>
        <select v-model.number="guard.commandId">
          <option :value="1">补血点补弹</option>
          <option :value="2">补给站实体补弹</option>
          <option :value="3">远程补弹</option>
          <option :value="4">远程回血</option>
          <option :value="5">确认复活</option>
          <option :value="6">花费金币复活</option>
          <option :value="7">地图标点</option>
          <option :value="8">进攻姿态</option>
          <option :value="9">防御姿态</option>
          <option :value="10">移动姿态</option>
        </select>
      </div>
      <button class="send-btn" @click="sendGuard">发送哨兵指令</button>
    </div>

    <!-- AirSupportCommand - 空中支援 -->
    <div v-if="activeTab === 'air'" class="command-form">
      <div class="form-row">
        <label>支援类型</label>
        <select v-model.number="airSupport.commandId">
          <option :value="1">免费呼叫空中支援</option>
          <option :value="2">花费金币呼叫</option>
          <option :value="3">中断空中支援</option>
        </select>
      </div>
      <button class="send-btn" @click="sendAirSupport">发送支援指令</button>
    </div>

    <!-- 发送状态 -->
    <div v-if="sendStatus" :class="['status-message', sendStatus.type]">
      {{ sendStatus.message }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive } from 'vue'

// ==================== Props ====================
defineProps<{
  /** MQTT 连接状态 */
  connected?: boolean
}>()

// ==================== 指令标签页 ====================
const commandTabs = [
  { id: 'remote', label: '遥控' },
  { id: 'map', label: '地图' },
  { id: 'assembly', label: '装配' },
  { id: 'performance', label: '性能' },
  { id: 'hero', label: '英雄' },
  { id: 'rune', label: '能量' },
  { id: 'dart', label: '飞镖' },
  { id: 'guard', label: '哨兵' },
  { id: 'air', label: '空援' }
]

const activeTab = ref('remote')

// ==================== 指令数据 ====================
// RemoteControl (使用 camelCase，与 Protobufjs 解析后的字段名一致)
const remoteControl = reactive({
  mouseX: 0,
  mouseY: 0,
  mouseZ: 0,
  leftButtonDown: false,
  rightButtonDown: false,
  midButtonDown: false,
  keyboardValue: 0
})
const remoteControlDataHex = ref('')

// MapClickInfoNotify
const mapClick = reactive({
  isSendAll: 1,
  robotId: new Uint8Array(7),
  mode: 1,
  enemyId: 0,
  ascii: 0,
  type: 1,
  screenX: 0,
  screenY: 0,
  mapX: 0,
  mapY: 0
})

// AssemblyCommand
const assembly = reactive({
  operation: 1,
  difficulty: 1
})

// RobotPerformanceSelectionCommand
const performance = reactive({
  shooter: 1,
  chassis: 1
})

// HeroDeployModeEventCommand
const heroMode = reactive({
  mode: 0
})

// RuneActivateCommand
const rune = reactive({
  activate: 1
})

// DartCommand
const dart = reactive({
  targetId: 1,
  open: false
})

// GuardCtrlCommand
const guard = reactive({
  commandId: 1
})

// AirSupportCommand
const airSupport = reactive({
  commandId: 1
})

// ==================== 发送状态 ====================
const sendStatus = ref<{ type: 'success' | 'error'; message: string } | null>(null)

function showStatus(type: 'success' | 'error', message: string): void {
  sendStatus.value = { type, message }
  setTimeout(() => {
    sendStatus.value = null
  }, 3000)
}

// ==================== 发送函数 ====================
async function sendMqttCommand(topic: string, messageType: string, payload: object): Promise<void> {
  if (!window.api?.mqtt) {
    showStatus('error', 'MQTT API 不可用')
    return
  }

  try {
    const result = await window.api.mqtt.publish({
      topic,
      messageType,
      payload,
      qos: 1
    })

    if (result.success) {
      showStatus('success', `已发送 ${messageType}`)
    } else {
      showStatus('error', result.error || '发送失败')
    }
  } catch (error) {
    showStatus('error', `发送错误: ${error}`)
  }
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(Math.min(hex.length / 2, 30))
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16) || 0
  }
  return bytes
}

async function sendRemoteControl(): Promise<void> {
  // 新协议拆分：键鼠字段 -> KeyboardMouseControl；自定义二进制 -> CustomControl
  await sendMqttCommand('KeyboardMouseControl', 'KeyboardMouseControl', { ...remoteControl })
  if (remoteControlDataHex.value) {
    const data = hexToBytes(remoteControlDataHex.value)
    await sendMqttCommand('CustomControl', 'CustomControl', { data: Array.from(data) })
  }
}

async function sendMapClick(): Promise<void> {
  await sendMqttCommand('MapClickInfoNotify', 'MapClickInfoNotify', {
    ...mapClick,
    robotId: Array.from(mapClick.robotId)
  })
}

async function sendAssembly(): Promise<void> {
  await sendMqttCommand('AssemblyCommand', 'AssemblyCommand', { ...assembly })
}

async function sendPerformance(): Promise<void> {
  await sendMqttCommand('RobotPerformanceSelectionCommand', 'RobotPerformanceSelectionCommand', {
    ...performance
  })
}

async function sendHeroMode(): Promise<void> {
  await sendMqttCommand('HeroDeployModeEventCommand', 'HeroDeployModeEventCommand', { ...heroMode })
}

async function sendRune(): Promise<void> {
  await sendMqttCommand('RuneActivateCommand', 'RuneActivateCommand', { ...rune })
}

async function sendDart(): Promise<void> {
  await sendMqttCommand('DartCommand', 'DartCommand', { ...dart })
}

async function sendGuard(): Promise<void> {
  await sendMqttCommand('SentryCtrlCommand', 'SentryCtrlCommand', { ...guard })
}

async function sendAirSupport(): Promise<void> {
  await sendMqttCommand('AirSupportCommand', 'AirSupportCommand', { ...airSupport })
}
</script>

<style scoped>
.mqtt-command-panel {
  padding: 16px;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.section-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 600;
  color: var(--ev-c-text-1, #fff);
  margin: 0 0 16px 0;
}

.section-title .icon {
  font-size: 16px;
}

/* 标签页 */
.command-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.tab-btn {
  padding: 6px 12px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  color: rgba(255, 255, 255, 0.6);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s;
}

.tab-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.8);
}

.tab-btn.active {
  background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
  border-color: #3b82f6;
  color: #fff;
}

/* 表单 */
.command-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.form-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.form-row label {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.6);
}

.form-row input,
.form-row select {
  padding: 8px 12px;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  color: #fff;
  font-size: 13px;
}

.form-row input:focus,
.form-row select:focus {
  outline: none;
  border-color: rgba(59, 130, 246, 0.5);
}

.input-group {
  display: flex;
  gap: 8px;
}

.input-group input {
  flex: 1;
  min-width: 0;
}

.checkbox-group {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
}

.checkbox-group label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.8);
  cursor: pointer;
}

.checkbox-group input[type='checkbox'] {
  width: 16px;
  height: 16px;
  cursor: pointer;
}

.hint {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.4);
  font-style: italic;
  margin: 0;
}

/* 发送按钮 */
.send-btn {
  padding: 10px 20px;
  background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
  border: none;
  border-radius: 8px;
  color: #fff;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  margin-top: 8px;
}

.send-btn:hover {
  background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
  transform: translateY(-1px);
}

.send-btn:active {
  transform: translateY(0);
}

/* 状态消息 */
.status-message {
  padding: 10px 14px;
  border-radius: 8px;
  font-size: 12px;
  margin-top: 12px;
}

.status-message.success {
  background: rgba(34, 197, 94, 0.2);
  border: 1px solid rgba(34, 197, 94, 0.3);
  color: #22c55e;
}

.status-message.error {
  background: rgba(239, 68, 68, 0.2);
  border: 1px solid rgba(239, 68, 68, 0.3);
  color: #ef4444;
}
</style>
