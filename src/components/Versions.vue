<script setup lang="ts">
import { reactive } from 'vue'

const versions = reactive({ tauri: '2.0.0', rust: 'Stable' })
</script>

<template>
  <ul class="versions">
    <li class="version-item">Tauri v{{ versions.tauri }}</li>
    <li class="version-separator">•</li>
    <li class="version-item">Rust v{{ versions.rust }}</li>
  </ul>
</template>

<style scoped>
.versions {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  align-items: center;
  gap: 12px;
  color: rgba(255, 255, 255, 0.6);
  font-size: 14px;
}

.version-item {
  margin: 0;
  padding: 0;
}

.version-separator {
  color: rgba(255, 255, 255, 0.3);
  user-select: none;
}
</style>
