import * as protobufModule from 'protobufjs/light'
import mqttProtoJson from '../generated/mqtt-proto.json'
import { convertProtobufData, parseTopicType } from '../utils/mqtt_protocol'

const MQTT_KEEP_RAW_PAYLOAD = false

export type ParsedMqttEventPayload = {
  topic: string
  messageType: string
  data: unknown
  raw: string
  timestamp: number
  parseSuccess: boolean
}

let mqttProtoRoot: any | null = null

function getMqttProtoRoot(): any {
  if (!mqttProtoRoot) {
    const protobufRuntime = (protobufModule as any).default ?? protobufModule
    mqttProtoRoot = protobufRuntime.Root.fromJSON(mqttProtoJson)
  }

  return mqttProtoRoot
}

function normalizeBinaryPayload(data: unknown): Uint8Array {
  if (data instanceof Uint8Array) {
    return data
  }

  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data)
  }

  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  }

  if (Array.isArray(data)) {
    return Uint8Array.from(data.map((value) => Number(value) & 0xff))
  }

  if (data && typeof data === 'object') {
    const entries = Object.entries(data)
      .filter(([key, value]) => /^\d+$/.test(key) && typeof value === 'number')
      .sort((a, b) => Number(a[0]) - Number(b[0]))

    if (entries.length > 0) {
      return Uint8Array.from(entries.map(([, value]) => Number(value) & 0xff))
    }
  }

  throw new Error(`Unsupported MQTT payload: ${Object.prototype.toString.call(data)}`)
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000

  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }

  return btoa(binary)
}

function getMqttProtoMessageName(topic: string): string {
  const slashSegment = topic.split('/').pop()?.trim() || topic
  return slashSegment.split('.').pop()?.trim() || slashSegment
}

export async function decodeMqttEventPayload(payload: unknown): Promise<ParsedMqttEventPayload> {
  const topic =
    typeof (payload as { topic?: unknown })?.topic === 'string'
      ? String((payload as { topic: string }).topic)
      : ''
  const timestamp = Date.now()
  const bytes = normalizeBinaryPayload((payload as { payload?: unknown })?.payload)
  const raw = MQTT_KEEP_RAW_PAYLOAD ? bytesToBase64(bytes) : ''
  const messageType = parseTopicType(topic)

  try {
    const root = getMqttProtoRoot()
    const MessageType = root.lookupType(getMqttProtoMessageName(topic))
    const decoded = MessageType.decode(bytes)
    const decodedObject = MessageType.toObject(decoded, {
      longs: String,
      enums: Number,
      bytes: Array
    })
    const converted = convertProtobufData(messageType, decodedObject)

    return {
      topic,
      messageType,
      data: converted ?? decodedObject,
      raw,
      timestamp,
      parseSuccess: true
    }
  } catch (error) {
    try {
      const decodedText = new TextDecoder().decode(bytes)
      const parsedJson = JSON.parse(decodedText)

      return {
        topic,
        messageType,
        data: parsedJson,
        raw,
        timestamp,
        parseSuccess: true
      }
    } catch {
      console.warn('[MQTT] Failed to decode payload:', topic, error)

      return {
        topic,
        messageType,
        data: null,
        raw,
        timestamp,
        parseSuccess: false
      }
    }
  }
}
