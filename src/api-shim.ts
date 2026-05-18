import { Channel, invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Buffer } from 'buffer';
import type { ParsedMqttEventPayload } from './mqtt/mqttPayloadDecoder';

type CommandResult = {
  success: boolean;
  error?: string;
  [key: string]: unknown;
};

function toCommandResult(result: unknown): CommandResult {
  if (typeof result === 'boolean') {
    return { success: result };
  }

  if (result && typeof result === 'object' && 'success' in result) {
    const typedResult = result as Record<string, unknown>;
    return {
      ...typedResult,
      success: Boolean(typedResult.success),
      error: typeof typedResult.error === 'string' ? typedResult.error : undefined
    };
  }

  return { success: Boolean(result) };
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) {
      return message;
    }
  }

  return String(error);
}

function normalizeUint8Array(data: unknown): Uint8Array {
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }

  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }

  if (Array.isArray(data)) {
    return new Uint8Array(data);
  }

  if (data && typeof data === 'object') {
    const entries = Object.entries(data)
      .filter(([key, value]) => /^\d+$/.test(key) && typeof value === 'number')
      .sort((a, b) => Number(a[0]) - Number(b[0]));

    if (entries.length > 0) {
      return new Uint8Array(entries.map(([, value]) => value));
    }
  }

  throw new Error(`Unsupported UDP frame payload: ${Object.prototype.toString.call(data)}`);
}

function normalizeBinaryPayload(data: unknown): Uint8Array {
  if (data instanceof Uint8Array) {
    return data;
  }

  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }

  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }

  if (Array.isArray(data)) {
    return Uint8Array.from(data.map((value) => Number(value) & 0xff));
  }

  if (data && typeof data === 'object') {
    const entries = Object.entries(data)
      .filter(([key, value]) => /^\d+$/.test(key) && typeof value === 'number')
      .sort((a, b) => Number(a[0]) - Number(b[0]));

    if (entries.length > 0) {
      return Uint8Array.from(entries.map(([, value]) => Number(value) & 0xff));
    }
  }

  throw new Error(`Unsupported MQTT payload: ${Object.prototype.toString.call(data)}`);
}

export interface UdpFrameInfo {
  type: string; // 'jpeg' | 'h264' | 'h265' | 'unknown'
  isKeyframe: boolean;
}

let udpFrameCallback: ((frame: { data: Uint8Array; info: UdpFrameInfo }) => void) | null = null;
let udpFrameGeneration = 0;

// ==================== Binary Frame Protocol ====================
//
// Compact (4-byte) header: JPEG / H.264 / H.265 passthrough.
//   [type: u8] [is_keyframe: u8] [reserved: u16] [payload...]
//
// Type codes:
//   0x00 = jpeg, 0x01 = h264, 0x02 = h265, 0xFF = unknown

const FRAME_TYPE_LABEL: Record<number, string> = {
  0x00: 'jpeg',
  0x01: 'h264',
  0x02: 'h265',
  0xff: 'unknown'
};
const IPC_HEADER_SIZE = 4;

function dispatchChannelFrame(raw: unknown, generation: number): void {
  if (!udpFrameCallback || generation !== udpFrameGeneration) {
    return;
  }

  try {
    const u8 =
      typeof raw === 'string'
        ? Buffer.from(raw, 'base64')
        : normalizeUint8Array(raw);
    if (u8.byteLength < IPC_HEADER_SIZE) {
      throw new Error(`Frame too small: ${u8.byteLength}B`);
    }

    const typeCode = u8[0];
    const isKeyframe = u8[1] === 1;

    const payload = u8.subarray(IPC_HEADER_SIZE);
    udpFrameCallback({
      data: payload,
      info: {
        type: FRAME_TYPE_LABEL[typeCode] ?? 'unknown',
        isKeyframe
      }
    });
  } catch (error) {
    console.error('[UDP] Failed to dispatch binary frame:', error);
  }
}

type MqttStatusPayload = {
  status: 'disconnected' | 'connecting' | 'connected' | 'error';
  connected: boolean;
};

const MQTT_WORKER_BATCH_SIZE = 128;
const MQTT_RAW_QUEUE_MAX_LENGTH = 4096;
const MQTT_RESULT_FRAME_BUDGET_MS = 8;
const MQTT_RESULT_MAX_MESSAGES_PER_FRAME = 32;
const MQTT_RESULT_QUEUE_MAX_LENGTH = 4096;

let mqttProtoRootPromise: Promise<import('protobufjs/light').Root> | null = null;

function getMqttProtoRoot(): Promise<import('protobufjs/light').Root> {
  if (!mqttProtoRootPromise) {
    mqttProtoRootPromise = Promise.all([
      import('protobufjs/light'),
      import('./generated/mqtt-proto.json')
    ]).then(([protobufModule, protoJsonModule]) => {
      const protobufRuntime = (protobufModule as any).default ?? protobufModule;
      return protobufRuntime.Root.fromJSON(protoJsonModule.default);
    });
  }

  return mqttProtoRootPromise;
}

function readRecordNumber(record: Record<string, unknown>, camelKey: string, snakeKey: string): number {
  const value = record[camelKey] ?? record[snakeKey] ?? 0;

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Invalid KeyboardMouseControl payload: ${camelKey} must be a finite number`);
  }

  return Math.trunc(value);
}

function readRecordBool(record: Record<string, unknown>, camelKey: string, snakeKey: string): boolean {
  const value = record[camelKey] ?? record[snakeKey] ?? false;

  if (typeof value !== 'boolean') {
    throw new Error(`Invalid KeyboardMouseControl payload: ${camelKey} must be a boolean`);
  }

  return value;
}

function writeVarint32(bytes: number[], value: number): void {
  let unsignedValue = value >>> 0;

  while (unsignedValue > 0x7f) {
    bytes.push((unsignedValue & 0x7f) | 0x80);
    unsignedValue >>>= 7;
  }

  bytes.push(unsignedValue);
}

function writeInt32Varint(bytes: number[], value: number): void {
  if (value >= 0) {
    writeVarint32(bytes, value);
    return;
  }

  let unsignedValue = BigInt.asUintN(64, BigInt(value));

  while (unsignedValue > 0x7fn) {
    bytes.push(Number((unsignedValue & 0x7fn) | 0x80n));
    unsignedValue >>= 7n;
  }

  bytes.push(Number(unsignedValue));
}

function writeBoolVarint(bytes: number[], value: boolean): void {
  bytes.push(value ? 1 : 0);
}

function encodeKeyboardMouseControlPayload(payload: unknown): Uint8Array {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Invalid KeyboardMouseControl payload: payload must be an object');
  }

  const record = payload as Record<string, unknown>;
  const mouseX = readRecordNumber(record, 'mouseX', 'mouse_x');
  const mouseY = readRecordNumber(record, 'mouseY', 'mouse_y');
  const mouseZ = readRecordNumber(record, 'mouseZ', 'mouse_z');
  const keyboardValue = readRecordNumber(record, 'keyboardValue', 'keyboard_value');
  const leftButtonDown = readRecordBool(record, 'leftButtonDown', 'left_button_down');
  const rightButtonDown = readRecordBool(record, 'rightButtonDown', 'right_button_down');
  const midButtonDown = readRecordBool(record, 'midButtonDown', 'mid_button_down');

  if (
    mouseX < -0x80000000 ||
    mouseX > 0x7fffffff ||
    mouseY < -0x80000000 ||
    mouseY > 0x7fffffff ||
    mouseZ < -0x80000000 ||
    mouseZ > 0x7fffffff
  ) {
    throw new Error('Invalid KeyboardMouseControl payload: mouse fields must fit int32');
  }

  if (keyboardValue < 0 || keyboardValue > 0xffffffff) {
    throw new Error('Invalid KeyboardMouseControl payload: keyboardValue must fit uint32');
  }

  const bytes: number[] = [];

  bytes.push(0x08);
  writeInt32Varint(bytes, mouseX);
  bytes.push(0x10);
  writeInt32Varint(bytes, mouseY);
  bytes.push(0x18);
  writeInt32Varint(bytes, mouseZ);
  bytes.push(0x20);
  writeBoolVarint(bytes, leftButtonDown);
  bytes.push(0x28);
  writeBoolVarint(bytes, rightButtonDown);
  bytes.push(0x30);
  writeVarint32(bytes, keyboardValue);
  bytes.push(0x38);
  writeBoolVarint(bytes, midButtonDown);

  return new Uint8Array(bytes);
}

function normalizeMqttStatusPayload(payload: unknown): MqttStatusPayload {
  if (payload && typeof payload === 'object') {
    const typedPayload = payload as Partial<MqttStatusPayload>;
    const status =
      typedPayload.status === 'connected' ||
      typedPayload.status === 'connecting' ||
      typedPayload.status === 'error' ||
      typedPayload.status === 'disconnected'
        ? typedPayload.status
        : typedPayload.connected
          ? 'connected'
          : 'disconnected';

    return {
      status,
      connected: Boolean(typedPayload.connected ?? (status === 'connected'))
    };
  }

  return {
    status: Boolean(payload) ? 'connected' : 'disconnected',
    connected: Boolean(payload)
  };
}

function normalizeLocalBrokerStatus(payload: unknown): { status: string; port: number } {
  if (payload && typeof payload === 'object') {
    const typedPayload = payload as { status?: unknown; port?: unknown };
    return {
      status: typeof typedPayload.status === 'string' ? typedPayload.status : 'stopped',
      port: typeof typedPayload.port === 'number' ? typedPayload.port : 3333
    };
  }

  return { status: 'stopped', port: 3333 };
}

async function encodeMqttCommandPayload(messageType: string, payload: unknown): Promise<Uint8Array> {
  if (messageType === 'KeyboardMouseControl') {
    return encodeKeyboardMouseControlPayload(payload);
  }

  const root = await getMqttProtoRoot();
  const MessageType = root.lookupType(messageType);
  const errMsg = MessageType.verify(payload as Record<string, unknown>);

  if (errMsg) {
    throw new Error(`Invalid ${messageType} payload: ${errMsg}`);
  }

  const message = MessageType.fromObject(payload as Record<string, unknown>);
  return MessageType.encode(message).finish();
}

function normalizeMqttEventBatch(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (payload && typeof payload === 'object') {
    const typedPayload = payload as { messages?: unknown; items?: unknown };
    if (Array.isArray(typedPayload.messages)) {
      return typedPayload.messages;
    }
    if (Array.isArray(typedPayload.items)) {
      return typedPayload.items;
    }
  }

  return payload ? [payload] : [];
}

function createMqttMessageQueue(cb: (payload: ParsedMqttEventPayload) => void): {
  enqueue(payload: unknown): void;
  dispose(): void;
} {
  type WorkerResponse = {
    id: number;
    messages: ParsedMqttEventPayload[];
  };

  const rawQueue: unknown[] = [];
  const resultQueue: ParsedMqttEventPayload[] = [];
  let rawReadIndex = 0;
  let resultReadIndex = 0;
  let worker: Worker | null = null;
  let workerBusy = false;
  let nextWorkerRequestId = 0;
  let resultPumpScheduled = false;
  let resultPumpRunning = false;
  let disposed = false;

  const pendingRawCount = (): number => rawQueue.length - rawReadIndex;
  const pendingResultCount = (): number => resultQueue.length - resultReadIndex;

  const compactRawQueue = (): void => {
    if (rawReadIndex === 0) return;
    rawQueue.splice(0, rawReadIndex);
    rawReadIndex = 0;
  };

  const compactResultQueue = (): void => {
    if (resultReadIndex === 0) return;
    resultQueue.splice(0, resultReadIndex);
    resultReadIndex = 0;
  };

  const trimRawQueue = (): void => {
    const overflow = pendingRawCount() - MQTT_RAW_QUEUE_MAX_LENGTH;
    if (overflow <= 0) return;
    rawReadIndex += overflow;
    compactRawQueue();
    console.warn(`[MQTT] Dropped ${overflow} raw messages before worker decode`);
  };

  const trimResultQueue = (): void => {
    const overflow = pendingResultCount() - MQTT_RESULT_QUEUE_MAX_LENGTH;
    if (overflow <= 0) return;
    resultReadIndex += overflow;
    compactResultQueue();
    console.warn(`[MQTT] Dropped ${overflow} decoded messages before UI update`);
  };

  const scheduleResultPump = (): void => {
    if (resultPumpScheduled || resultPumpRunning || disposed) return;
    resultPumpScheduled = true;
    window.requestAnimationFrame(() => {
      resultPumpScheduled = false;
      drainResults();
    });
  };

  const ensureWorker = (): Worker => {
    if (worker) {
      return worker;
    }

    worker = new Worker(new URL('./mqtt/mqttDecoder.worker.ts', import.meta.url), {
      type: 'module'
    });

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      workerBusy = false;
      if (disposed) return;

      resultQueue.push(...event.data.messages);
      trimResultQueue();
      scheduleResultPump();
      pumpWorker();
    };

    worker.onerror = (event) => {
      workerBusy = false;
      console.warn('[MQTT] Decoder worker error:', event.message);
      pumpWorker();
    };

    return worker;
  };

  const takeRawBatch = (): unknown[] => {
    const batch: unknown[] = [];

    while (pendingRawCount() > 0 && batch.length < MQTT_WORKER_BATCH_SIZE) {
      batch.push(rawQueue[rawReadIndex++]);
    }

    if (rawReadIndex > 512 || rawReadIndex >= rawQueue.length) {
      compactRawQueue();
    }

    return batch;
  };

  const pumpWorker = (): void => {
    if (disposed || workerBusy || pendingRawCount() <= 0) return;

    const batch = takeRawBatch();
    if (batch.length === 0) return;

    workerBusy = true;
    ensureWorker().postMessage({
      id: ++nextWorkerRequestId,
      payloads: batch
    });
  };

  const drainResults = (): void => {
    if (resultPumpRunning || disposed) return;
    resultPumpRunning = true;
    const startedAt = performance.now();
    let processed = 0;

    try {
      while (
        pendingResultCount() > 0 &&
        processed < MQTT_RESULT_MAX_MESSAGES_PER_FRAME &&
        performance.now() - startedAt < MQTT_RESULT_FRAME_BUDGET_MS
      ) {
        const next = resultQueue[resultReadIndex++];
        if (!next) continue;
        cb(next);
        processed += 1;
      }
    } finally {
      if (resultReadIndex > 512 || resultReadIndex >= resultQueue.length) {
        compactResultQueue();
      }
      resultPumpRunning = false;
      if (pendingResultCount() > 0 && !disposed) {
        scheduleResultPump();
      }
    }
  };

  return {
    enqueue(payload: unknown): void {
      if (disposed) return;
      rawQueue.push(...normalizeMqttEventBatch(payload));
      trimRawQueue();
      pumpWorker();
    },
    dispose(): void {
      disposed = true;
      rawQueue.length = 0;
      resultQueue.length = 0;
      worker?.terminate();
      worker = null;
    }
  };
}

// @ts-ignore - Ignore complex type issues temporarily for Phase 1

// Frontend-side F11 handler (registered on demand via setF11Shortcut).
// Uses capture phase + preventDefault to beat the webview's default handler.
let f11KeyHandler: ((ev: KeyboardEvent) => void) | null = null;
function installF11Handler(): void {
  if (f11KeyHandler) return;
  const handler = (ev: KeyboardEvent): void => {
    if (ev.key === 'F11' && !ev.repeat) {
      ev.preventDefault();
      ev.stopPropagation();
      invoke('toggle_fullscreen').catch((err) => {
        console.error('[F11] toggle_fullscreen failed:', err);
      });
    }
  };
  window.addEventListener('keydown', handler, { capture: true });
  f11KeyHandler = handler;
}
function uninstallF11Handler(): void {
  if (!f11KeyHandler) return;
  window.removeEventListener('keydown', f11KeyHandler, { capture: true } as unknown as EventListenerOptions);
  f11KeyHandler = null;
}

const api: any = {
  selectDirectory: async () => await invoke('select_directory'),
  selectFile: async () => await invoke('select_file'),
  sendRobotCommand: async (cmd: string, payload?: any) => { console.log("MOCK: sendRobotCommand", cmd, payload); },
  invokeRobot: async (method: string, ...args: any[]) => { console.log("MOCK: invokeRobot", method, args); },
  onTelemetry: (_cb: any) => { return () => {}; },
  
  getBoundaryCorners: async () => [],
  setBoundaryCorners: async (_corners: any) => {},
  
  getSetting: async (key: string) => await invoke('get_setting', { key }),
  saveSetting: async (key: string, value: any) => await invoke('save_setting', { key, value }),
  
  getModelPath: async (relativePath: string) => `/${relativePath}`,
  readModelFile: async (relativePath: string) => {
    try {
        const res = await fetch(`/${relativePath}`);
        if (!res.ok) return null;
        return new Uint8Array(await res.arrayBuffer());
    } catch {
        return null;
    }
  },
  getPreloadedModel: async () => null,
  isModelPreloaded: async () => false,
  
  getCrosshairPresets: async () => [],
  saveCrosshairPreset: async (_preset: any) => {},
  deleteCrosshairPreset: async (_presetName: string) => {},
  
  getCustomDataBlocks: async () => [],
  saveCustomDataBlocks: async (_blocks: any) => {},
  syncSendDataProto: async (_blocks: any) => {},
  parseCustomData: async (_protoPath: string, _buffer: Uint8Array) => null,
  
  getAppInfo: async () => ({ version: "2.0.0" }),
  getRobotTypes: async () => await invoke('get_robot_types'),
  getRobotConfig: async () => await invoke('get_robot_config'),
  getRobotConfigByName: async (name: string) => await invoke('get_robot_config_by_name', { name }),
  readYamlConfig: async (filename: string) => await invoke('read_yaml_config', { filename }),
  
  hud: {
    getTemplates: async () => await invoke('hud_get_templates'),
    saveTemplate: async (filename: string, content: string) =>
      await invoke('hud_save_template', { filename, content }),
    updateTemplateTitle: async (id: string, title: string) =>
      await invoke('hud_update_template_title', { id, title }),
    deleteTemplate: async (id: string) => await invoke('hud_delete_template', { id }),
    onTemplateChanged: (cb: any) => {
      let unlisten: any;
      listen('hud-template-changed', (event) => cb(event.payload)).then(u => unlisten = u);
      return () => unlisten?.();
    }
  },
  
  dashboardConfig: {
    list: async () => await invoke('dashboard_config_list'),
    load: async (filename: string) => await invoke('dashboard_config_load', { filename }),
    save: async (filename: string, content: string) => await invoke('dashboard_config_save', { filename, content }),
    delete: async (filename: string) => await invoke('dashboard_config_delete', { filename }),
    checkPanelUsage: async (panelId: string) => await invoke('dashboard_config_check_panel_usage', { panelId })
  },
  
  graphic: {
    getAllCategories: async () => await invoke('graphic_get_all_categories'),
    getList: async () => await invoke('graphic_get_list'),
    save: async (filename: string, content: string) =>
      await invoke('graphic_save', { filename, content }),
    delete: async (filename: string) => await invoke('graphic_delete', { filename }),
    rename: async (oldName: string, newName: string) =>
      await invoke('graphic_rename', { oldName, newName })
  },
  
  saveTerrainData: async (_data: any) => {},
  loadTerrainData: async () => null,
  
  mapConfig: {
    list: async () => [],
    load: async (_filename: string) => null,
    detect: async (_data: any) => {},
    sendProtocolData: async (_data: unknown) => {},
    delete: async (_filename: string) => {}
  },
  
  openDevTools: async () => {
    try {
      await invoke('open_devtools');
    } catch (err) {
      console.warn('[devtools] open failed:', err);
    }
  },
  closeDevTools: async () => {},
  isDevToolsOpened: async () => false,
  setF11Shortcut: (enabled: boolean) => {
    if (enabled) {
      installF11Handler();
    } else {
      uninstallF11Handler();
    }
  },
  toggleFullscreen: async () => await invoke('toggle_fullscreen'),
  setFullscreen: async (fullscreen: boolean) =>
    await invoke('set_fullscreen', { fullscreen }),
  logWorkerMessage: () => {},
  getRandomBytes: (size: number) => new Uint8Array(size),
  readVideoFile: async (_filePath: string) => {
    // Return empty array for now or fetch if it's relative
    return new Uint8Array();
  },
  
  setMatchStatus: () => {},
  onMatchStatusChanged: () => { return () => {}; },
  minimize: async () => {
    try { await invoke('window_minimize'); } catch (err) { console.warn('[window] minimize failed:', err); }
  },
  maximize: async () => {
    try { await invoke('window_toggle_maximize'); } catch (err) { console.warn('[window] toggle maximize failed:', err); }
  },
  close: async () => {
    try { await invoke('app_close'); } catch (err) { console.warn('[window] close failed:', err); }
  },
  onMaximizedStateChanged: () => { return () => {}; },
  
  shm: {
    connect: async () => {
      try {
        return await invoke<boolean>('shm_connect');
      } catch (err) {
        console.error('[shm] connect failed:', err);
        return false;
      }
    },
    disconnect: async () => {
      try {
        return await invoke<boolean>('shm_disconnect');
      } catch (err) {
        console.error('[shm] disconnect failed:', err);
        return false;
      }
    },
    status: async () => {
      try {
        return await invoke('shm_status');
      } catch {
        return { connected: false, metrics: null };
      }
    },
    /**
     * Send a detection request to the external script. Rust upgrades image
     * payloads to shared memory on Windows and uses the pipe as control IPC.
     */
    sendProtocolData: async (data: unknown) => {
      return await invoke('shm_detect', { data });
    },
    detectLatestMjpeg: async (data: unknown) => {
      return await invoke('shm_detect_latest_mjpeg', { data });
    }
  },

  /**
   * External detection script lifecycle.
   */
  pipeServer: {
    downloadFile: async (_path: string) => ({ success: true }),
    start: async (path = 'AI Server') => {
      return await invoke('pipe_server_start', { path });
    },
    stop: async () => await invoke<boolean>('pipe_server_stop'),
    getStatus: async () => await invoke('pipe_server_get_status'),
    onStatusChanged: (cb: (status: string, message?: string) => void) => {
      let unlisten: any;
      listen('pipe-server-status', (event) => {
        const payload = event.payload as { status?: unknown; message?: unknown };
        cb(String(payload?.status ?? 'stopped'), String(payload?.message ?? ''));
      }).then(u => unlisten = u);
      return () => unlisten?.();
    }
  },
  
  udpStream: {
    getDecodeCapabilities: async () => await invoke('get_decode_capabilities'),
    start: async (config: any) => {
      try {
        const generation = ++udpFrameGeneration;
        // Raw bytes channel carrying [type, keyframe, 0, 0, payload...].
        const frameChannel = new Channel<unknown>((message) => {
          dispatchChannelFrame(message, generation);
        });

        return toCommandResult(await invoke('udp_stream_start', { config, frameChannel }));
      } catch (error) {
        return {
          success: false,
          error: getErrorMessage(error)
        };
      }
    },
    stop: async () => {
      try {
        udpFrameGeneration++;
        udpFrameCallback = null;
        return toCommandResult(await invoke('udp_stream_stop'));
      } catch (error) {
        return {
          success: false,
          error: getErrorMessage(error)
        };
      }
    },
    getStatus: async () => await invoke('udp_stream_get_status'),
    getLatestMjpegFrame: async () => await invoke('udp_stream_get_latest_mjpeg_frame'),
    onFrame: async (cb: any) => {
        udpFrameCallback = cb;
        return () => {
          if (udpFrameCallback === cb) {
            udpFrameCallback = null;
          }
        };
    },
    onError: (cb: any) => {
        let unlisten: any;
        listen('udp-stream-error', (event) => cb(event.payload)).then(u => unlisten = u);
        return () => unlisten?.();
    },
    onStats: (cb: any) => {
        let unlisten: any;
        listen('udp-stream-stats', (event) => cb(event.payload)).then(u => unlisten = u);
        return () => unlisten?.();
    }
  },
  
  startSignalingServer: async () => {},
  stopSignalingServer: async () => {},
  
  getVehicleAttitudeMap: async (_vehicleId: number) => null,
  listVehiclePhysicsConfigs: async () => [],
  
  onSignalingStatus: () => { return () => {}; },
  onSignalingOffer: () => { return () => {}; },
  sendSignalingAnswer: () => {},
  sendSignalingCandidate: () => {},
  
  mqtt: {
    connect: async (config: any) => await invoke('mqtt_connect', { config }),
    disconnect: async () => await invoke('mqtt_disconnect'),
    publish: async (data: any) => {
      try {
        const payload = await encodeMqttCommandPayload(
          data.messageType || data.topic,
          data.payload ?? {}
        );
        const result = await invoke('mqtt_publish', {
          data: {
            topic: data.topic,
            payload: Array.from(payload),
            qos: data.qos ?? 1,
            retain: data.retain ?? false
          }
        });

        return toCommandResult(result);
      } catch (error) {
        return {
          success: false,
          error: getErrorMessage(error)
        };
      }
    },
    publishRaw: async (data: any) => {
      try {
        const payloadBytes = data.payload instanceof Uint8Array
          ? Array.from(data.payload)
          : Array.isArray(data.payload)
            ? data.payload
            : Array.from(normalizeBinaryPayload(data.payload));
        const result = await invoke('mqtt_publish_raw', {
          data: {
            topic: data.topic,
            payload: payloadBytes,
            qos: data.qos ?? 1,
            retain: data.retain ?? false
          }
        });
        return toCommandResult(result);
      } catch (error) {
        return {
          success: false,
          error: getErrorMessage(error)
        };
      }
    },
    subscribe: async (topics: any) => await invoke('mqtt_subscribe', { topics }),
    unsubscribe: async (topics: any) => await invoke('mqtt_unsubscribe', { topics }),
    getStatus: async () => normalizeMqttStatusPayload(await invoke('mqtt_get_status')),
    onStatus: (cb: any) => {
        let unlisten: any;
        listen('mqtt-status', (event) => cb(normalizeMqttStatusPayload(event.payload))).then(u => unlisten = u);
        return () => unlisten?.();
    },
    onMessage: (cb: any) => { 
        let unlistenSingle: any;
        let unlistenBatch: any;
        const queue = createMqttMessageQueue(cb);
        listen('mqtt-message', (event) => queue.enqueue(event.payload)).then(u => unlistenSingle = u);
        listen('mqtt-message-batch', (event) => queue.enqueue(event.payload)).then(u => unlistenBatch = u);
        return () => {
          queue.dispose();
          unlistenSingle?.();
          unlistenBatch?.();
        };
    },
    onRobotStatus: () => { return () => {}; },
    onDetectionList: () => { return () => {}; },
    onRadarData: () => { return () => {}; },
    onHeartbeat: () => { return () => {}; },
    startLocalBroker: async (port: number) => toCommandResult(await invoke('mqtt_start_local_broker', { port })),
    stopLocalBroker: async () => await invoke('mqtt_stop_local_broker'),
    getLocalBrokerStatus: async () => normalizeLocalBrokerStatus(await invoke('mqtt_get_local_broker_status')),
    onLocalBrokerStatus: () => { return () => {}; },
    getStats: async () => await invoke('mqtt_get_stats'),
    resetStats: async () => toCommandResult(await invoke('mqtt_reset_stats'))
  }
};

(window as any).api = api;
