<template>
  <div class="custom-data-display">
    <!-- 标题栏 -->
    <div class="header">
      <h1 class="title">自定义数据实时显示</h1>
      <div class="subtitle">解析自 CustomByteBlock MQTT 消息</div>
    </div>

    <!-- 空状态 -->
    <div v-if="!currentRobotData" class="empty-state">
      <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <circle cx="12" cy="12" r="10"></circle>
        <line x1="12" y1="16" x2="12" y2="12"></line>
        <line x1="12" y1="8" x2="12.01" y2="8"></line>
      </svg>
      <h3>暂无数据</h3>
      <p>等待接收 CustomByteBlock 消息...</p>
      <div class="tip">
        <span>📌 提示：</span>
        <span>请确保已在 Dashboard 中选择机器人并连接 MQTT</span>
      </div>
    </div>

    <!-- 数据显示区 -->
    <div v-else class="data-container">
      <!-- 元信息卡片 -->
      <div class="meta-card">
        <div class="meta-header">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <circle cx="12" cy="12" r="10"></circle>
            <polyline points="12 6 12 12 16 14"></polyline>
          </svg>
          <span>数据包信息</span>
        </div>
        <div class="meta-grid">
          <div class="meta-item">
            <span class="meta-label">机器人 ID</span>
            <span class="meta-value">{{ currentRobotId }}</span>
          </div>
          <div class="meta-item">
            <span class="meta-label">数据模式</span>
            <span class="meta-value mode-badge" :class="modeClass">
              {{ currentRobotData.mode === 0 ? '纯数据模式' : '图像数据模式' }}
            </span>
          </div>
          <div class="meta-item">
            <span class="meta-label">数据长度</span>
            <span class="meta-value">{{ dataLength }} 字节</span>
          </div>
          <div class="meta-item">
            <span class="meta-label">最后更新</span>
            <span class="meta-value">{{ lastUpdateTime }}</span>
          </div>
        </div>
      </div>

      <!-- 纯数据模式字段 -->
      <div
        v-if="currentRobotData.mode === 0 && currentRobotData.pureDataFields"
        class="fields-section"
      >
        <div class="section-header">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <rect x="3" y="3" width="7" height="7"></rect>
            <rect x="14" y="3" width="7" height="7"></rect>
            <rect x="3" y="14" width="7" height="7"></rect>
            <rect x="14" y="14" width="7" height="7"></rect>
          </svg>
          <span>传感器数据字段</span>
          <span class="field-count">
            {{ Object.keys(currentRobotData.pureDataFields).length }} 个字段
          </span>
        </div>
        <div class="fields-grid">
          <div
            v-for="(value, key) in currentRobotData.pureDataFields"
            :key="key"
            class="field-card"
          >
            <div class="field-name">{{ key }}</div>
            <div class="field-value">{{ formatFieldValue(value) }}</div>
          </div>
        </div>
      </div>

      <!-- 图像数据模式字段 -->
      <div v-if="currentRobotData.mode === 1" class="image-mode-section">
        <!-- 普通伴随字段（非 ImageBlock 类型） -->
        <div v-if="Object.keys(normalCompanionFields).length > 0" class="fields-section">
          <div class="section-header">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="7 10 12 15 17 10"></polyline>
              <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
            <span>伴随数据字段</span>
          </div>
          <div class="fields-grid">
            <div v-for="(value, key) in normalCompanionFields" :key="key" class="field-card">
              <div class="field-name">{{ key }}</div>
              <div class="field-value">{{ formatFieldValue(value) }}</div>
            </div>
          </div>
        </div>

        <!-- ImageBlock 字段（如 infantry_pic） -->
        <div
          v-for="(blockData, blockName) in imageBlockFields"
          :key="blockName"
          class="image-block-section"
        >
          <div class="section-header">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
              <circle cx="8.5" cy="8.5" r="1.5"></circle>
              <polyline points="21 15 16 10 5 21"></polyline>
            </svg>
            <span>{{ blockName }} (ImageBlock)</span>
          </div>

          <!-- ImageBlock 元信息 -->
          <div class="image-block-meta">
            <div class="meta-row">
              <span class="meta-label">命令类型 (cmd_type)</span>
              <span class="meta-value">{{ blockData.cmd_type }}</span>
            </div>
            <div class="meta-row">
              <span class="meta-label">图像 ID (img_id)</span>
              <span class="meta-value">{{ blockData.img_id }}</span>
            </div>
            <div class="meta-row">
              <span class="meta-label">块索引 (block_idx)</span>
              <span class="meta-value">{{ blockData.block_idx }}</span>
            </div>
            <div class="meta-row">
              <span class="meta-label">总块数 (total_block)</span>
              <span class="meta-value">{{ blockData.total_block }}</span>
            </div>
            <div class="meta-row">
              <span class="meta-label">数据长度 (data_len)</span>
              <span class="meta-value">{{ blockData.data_len }} 字节</span>
            </div>
          </div>

          <!-- 图像拼合进度 -->
          <div class="image-assembly-progress">
            <div class="progress-header">
              <span>图像拼合进度</span>
              <span class="progress-text">
                {{ getImageProgress(blockData.img_id).received }} / {{ blockData.total_block }} 块
                ({{ getImageProgress(blockData.img_id).percentage }}%)
              </span>
            </div>
            <div class="progress-bar">
              <div
                class="progress-fill"
                :style="{ width: getImageProgress(blockData.img_id).percentage + '%' }"
              ></div>
            </div>
            <div v-if="getImageProgress(blockData.img_id).isComplete" class="complete-badge">
              ✓ 拼合完成
            </div>
          </div>

          <!-- 拼合后的图像预览 -->
          <div v-if="getAssembledImage(blockData.img_id)" class="assembled-image-preview">
            <div class="image-preview-header">
              <span>拼合后的图像</span>
              <span class="image-format">{{ getAssembledImage(blockData.img_id)!.format }}</span>
            </div>
            <img
              :src="getAssembledImage(blockData.img_id)!.dataUrl"
              alt="拼合图像"
              class="preview-image"
            />
            <div class="image-info">
              <span>总大小: {{ getAssembledImage(blockData.img_id)!.totalSize }} 字节</span>
            </div>
          </div>

          <!-- ImageBlock 数据预览 -->
          <div v-if="blockData.data && Array.isArray(blockData.data)" class="raw-data-preview">
            <div class="raw-data-header">
              <span>图像数据 (前 64 字节)</span>
              <span class="raw-data-length">总长: {{ blockData.data.length }} 字节</span>
            </div>
            <div class="hex-dump">{{ formatHexDump(blockData.data) }}</div>
          </div>
        </div>

        <!-- 图像原始数据预览（直接从 imageData 字段，兼容旧格式） -->
        <div
          v-if="currentRobotData.imageData && Object.keys(imageBlockFields).length === 0"
          class="image-block-section"
        >
          <div class="section-header">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
              <circle cx="8.5" cy="8.5" r="1.5"></circle>
              <polyline points="21 15 16 10 5 21"></polyline>
            </svg>
            <span>图像数据块 ({{ currentRobotData.imageData.length }} 字节)</span>
          </div>

          <!-- 原始图像数据预览 -->
          <div class="raw-data-preview">
            <div class="raw-data-header">
              <span>原始数据 (前 64 字节)</span>
              <span class="raw-data-length">
                总长: {{ currentRobotData.imageData.length }} 字节
              </span>
            </div>
            <div class="hex-dump">
              {{ formatHexDump(currentRobotData.imageData) }}
            </div>
          </div>
        </div>

        <!-- 图像块信息（嵌套格式，兼容） -->
        <div
          v-if="currentRobotData.imageBlock && !currentRobotData.imageData"
          class="image-block-section"
        >
          <div class="section-header">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
              <circle cx="8.5" cy="8.5" r="1.5"></circle>
              <polyline points="21 15 16 10 5 21"></polyline>
            </svg>
            <span>图像数据块 (128 字节)</span>
          </div>

          <!-- 图像块字段 -->
          <div v-if="currentRobotData.imageBlock.fields" class="fields-grid">
            <div
              v-for="(value, key) in currentRobotData.imageBlock.fields"
              :key="key"
              class="field-card"
            >
              <div class="field-name">{{ key }}</div>
              <div class="field-value">{{ formatFieldValue(value) }}</div>
            </div>
          </div>

          <!-- 原始图像数据预览 -->
          <div v-if="currentRobotData.imageBlock.rawData" class="raw-data-preview">
            <div class="raw-data-header">
              <span>原始数据 (前 64 字节)</span>
              <span class="raw-data-length">
                总长: {{ currentRobotData.imageBlock.rawData.length }} 字节
              </span>
            </div>
            <div class="hex-dump">
              {{ formatHexDump(currentRobotData.imageBlock.rawData) }}
            </div>
          </div>
        </div>
      </div>

      <!-- 原始二进制数据预览 -->
      <div v-if="currentRobotData.rawBuffer" class="raw-buffer-section">
        <div class="section-header">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <polyline points="16 18 22 12 16 6"></polyline>
            <polyline points="8 6 2 12 8 18"></polyline>
          </svg>
          <span>原始数据 (150 字节完整包)</span>
        </div>
        <div class="hex-dump full">
          {{ formatFullHexDump(currentRobotData.rawBuffer) }}
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue'
import { useMqttDataStore } from '@/store/modules/mqtt_data'

const mqttDataStore = useMqttDataStore()

// ==================== 图像块收集器 ====================
interface ImageBlockData {
  cmd_type: number
  img_id: number
  block_idx: number
  total_block: number
  data_len: number
  data: number[]
}

interface AssembledImage {
  dataUrl: string
  format: string
  totalSize: number
}

// 存储每个 img_id 的所有块（使用普通 Map，非响应式）
const imageBlocksMap = new Map<number, Map<number, ImageBlockData>>()
// 存储已拼合的图像（普通 Map，非响应式，避免触发 watch 循环）
const assembledImages = new Map<number, AssembledImage>()
// 存储已处理的块 ID（普通 Set，非响应式）
const processedBlockIds = new Set<string>()
// 正在拼合的图像 ID 集合（防止递归触发）
const assemblingImageIds = new Set<number>()
// UI 更新计数器（用于触发模板重新渲染）
const assembledImagesVersion = ref(0)

// 强制创建对 customData 的响应式依赖
const customDataSize = computed(() => mqttDataStore.customData.size)

// 当前选中机器人的 ID（从 customData Map 获取第一个可用的 robotId）
const currentRobotId = computed(() => {
  // 通过访问 size 确保响应式依赖
  const size = customDataSize.value
  if (size === 0) {
    return null
  }

  // 获取所有键并返回第一个
  const keys = Array.from(mqttDataStore.customData.keys())
  if (keys.length > 0) {
    return keys[0]
  }

  return null
})

// 当前机器人的解析数据
const currentRobotData = computed(() => {
  if (currentRobotId.value === null) {
    return undefined
  }
  return mqttDataStore.customData.get(currentRobotId.value) as ParsedCustomData | undefined
})

// 解析数据接口定义（根据实际解析结果）
interface ParsedCustomData {
  mode: number // 0 = 纯数据模式, 1 = 图像数据模式
  pureDataFields?: Record<string, unknown> // 纯数据模式字段
  companionField?: Record<string, unknown> // 图像模式伴随字段（单个对象）
  imageBlock?: {
    fields?: Record<string, unknown> // 图像块内部字段
    rawData?: number[] // 原始图像数据
  }
  imageData?: number[] // 图像原始数据（兼容旧格式）
  rawBuffer?: number[] // 完整 150 字节原始数据
}

// 计算属性
const modeClass = computed(() => {
  return currentRobotData.value?.mode === 0 ? 'mode-pure' : 'mode-image'
})

const dataLength = computed(() => {
  // 优先从 rawBuffer 获取，其次从 imageData，默认 150
  if (currentRobotData.value?.rawBuffer?.length) {
    return currentRobotData.value.rawBuffer.length
  }
  if (currentRobotData.value?.imageData?.length) {
    return currentRobotData.value.imageData.length
  }
  return currentRobotData.value ? 150 : 0
})

const lastUpdateTime = computed(() => {
  const now = new Date()
  return now.toLocaleTimeString('zh-CN', { hour12: false })
})

// 提取伴随字段（排除系统字段）
const companionFields = computed(() => {
  if (!currentRobotData.value || currentRobotData.value.mode !== 1) {
    return {}
  }
  const systemFields = [
    'mode',
    'imageData',
    'imageBlock',
    'rawBuffer',
    'pureDataFields',
    'companionField'
  ]
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(currentRobotData.value)) {
    if (!systemFields.includes(key)) {
      result[key] = value
    }
  }
  return result
})

// 解析 ImageBlock 字段（如 infantry_pic）
const parseImageBlockField = (value: unknown): Record<string, unknown> | null => {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as Record<string, unknown>
    } catch {
      return null
    }
  }
  if (typeof value === 'object' && value !== null) {
    return value as Record<string, unknown>
  }
  return null
}

// 提取所有 ImageBlock 类型字段
const imageBlockFields = computed(() => {
  const result: Record<string, ImageBlockData> = {}
  for (const [key, value] of Object.entries(companionFields.value)) {
    const parsed = parseImageBlockField(value)
    if (
      parsed &&
      'cmd_type' in parsed &&
      'img_id' in parsed &&
      'block_idx' in parsed &&
      'total_block' in parsed &&
      'data_len' in parsed &&
      'data' in parsed
    ) {
      result[key] = parsed as unknown as ImageBlockData
    }
  }
  return result
})

// 非 ImageBlock 的普通伴随字段
const normalCompanionFields = computed(() => {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(companionFields.value)) {
    const parsed = parseImageBlockField(value)
    if (!parsed || !('cmd_type' in parsed)) {
      result[key] = value
    }
  }
  return result
})

/**
 * 检测图像格式
 */
function detectImageFormat(data: Uint8Array): string {
  // JPEG: FF D8 FF
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return 'image/jpeg'
  }
  // PNG: 89 50 4E 47
  if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) {
    return 'image/png'
  }
  // WebP: RIFF ... WEBP
  if (data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46) {
    if (data[8] === 0x57 && data[9] === 0x45 && data[10] === 0x42 && data[11] === 0x50) {
      return 'image/webp'
    }
  }
  // AVIF: ... ftyp avif/avis
  const ftypIndex = data.findIndex(
    (_, i) =>
      data[i] === 0x66 && data[i + 1] === 0x74 && data[i + 2] === 0x79 && data[i + 3] === 0x70
  )
  if (ftypIndex !== -1 && ftypIndex + 8 < data.length) {
    const brand = String.fromCharCode(
      data[ftypIndex + 4],
      data[ftypIndex + 5],
      data[ftypIndex + 6],
      data[ftypIndex + 7]
    )
    if (brand === 'avif' || brand === 'avis') {
      return 'image/avif'
    }
  }
  return 'application/octet-stream'
}

/**
 * 拼合图像块
 */
function assembleImage(imgId: number): void {
  // 如果已经拼合过或正在拼合，直接返回
  if (assembledImages.has(imgId) || assemblingImageIds.has(imgId)) {
    console.log(`[图像拼合] 跳过 imgId=${imgId} (已拼合或正在拼合)`)
    return
  }

  const blocks = imageBlocksMap.get(imgId)
  if (!blocks || blocks.size === 0) {
    console.log(`[图像拼合] 跳过 imgId=${imgId} (无块数据)`)
    return
  }

  // 标记为正在拼合
  assemblingImageIds.add(imgId)

  console.log(`[图像拼合] 开始拼合 imgId=${imgId}, 共 ${blocks.size} 块`)

  // 按 block_idx 排序并拼接数据
  const sortedBlocks = Array.from(blocks.entries())
    .sort(([idxA], [idxB]) => idxA - idxB)
    .map(([, block]) => block)

  // 计算总大小
  let totalSize = 0
  for (const block of sortedBlocks) {
    totalSize += block.data_len
  }

  // 拼接所有块的数据
  const assembledData = new Uint8Array(totalSize)
  let offset = 0
  for (const block of sortedBlocks) {
    // 只取实际数据长度（data_len），避免填充字节
    const actualData = block.data.slice(0, block.data_len)
    assembledData.set(actualData, offset)
    offset += block.data_len
  }

  // 检测图像格式
  const mimeType = detectImageFormat(assembledData)
  const formatName = mimeType.split('/')[1]?.toUpperCase() || 'Unknown'

  // 转换为 Base64（分块处理，避免栈溢出）
  let binaryString = ''
  const chunkSize = 8192 // 每次处理 8KB
  for (let i = 0; i < assembledData.length; i += chunkSize) {
    const chunk = assembledData.subarray(i, i + chunkSize)
    binaryString += String.fromCharCode(...chunk)
  }
  const base64 = btoa(binaryString)
  const dataUrl = `data:${mimeType};base64,${base64}`

  console.log(`[图像拼合] 完成 imgId=${imgId}, 格式=${formatName}, 大小=${totalSize}字节`)

  // 先移除正在拼合标记
  assemblingImageIds.delete(imgId)

  // 存储拼合结果（普通 Map，不触发响应式）
  assembledImages.set(imgId, {
    dataUrl,
    format: formatName,
    totalSize
  })

  // 触发 UI 更新
  assembledImagesVersion.value++
}

/**
 * 获取图像拼合进度
 */
function getImageProgress(imgId: number): {
  received: number
  percentage: number
  isComplete: boolean
} {
  const blocks = imageBlocksMap.get(imgId)
  if (!blocks || blocks.size === 0) {
    return { received: 0, percentage: 0, isComplete: false }
  }

  const firstBlock = Array.from(blocks.values())[0]
  const totalBlocks = firstBlock.total_block
  const received = blocks.size
  const percentage = Math.round((received / totalBlocks) * 100)

  return {
    received,
    percentage,
    isComplete: received === totalBlocks
  }
}

/**
 * 获取已拼合的图像
 */
function getAssembledImage(imgId: number): AssembledImage | null {
  // 访问 version 以建立响应式依赖
  void assembledImagesVersion.value
  return assembledImages.get(imgId) || null
}

// 格式化字段值
const formatFieldValue = (value: unknown): string => {
  if (value === null || value === undefined) {
    return 'null'
  }
  if (typeof value === 'number') {
    // 对于浮点数，保留 3 位小数
    if (!Number.isInteger(value)) {
      return value.toFixed(3)
    }
    return String(value)
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false'
  }
  if (Array.isArray(value)) {
    return `[${value.length} items]`
  }
  if (typeof value === 'object') {
    return JSON.stringify(value)
  }
  return String(value)
}

// 格式化十六进制转储（前 64 字节）
const formatHexDump = (data: number[]): string => {
  if (!data || data.length === 0) {
    return '无数据'
  }

  const preview = data.slice(0, 64)
  let output = ''
  for (let i = 0; i < preview.length; i += 16) {
    const chunk = preview.slice(i, i + 16)
    const hexPart = chunk.map((byte) => byte.toString(16).padStart(2, '0').toUpperCase()).join(' ')
    const asciiPart = chunk
      .map((byte) => (byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : '.'))
      .join('')

    output += `${i.toString(16).padStart(4, '0')}  ${hexPart.padEnd(48, ' ')}  ${asciiPart}\n`
  }

  if (data.length > 64) {
    output += `\n... (剩余 ${data.length - 64} 字节未显示)`
  }

  return output
}

// 格式化完整十六进制转储（150 字节）
const formatFullHexDump = (data: number[]): string => {
  if (!data || data.length === 0) {
    return '无数据'
  }

  let output = ''
  for (let i = 0; i < data.length; i += 16) {
    const chunk = data.slice(i, i + 16)
    const hexPart = chunk.map((byte) => byte.toString(16).padStart(2, '0').toUpperCase()).join(' ')
    const asciiPart = chunk
      .map((byte) => (byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : '.'))
      .join('')

    output += `${i.toString(16).padStart(4, '0')}  ${hexPart.padEnd(48, ' ')}  ${asciiPart}\n`
  }

  return output
}

// 自动刷新时间戳
const updateInterval = ref<number | null>(null)

updateInterval.value = window.setInterval(() => {
  // 强制触发计算属性重新计算（通过访问它）
  void lastUpdateTime.value
}, 1000)

onUnmounted(() => {
  if (updateInterval.value !== null) {
    clearInterval(updateInterval.value)
  }
})

/**
 * 生成块的唯一 ID
 */
function getBlockId(imgId: number, blockIdx: number): string {
  return `${imgId}-${blockIdx}`
}

// 监听 imageBlockFields 变化，收集图像块
watch(
  () => imageBlockFields.value,
  (newFields) => {
    console.log(`[watch] 触发，字段数=${Object.keys(newFields).length}`)

    // 遍历所有字段
    for (const [, blockData] of Object.entries(newFields)) {
      const imgId = blockData.img_id
      const blockIdx = blockData.block_idx
      const blockId = getBlockId(imgId, blockIdx)

      // 如果已经处理过这个块，跳过
      if (processedBlockIds.has(blockId)) {
        continue
      }

      // 标记为已处理
      processedBlockIds.add(blockId)

      // 初始化该 img_id 的块映射
      if (!imageBlocksMap.has(imgId)) {
        imageBlocksMap.set(imgId, new Map())
      }

      const blocksForImage = imageBlocksMap.get(imgId)!

      // 存储该块
      blocksForImage.set(blockIdx, blockData)

      // 只在收集齐全时才尝试拼合（避免无效调用）
      const totalBlocks = blockData.total_block
      if (blocksForImage.size === totalBlocks) {
        console.log(
          `[图像块] imgId=${imgId} 已收集齐全 (${blocksForImage.size}/${totalBlocks})，开始拼合`
        )
        assembleImage(imgId)
      }
    }
  },
  { flush: 'post' } // 在 DOM 更新后执行，避免循环
)

// 监听数据变化并打印日志
watch(
  () => currentRobotData.value,
  (newData) => {
    if (newData) {
      console.log('[CustomDataDisplay] 接收到新数据:', newData)
    }
  },
  { deep: true }
)
</script>

<style scoped>
.custom-data-display {
  width: 100%;
  height: 100%;
  background: #0a0e1a;
  color: #fff;
  overflow-y: auto;
  padding: 24px;
}

.header {
  margin-bottom: 32px;
}

.title {
  font-size: 28px;
  font-weight: 700;
  margin: 0 0 8px 0;
  background: linear-gradient(135deg, #3b82f6, #8b5cf6);
  background-clip: text;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

.subtitle {
  font-size: 14px;
  color: rgba(255, 255, 255, 0.6);
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 100px 20px;
  color: rgba(255, 255, 255, 0.4);
  text-align: center;
}

.empty-state svg {
  margin-bottom: 24px;
  opacity: 0.3;
}

.empty-state h3 {
  margin: 0 0 12px 0;
  font-size: 20px;
  color: rgba(255, 255, 255, 0.6);
}

.empty-state p {
  margin: 0 0 24px 0;
  font-size: 14px;
}

.tip {
  display: flex;
  gap: 8px;
  padding: 12px 20px;
  background: rgba(59, 130, 246, 0.1);
  border: 1px solid rgba(59, 130, 246, 0.3);
  border-radius: 8px;
  color: #60a5fa;
  font-size: 13px;
}

.data-container {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.meta-card {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  padding: 20px;
}

.meta-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 16px;
  font-size: 16px;
  font-weight: 600;
  color: #3b82f6;
}

.meta-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 16px;
}

.meta-item {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.meta-label {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.5);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.meta-value {
  font-size: 16px;
  font-weight: 600;
  color: #fff;
}

.mode-badge {
  display: inline-block;
  padding: 4px 12px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
}

.mode-badge.mode-pure {
  background: rgba(34, 197, 94, 0.2);
  color: #22c55e;
  border: 1px solid rgba(34, 197, 94, 0.3);
}

.mode-badge.mode-image {
  background: rgba(139, 92, 246, 0.2);
  color: #8b5cf6;
  border: 1px solid rgba(139, 92, 246, 0.3);
}

.fields-section {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  padding: 20px;
}

.section-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 16px;
  font-size: 15px;
  font-weight: 600;
  color: #8b5cf6;
}

.field-count {
  margin-left: auto;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.5);
  font-weight: 400;
}

.fields-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 12px;
}

.field-card {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  padding: 12px;
  transition: all 0.2s;
}

.field-card:hover {
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(59, 130, 246, 0.3);
}

.field-name {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.6);
  margin-bottom: 6px;
}

.field-value {
  font-size: 16px;
  font-weight: 600;
  color: #3b82f6;
  font-family: 'Monaco', 'Consolas', monospace;
}

.image-mode-section {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.image-block-section {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  padding: 20px;
}

.image-block-meta {
  background: rgba(59, 130, 246, 0.1);
  border: 1px solid rgba(59, 130, 246, 0.2);
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 16px;
}

.meta-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.meta-row:last-child {
  border-bottom: none;
}

.meta-row .meta-label {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.6);
}

.meta-row .meta-value {
  font-size: 14px;
  font-weight: 600;
  color: #60a5fa;
  font-family: 'Monaco', 'Consolas', monospace;
}

.raw-data-preview {
  margin-top: 16px;
}

.raw-data-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.6);
}

.raw-data-length {
  color: #8b5cf6;
  font-weight: 500;
}

.raw-buffer-section {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  padding: 20px;
}

.hex-dump {
  background: #0a0e1a;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  padding: 16px;
  font-family: 'Monaco', 'Consolas', monospace;
  font-size: 12px;
  color: #22c55e;
  white-space: pre;
  overflow-x: auto;
  line-height: 1.6;
}

.hex-dump.full {
  max-height: 600px;
  overflow-y: auto;
}

/* 图像拼合进度 */
.image-assembly-progress {
  margin-top: 16px;
  padding: 16px;
  background: rgba(59, 130, 246, 0.05);
  border: 1px solid rgba(59, 130, 246, 0.2);
  border-radius: 8px;
}

.progress-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
  font-size: 14px;
  color: #e2e8f0;
}

.progress-text {
  font-weight: 600;
  color: #3b82f6;
}

.progress-bar {
  height: 8px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 4px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #3b82f6, #8b5cf6);
  border-radius: 4px;
  transition: width 0.3s ease;
}

.complete-badge {
  margin-top: 8px;
  padding: 6px 12px;
  background: rgba(34, 197, 94, 0.2);
  border: 1px solid rgba(34, 197, 94, 0.4);
  border-radius: 6px;
  color: #22c55e;
  font-size: 13px;
  font-weight: 600;
  text-align: center;
}

/* 拼合图像预览 */
.assembled-image-preview {
  margin-top: 16px;
  padding: 16px;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
}

.image-preview-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
  font-size: 14px;
  color: #e2e8f0;
}

.image-format {
  padding: 4px 12px;
  background: rgba(139, 92, 246, 0.2);
  border: 1px solid rgba(139, 92, 246, 0.4);
  border-radius: 4px;
  color: #a78bfa;
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
}

.preview-image {
  width: 100%;
  max-width: 800px;
  height: auto;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  display: block;
  margin: 0 auto;
}

.image-info {
  margin-top: 12px;
  padding: 8px 12px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 6px;
  text-align: center;
  font-size: 13px;
  color: #94a3b8;
}
</style>
