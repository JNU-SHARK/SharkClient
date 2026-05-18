import './assets/main.css'
import './assets/modals.css'


import { createApp } from 'vue'
import App from './App.vue'
import pinia from './store'
import { addLog } from './store/log'

// --- 新增: 覆盖 console 函数 ---
const originalLog = console.log
console.log = (...args: unknown[]) => {
  addLog('log', ...args)
  originalLog.apply(console, args)
}

const originalWarn = console.warn
console.warn = (...args: unknown[]) => {
  addLog('warn', ...args)
  originalWarn.apply(console, args)
}

const originalError = console.error
console.error = (...args: unknown[]) => {
  addLog('error', ...args)
  originalError.apply(console, args)
}
// --- 结束 ---

// 创建 Vue 应用并注册 Pinia
async function bootstrap(): Promise<void> {
  const startupAt = performance.now()
  const apiShimAt = performance.now()
  await import('./api-shim')
  console.log(`[startup] api-shim loaded in ${(performance.now() - apiShimAt).toFixed(1)}ms`)

  const app = createApp(App)
  app.use(pinia)
  app.mount('#app')
  console.log(`[startup] vue mounted in ${(performance.now() - startupAt).toFixed(1)}ms`)

  // Signal the Rust side to reveal the window now that the UI is mounted,
  // eliminating the initial white flash.
  try {
    const { emit } = await import('@tauri-apps/api/event')
    await emit('frontend-ready')
    console.log(`[startup] frontend-ready emitted in ${(performance.now() - startupAt).toFixed(1)}ms`)
  } catch {
    // Non-Tauri environment (e.g., plain `vite` dev) — safe to ignore.
  }
}

void bootstrap()
