<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'

const isMaximized = ref(false)
const appInfo = ref<{ name: string; version: string } | null>(null)
let cleanupListener: (() => void) | null = null

const minimize = () => window.api.minimize()
const maximize = () => window.api.maximize()
const close = () => window.api.close()

onMounted(async () => {
  appInfo.value = await window.api.getAppInfo()
  cleanupListener = window.api.onMaximizedStateChanged?.((state) => {
    isMaximized.value = state
  }) ?? null
})

onUnmounted(() => {
  if (cleanupListener) {
    cleanupListener()
  }
})
</script>

<template>
  <div class="title-bar">
    <div class="title">{{ appInfo?.name }} v{{ appInfo?.version }}</div>
    <div class="controls">
      <button class="control-btn" @click="minimize" title="Minimize">
        <svg width="12" height="12" viewBox="0 0 12 12"><path d="M0 5 H 12 V 7 H 0 Z"></path></svg>
      </button>
      <button class="control-btn" @click="maximize" title="Maximize">
        <svg v-if="!isMaximized" width="12" height="12" viewBox="0 0 12 12">
          <path d="M2 2 H 10 V 10 H 2 Z M 0 0 H 12 V 12 H 0 Z" fill-rule="evenodd"></path>
        </svg>
        <svg v-else width="12" height="12" viewBox="0 0 12 12">
          <path d="M4 0 H 12 V 8 H 10 V 2 H 4 Z M 0 4 H 8 V 12 H 0 Z"></path>
        </svg>
      </button>
      <button class="control-btn close" @click="close" title="Close">
        <svg width="12" height="12" viewBox="0 0 12 12">
          <path
            d="M2.22 0 L0 2.22 L3.78 6 L0 9.78 L2.22 12 L6 8.22 L9.78 12 L12 9.78 L8.22 6 L12 2.22 L9.78 0 L6 3.78 Z"
          ></path>
        </svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
.title-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  height: 36px;
  background: transparent;
  color: rgba(255, 255, 255, 0.7);
  user-select: none;
  /* 使标题栏可拖动 */
  -webkit-app-region: drag;
  z-index: 1000;
}

.title {
  padding-left: 16px;
  font-size: 13px;
  font-weight: 500;
  letter-spacing: 0.3px;
}

.controls {
  display: flex;
  height: 100%;
  /* 使控制按钮不可拖动，以便可以点击 */
  -webkit-app-region: no-drag;
}

.control-btn {
  width: 48px;
  height: 100%;
  border: none;
  background-color: transparent;
  color: rgba(255, 255, 255, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.15s;
}

.control-btn svg {
  fill: currentColor;
}

.control-btn:hover {
  background-color: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.95);
}

.control-btn.close:hover {
  background-color: #e81123;
  color: white;
}
</style>
