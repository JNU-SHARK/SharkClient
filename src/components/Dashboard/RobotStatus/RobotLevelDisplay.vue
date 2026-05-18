<template>
  <div class="level-indicator" :title="`等级 ${currentLevel}`">
    <div class="chevron-stack">
      <!-- 堆叠显示 V 形图标，数量代表等级 -->
      <svg
        v-for="i in Math.min(3, Math.max(1, currentLevel))"
        :key="i"
        class="chevron-icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="4"
        stroke-linecap="round"
        stroke-linejoin="round"
        :style="{ marginTop: i > 1 ? '-14px' : '0' }"
      >
        <polyline points="4 9 12 17 20 9"></polyline>
      </svg>
    </div>
  </div>
</template>

<script setup lang="ts">
interface Props {
  currentLevel?: number
  maxLevel?: number
}

withDefaults(defineProps<Props>(), {
  currentLevel: 1,
  maxLevel: 3
})
</script>

<style scoped>
.level-indicator {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  background: rgba(0, 0, 0, 0.6);
  border-radius: 50%;
  border: 1px solid #f59e0b;
  box-shadow: 0 0 8px rgba(245, 158, 11, 0.4);
}

.chevron-stack {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #f59e0b; /* 琥珀色/金色 */
}

.chevron-icon {
  width: 16px;
  height: 16px;
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.8));
}
</style>
