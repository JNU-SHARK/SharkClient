/**
 * 全局消息服务
 * 用于在任意组件中触发消息弹窗通知
 */

import { ref, reactive } from 'vue'

// ==================== 类型定义 ====================

export type MessageLevel = 'info' | 'warning' | 'danger'

export interface GlobalMessage {
  id: string
  level: MessageLevel
  title: string
  text: string
  duration: number
  createdAt: number
}

// ==================== 全局状态 ====================

/** 消息队列 */
const messageQueue = reactive<GlobalMessage[]>([])

/** 消息 ID 计数器 */
let messageIdCounter = 0

/** 消息回调函数列表 */
const messageCallbacks = ref<Array<(message: GlobalMessage) => void>>([])

/** 消息删除回调函数列表 */
const dismissCallbacks = ref<Array<(id: string) => void>>([])

// ==================== 消息服务方法 ====================

/**
 * 显示消息弹窗
 * @param level 消息级别 ('info' | 'warning' | 'danger')
 * @param title 消息标题
 * @param text 消息内容
 * @param duration 显示时长（毫秒），0 表示不自动关闭
 */
export function showMessage(
  level: MessageLevel,
  title: string,
  text: string,
  duration = 5000
): string {
  const id = `global-msg-${++messageIdCounter}`

  const message: GlobalMessage = {
    id,
    level,
    title,
    text,
    duration,
    createdAt: Date.now()
  }

  messageQueue.push(message)

  // 通知所有注册的回调
  messageCallbacks.value.forEach((callback) => {
    try {
      callback(message)
    } catch (error) {
      console.error('[MessageService] 回调执行失败:', error)
    }
  })

  console.log(`[MessageService] 显示消息: [${level}] ${title} - ${text}`)

  return id
}

/**
 * 显示信息消息
 */
export function showInfo(title: string, text: string, duration = 5000): string {
  return showMessage('info', title, text, duration)
}

/**
 * 显示警告消息
 */
export function showWarning(title: string, text: string, duration = 8000): string {
  return showMessage('warning', title, text, duration)
}

/**
 * 显示危险/错误消息
 */
export function showDanger(title: string, text: string, duration = 10000): string {
  return showMessage('danger', title, text, duration)
}

/**
 * 注册消息回调
 * @param callback 回调函数
 * @returns 取消注册的函数
 */
export function onMessage(callback: (message: GlobalMessage) => void): () => void {
  messageCallbacks.value.push(callback)

  return () => {
    const index = messageCallbacks.value.indexOf(callback)
    if (index > -1) {
      messageCallbacks.value.splice(index, 1)
    }
  }
}

/**
 * 注册消息删除回调
 * @param callback 回调函数，接收被删除消息的 ID
 * @returns 取消注册的函数
 */
export function onDismiss(callback: (id: string) => void): () => void {
  dismissCallbacks.value.push(callback)

  return () => {
    const index = dismissCallbacks.value.indexOf(callback)
    if (index > -1) {
      dismissCallbacks.value.splice(index, 1)
    }
  }
}

/**
 * 获取消息队列
 */
export function getMessageQueue(): GlobalMessage[] {
  return messageQueue
}

/**
 * 清除指定消息
 */
export function dismissMessage(id: string): void {
  const index = messageQueue.findIndex((m) => m.id === id)
  if (index > -1) {
    messageQueue.splice(index, 1)
  }

  // 通知所有注册的删除回调
  dismissCallbacks.value.forEach((callback) => {
    try {
      callback(id)
    } catch (error) {
      console.error('[MessageService] 删除回调执行失败:', error)
    }
  })

  console.log(`[MessageService] 删除消息: ${id}`)
}

/**
 * 清除所有消息
 */
export function clearAllMessages(): void {
  messageQueue.splice(0, messageQueue.length)
}

// ==================== 导出默认服务对象 ====================

export const messageService = {
  showMessage,
  showInfo,
  showWarning,
  showDanger,
  onMessage,
  onDismiss,
  getMessageQueue,
  dismissMessage,
  clearAllMessages
}

export default messageService
