import { decodeMqttEventPayload, type ParsedMqttEventPayload } from './mqttPayloadDecoder'

type DecodeRequest = {
  id: number
  payloads: unknown[]
}

type DecodeResponse = {
  id: number
  messages: ParsedMqttEventPayload[]
}

self.onmessage = (event: MessageEvent<DecodeRequest>) => {
  const { id, payloads } = event.data

  void (async () => {
    const messages: ParsedMqttEventPayload[] = []

    for (const payload of payloads) {
      messages.push(await decodeMqttEventPayload(payload))
    }

    self.postMessage({
      id,
      messages
    } satisfies DecodeResponse)
  })()
}
