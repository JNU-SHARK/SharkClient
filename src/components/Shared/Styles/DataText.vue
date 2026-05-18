<script setup lang="ts">
defineProps({
  text: { type: String, default: '' },
  color: { type: String, default: '#fff' },
  align: { type: String, default: 'left' }, // left, center, right
  bold: { type: Boolean, default: false }
})
</script>

<template>
  <div
    class="data-text-widget"
    :style="{
      color,
      textAlign: align as any,
      fontWeight: bold ? 'bold' : 'normal'
    }"
  >
    <slot>{{ text }}</slot>
  </div>
</template>

<style scoped>
.data-text-widget {
  font-family: 'JetBrains Mono', monospace;
  font-size: 14px;
  line-height: 1.4;
  text-shadow: 0 0 5px rgba(0, 0, 0, 0.5);
}
</style>
