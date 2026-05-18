<script setup lang="ts">
import { ref, computed } from 'vue'

interface Props {
  currentAmmo: number // 当前弹量
  exchangeableAmmo: number // 可兑换弹量
}

const props = defineProps<Props>()

const emit = defineEmits<{
  (e: 'purchase', amount: number): void
  (e: 'close'): void
}>()

// 购买选项
const purchaseOptions = [50, 100, 150, 200, 250, 300]

// 当前选中的购买量
const selectedAmount = ref<number | null>(null)

// 上次点击时间（用于检测双击）
const lastClickTime = ref(0)
const lastClickedAmount = ref<number | null>(null)

// 实际可购买量（不能超过可兑换量）
const actualPurchaseAmount = computed(() => {
  if (selectedAmount.value === null) return 0
  return Math.min(selectedAmount.value, props.exchangeableAmmo)
})

// 处理选项点击（双击确认）
function handleOptionClick(amount: number): void {
  const now = Date.now()
  const isDoubleClick = lastClickedAmount.value === amount && now - lastClickTime.value < 400

  if (isDoubleClick && props.exchangeableAmmo > 0) {
    // 双击确认购买
    const purchaseAmount = Math.min(amount, props.exchangeableAmmo)
    emit('purchase', purchaseAmount)
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
    <div class="modal-backdrop" @click.self="closeMenu">
      <div class="ammo-purchase-modal">
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
            <circle cx="12" cy="12" r="10"></circle>
            <circle cx="12" cy="12" r="3"></circle>
          </svg>
          弹丸购买
        </h3>

        <!-- 当前状态显示 -->
        <div class="ammo-status">
          <div class="status-item">
            <span class="status-label">当前弹量</span>
            <span class="status-value current">{{ currentAmmo }}</span>
          </div>
          <div class="status-divider">/</div>
          <div class="status-item">
            <span class="status-label">可兑换</span>
            <span
              class="status-value exchangeable"
              :class="{ low: exchangeableAmmo < 50, empty: exchangeableAmmo <= 0 }"
            >
              {{ exchangeableAmmo }}
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
              unavailable: exchangeableAmmo <= 0,
              partial: amount > exchangeableAmmo && exchangeableAmmo > 0
            }"
            :disabled="exchangeableAmmo <= 0"
            @click="handleOptionClick(amount)"
          >
            <span class="option-amount">{{ amount }}</span>
            <span v-if="amount > exchangeableAmmo && exchangeableAmmo > 0" class="option-actual">
              → {{ exchangeableAmmo }}
            </span>
          </button>
        </div>

        <!-- 操作提示 -->
        <div class="purchase-hint">
          <span v-if="exchangeableAmmo <= 0" class="hint-warning"> ⚠ 无可兑换弹丸 </span>
          <span v-else-if="selectedAmount">
            双击确认购买 <strong>{{ actualPurchaseAmount }}</strong> 发弹丸
          </span>
          <span v-else> 选择购买数量，双击确认 </span>
        </div>

        <!-- 底部按键提示 -->
        <div class="key-hint-footer">
          <span>按 <kbd>B</kbd> 关闭菜单</span>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.ammo-purchase-modal {
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
    0 0 40px rgba(59, 130, 246, 0.1);
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
  stroke: #3b82f6;
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
  font-size: 12px;
  color: #94a3b8;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.status-value {
  font-size: 28px;
  font-weight: 700;
  font-family: 'Consolas', 'Monaco', monospace;
}

.status-value.current {
  color: #3b82f6;
}

.status-value.exchangeable {
  color: #22c55e;
}

.status-value.exchangeable.low {
  color: #f59e0b;
}

.status-value.exchangeable.empty {
  color: #ef4444;
}

.status-divider {
  font-size: 24px;
  color: #475569;
  font-weight: 300;
}

/* 购买选项网格 */
.purchase-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  margin-bottom: 16px;
}

.purchase-option {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 16px 12px;
  border-radius: 10px;
  border: 2px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.04);
  color: #e2e8f0;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  position: relative;
  overflow: hidden;
}

.purchase-option::before {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.1) 0%, transparent 50%);
  opacity: 0;
  transition: opacity 0.2s;
}

.purchase-option:hover:not(:disabled) {
  border-color: rgba(59, 130, 246, 0.5);
  background: rgba(59, 130, 246, 0.1);
  transform: translateY(-2px);
}

.purchase-option:hover:not(:disabled)::before {
  opacity: 1;
}

.purchase-option.selected {
  border-color: #3b82f6;
  background: rgba(59, 130, 246, 0.2);
  box-shadow: 0 0 20px rgba(59, 130, 246, 0.3);
}

.purchase-option.partial {
  border-color: rgba(245, 158, 11, 0.5);
}

.purchase-option.partial .option-amount {
  text-decoration: line-through;
  opacity: 0.6;
}

.purchase-option.unavailable {
  opacity: 0.4;
  cursor: not-allowed;
  border-color: rgba(239, 68, 68, 0.3);
}

.option-amount {
  font-size: 20px;
  font-family: 'Consolas', 'Monaco', monospace;
}

.option-actual {
  font-size: 12px;
  color: #f59e0b;
  margin-top: 4px;
}

/* 操作提示 */
.purchase-hint {
  text-align: center;
  font-size: 13px;
  color: #64748b;
  padding-top: 12px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.purchase-hint strong {
  color: #3b82f6;
  font-weight: 600;
}

.hint-warning {
  color: #ef4444;
}

/* 关闭按钮 */
.modal-close-btn {
  position: absolute;
  top: 12px;
  right: 12px;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: none;
  background: rgba(255, 255, 255, 0.06);
  color: #94a3b8;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  line-height: 1;
  transition: all 0.2s;
}

.modal-close-btn:hover {
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
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

/* 过渡动画 */
.modal-fade-enter-active,
.modal-fade-leave-active {
  transition: opacity 0.2s ease;
}

.modal-fade-enter-from,
.modal-fade-leave-to {
  opacity: 0;
}

.modal-fade-enter-active .ammo-purchase-modal,
.modal-fade-leave-active .ammo-purchase-modal {
  transition:
    transform 0.2s ease,
    opacity 0.2s ease;
}

.modal-fade-enter-from .ammo-purchase-modal,
.modal-fade-leave-to .ammo-purchase-modal {
  transform: scale(0.95) translateY(-10px);
  opacity: 0;
}
</style>
