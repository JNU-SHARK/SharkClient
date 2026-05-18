<template>
  <div class="settings-root">
    <!-- 固定标题区域 -->
    <div class="settings-header">
      <h1 class="settings-title">系统设置</h1>
      <p class="settings-subtitle">客户端配置与系统选项</p>
    </div>

    <!-- 可滚动内容区域 -->
    <div class="settings-container">
      <!-- 外置 AI 检测服务 -->
      <div class="settings-section server-section">
        <div class="section-header">
          <div class="section-icon server">
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"></path>
            </svg>
          </div>
          <div>
            <h3 class="section-title">外置 AI 检测服务</h3>
            <p class="section-desc">
              手动启动 Python 脚本，通过共享内存传帧并由 Pipe 返回检测结果
            </p>
          </div>
        </div>

        <!-- 状态卡片 -->
        <div class="server-grid single">
          <div class="server-card" :class="{ active: pipeServerRunning }">
            <div class="server-card-header">
              <div class="server-icon-wrapper pipe">
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <circle cx="12" cy="12" r="10"></circle>
                  <path d="M12 6v6l4 2"></path>
                </svg>
              </div>
              <span class="status-indicator" :class="pipeStatusClass"></span>
            </div>
            <div class="server-card-body">
              <h4 class="server-name">检测脚本</h4>
              <p class="server-desc">
                {{ pipeServerRunning ? `PID ${pipeServerPid ?? '—'}` : '未启动（需手动启动）' }}
              </p>
              <p v-if="pipeServerMessage && pipeServerStatus === 'error'" class="server-error">
                {{ pipeServerMessage }}
              </p>
              <span class="status-text" :class="pipeStatusClass">{{ pipeStatusText }}</span>
            </div>
            <div class="server-card-actions">
              <button
                class="action-btn start"
                :disabled="pipeServerRunning || pipeServerBusy"
                :title="'启动外置检测脚本'"
                @click="handleStartPipeServer"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <polygon points="5 3 19 12 5 21 5 3"></polygon>
                </svg>
              </button>
              <button
                class="action-btn stop"
                :disabled="!pipeServerRunning || pipeServerBusy"
                :title="'停止外置检测脚本'"
                @click="handleStopPipeServer"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="6" y="6" width="12" height="12"></rect>
                </svg>
              </button>
            </div>
          </div>
        </div>

        <div class="info-tip">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <circle cx="12" cy="12" r="10"></circle>
            <path d="M12 16v-4"></path>
            <path d="M12 8h.01"></path>
          </svg>
          <span>
            检测服务默认不会随客户端启动；需要先手动启动脚本，再在主界面开启 AI 检测。
          </span>
        </div>
      </div>

      <!-- 窗口设置 -->
      <div class="settings-section">
        <div class="section-header">
          <div class="section-icon window">
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
              <line x1="3" y1="9" x2="21" y2="9"></line>
            </svg>
          </div>
          <div>
            <h3 class="section-title">窗口设置</h3>
            <p class="section-desc">显示与快捷键</p>
          </div>
        </div>
        <div class="toggle-item">
          <div class="toggle-info">
            <span class="toggle-label">F11 全屏切换</span>
            <span class="toggle-desc">按 F11 键快速切换全屏模式</span>
          </div>
          <label class="toggle-switch">
            <input v-model="isF11Enabled" type="checkbox" />
            <span class="toggle-slider"></span>
          </label>
        </div>
      </div>

      <!-- 调试选项 -->
      <div class="settings-section">
        <div class="section-header">
          <div class="section-icon window">
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path d="M12 8v4l3 3"></path>
              <circle cx="12" cy="12" r="10"></circle>
            </svg>
          </div>
          <div>
            <h3 class="section-title">调试选项</h3>
            <p class="section-desc">开发/测试场景使用，普通用户请保持关闭</p>
          </div>
        </div>
        <div class="toggle-item">
          <div class="toggle-info">
            <span class="toggle-label">调试模式</span>
            <span class="toggle-desc">显示 MQTT 指令发送等内部调试工具</span>
          </div>
          <label class="toggle-switch">
            <input v-model="isDebugMode" type="checkbox" />
            <span class="toggle-slider"></span>
          </label>
        </div>
      </div>

      <!-- 版本信息 -->
      <div class="settings-section">
        <div class="section-header">
          <div class="section-icon info">
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="16" x2="12" y2="12"></line>
              <line x1="12" y1="8" x2="12.01" y2="8"></line>
            </svg>
          </div>
          <div>
            <h3 class="section-title">版本信息</h3>
            <p class="section-desc">客户端运行环境</p>
          </div>
        </div>
        <Versions />
      </div>

      <!-- 危险操作区 -->
      <div class="settings-section danger-zone">
        <div class="section-header">
          <div class="section-icon danger">
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path
                d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"
              ></path>
              <line x1="12" y1="9" x2="12" y2="13"></line>
              <line x1="12" y1="17" x2="12.01" y2="17"></line>
            </svg>
          </div>
          <div>
            <h3 class="section-title danger">危险操作</h3>
            <p class="section-desc">请谨慎操作</p>
          </div>
        </div>
        <button class="exit-btn" @click="showExitConfirmation">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
            <polyline points="16 17 21 12 16 7"></polyline>
            <line x1="21" y1="12" x2="9" y2="12"></line>
          </svg>
          退出客户端
        </button>
      </div>
    </div>

    <!-- 确认对话框 -->
    <ConfirmationDialog
      v-if="isExitDialogVisible"
      title="退出确认"
      message="确定退出自定义客户端吗？"
      @confirm="handleExitConfirm"
      @cancel="handleExitCancel"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed, onMounted, onUnmounted } from 'vue'
import { storeToRefs } from 'pinia'
import Versions from '@/components/Versions.vue'
import ConfirmationDialog from '@/components/ConfirmationDialog.vue'
import { useDashboardStore } from '@/store'

const dashboardStore = useDashboardStore()
const { isDebugMode } = storeToRefs(dashboardStore)

const isExitDialogVisible = ref(false)
const isF11Enabled = ref(false)
const F11_STORAGE_KEY = 'shark.f11Enabled'

// ─── 外置 AI 检测脚本 ────────────────────────────────────────────────
type PipeStatus = 'stopped' | 'starting' | 'running' | 'error'
const pipeServerStatus = ref<PipeStatus>('stopped')
const pipeServerBusy = ref(false)
const pipeServerPid = ref<number | null>(null)
const pipeServerMessage = ref('')
const pipeServerPath = 'AI Server'
let pipeStatusCleanup: (() => void) | null = null

const pipeServerRunning = computed(() => pipeServerStatus.value === 'running')
const pipeStatusText = computed(() => {
  if (pipeServerBusy.value || pipeServerStatus.value === 'starting') return '启动中...'
  if (pipeServerStatus.value === 'running') return '已启动'
  if (pipeServerStatus.value === 'error') return '异常'
  return '未启动'
})
const pipeStatusClass = computed(() => {
  if (pipeServerBusy.value || pipeServerStatus.value === 'starting') return 'status-loading'
  if (pipeServerStatus.value === 'running') return 'status-success'
  if (pipeServerStatus.value === 'error') return 'status-error'
  return 'status-idle'
})

async function refreshPipeServerStatus(): Promise<void> {
  try {
    const st = await window.api.pipeServer.getStatus()
    pipeServerStatus.value = st?.running ? 'running' : 'stopped'
    pipeServerPid.value = typeof st?.pid === 'number' ? st.pid : null
  } catch {
    pipeServerStatus.value = 'stopped'
    pipeServerPid.value = null
  }
}

// 组件加载：恢复设置 + 读取当前推理器状态
onMounted(async () => {
  try {
    try {
      const saved = localStorage.getItem(F11_STORAGE_KEY)
      isF11Enabled.value = saved === null ? true : saved === '1'
    } catch {
      isF11Enabled.value = true
    }

    await refreshPipeServerStatus()
    pipeStatusCleanup = window.api.pipeServer.onStatusChanged((status: PipeStatus, message?: string) => {
      pipeServerStatus.value = status
      pipeServerMessage.value = message ?? ''
      if (status !== 'running') pipeServerPid.value = null
      if (status === 'running') void refreshPipeServerStatus()
    })
  } catch (error) {
    console.error('[Settings] 初始化失败:', error)
  }
})

onUnmounted(() => {
  pipeStatusCleanup?.()
  pipeStatusCleanup = null
})

async function handleStartPipeServer(): Promise<void> {
  pipeServerBusy.value = true
  try {
    pipeServerStatus.value = 'starting'
    const result = await window.api.pipeServer.start(pipeServerPath)
    if (result?.success) {
      pipeServerStatus.value = (result as { status?: PipeStatus }).status ?? 'starting'
      pipeServerPid.value = (result as { pid?: number }).pid ?? null
      pipeServerMessage.value = (result as { message?: string }).message ?? ''
    } else {
      pipeServerMessage.value = (result as { error?: string })?.error ?? ''
      alert(
        '检测脚本启动失败: ' + ((result as { error?: string })?.error ?? '未知错误，请查看控制台')
      )
      pipeServerStatus.value = 'error'
    }
  } catch (e) {
    console.error('[Settings] pipe server start failed:', e)
    pipeServerStatus.value = 'error'
    pipeServerMessage.value = e instanceof Error ? e.message : String(e)
    alert('检测脚本启动异常: ' + pipeServerMessage.value)
  } finally {
    pipeServerBusy.value = false
  }
}

async function handleStopPipeServer(): Promise<void> {
  pipeServerBusy.value = true
  try {
    await window.api.pipeServer.stop()
    pipeServerStatus.value = 'stopped'
    pipeServerPid.value = null
  } catch (e) {
    console.error('[Settings] pipe server stop failed:', e)
    pipeServerStatus.value = 'error'
    alert('检测脚本停止异常，请查看控制台')
  } finally {
    pipeServerBusy.value = false
  }
}

// 监听 F11 状态变化，持久化 + 同步到主进程
watch(
  isF11Enabled,
  (val) => {
    console.log('[Settings] F11 快捷键状态变更:', val)
    try {
      localStorage.setItem(F11_STORAGE_KEY, val ? '1' : '0')
    } catch {
      /* ignore quota errors */
    }
    if (window.api?.setF11Shortcut) {
      window.api.setF11Shortcut(val)
    }
  },
  { immediate: true }
)

const showExitConfirmation = (): void => {
  isExitDialogVisible.value = true
}

const handleExitConfirm = (): void => {
  window.api.close()
  isExitDialogVisible.value = false
}

const handleExitCancel = (): void => {
  isExitDialogVisible.value = false
}
</script>

<style scoped>
.settings-root {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  background: linear-gradient(180deg, #0a0a0a 0%, #111 100%);
  color: #fff;
}

.settings-header {
  flex-shrink: 0;
  padding: 40px 60px 24px 60px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  background: rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(10px);
}

.settings-container {
  flex: 1;
  overflow-y: auto;
  padding: 32px 60px 48px 60px;
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.settings-container::-webkit-scrollbar {
  display: none;
}

.settings-title {
  font-size: 28px;
  font-weight: 700;
  margin: 0 0 6px 0;
  color: #fff;
  letter-spacing: -0.5px;
}

.settings-subtitle {
  font-size: 14px;
  color: rgba(255, 255, 255, 0.45);
  margin: 0;
}

/* Section 通用样式 */
.settings-section {
  padding: 24px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 16px;
  margin-bottom: 20px;
}

.section-header {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 20px;
}

.section-icon {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.section-icon.server {
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.2), rgba(147, 51, 234, 0.2));
  color: #60a5fa;
}

.section-icon.network {
  background: linear-gradient(135deg, rgba(16, 185, 129, 0.2), rgba(6, 182, 212, 0.2));
  color: #34d399;
}

.section-icon.window {
  background: linear-gradient(135deg, rgba(251, 191, 36, 0.2), rgba(245, 158, 11, 0.2));
  color: #fbbf24;
}

.section-icon.info {
  background: linear-gradient(135deg, rgba(99, 102, 241, 0.2), rgba(139, 92, 246, 0.2));
  color: #818cf8;
}

.section-icon.danger {
  background: linear-gradient(135deg, rgba(239, 68, 68, 0.2), rgba(220, 38, 38, 0.2));
  color: #f87171;
}

.section-title {
  font-size: 16px;
  font-weight: 600;
  margin: 0;
  color: rgba(255, 255, 255, 0.95);
}

.section-title.danger {
  color: #f87171;
}

.section-desc {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.4);
  margin: 2px 0 0 0;
}

/* 服务器区域特殊样式 */
.server-section {
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.03), rgba(147, 51, 234, 0.03));
  border-color: rgba(59, 130, 246, 0.1);
}

/* 配置卡片 */
.config-card {
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 12px;
  padding: 16px 20px;
  margin-bottom: 20px;
}

.config-label {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.label-text {
  font-size: 14px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.9);
}

.label-hint {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.4);
}

/* 路径输入组 */
.path-input-group {
  display: flex;
  gap: 10px;
}

.path-input {
  flex: 1;
  padding: 12px 16px;
  background: rgba(0, 0, 0, 0.4);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: #fff;
  border-radius: 10px;
  font-size: 14px;
  transition: all 0.2s;
}

.path-input:focus {
  outline: none;
  border-color: rgba(59, 130, 246, 0.5);
  background: rgba(0, 0, 0, 0.6);
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}

.path-input::placeholder {
  color: rgba(255, 255, 255, 0.3);
}

.browse-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 20px;
  border-radius: 10px;
  border: none;
  background: linear-gradient(135deg, #3b82f6, #2563eb);
  color: white;
  font-weight: 500;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s;
  white-space: nowrap;
}

.browse-btn:hover {
  background: linear-gradient(135deg, #60a5fa, #3b82f6);
  transform: translateY(-1px);
  box-shadow: 0 4px 16px rgba(59, 130, 246, 0.35);
}

/* 服务器卡片网格 */
.server-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
  margin-bottom: 16px;
}

.server-card {
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 14px;
  padding: 20px;
  transition: all 0.3s;
}

.server-card:hover {
  border-color: rgba(255, 255, 255, 0.12);
  background: rgba(0, 0, 0, 0.4);
}

.server-card.active {
  border-color: rgba(34, 197, 94, 0.4);
  background: rgba(34, 197, 94, 0.05);
}

.server-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}

.server-icon-wrapper {
  width: 48px;
  height: 48px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.server-icon-wrapper.pipe {
  background: linear-gradient(135deg, rgba(251, 191, 36, 0.2), rgba(245, 158, 11, 0.3));
  color: #fbbf24;
}

.status-indicator {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #6b7280;
}

.status-indicator.status-success {
  background: #22c55e;
  box-shadow: 0 0 8px rgba(34, 197, 94, 0.6);
  animation: pulse-green 2s infinite;
}

.status-indicator.status-loading {
  background: #f59e0b;
  animation: pulse-yellow 1s infinite;
}

.status-indicator.status-error {
  background: #ef4444;
}

.status-indicator.status-idle {
  background: #6b7280;
}

@keyframes pulse-green {
  0%,
  100% {
    box-shadow: 0 0 8px rgba(34, 197, 94, 0.6);
  }
  50% {
    box-shadow: 0 0 16px rgba(34, 197, 94, 0.8);
  }
}

@keyframes pulse-yellow {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}

.server-card-body {
  margin-bottom: 16px;
}

.server-name {
  font-size: 15px;
  font-weight: 600;
  margin: 0 0 4px 0;
  color: rgba(255, 255, 255, 0.95);
}

.server-desc {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.4);
  margin: 0 0 10px 0;
}

.server-error {
  max-height: 96px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 11px;
  line-height: 1.45;
  color: #fca5a5;
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.22);
  border-radius: 6px;
  padding: 8px;
  margin: 0 0 10px 0;
}

.status-text {
  display: inline-block;
  font-size: 12px;
  font-weight: 500;
  padding: 4px 10px;
  border-radius: 6px;
  background: rgba(107, 114, 128, 0.2);
  color: #9ca3af;
}

.status-text.status-success {
  background: rgba(34, 197, 94, 0.15);
  color: #4ade80;
}

.status-text.status-loading {
  background: rgba(245, 158, 11, 0.15);
  color: #fbbf24;
}

.status-text.status-error {
  background: rgba(239, 68, 68, 0.15);
  color: #f87171;
}

.server-card-actions {
  display: flex;
  gap: 10px;
}

.action-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 10px;
  border: none;
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.2s;
}

.action-btn.start {
  background: linear-gradient(135deg, #22c55e, #16a34a);
  color: white;
}

.action-btn.start:hover:not(:disabled) {
  background: linear-gradient(135deg, #4ade80, #22c55e);
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(34, 197, 94, 0.35);
}

.action-btn.stop {
  background: linear-gradient(135deg, #ef4444, #dc2626);
  color: white;
}

.action-btn.stop:hover:not(:disabled) {
  background: linear-gradient(135deg, #f87171, #ef4444);
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(239, 68, 68, 0.35);
}

.action-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
  transform: none !important;
  box-shadow: none !important;
}

/* 信息提示 */
.info-tip {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  background: rgba(99, 102, 241, 0.08);
  border: 1px solid rgba(99, 102, 241, 0.15);
  border-radius: 10px;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.7);
}

.info-tip svg {
  flex-shrink: 0;
  color: #818cf8;
}

.info-tip strong {
  color: #a5b4fc;
}

/* 表单网格 */
.form-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
}

.form-item {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.form-item label {
  color: rgba(255, 255, 255, 0.6);
  font-size: 13px;
  font-weight: 500;
}

.form-item input {
  padding: 12px 16px;
  background: rgba(0, 0, 0, 0.4);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: #fff;
  border-radius: 10px;
  font-size: 14px;
  transition: all 0.2s;
}

.form-item input:focus {
  outline: none;
  border-color: rgba(16, 185, 129, 0.5);
  background: rgba(0, 0, 0, 0.6);
  box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.1);
}

/* Toggle 开关 */
.toggle-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 12px;
  transition: all 0.2s;
}

.toggle-item:hover {
  background: rgba(0, 0, 0, 0.3);
}

.toggle-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.toggle-label {
  font-size: 14px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.9);
}

.toggle-desc {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.4);
}

.toggle-switch {
  position: relative;
  width: 48px;
  height: 26px;
  cursor: pointer;
}

.toggle-switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.toggle-slider {
  position: absolute;
  inset: 0;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 13px;
  transition: all 0.3s;
}

.toggle-slider::before {
  content: '';
  position: absolute;
  width: 20px;
  height: 20px;
  left: 3px;
  bottom: 3px;
  background: white;
  border-radius: 50%;
  transition: all 0.3s;
}

.toggle-switch input:checked + .toggle-slider {
  background: linear-gradient(135deg, #3b82f6, #2563eb);
}

.toggle-switch input:checked + .toggle-slider::before {
  transform: translateX(22px);
}

/* 危险区域 */
.danger-zone {
  border-color: rgba(239, 68, 68, 0.15);
  background: rgba(239, 68, 68, 0.03);
}

.exit-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 14px 28px;
  border-radius: 12px;
  border: none;
  background: linear-gradient(135deg, #dc2626, #b91c1c);
  color: white;
  font-weight: 600;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s;
}

.exit-btn:hover {
  background: linear-gradient(135deg, #ef4444, #dc2626);
  transform: translateY(-1px);
  box-shadow: 0 4px 16px rgba(220, 38, 38, 0.4);
}

.exit-btn:active {
  transform: translateY(0);
}

/* 响应式 */
@media (max-width: 900px) {
  .settings-header,
  .settings-container {
    padding-left: 32px;
    padding-right: 32px;
  }

  .server-grid,
  .form-grid {
    grid-template-columns: 1fr;
  }
}
</style>
