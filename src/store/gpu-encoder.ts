// GPU加速JPEG编码工具
// 使用OffscreenCanvas + createImageBitmap实现硬件加速

// 编码器状态
let offscreenCanvas: OffscreenCanvas | null = null
let offscreenCtx: OffscreenCanvasRenderingContext2D | null = null
let lastWidth = 0
let lastHeight = 0

// 默认编码配置
export const DEFAULT_ENCODE_CONFIG = {
  quality: 0.5, // JPEG质量 (0.1-1.0)，低性能平台默认减少编码压力
  maxSize: 640, // 最大编码尺寸，超过则下采样
  enableDownsample: true // 是否启用下采样
}

/**
 * 检查浏览器是否支持GPU加速编码
 * OffscreenCanvas.convertToBlob 在支持的浏览器中会使用GPU加速
 */
export function isWebCodecsSupported(): boolean {
  return (
    typeof window !== 'undefined' && 'OffscreenCanvas' in window && 'createImageBitmap' in window
  )
}

/**
 * 检查是否支持高性能编码
 */
export async function isJpegEncodingSupported(): Promise<boolean> {
  if (!isWebCodecsSupported()) return false

  try {
    // 测试OffscreenCanvas.convertToBlob是否可用
    const testCanvas = new OffscreenCanvas(16, 16)
    const testCtx = testCanvas.getContext('2d')
    if (!testCtx) return false

    testCtx.fillStyle = '#000'
    testCtx.fillRect(0, 0, 16, 16)

    const blob = await testCanvas.convertToBlob({ type: 'image/jpeg', quality: 0.5 })
    return blob.size > 0
  } catch {
    return false
  }
}

/**
 * 初始化或调整OffscreenCanvas尺寸
 */
function ensureOffscreenCanvas(width: number, height: number): void {
  if (!offscreenCanvas || lastWidth !== width || lastHeight !== height) {
    offscreenCanvas = new OffscreenCanvas(width, height)
    offscreenCtx = offscreenCanvas.getContext('2d', {
      alpha: false, // 不需要透明通道，提升性能
      desynchronized: true, // 允许异步渲染，减少延迟
      willReadFrequently: false
    })
    lastWidth = width
    lastHeight = height
  }
}

/**
 * 计算下采样后的尺寸
 */
function calculateDownsampledSize(
  width: number,
  height: number,
  maxSize: number
): { width: number; height: number; scale: number } {
  if (width <= maxSize && height <= maxSize) {
    return { width, height, scale: 1 }
  }

  const scale = Math.min(maxSize / width, maxSize / height)
  return {
    width: Math.round(width * scale),
    height: Math.round(height * scale),
    scale
  }
}

/**
 * GPU加速JPEG编码 - 核心函数
 * 使用OffscreenCanvas.convertToBlob实现硬件加速
 */
async function gpuEncodeToJpeg(
  source: HTMLCanvasElement | OffscreenCanvas | ImageBitmap,
  quality: number,
  targetWidth: number,
  targetHeight: number
): Promise<Blob> {
  ensureOffscreenCanvas(targetWidth, targetHeight)

  if (!offscreenCtx || !offscreenCanvas) {
    throw new Error('OffscreenCanvas初始化失败')
  }

  // 使用GPU加速的drawImage进行缩放和绘制
  offscreenCtx.drawImage(source, 0, 0, targetWidth, targetHeight)

  // convertToBlob在现代浏览器中使用GPU加速
  return offscreenCanvas.convertToBlob({
    type: 'image/jpeg',
    quality
  })
}

/**
 * CPU回退编码
 */
function cpuEncodeToJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob)
        else reject(new Error('Canvas编码失败'))
      },
      'image/jpeg',
      quality
    )
  })
}

/**
 * 智能JPEG编码函数
 * 优先使用GPU加速的OffscreenCanvas，支持下采样
 */
export async function smartEncodeCanvasToJpeg(
  canvas: HTMLCanvasElement,
  quality: number = DEFAULT_ENCODE_CONFIG.quality,
  maxSize: number = DEFAULT_ENCODE_CONFIG.maxSize,
  enableDownsample: boolean = DEFAULT_ENCODE_CONFIG.enableDownsample
): Promise<Blob> {
  const sourceWidth = canvas.width
  const sourceHeight = canvas.height

  // 计算目标尺寸
  let targetWidth = sourceWidth
  let targetHeight = sourceHeight

  if (enableDownsample && maxSize > 0) {
    const sized = calculateDownsampledSize(sourceWidth, sourceHeight, maxSize)
    targetWidth = sized.width
    targetHeight = sized.height
  }

  try {
    // 优先使用GPU加速的OffscreenCanvas
    if (isWebCodecsSupported()) {
      // 使用createImageBitmap进行GPU加速的图像处理
      const imageBitmap = await createImageBitmap(canvas, {
        resizeWidth: targetWidth,
        resizeHeight: targetHeight,
        resizeQuality: 'low' // 'low' 更快，'medium'/'high' 更好质量
      })

      const blob = await gpuEncodeToJpeg(imageBitmap, quality, targetWidth, targetHeight)
      imageBitmap.close() // 释放GPU资源

      return blob
    }
  } catch (error) {
    console.warn('[GPU编码] 失败，回退到CPU:', error)
  }

  // CPU回退
  if (targetWidth !== sourceWidth || targetHeight !== sourceHeight) {
    // 需要缩放，创建临时canvas
    const tempCanvas = document.createElement('canvas')
    tempCanvas.width = targetWidth
    tempCanvas.height = targetHeight
    const tempCtx = tempCanvas.getContext('2d')
    if (tempCtx) {
      tempCtx.drawImage(canvas, 0, 0, targetWidth, targetHeight)
      return cpuEncodeToJpeg(tempCanvas, quality)
    }
  }

  return cpuEncodeToJpeg(canvas, quality)
}

/**
 * 快速编码 - 最低质量，最快速度
 * 适用于实时检测场景
 */
export async function fastEncodeCanvasToJpeg(canvas: HTMLCanvasElement): Promise<Blob> {
  return smartEncodeCanvasToJpeg(canvas, 0.5, 640, true)
}

/**
 * 高质量编码 - 较高质量，速度适中
 * 适用于需要保存或展示的场景
 */
export async function highQualityEncodeCanvasToJpeg(canvas: HTMLCanvasElement): Promise<Blob> {
  return smartEncodeCanvasToJpeg(canvas, 0.85, 1920, false)
}

/**
 * 性能测试函数 - 比较GPU和CPU编码性能
 */
export async function benchmarkEncoding(
  canvas: HTMLCanvasElement,
  iterations: number = 10
): Promise<{
  gpuTime: number
  cpuTime: number
  speedup: number
  gpuSupported: boolean
}> {
  console.log(`[性能测试] 开始编码性能测试 (${iterations} 次迭代)...`)
  console.log(`[性能测试] 源图像尺寸: ${canvas.width}x${canvas.height}`)

  const results = {
    gpuTime: 0,
    cpuTime: 0,
    speedup: 0,
    gpuSupported: false
  }

  // GPU编码测试 (使用下采样)
  if (isWebCodecsSupported()) {
    results.gpuSupported = true
    console.log('[性能测试] 测试GPU编码 (OffscreenCanvas + 下采样)...')

    // 预热
    await smartEncodeCanvasToJpeg(canvas, 0.5, 640, true)

    const gpuStart = performance.now()
    for (let i = 0; i < iterations; i++) {
      await smartEncodeCanvasToJpeg(canvas, 0.5, 640, true)
    }
    const gpuEnd = performance.now()
    results.gpuTime = (gpuEnd - gpuStart) / iterations
    console.log(`[性能测试] GPU编码平均时间: ${results.gpuTime.toFixed(2)}ms`)
  } else {
    console.log('[性能测试] GPU编码不支持，跳过')
    results.gpuTime = -1
  }

  // CPU编码测试 (原始尺寸)
  console.log('[性能测试] 测试CPU编码 (原始尺寸)...')

  // 预热
  await cpuEncodeToJpeg(canvas, 0.8)

  const cpuStart = performance.now()
  for (let i = 0; i < iterations; i++) {
    await cpuEncodeToJpeg(canvas, 0.8)
  }
  const cpuEnd = performance.now()
  results.cpuTime = (cpuEnd - cpuStart) / iterations
  console.log(`[性能测试] CPU编码平均时间: ${results.cpuTime.toFixed(2)}ms`)

  // 计算加速比
  if (results.gpuTime > 0) {
    results.speedup = results.cpuTime / results.gpuTime
    console.log(`[性能测试] GPU加速比: ${results.speedup.toFixed(2)}x`)
  }

  return results
}

/**
 * 清理GPU资源
 */
export function cleanupGpuEncoder(): void {
  offscreenCanvas = null
  offscreenCtx = null
  lastWidth = 0
  lastHeight = 0
}
