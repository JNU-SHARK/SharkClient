<script setup lang="ts">
interface StatusOption {
  value: string | number
  label: string
  color: string
}

defineProps({
  label: { type: String, default: '' },
  currentValue: { type: [String, Number], default: '' },
  options: {
    type: Array as () => StatusOption[],
    default: () => []
  },
  showAllStates: { type: Boolean, default: false } // 是否显示所有状态（灰色未激活）
})
</script>

<template>
  <div class="multi-status-indicator">
    <div v-if="label" class="status-label">{{ label }}</div>
    <div class="status-options">
      <div
        v-for="option in options"
        :key="option.value"
        class="status-option"
        :class="{
          active: currentValue === option.value,
          visible: showAllStates || currentValue === option.value
        }"
      >
        <div
          class="led"
          :style="{
            background:
              currentValue === option.value
                ? `linear-gradient(90deg, ${option.color}, ${option.color}dd)`
                : 'rgba(255, 255, 255, 0.08)',
            boxShadow: currentValue === option.value ? `0 0 10px ${option.color}bb` : 'none'
          }"
        ></div>
        <div class="option-label">{{ option.label }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.multi-status-indicator {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-family: 'JetBrains Mono', monospace;
}

.status-label {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.7);
  text-transform: uppercase;
  font-weight: 600;
  letter-spacing: 0.5px;
}

.status-options {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.status-option {
  display: none;
  align-items: center;
  gap: 6px;
}

.status-option.visible {
  display: flex;
}

.status-option.active {
  display: flex;
}

.led {
  width: 18px;
  height: 14px;
  background: rgba(255, 255, 255, 0.08);
  transform: skewX(-25deg);
  border-radius: 2px;
  transition: all 0.2s ease-in-out;
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.status-option.active .led {
  border-color: transparent;
}

.option-label {
  font-size: 13px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.9);
  letter-spacing: 0.5px;
  text-transform: uppercase;
  white-space: nowrap;
}

.status-option:not(.active) .option-label {
  opacity: 0.5;
}
</style>
