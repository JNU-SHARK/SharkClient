<script setup lang="ts">
defineProps({
  value: { type: [Number, String], default: 0 },
  unit: { type: String, default: '' },
  label: { type: String, default: '' },
  color: { type: String, default: '#fff' },
  size: { type: String, default: 'medium' } // small, medium, large, x-large
})
</script>

<template>
  <div class="data-number-widget" :class="size">
    <div v-if="label" class="number-label">{{ label }}</div>
    <div class="number-value" :style="{ color }">
      {{ value }}<span class="unit">{{ unit }}</span>
    </div>
  </div>
</template>

<style scoped>
.data-number-widget {
  display: flex;
  flex-direction: column;
  font-family: 'JetBrains Mono', monospace;
}

.number-label {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.6);
  text-transform: uppercase;
  margin-bottom: 2px;
}

.number-value {
  font-weight: bold;
  line-height: 1;
  text-shadow: 0 0 10px currentColor;
}

.unit {
  font-size: 0.5em;
  margin-left: 4px;
  opacity: 0.7;
  font-weight: normal;
}

/* Sizes */
.small .number-value {
  font-size: 18px;
}
.medium .number-value {
  font-size: 24px;
}
.large .number-value {
  font-size: 36px;
}
.x-large .number-value {
  font-size: 48px;
}
</style>
