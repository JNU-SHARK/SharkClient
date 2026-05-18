/**
 * 手动 Protobuf 编码器
 * 完全符合 Protocol Buffers 规范，不使用 eval() 以满足 CSP 安全策略
 */

export interface DataBlock {
  id: string
  dataId: string
  dataName: string
  dataDesc: string
  dataType: number
  sendFreq: number
  deviceId: string
  value: string | number | boolean | Uint8Array
  timestamp: number
}

/**
 * Protobuf Writer - 低级别编码器
 */
class ProtobufWriter {
  private buffer: number[] = []

  /**
   * 写入 Varint 编码的整数
   */
  writeVarint(value: number): void {
    while (value > 127) {
      this.buffer.push((value & 0x7f) | 0x80)
      value >>>= 7
    }
    this.buffer.push(value & 0x7f)
  }

  /**
   * 写入 ZigZag 编码的有符号整数
   */
  writeZigZag(value: number): void {
    this.writeVarint((value << 1) ^ (value >> 31))
  }

  /**
   * 写入 32 位固定长度整数
   */
  writeFixed32(value: number): void {
    this.buffer.push(
      value & 0xff,
      (value >>> 8) & 0xff,
      (value >>> 16) & 0xff,
      (value >>> 24) & 0xff
    )
  }

  /**
   * 写入 64 位固定长度整数
   */
  writeFixed64(value: number): void {
    const low = value >>> 0
    const high = (value / 0x100000000) >>> 0
    this.writeFixed32(low)
    this.writeFixed32(high)
  }

  /**
   * 写入字符串字段
   */
  writeString(fieldNumber: number, value: string): void {
    if (!value) return
    this.writeVarint((fieldNumber << 3) | 2) // wire type 2 (length-delimited)
    const bytes = new TextEncoder().encode(value)
    this.writeVarint(bytes.length)
    this.buffer.push(...bytes)
  }

  /**
   * 写入无符号 32 位整数字段
   */
  writeUint32(fieldNumber: number, value: number): void {
    this.writeVarint((fieldNumber << 3) | 0) // wire type 0 (varint)
    this.writeVarint(value)
  }

  /**
   * 写入无符号 64 位整数字段
   */
  writeUint64(fieldNumber: number, value: number): void {
    this.writeVarint((fieldNumber << 3) | 0)
    this.writeVarint(value)
  }

  /**
   * 写入有符号 32 位整数字段（ZigZag 编码）
   */
  writeSint32(fieldNumber: number, value: number): void {
    this.writeVarint((fieldNumber << 3) | 0)
    this.writeZigZag(value)
  }

  /**
   * 写入 32 位浮点数字段
   */
  writeFloat(fieldNumber: number, value: number): void {
    this.writeVarint((fieldNumber << 3) | 5) // wire type 5 (32-bit)
    const view = new DataView(new ArrayBuffer(4))
    view.setFloat32(0, value, true) // little-endian
    this.buffer.push(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3))
  }

  /**
   * 写入布尔值字段
   */
  writeBool(fieldNumber: number, value: boolean): void {
    this.writeVarint((fieldNumber << 3) | 0)
    this.buffer.push(value ? 1 : 0)
  }

  /**
   * 写入字节数组字段
   */
  writeBytes(fieldNumber: number, value: Uint8Array): void {
    if (!value || value.length === 0) return
    this.writeVarint((fieldNumber << 3) | 2)
    this.writeVarint(value.length)
    this.buffer.push(...value)
  }

  /**
   * 写入嵌套消息字段
   */
  writeMessage(fieldNumber: number, messageBytes: Uint8Array): void {
    this.writeVarint((fieldNumber << 3) | 2)
    this.writeVarint(messageBytes.length)
    this.buffer.push(...messageBytes)
  }

  /**
   * 完成编码，返回最终字节数组
   */
  finish(): Uint8Array {
    return new Uint8Array(this.buffer)
  }
}

/**
 * 编码 CustomDataBlock (所有数据在一个大块中)
 *
 * 智能拼合策略：
 * - FLAG(1bit), INT8(8bit), INT16(16bit) 自动拼合到 int32 字段中
 * - 其他类型单独占用一个字段
 * - 字段编号从 1 开始顺序递增
 */
export function encodeCustomDataBlock(blocks: DataBlock[]): Uint8Array {
  const writer = new ProtobufWriter()

  let fieldNumber = 1
  let currentPackedValue = 0
  let currentBitOffset = 0
  let hasPackedData = false

  // 数据类型位大小映射
  const typeSizes: Record<number, number> = {
    0: 1, // FLAG
    2: 8, // INT8
    3: 16 // INT16
  }

  for (const block of blocks) {
    const bitSize = typeSizes[block.dataType]

    if (bitSize) {
      // 可拼合类型
      // 检查是否需要刷新当前桶
      if (currentBitOffset + bitSize > 32) {
        if (hasPackedData) {
          writer.writeSint32(fieldNumber++, currentPackedValue)
          currentPackedValue = 0
          currentBitOffset = 0
          hasPackedData = false
        }
      }

      // 处理值
      let value = 0
      if (block.dataType === 0) {
        value = block.value ? 1 : 0
      } else {
        value = Number(block.value)
      }

      // 掩码处理（确保只取低位）
      // 注意：JS位运算会自动转换为32位整数
      const mask = (1 << bitSize) - 1
      value = value & mask

      // 拼合
      currentPackedValue |= value << currentBitOffset
      currentBitOffset += bitSize
      hasPackedData = true
    } else {
      // 不可拼合类型，先刷新之前的拼合块
      if (hasPackedData) {
        writer.writeSint32(fieldNumber++, currentPackedValue)
        currentPackedValue = 0
        currentBitOffset = 0
        hasPackedData = false
      }

      // 写入单独字段
      switch (block.dataType) {
        case 1: // UINT
          writer.writeUint64(fieldNumber++, Number(block.value))
          break
        case 4: // INT32
          writer.writeSint32(fieldNumber++, Number(block.value))
          break
        case 5: // STRING
          writer.writeString(fieldNumber++, String(block.value))
          break
        case 6: // FLOAT
          writer.writeFloat(fieldNumber++, Number(block.value))
          break
        case 7: // BYTES
          try {
            const bytes = Uint8Array.from(atob(String(block.value)), (c) => c.charCodeAt(0))
            writer.writeBytes(fieldNumber++, bytes)
          } catch {
            writer.writeBytes(fieldNumber++, new Uint8Array(0))
          }
          break
        case 8: // VIDEO
          try {
            // 视频流数据也作为 BYTES 处理
            // 如果 value 是 Base64 字符串，则解码；否则尝试直接作为 Uint8Array
            if (typeof block.value === 'string') {
              const bytes = Uint8Array.from(atob(block.value), (c) => c.charCodeAt(0))
              writer.writeBytes(fieldNumber++, bytes)
            } else if (block.value && typeof block.value === 'object' && 'length' in block.value) {
              // 简单的 duck typing 检查是否为类数组对象 (Uint8Array)
              writer.writeBytes(fieldNumber++, block.value as Uint8Array)
            } else {
              writer.writeBytes(fieldNumber++, new Uint8Array(0))
            }
          } catch {
            writer.writeBytes(fieldNumber++, new Uint8Array(0))
          }
          break
      }
    }
  }

  // 刷新最后残留的拼合块
  if (hasPackedData) {
    writer.writeSint32(fieldNumber++, currentPackedValue)
  }

  return writer.finish()
}
