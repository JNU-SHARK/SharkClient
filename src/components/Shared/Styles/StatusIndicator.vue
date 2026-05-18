<script setup lang="ts">
defineProps({
  label: { type: String, default: '' },
  active: { type: Boolean, default: false },
  activeColor: { type: String, default: '#10b981' }, // 激活时的颜色
  inactiveColor: { type: String, default: 'rgba(255, 255, 255, 0.08)' } // 未激活时的颜色
})
</script>

<template>
  <div class="status-indicator">
    <div
      class="led"
      :class="{ active: active }"
      :style="{
        background: active
          ? `linear-gradient(90deg, ${activeColor}, ${activeColor}dd)`
          : inactiveColor,
        boxShadow: active ? `0 0 10px ${activeColor}bb` : 'none'
      }"
    ></div>
    <div class="status-label">{{ label }}</div>
  </div>
</template>

<style scoped>
.status-indicator {
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: 'JetBrains Mono', monospace;
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

.led.active {
  border-color: transparent;
}

.status-label {
  font-size: 13px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.9);
  letter-spacing: 0.5px;
  text-transform: uppercase;
}
</style>
