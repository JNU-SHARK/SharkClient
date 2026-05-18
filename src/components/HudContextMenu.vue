<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useWidgetStylesStore } from '../store/modules/widget-styles'

defineProps({
  x: { type: Number, required: true },
  y: { type: Number, required: true },
  visible: { type: Boolean, default: false },
  type: { type: String, default: 'create' }, // 'create' | 'panel'
  target: { type: String, default: '' },
  panels: { type: Object as () => Record<string, boolean>, default: () => ({}) }
})

const emit = defineEmits([
  'close',
  'create-widget',
  'edit-panel',
  'toggle-panel',
  'delete-panel',
  'add-custom-panel',
  'manage-components',
  'create-graphic',
  'rename-panel',
  'toggle-drawing-mode',
  'place-graphic-template'
])

const widgetStylesStore = useWidgetStylesStore()
const menuRef = ref<HTMLElement | null>(null)
const activeSubmenu = ref<string | null>(null)
const activeSubSubmenu = ref<string | null>(null) // 用于三级菜单

// 组件模板数据
const graphicTemplates = ref<{
  basic: Array<{ filename: string; content: string }>
  dynamic: Array<{ filename: string; content: string }>
  fix: Array<{ filename: string; content: string }>
}>({
  basic: [],
  dynamic: [],
  fix: []
})

// 默认窗口列表(只能隐藏不能删除)
const defaultPanels = ['车辆姿态', '模块状态', '本车状态']

// 判断是否为默认窗口
const isDefaultPanel = (name: string): boolean => {
  return defaultPanels.includes(name)
}

// 点击外部关闭
const handleClickOutside = (event: MouseEvent): void => {
  if (menuRef.value && !menuRef.value.contains(event.target as Node)) {
    emit('close')
  }
}

onMounted(async () => {
  document.addEventListener('mousedown', handleClickOutside)

  // 加载图形模板
  if (window.api?.graphic?.getAllCategories) {
    try {
      graphicTemplates.value = await window.api.graphic.getAllCategories()
    } catch (error) {
      console.error('[HudContextMenu] 加载图形模板失败:', error)
    }
  }
})

onUnmounted(() => {
  document.removeEventListener('mousedown', handleClickOutside)
})

const handleAction = (action: string, payload?: unknown): void => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  emit(action as any, payload)
  emit('close')
}

const handleSubmenuEnter = (menuId: string): void => {
  activeSubmenu.value = menuId
  activeSubSubmenu.value = null // 重置三级菜单
}

const handleSubSubmenuEnter = (menuId: string): void => {
  activeSubSubmenu.value = menuId
}

const handleSubmenuLeave = (): void => {
  activeSubmenu.value = null
  activeSubSubmenu.value = null
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible"
      ref="menuRef"
      class="hud-context-menu"
      :style="{ top: `${y}px`, left: `${x}px` }"
      @mouseleave="handleSubmenuLeave"
    >
    <!-- ==================== 空白区域菜单 (Global) ==================== -->
    <template v-if="type === 'create'">
      <div class="menu-header">全局菜单</div>
      <div class="menu-items">
        <!-- 1. 新建自定义窗口 -->
        <div class="menu-item" @click="handleAction('add-custom-panel')">
          <span class="item-name">新建自定义窗口</span>
          <span class="item-icon">+</span>
        </div>

        <!-- 2. 显示/隐藏窗口 (二级菜单) -->
        <div class="menu-item has-submenu" @mouseenter="handleSubmenuEnter('toggle-panel')">
          <span class="item-name">显示/隐藏窗口</span>
          <span class="item-arrow">▶</span>

          <!-- Submenu -->
          <div v-if="activeSubmenu === 'toggle-panel'" class="submenu">
            <div class="menu-header">窗口列表</div>
            <div
              v-for="(isVisible, name) in panels"
              :key="name"
              class="menu-item"
              @click="handleAction('toggle-panel', name)"
            >
              <span class="item-name">{{ name }}</span>
              <span v-if="isVisible" class="item-status-dot">●</span>
            </div>
          </div>
        </div>

        <!-- 3. 删除模块 (二级菜单) -->
        <div class="menu-item has-submenu" @mouseenter="handleSubmenuEnter('delete-module')">
          <span class="item-name">删除模块</span>
          <span class="item-arrow">▶</span>

          <!-- Submenu -->
          <div v-if="activeSubmenu === 'delete-module'" class="submenu">
            <div class="menu-header">选择模块删除</div>
            <div
              v-for="(_isVisible, name) in panels"
              :key="name"
              class="menu-item"
              @click="handleAction('delete-panel', name)"
            >
              <span class="item-name text-danger">{{ name }}</span>
            </div>
          </div>
        </div>

        <div class="menu-divider"></div>

        <!-- 4. 放置组件 (三级菜单) -->
        <div class="menu-item has-submenu" @mouseenter="handleSubmenuEnter('place-component')">
          <span class="item-name">放置组件</span>
          <span class="item-arrow">▶</span>

          <!-- Submenu Level 2: 类别选择 -->
          <div v-if="activeSubmenu === 'place-component'" class="submenu">
            <div class="menu-header">选择类别</div>

            <!-- 基础组件 -->
            <div
              v-if="graphicTemplates.basic.length > 0"
              class="menu-item has-submenu"
              @mouseenter="handleSubSubmenuEnter('place-basic')"
            >
              <span class="item-name">基础组件</span>
              <span class="item-arrow">▶</span>

              <!-- Submenu Level 3: 具体模板 -->
              <div v-if="activeSubSubmenu === 'place-basic'" class="submenu">
                <div class="menu-header">基础模板</div>
                <div
                  v-for="template in graphicTemplates.basic"
                  :key="template.filename"
                  class="menu-item"
                  @click="handleAction('place-graphic-template', { category: 'basic', template })"
                >
                  <span class="item-name">{{ template.filename }}</span>
                </div>
              </div>
            </div>

            <!-- 动态组件 -->
            <div
              v-if="graphicTemplates.dynamic.length > 0"
              class="menu-item has-submenu"
              @mouseenter="handleSubSubmenuEnter('place-dynamic')"
            >
              <span class="item-name">动态组件</span>
              <span class="item-arrow">▶</span>

              <!-- Submenu Level 3: 具体模板 -->
              <div v-if="activeSubSubmenu === 'place-dynamic'" class="submenu">
                <div class="menu-header">动态模板</div>
                <div
                  v-for="template in graphicTemplates.dynamic"
                  :key="template.filename"
                  class="menu-item"
                  @click="handleAction('place-graphic-template', { category: 'dynamic', template })"
                >
                  <span class="item-name">{{ template.filename }}</span>
                </div>
              </div>
            </div>

            <!-- 固定组件 -->
            <div
              v-if="graphicTemplates.fix.length > 0"
              class="menu-item has-submenu"
              @mouseenter="handleSubSubmenuEnter('place-fix')"
            >
              <span class="item-name">固定组件</span>
              <span class="item-arrow">▶</span>

              <!-- Submenu Level 3: 具体模板 -->
              <div v-if="activeSubSubmenu === 'place-fix'" class="submenu">
                <div class="menu-header">固定模板</div>
                <div
                  v-for="template in graphicTemplates.fix"
                  :key="template.filename"
                  class="menu-item"
                  @click="handleAction('place-graphic-template', { category: 'fix', template })"
                >
                  <span class="item-name">{{ template.filename }}</span>
                </div>
              </div>
            </div>

            <!-- 空状态提示 -->
            <div
              v-if="
                graphicTemplates.basic.length === 0 &&
                graphicTemplates.dynamic.length === 0 &&
                graphicTemplates.fix.length === 0
              "
              class="menu-item disabled"
            >
              <span class="item-name" style="font-size: 12px; color: rgba(255, 255, 255, 0.4)">
                暂无可用模板
              </span>
            </div>
          </div>
        </div>

        <div class="menu-divider"></div>

        <!-- 5. 进入绘图模式 -->
        <div class="menu-item" @click="handleAction('toggle-drawing-mode')">
          <span class="item-name">进入绘图模式</span>
          <span class="item-icon">✏️</span>
        </div>
      </div>
    </template>

    <!-- ==================== 窗口菜单 (Panel) ==================== -->
    <template v-else-if="type === 'panel'">
      <div class="menu-header">编辑: {{ target }}</div>
      <div class="menu-items">
        <div class="menu-item" @click="handleAction('add-custom-panel')">
          <span class="item-name">新建自定义窗口</span>
          <span class="item-icon">+</span>
        </div>

        <div class="menu-divider"></div>

        <!-- 1. 编辑/删除模块组件 (管理模式) -->
        <div class="menu-item" @click="handleAction('manage-components', target)">
          <span class="item-name">管理组件排布</span>
          <span class="item-desc">进入组件编辑模式</span>
        </div>

        <!-- 2. 增加模块组件 (二级菜单) -->
        <div class="menu-item has-submenu" @mouseenter="handleSubmenuEnter('add-component')">
          <span class="item-name">增加模块组件</span>
          <span class="item-arrow">▶</span>

          <!-- Submenu Level 2 -->
          <div v-if="activeSubmenu === 'add-component'" class="submenu">
            <div class="menu-header">选择组件样式</div>
            <div
              v-for="style in widgetStylesStore.styles"
              :key="style.id"
              class="menu-item"
              @click="handleAction('create-widget', { panelName: target, styleId: style.id })"
            >
              <span class="item-name">{{ style.name }}</span>
              <span class="item-desc">{{ style.description }}</span>
            </div>
          </div>
        </div>

        <div class="menu-divider"></div>

        <div class="menu-item" @click="handleAction('edit-panel', target)">
          <span class="item-name">编辑窗口样式</span>
        </div>

        <!-- 重命名窗口 (仅自定义窗口可用) -->
        <div
          v-if="!isDefaultPanel(target)"
          class="menu-item"
          @click="handleAction('rename-panel', target)"
        >
          <span class="item-name">重命名窗口</span>
        </div>

        <!-- 隐藏此窗口 (所有窗口可用) -->
        <div class="menu-item" @click="handleAction('toggle-panel', target)">
          <span class="item-name">隐藏此窗口</span>
        </div>

        <!-- 删除此窗口 (仅自定义窗口可用) -->
        <div
          v-if="!isDefaultPanel(target)"
          class="menu-item"
          @click="handleAction('delete-panel', target)"
        >
          <span class="item-name text-danger">删除此窗口</span>
        </div>
      </div>
    </template>
  </div>
  </Teleport>
</template>

<style scoped>
.item-status-dot {
  color: #10b981; /* Green */
  font-size: 12px;
  margin-left: auto;
}

.hud-context-menu {
  position: fixed;
  z-index: 100000;
  width: 220px;
  background: rgba(25, 28, 38, 0.95);
  backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
  pointer-events: auto;
  animation: menu-fade-in 0.15s ease-out;
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
  position: relative; /* For submenu positioning */
  padding: 8px 12px;
  cursor: pointer;
  border-radius: 4px;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.menu-item:hover {
  background: rgba(59, 130, 246, 0.2);
}

.menu-item.disabled {
  opacity: 0.5;
  pointer-events: none;
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

.item-arrow {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.4);
}

.menu-divider {
  height: 1px;
  background: rgba(255, 255, 255, 0.1);
  margin: 4px 0;
}

/* Submenu Styles */
.submenu {
  position: absolute;
  left: 100%;
  top: -4px;
  width: 200px;
  background: rgba(25, 28, 38, 0.98);
  backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
  padding: 4px;
  margin-left: 4px;
  z-index: 100001;
  pointer-events: auto;
  animation: menu-fade-in 0.15s ease-out;
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
