<template>
  <div class="module-status-panel" :class="{ 'is-compact': compact }">
    <div class="module-grid">
      <div
        v-for="(item, index) in statusItems"
        :key="index"
        class="module-item"
        :class="{ active: item.status === 1, error: item.status === 0 }"
      >
        <div class="status-slash"></div>
        <span class="module-name">{{ item.label }}</span>
      </div>
    </div>
    <!-- 底部红线装饰 (仅在非紧凑模式下显示) -->
    <div v-if="!compact" class="bottom-line"></div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { RobotModuleStatus } from '../../../utils/mqtt_protocol'

interface Props {
  moduleStatus?: RobotModuleStatus | null
  compact?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  moduleStatus: null,
  compact: false
})

const statusItems = computed(() => {
  const s = props.moduleStatus
  // 默认全红(0)
  const defaultStatus = 0

  if (!s) {
    // 如果没有数据，显示默认列表（全红）
    return [
      { label: '主控', status: defaultStatus },
      { label: '电源管理', status: defaultStatus },
      { label: '图传', status: defaultStatus },
      { label: 'RFID', status: defaultStatus },
      { label: 'UWB', status: defaultStatus },
      { label: '装甲板', status: defaultStatus },
      { label: '小弹丸', status: defaultStatus },
      { label: '大弹丸', status: defaultStatus },
      { label: '超级电容', status: defaultStatus },
      { label: '灯条', status: defaultStatus }
    ]
  }

  return [
    { label: '主控', status: s.mainController },
    { label: '电源管理', status: s.powerManager },
    { label: '图传', status: s.videoTransmission },
    { label: 'RFID', status: s.rfid },
    { label: 'UWB', status: s.uwb },
    { label: '装甲板', status: s.armor },
    { label: '小弹丸', status: s.smallShooter },
    { label: '大弹丸', status: s.bigShooter },
    { label: '超级电容', status: s.capacitor },
    { label: '灯条', status: s.lightStrip }
  ]
})
</script>

<style scoped>
.module-status-panel {
  position: relative;
  margin-top: 8px;
  padding: 8px 16px;
  width: 100%;
  box-sizing: border-box;
}

.module-status-panel.is-compact {
  margin-top: 0;
  padding: 0;
  width: 100%;
}

.module-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 24px;
  justify-content: center;
}

.is-compact .module-grid {
  gap: 6px 12px; /* 调整间距，更紧凑 */
  justify-content: flex-start;
  width: 100%;
}

.module-item {
  display: flex;
  align-items: center;
  gap: 6px;
}

.is-compact .module-item {
  gap: 6px;
}

.status-slash {
  width: 4px;
  height: 14px;
  background-color: #ef4444; /* 默认红色 */
  transform: skewX(-20deg);
  box-shadow: 0 0 6px rgba(239, 68, 68, 0.6); /* 增加发光 */
  transition: all 0.3s ease;
}

.is-compact .status-slash {
  width: 4px;
  height: 12px;
}

/* 激活状态（绿色） */
.module-item.active .status-slash {
  background-color: #84cc16; /* 亮绿色 */
  box-shadow: 0 0 8px rgba(132, 204, 22, 0.6);
}

/* 错误状态（红色） */
.module-item.error .status-slash {
  background-color: #ef4444;
  box-shadow: 0 0 8px rgba(239, 68, 68, 0.6);
}

.module-name {
  font-size: 14px;
  color: #e2e8f0;
  font-weight: 500;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
}

.is-compact .module-name {
  font-size: 12px; /* 稍微减小以适应更多内容 */
  color: #cbd5e1;
  font-family: 'Microsoft YaHei', sans-serif;
  letter-spacing: 0.3px;
  white-space: nowrap;
}

.bottom-line {
  margin-top: 12px;
  width: 100%;
  height: 2px;
  background: linear-gradient(90deg, transparent, #ef4444, transparent);
  box-shadow: 0 0 8px rgba(239, 68, 68, 0.8);
}
</style>
