import { reactive } from 'vue'

export interface LogEntry {
  type: 'log' | 'warn' | 'error'
  timestamp: string
  message: string
}

// 一个响应式的存储，用于保存所有日志条目
export const logStore = reactive<{ logs: LogEntry[] }>({
  logs: []
})

/**
 * 添加一条新日志到存储中
 * @param type 日志类型 ('log', 'warn', 'error')
 * @param args 要记录的消息体
 */
export function addLog(type: LogEntry['type'], ...args: any[]) {
  // 将所有参数转换为一个字符串
  const message = args
    .map((arg) => {
      if (typeof arg === 'object' && arg !== null) {
        try {
          // 美化输出 JSON 对象
          return JSON.stringify(arg, null, 2)
        } catch (e) {
          return '[Unserializable Object]'
        }
      }
      return String(arg)
    })
    .join(' ')

  // 将新日志添加到数组的开头
  logStore.logs.unshift({
    type,
    timestamp: new Date().toLocaleTimeString('en-US', { hour12: false }),
    message
  })

  // 限制日志数量，防止内存溢出
  if (logStore.logs.length > 200) {
    logStore.logs.pop()
  }
}
