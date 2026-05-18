<template>
  <div class="dashboard-config-manager">
    <h4 class="section-title">
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <path d="M4 22h14a2 2 0 0 0 2-2V7.5L14.5 2H6a2 2 0 0 0-2 2v4"></path>
        <polyline points="14 2 14 8 20 8"></polyline>
        <path d="M3 15h6"></path>
        <path d="M6 12v6"></path>
      </svg>
      界面配置
    </h4>

    <!-- 当前配置 -->
    <div class="current-config">
      <label class="small-label">当前配置</label>
      <div class="config-select-row">
        <select v-model="currentConfigFilename" class="config-select">
          <option value="">默认配置</option>
          <option v-for="config in configList" :key="config.filename" :value="config.filename">
            {{ config.name }}
          </option>
        </select>
        <button class="icon-btn apply-btn" title="应用配置" @click="handleApplyConfig">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
        </button>
        <button class="icon-btn" title="刷新配置列表" @click="loadConfigList">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <path d="M21 2v6h-6"></path>
            <path d="M3 12a9 9 0 0 1 15-6.7L21 8"></path>
            <path d="M3 22v-6h6"></path>
            <path d="M21 12a9 9 0 0 1-15 6.7L3 16"></path>
          </svg>
        </button>
      </div>
    </div>

    <!-- 操作按钮 -->
    <div class="config-actions">
      <button class="action-btn primary" @click="handleSaveConfig">
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
          <polyline points="17 21 17 13 7 13 7 21"></polyline>
          <polyline points="7 3 7 8 15 8"></polyline>
        </svg>
        保存配置
      </button>
      <button class="action-btn" @click="handleSaveAsNew">
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <path d="M12 5v14"></path>
          <path d="M5 12h14"></path>
        </svg>
        另存为
      </button>
      <button
        class="action-btn danger"
        :disabled="!currentConfigFilename"
        @click="handleDeleteConfig"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <polyline points="3 6 5 6 21 6"></polyline>
          <path
            d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"
          ></path>
        </svg>
        删除
      </button>
    </div>

    <!-- 保存/另存为对话框 -->
    <Transition name="fade">
      <div v-if="saveDialogVisible" class="save-dialog-backdrop" @click.self="closeSaveDialog">
        <div class="save-dialog">
          <h4>{{ isNewConfig ? '保存新配置' : '保存配置' }}</h4>
          <div class="form-item">
            <label>配置名称</label>
            <input
              v-model="saveConfigName"
              type="text"
              placeholder="请输入配置名称"
              @keyup.enter="confirmSave"
            />
          </div>
          <div class="dialog-actions">
            <button class="dialog-btn cancel" @click="closeSaveDialog">取消</button>
            <button
              class="dialog-btn confirm"
              :disabled="!saveConfigName.trim()"
              @click="confirmSave"
            >
              保存
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- 删除确认对话框 -->
    <Transition name="fade">
      <div v-if="deleteDialogVisible" class="save-dialog-backdrop" @click.self="closeDeleteDialog">
        <div class="save-dialog">
          <h4>确认删除</h4>
          <p class="delete-warning">
            确定要删除配置「{{ currentConfigName }}」吗？此操作不可恢复。
          </p>
          <div class="dialog-actions">
            <button class="dialog-btn cancel" @click="closeDeleteDialog">取消</button>
            <button class="dialog-btn danger" @click="confirmDelete">删除</button>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'

interface ConfigItem {
  filename: string
  name: string
  modifiedAt: string
}

// 当前界面配置的类型定义
export interface DashboardLayoutConfig {
  name: string
  version: string
  createdAt: string
  modifiedAt: string
  panels: Array<{
    id: string
    title: string
    visible: boolean
    position: {
      top?: string
      left?: string
      right?: string
      bottom?: string
    }
    size: {
      width: string
      height: string
    }
    options: {
      hideTitleBar?: boolean
      transparent?: boolean
      opacity?: number
    }
  }>
}

const props = defineProps<{
  /** 获取当前界面配置的回调 */
  getCurrentConfig: () => DashboardLayoutConfig
}>()

const emit = defineEmits<{
  (e: 'config-loaded', config: DashboardLayoutConfig): void
  (e: 'config-changed', filename: string): void
}>()

// 配置列表
const configList = ref<ConfigItem[]>([])
// 当前选中的配置文件名
const currentConfigFilename = ref('')
// 保存对话框
const saveDialogVisible = ref(false)
const isNewConfig = ref(false)
const saveConfigName = ref('')
// 删除对话框
const deleteDialogVisible = ref(false)

// 当前配置名称
const currentConfigName = computed(() => {
  if (!currentConfigFilename.value) return '默认配置'
  const config = configList.value.find((c) => c.filename === currentConfigFilename.value)
  return config?.name || currentConfigFilename.value
})

// 加载配置列表
async function loadConfigList(): Promise<void> {
  if (!window.api?.dashboardConfig) return
  try {
    const result = await window.api.dashboardConfig.list()
    if (result.success) {
      configList.value = result.configs
    }
  } catch (error) {
    console.error('[DashboardConfig] 加载配置列表失败:', error)
  }
}

// 应用配置（用户点击应用按钮）
async function handleApplyConfig(): Promise<void> {
  if (!currentConfigFilename.value) {
    // 应用默认配置
    emit('config-changed', '')
    console.log('[DashboardConfig] 已应用默认配置')
    return
  }

  if (!window.api?.dashboardConfig) return
  try {
    const result = await window.api.dashboardConfig.load(currentConfigFilename.value)
    if (result.success && result.content) {
      const config = parseConfigXml(result.content)
      if (config) {
        emit('config-loaded', config)
        emit('config-changed', currentConfigFilename.value)
        console.log('[DashboardConfig] 已应用配置:', currentConfigFilename.value)
      }
    }
  } catch (error) {
    console.error('[DashboardConfig] 应用配置失败:', error)
  }
}

// 保存当前配置
function handleSaveConfig(): void {
  if (!currentConfigFilename.value) {
    // 如果是默认配置，需要另存为
    handleSaveAsNew()
    return
  }
  saveConfigName.value = currentConfigName.value
  isNewConfig.value = false
  saveDialogVisible.value = true
}

// 另存为新配置
function handleSaveAsNew(): void {
  saveConfigName.value = ''
  isNewConfig.value = true
  saveDialogVisible.value = true
}

// 确认保存
async function confirmSave(): Promise<void> {
  if (!saveConfigName.value.trim()) return
  if (!window.api?.dashboardConfig) return

  try {
    const config = props.getCurrentConfig()
    config.name = saveConfigName.value.trim()
    config.modifiedAt = new Date().toISOString()
    if (isNewConfig.value) {
      config.createdAt = config.modifiedAt
    }

    const xmlContent = buildConfigXml(config)
    // 使用配置名称作为文件名
    const filename = `${saveConfigName.value.trim().replace(/[\\/:*?"<>|]/g, '_')}.xml`

    const result = await window.api.dashboardConfig.save(filename, xmlContent)
    if (result.success) {
      console.log('[DashboardConfig] 配置已保存:', filename)
      currentConfigFilename.value = filename
      await loadConfigList()
      emit('config-changed', filename)
    } else {
      console.error('[DashboardConfig] 保存失败:', result.error)
    }
  } catch (error) {
    console.error('[DashboardConfig] 保存配置失败:', error)
  } finally {
    closeSaveDialog()
  }
}

// 关闭保存对话框
function closeSaveDialog(): void {
  saveDialogVisible.value = false
  saveConfigName.value = ''
}

// 删除配置
function handleDeleteConfig(): void {
  if (!currentConfigFilename.value) return
  deleteDialogVisible.value = true
}

// 确认删除
async function confirmDelete(): Promise<void> {
  if (!window.api?.dashboardConfig) return
  if (!currentConfigFilename.value) return

  try {
    const result = await window.api.dashboardConfig.delete(currentConfigFilename.value)
    if (result.success) {
      console.log('[DashboardConfig] 配置已删除:', currentConfigFilename.value)
      currentConfigFilename.value = ''
      await loadConfigList()
      emit('config-changed', '')
    } else {
      console.error('[DashboardConfig] 删除失败:', result.error)
    }
  } catch (error) {
    console.error('[DashboardConfig] 删除配置失败:', error)
  } finally {
    closeDeleteDialog()
  }
}

// 关闭删除对话框
function closeDeleteDialog(): void {
  deleteDialogVisible.value = false
}

// 解析配置 XML
function parseConfigXml(xmlContent: string): DashboardLayoutConfig | null {
  try {
    const parser = new DOMParser()
    const doc = parser.parseFromString(xmlContent, 'text/xml')
    const root = doc.querySelector('DashboardConfig')
    if (!root) return null

    const config: DashboardLayoutConfig = {
      name: root.querySelector('name')?.textContent || '',
      version: root.querySelector('version')?.textContent || '1.0',
      createdAt: root.querySelector('createdAt')?.textContent || '',
      modifiedAt: root.querySelector('modifiedAt')?.textContent || '',
      panels: []
    }

    const panelsNode = root.querySelector('panels')
    if (panelsNode) {
      const panelNodes = panelsNode.querySelectorAll('panel')
      panelNodes.forEach((panelNode) => {
        const panel = {
          id: panelNode.getAttribute('id') || '',
          title: panelNode.querySelector('title')?.textContent || '',
          visible: panelNode.querySelector('visible')?.textContent === 'true',
          position: {
            top: panelNode.querySelector('position > top')?.textContent || undefined,
            left: panelNode.querySelector('position > left')?.textContent || undefined,
            right: panelNode.querySelector('position > right')?.textContent || undefined,
            bottom: panelNode.querySelector('position > bottom')?.textContent || undefined
          },
          size: {
            width: panelNode.querySelector('size > width')?.textContent || '200px',
            height: panelNode.querySelector('size > height')?.textContent || '150px'
          },
          options: {
            hideTitleBar: panelNode.querySelector('options > hideTitleBar')?.textContent === 'true',
            transparent: panelNode.querySelector('options > transparent')?.textContent === 'true',
            opacity: parseFloat(panelNode.querySelector('options > opacity')?.textContent || '1')
          }
        }
        config.panels.push(panel)
      })
    }

    return config
  } catch (error) {
    console.error('[DashboardConfig] 解析配置 XML 失败:', error)
    return null
  }
}

// 构建配置 XML
function buildConfigXml(config: DashboardLayoutConfig): string {
  let xml = `<?xml version="1.0" encoding="UTF-8"?>
<DashboardConfig>
  <name>${escapeXml(config.name)}</name>
  <version>${config.version}</version>
  <createdAt>${config.createdAt}</createdAt>
  <modifiedAt>${config.modifiedAt}</modifiedAt>
  
  <panels>
`

  for (const panel of config.panels) {
    xml += `    <panel id="${escapeXml(panel.id)}">
      <title>${escapeXml(panel.title)}</title>
      <visible>${panel.visible}</visible>
      <position>
${panel.position.top ? `        <top>${panel.position.top}</top>\n` : ''}${panel.position.left ? `        <left>${panel.position.left}</left>\n` : ''}${panel.position.right ? `        <right>${panel.position.right}</right>\n` : ''}${panel.position.bottom ? `        <bottom>${panel.position.bottom}</bottom>\n` : ''}      </position>
      <size>
        <width>${panel.size.width}</width>
        <height>${panel.size.height}</height>
      </size>
      <options>
        <hideTitleBar>${panel.options.hideTitleBar || false}</hideTitleBar>
        <transparent>${panel.options.transparent || false}</transparent>
        <opacity>${panel.options.opacity ?? 1}</opacity>
      </options>
    </panel>
`
  }

  xml += `  </panels>
</DashboardConfig>`

  return xml
}

// XML 转义
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

// 暴露方法
defineExpose({
  loadConfigList,
  currentConfigFilename
})

onMounted(() => {
  loadConfigList()
})
</script>

<style scoped>
.dashboard-config-manager {
  margin-bottom: 16px;
}

.section-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 12px 0;
  font-size: 14px;
  font-weight: 600;
  color: #e2e8f0;
}

.section-title svg {
  opacity: 0.7;
}

.small-label {
  display: block;
  font-size: 12px;
  color: #94a3b8;
  margin-bottom: 6px;
}

.current-config {
  margin-bottom: 12px;
}

.config-select-row {
  display: flex;
  gap: 6px;
}

.config-select {
  flex: 1;
  padding: 8px 12px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  color: #e2e8f0;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.config-select:hover {
  border-color: rgba(255, 255, 255, 0.2);
}

.config-select:focus {
  outline: none;
  border-color: #3b82f6;
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2);
}

.icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  color: #94a3b8;
  cursor: pointer;
  transition: all 0.2s ease;
}

.icon-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #e2e8f0;
}

.icon-btn.apply-btn {
  background: rgba(34, 197, 94, 0.15);
  border-color: rgba(34, 197, 94, 0.3);
  color: #22c55e;
}

.icon-btn.apply-btn:hover {
  background: rgba(34, 197, 94, 0.25);
  border-color: rgba(34, 197, 94, 0.5);
  color: #4ade80;
}

.config-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.action-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  color: #e2e8f0;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.action-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.1);
}

.action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.action-btn.primary {
  background: rgba(59, 130, 246, 0.2);
  border-color: rgba(59, 130, 246, 0.3);
  color: #60a5fa;
}

.action-btn.primary:hover {
  background: rgba(59, 130, 246, 0.3);
}

.action-btn.danger {
  color: #f87171;
}

.action-btn.danger:hover:not(:disabled) {
  background: rgba(239, 68, 68, 0.15);
}

/* 对话框样式 */
.save-dialog-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
}

.save-dialog {
  background: rgba(25, 28, 38, 0.95);
  backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  padding: 20px;
  min-width: 320px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
}

.save-dialog h4 {
  margin: 0 0 16px 0;
  font-size: 16px;
  font-weight: 600;
  color: #e2e8f0;
}

.save-dialog .form-item {
  margin-bottom: 16px;
}

.save-dialog .form-item label {
  display: block;
  font-size: 12px;
  color: #94a3b8;
  margin-bottom: 6px;
}

.save-dialog .form-item input {
  width: 100%;
  padding: 10px 12px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  color: #e2e8f0;
  font-size: 14px;
  box-sizing: border-box;
}

.save-dialog .form-item input:focus {
  outline: none;
  border-color: #3b82f6;
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2);
}

.delete-warning {
  margin: 0 0 16px 0;
  font-size: 14px;
  color: #f87171;
  line-height: 1.5;
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.dialog-btn {
  padding: 8px 16px;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.dialog-btn.cancel {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: #94a3b8;
}

.dialog-btn.cancel:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #e2e8f0;
}

.dialog-btn.confirm {
  background: rgba(59, 130, 246, 0.8);
  border: none;
  color: white;
}

.dialog-btn.confirm:hover:not(:disabled) {
  background: rgba(59, 130, 246, 1);
}

.dialog-btn.confirm:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.dialog-btn.danger {
  background: rgba(239, 68, 68, 0.8);
  border: none;
  color: white;
}

.dialog-btn.danger:hover {
  background: rgba(239, 68, 68, 1);
}

/* 过渡动画 */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
