<script setup lang="ts">
import { ref, computed } from 'vue'
import { useMqttDataStore } from '@/store/modules/mqtt_data'

const mqttStore = useMqttDataStore()

const emit = defineEmits<{
  (e: 'purchase', amount: number): void
  (e: 'close'): void
}>()

// 购买选项
const purchaseOptions = [50, 100, 150, 200]

// 当前选中的购买量
const selectedAmount = ref<number | null>(null)

// 上次点击时间（用于检测双击）
const lastClickTime = ref(0)
const lastClickedAmount = ref<number | null>(null)

// 从 MQTT 数据获取当前机器人信息
const currentRobotId = computed(() => mqttStore.currentRobotId)

// 获取当前机器人数据
const currentRobot = computed(() => {
  if (currentRobotId.value <= 0) return null
  return mqttStore.getRobot(currentRobotId.value)
})

// 是否可以远程补弹
const canRemoteAmmo = computed(() => {
  return currentRobot.value?.canRemoteAmmo ?? false
})

// 当前金币（从后勤状态获取）
const currentGold = computed(() => {
  return mqttStore.logisticsStatus.remainingEconomy ?? 0
})

// 弹丸单价（假设每发 10 金币）
const ammoPrice = 10

// 处理选项点击（双击确认）
function handleOptionClick(amount: number): void {
  if (!canRemoteAmmo.value) return

  const cost = amount * ammoPrice
  if (currentGold.value < cost) return

  const now = Date.now()
  const isDoubleClick = lastClickedAmount.value === amount && now - lastClickTime.value < 400

  if (isDoubleClick) {
    // 双击确认购买
    emit('purchase', amount)
    emit('close')
  } else {
    // 单击选中
    selectedAmount.value = amount
    lastClickedAmount.value = amount
    lastClickTime.value = now
  }
}

// 关闭菜单
function closeMenu(): void {
  emit('close')
}
</script>

<template>
  <Transition name="modal-fade">
    <div v-if="true" class="modal-backdrop" @click.self="closeMenu">
      <div class="remote-ammo-modal">
        <!-- 关闭按钮 -->
        <button class="modal-close-btn" @click="closeMenu">×</button>

        <!-- 标题 -->
        <h3 class="modal-title">
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <path d="M22 12h-4l-3 9L9 3l-3 9H2"></path>
          </svg>
          远程弹丸补给
        </h3>

        <!-- 状态显示 -->
        <div class="ammo-status">
          <div class="status-item">
            <span class="status-label">当前金币</span>
            <span class="status-value gold">{{ currentGold }}</span>
          </div>
          <div class="status-divider">|</div>
          <div class="status-item">
            <span class="status-label">远程补弹</span>
            <span
              class="status-value"
              :class="{ available: canRemoteAmmo, unavailable: !canRemoteAmmo }"
            >
              {{ canRemoteAmmo ? '可用' : '不可用' }}
            </span>
          </div>
        </div>

        <!-- 购买选项网格 -->
        <div class="purchase-grid">
          <button
            v-for="amount in purchaseOptions"
            :key="amount"
            class="purchase-option"
            :class="{
              selected: selectedAmount === amount,
              unavailable: !canRemoteAmmo || currentGold < amount * ammoPrice
            }"
            :disabled="!canRemoteAmmo || currentGold < amount * ammoPrice"
            @click="handleOptionClick(amount)"
          >
            <span class="option-amount">{{ amount }}</span>
            <span class="option-cost">{{ amount * ammoPrice }} 金币</span>
          </button>
        </div>

        <!-- 操作提示 -->
        <div class="purchase-hint">
          <span v-if="!canRemoteAmmo" class="hint-warning"> ⚠ 当前无法使用远程补弹 </span>
          <span v-else-if="selectedAmount">
            双击确认购买 <strong>{{ selectedAmount }}</strong> 发弹丸 ({{
              selectedAmount * ammoPrice
            }}
            金币)
          </span>
          <span v-else> 选择购买数量，双击确认 </span>
        </div>

        <!-- 底部按键提示 -->
        <div class="key-hint-footer">
          <span>按 <kbd>H</kbd> 关闭菜单</span>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.remote-ammo-modal {
  background-color: rgba(25, 28, 38, 0.5);
  backdrop-filter: blur(30px) saturate(1.2);
  -webkit-backdrop-filter: blur(30px) saturate(1.2);
  border-radius: 16px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  padding: 24px;
  position: relative;
  min-width: 420px;
  box-shadow:
    inset 0 1px 1px rgba(255, 255, 255, 0.05),
    0 20px 60px rgba(0, 0, 0, 0.5),
    0 0 40px rgba(168, 85, 247, 0.1);
  color: #e2e8f0;
  transform: translateZ(0);
}

.modal-title {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  margin: 0 0 20px 0;
  font-size: 18px;
  font-weight: 600;
  color: #f1f5f9;
}

.modal-title svg {
  stroke: #a855f7;
}

/* 状态显示 */
.ammo-status {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
  padding: 16px 20px;
  background: rgba(255, 255, 255, 0.04);
  border-radius: 12px;
  margin-bottom: 20px;
  border: 1px solid rgba(255, 255, 255, 0.06);
}

.status-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.status-label {
  font-size: 11px;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.status-value {
  font-size: 24px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.status-value.gold {
  color: #fbbf24;
}

.status-value.available {
  color: #22c55e;
  font-size: 16px;
}

.status-value.unavailable {
  color: #ef4444;
  font-size: 16px;
}

.status-divider {
  font-size: 24px;
  color: rgba(255, 255, 255, 0.15);
  font-weight: 300;
}

/* 购买选项网格 */
.purchase-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
  margin-bottom: 16px;
}

.purchase-option {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 16px 12px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.purchase-option:hover:not(:disabled) {
  background: rgba(168, 85, 247, 0.15);
  border-color: rgba(168, 85, 247, 0.3);
}

.purchase-option.selected {
  background: rgba(168, 85, 247, 0.2);
  border-color: #a855f7;
  box-shadow: 0 0 20px rgba(168, 85, 247, 0.2);
}

.purchase-option.unavailable {
  opacity: 0.4;
  cursor: not-allowed;
}

.option-amount {
  font-size: 28px;
  font-weight: 700;
  color: #f1f5f9;
}

.option-cost {
  font-size: 12px;
  color: #fbbf24;
}

/* 操作提示 */
.purchase-hint {
  text-align: center;
  font-size: 13px;
  color: #94a3b8;
  padding: 12px;
  background: rgba(255, 255, 255, 0.02);
  border-radius: 8px;
}

.purchase-hint strong {
  color: #a855f7;
}

.hint-warning {
  color: #f59e0b;
}

/* 底部按键提示 */
.key-hint-footer {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  font-size: 12px;
  color: #64748b;
}

.key-hint-footer kbd {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 4px;
  font-family: inherit;
  font-size: 11px;
  font-weight: 600;
  color: #94a3b8;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
}

/* 关闭按钮 */
.modal-close-btn {
  position: absolute;
  top: 12px;
  right: 12px;
  width: 28px;
  height: 28px;
  border: none;
  background: rgba(255, 255, 255, 0.06);
  border-radius: 8px;
  color: #94a3b8;
  font-size: 18px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
}

.modal-close-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
}

.modal-backdrop {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

/* 过渡动画 */
.modal-fade-enter-active,
.modal-fade-leave-active {
  transition: opacity 0.2s ease;
}

.modal-fade-enter-from,
.modal-fade-leave-to {
  opacity: 0;
}

.modal-fade-enter-active .remote-ammo-modal,
.modal-fade-leave-active .remote-ammo-modal {
  transition:
    transform 0.2s ease,
    opacity 0.2s ease;
}

.modal-fade-enter-from .remote-ammo-modal,
.modal-fade-leave-to .remote-ammo-modal {
  transform: scale(0.95) translateY(-10px);
  opacity: 0;
}
</style>
