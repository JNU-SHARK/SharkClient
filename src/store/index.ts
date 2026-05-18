/**
 * Pinia Store 入口文件
 * 创建和导出 Pinia 实例
 */

import { createPinia } from 'pinia'

// 创建 Pinia 实例
const pinia = createPinia()

export default pinia

// 导出所有 store 模块
export * from './modules/dashboard'
export * from './modules/mqtt_data'
