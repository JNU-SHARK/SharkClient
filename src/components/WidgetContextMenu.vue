<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { useWidgetStylesStore } from '../store/modules/widget-styles'

interface Props {
  x: number
  y: number
  visible: boolean
  widgetId: string
  currentStyleId: string
}

const props = defineProps<Props>()

const emit = defineEmits([
  'close',
  'changeStyle',
  'renameWidget',
  'renameDisplay',
  'bindMqtt',
  'configureMqtt',
  'editStyle',
  'deleteWidget'
])

const widgetStylesStore = useWidgetStylesStore()
const menuRef = ref<HTMLElement | null>(null)
const activeSubmenu = ref<string | null>(null)

// 计算菜单实际显示位置（边界检测）
const menuPosition = ref({ x: 0, y: 0 })

// 监听位置和可见性变化，调整菜单位置
watch(
  () => [props.x, props.y, props.visible],
  async () => {
    if (props.visible) {
      await nextTick()
      adjustMenuPosition()
    }
  },
  { immediate: true }
)

const adjustMenuPosition = (): void => {
  if (!menuRef.value) {
    menuPosition.value = { x: props.x, y: props.y }
    return
  }

  const menuRect = menuRef.value.getBoundingClientRect()
  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight

  let x = props.x
  let y = props.y

  // 右边界检测
  if (x + menuRect.width > viewportWidth) {
    x = viewportWidth - menuRect.width - 10
  }

  // 底部边界检测
  if (y + menuRect.height > viewportHeight) {
    y = viewportHeight - menuRect.height - 10
  }

  // 确保不超出左边界和顶部
  x = Math.max(10, x)
  y = Math.max(10, y)

  menuPosition.value = { x, y }
}

// 获取当前组件的样式信息
const currentStyle = computed(() => {
  return widgetStylesStore.getStyleById(props.currentStyleId)
})

// 判断是否为动态组件（包含可变数据的组件）
const isDynamic = computed(() => {
  if (!currentStyle.value) return false
  // 动态组件：DataBar, DataRing, DataNumber, StatusIndicator, MultiStatusIndicator, DataWaveform（有 value 属性）
  // 静态组件：DataText（只有静态文本）
  return [
    'DataBar',
    'DataRing',
    'DataNumber',
    'StatusIndicator',
    'MultiStatusIndicator',
    'DataWaveform'
  ].includes(currentStyle.value.component)
})

// 判断是否支持单位和公式（仅数据条、环形条和波形图）
const supportsUnitAndFormula = computed(() => {
  if (!currentStyle.value) return false
  return ['DataBar', 'DataRing', 'DataWaveform'].includes(currentStyle.value.component)
})

// 获取可切换的样式列表（同类型：动态或静态）
const availableStyles = computed(() => {
  return widgetStylesStore.styles.filter((style) => {
    if (!currentStyle.value) return false

    const currentIsDynamic = ['DataBar', 'DataRing', 'DataNumber'].includes(
      currentStyle.value.component
    )
    const styleIsDynamic = ['DataBar', 'DataRing', 'DataNumber'].includes(style.component)

    // 动态组件只能换成其他动态组件，静态组件只能换成其他静态组件
    return currentIsDynamic === styleIsDynamic && style.id !== props.currentStyleId
  })
})

// 点击外部关闭
const handleClickOutside = (event: MouseEvent): void => {
  if (menuRef.value && !menuRef.value.contains(event.target as Node)) {
    emit('close')
  }
}

onMounted(() => {
  document.addEventListener('mousedown', handleClickOutside)
})

onUnmounted(() => {
  document.removeEventListener('mousedown', handleClickOutside)
})

const handleAction = (action: string, payload?: unknown): void => {
  if (action === 'rename-widget') {
    emit('renameWidget', payload)
  } else if (action === 'rename-display') {
    emit('renameDisplay', payload)
  } else if (action === 'bind-mqtt') {
    emit('bindMqtt', payload)
  } else if (action === 'configure-mqtt') {
    emit('configureMqtt', payload)
  } else if (action === 'edit-style') {
    emit('editStyle', payload)
  } else if (action === 'delete-widget') {
    emit('deleteWidget', payload)
  } else if (action === 'change-style') {
    emit('changeStyle', payload)
  }
  emit('close')
}

const handleSubmenuEnter = (menuId: string): void => {
  activeSubmenu.value = menuId
}

const handleSubmenuLeave = (): void => {
  activeSubmenu.value = null
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible"
      ref="menuRef"
      class="widget-context-menu"
      :style="{ top: `${menuPosition.y}px`, left: `${menuPosition.x}px` }"
      @mouseleave="handleSubmenuLeave"
    >
    <div class="menu-header">组件菜单</div>
    <div class="menu-items">
      <!-- 1. 修改当前组件样式 -->
      <div
        class="menu-item has-submenu"
        :class="{ disabled: availableStyles.length === 0 }"
        @mouseenter="availableStyles.length > 0 && handleSubmenuEnter('change-style')"
      >
        <span class="item-name">修改组件样式</span>
        <span class="item-arrow">▶</span>

        <!-- 子菜单：可用样式列表 -->
        <div v-if="activeSubmenu === 'change-style'" class="submenu">
          <div class="menu-header">选择新样式</div>
          <div
            v-for="style in availableStyles"
            :key="style.id"
            class="menu-item"
            @click="handleAction('change-style', style.id)"
          >
            <span class="item-name">{{ style.name }}</span>
            <span class="item-desc">{{ style.description }}</span>
          </div>
          <div v-if="availableStyles.length === 0" class="menu-item disabled">
            <span class="item-name" style="font-size: 12px; color: rgba(255, 255, 255, 0.4)">
              暂无可用样式
            </span>
          </div>
        </div>
      </div>

      <!-- 2. 编辑组件样式 -->
      <div class="menu-item" @click="handleAction('edit-style')">
        <span class="item-name">编辑组件样式</span>
        <span class="item-icon">🎨</span>
      </div>

      <!-- 3. 重命名显示名称 -->
      <div class="menu-item" @click="handleAction('rename-display')">
        <span class="item-name">重命名显示名称</span>
        <span class="item-icon">✏️</span>
      </div>

      <!-- 4. 绑定 MQTT 数据（仅动态组件） -->
      <div v-if="isDynamic" class="menu-item has-submenu" @mouseenter="handleSubmenuEnter('mqtt')">
        <span class="item-name">绑定 MQTT 数据</span>
        <span class="item-arrow">▶</span>

        <!-- 子菜单：MQTT 配置 -->
        <div v-if="activeSubmenu === 'mqtt'" class="submenu">
          <div class="menu-header">MQTT 配置</div>
          <div class="menu-item" @click="handleAction('bind-mqtt')">
            <span class="item-name">选择数据源</span>
            <span class="item-icon">🔗</span>
          </div>
          <div
            v-if="supportsUnitAndFormula"
            class="menu-item"
            @click="handleAction('configure-mqtt')"
          >
            <span class="item-name">配置单位和公式</span>
            <span class="item-icon">⚙️</span>
          </div>
        </div>
      </div>

      <div class="menu-divider"></div>

      <!-- 5. 删除组件 -->
      <div class="menu-item" @click="handleAction('delete-widget')">
        <span class="item-name text-danger">删除组件</span>
        <span class="item-icon">×</span>
      </div>
    </div>
  </div>
  </Teleport>
</template>

<style scoped>
.widget-context-menu {
  position: fixed;
  z-index: 10001; /* 高于 HudContextMenu */
  width: 200px;
  background: rgba(25, 28, 38, 0.95);
  backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
  animation: menu-fade-in 0.15s ease-out;
  pointer-events: auto; /* 确保菜单可以接收鼠标事件 */
}

.menu-header {
  padding: 8px 12px;
  font-size: 11px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.4);
  background: rgba(0, 0, 0, 0.2);
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.menu-items {
  padding: 4px;
}

.menu-item {
  position: relative;
  padding: 8px 12px;
  cursor: pointer;
  border-radius: 4px;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.menu-item:hover:not(.disabled) {
  background: rgba(59, 130, 246, 0.2);
}

.menu-item.disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.item-name {
  font-size: 13px;
  color: #fff;
  font-weight: 500;
}

.item-desc {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.5);
  margin-left: auto;
}

.item-icon {
  font-size: 14px;
  color: rgba(255, 255, 255, 0.6);
}

.item-arrow {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.4);
}

.menu-divider {
  height: 1px;
  background: rgba(255, 255, 255, 0.1);
  margin: 4px 0;
}

/* 子菜单样式 */
.submenu {
  position: absolute;
  left: 100%;
  top: -4px;
  width: 180px;
  background: rgba(25, 28, 38, 0.98);
  backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
  padding: 4px;
  margin-left: 4px;
  animation: menu-fade-in 0.15s ease-out;
  pointer-events: auto; /* 确保子菜单可以接收鼠标事件 */
  z-index: 100001; /* 确保子菜单在主菜单之上 */
}

.text-danger {
  color: #f87171 !important;
}

@keyframes menu-fade-in {
  from {
    opacity: 0;
    transform: scale(0.95);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}
</style>
