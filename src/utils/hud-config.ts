/**
 * HUD Panel 配置管理工具
 * 用于加载和解析 resources/HUDPanel/*.xml 配置文件
 */

export interface HUDPanelPosition {
  top?: string
  left?: string
  right?: string
  bottom?: string
}

export interface HUDPanelSize {
  width?: string
  height?: string
  minWidth?: string
  minHeight?: string
  maxWidth?: string
  maxHeight?: string
}

export interface HUDPanelConfig {
  id: string
  title: string
  description?: string
  position: HUDPanelPosition
  size: HUDPanelSize
  options: {
    resizable: boolean
    defaultTeam?: 'red' | 'blue' | 'inherit' | null
  }
  content: {
    component: string
    props?: Record<string, unknown>
    fields?: Array<{
      name: string
      label: string
      type: string
      toggleable?: boolean
    }>
  }
}

/**
 * 解析 XML 字符串为 HUDPanelConfig
 */
export function parseHUDPanelXML(xmlString: string): HUDPanelConfig | null {
  try {
    const parser = new DOMParser()
    const doc = parser.parseFromString(xmlString, 'text/xml')

    const root = doc.querySelector('HUDPanel')
    if (!root) return null

    const id = root.getAttribute('id') || ''
    const title = root.querySelector('title')?.textContent || ''
    const description = root.querySelector('description')?.textContent || undefined

    // 解析位置
    const positionEl = root.querySelector('position')
    const position: HUDPanelPosition = {}
    if (positionEl) {
      position.top = positionEl.querySelector('top')?.textContent || undefined
      position.left = positionEl.querySelector('left')?.textContent || undefined
      position.right = positionEl.querySelector('right')?.textContent || undefined
      position.bottom = positionEl.querySelector('bottom')?.textContent || undefined
    }

    // 解析大小
    const sizeEl = root.querySelector('size')
    const size: HUDPanelSize = {}
    if (sizeEl) {
      size.width = sizeEl.querySelector('width')?.textContent || undefined
      size.height = sizeEl.querySelector('height')?.textContent || undefined
      size.minWidth = sizeEl.querySelector('minWidth')?.textContent || undefined
      size.minHeight = sizeEl.querySelector('minHeight')?.textContent || undefined
      size.maxWidth = sizeEl.querySelector('maxWidth')?.textContent || undefined
      size.maxHeight = sizeEl.querySelector('maxHeight')?.textContent || undefined
    }

    // 解析选项
    const optionsEl = root.querySelector('options')
    const options = {
      resizable: optionsEl?.querySelector('resizable')?.textContent === 'true',
      defaultTeam: optionsEl?.querySelector('defaultTeam')?.textContent as
        | 'red'
        | 'blue'
        | 'inherit'
        | null
    }

    // 解析内容
    const contentEl = root.querySelector('content')
    const component = contentEl?.querySelector('component')?.textContent || ''

    // 解析 props
    const propsEl = contentEl?.querySelector('props')
    const props: Record<string, unknown> = {}
    if (propsEl) {
      for (const child of Array.from(propsEl.children)) {
        const value = child.textContent
        // 尝试解析数字和布尔值
        if (value === 'true') props[child.tagName] = true
        else if (value === 'false') props[child.tagName] = false
        else if (!isNaN(Number(value))) props[child.tagName] = Number(value)
        else props[child.tagName] = value
      }
    }

    // 解析 fields
    const fieldsEl = contentEl?.querySelector('fields')
    const fields: HUDPanelConfig['content']['fields'] = []
    if (fieldsEl) {
      for (const fieldEl of Array.from(fieldsEl.querySelectorAll('field'))) {
        fields.push({
          name: fieldEl.getAttribute('name') || '',
          label: fieldEl.getAttribute('label') || '',
          type: fieldEl.getAttribute('type') || 'text',
          toggleable: fieldEl.getAttribute('toggleable') === 'true'
        })
      }
    }

    return {
      id,
      title,
      description,
      position,
      size,
      options,
      content: {
        component,
        props: Object.keys(props).length > 0 ? props : undefined,
        fields: fields.length > 0 ? fields : undefined
      }
    }
  } catch (error) {
    console.error('[HUDPanel] Failed to parse XML:', error)
    return null
  }
}

/**
 * 将 HUDPanelConfig 转换为 HudPanel 组件的 initialStyle prop
 */
export function configToInitialStyle(config: HUDPanelConfig): Record<string, string | undefined> {
  return {
    ...config.position,
    ...config.size
  }
}

/**
 * 将 HUDPanelConfig 序列化为 XML 字符串（用于保存配置）
 */
export function serializeHUDPanelConfig(config: HUDPanelConfig): string {
  const lines: string[] = []
  lines.push('<?xml version="1.0" encoding="UTF-8"?>')
  lines.push(`<HUDPanel id="${config.id}">`)
  lines.push(`  <title>${config.title}</title>`)
  if (config.description) {
    lines.push(`  <description>${config.description}</description>`)
  }

  // Position
  lines.push('  <position>')
  if (config.position.top) lines.push(`    <top>${config.position.top}</top>`)
  if (config.position.left) lines.push(`    <left>${config.position.left}</left>`)
  if (config.position.right) lines.push(`    <right>${config.position.right}</right>`)
  if (config.position.bottom) lines.push(`    <bottom>${config.position.bottom}</bottom>`)
  lines.push('  </position>')

  // Size
  lines.push('  <size>')
  if (config.size.width) lines.push(`    <width>${config.size.width}</width>`)
  if (config.size.height) lines.push(`    <height>${config.size.height}</height>`)
  if (config.size.minWidth) lines.push(`    <minWidth>${config.size.minWidth}</minWidth>`)
  if (config.size.minHeight) lines.push(`    <minHeight>${config.size.minHeight}</minHeight>`)
  if (config.size.maxWidth) lines.push(`    <maxWidth>${config.size.maxWidth}</maxWidth>`)
  if (config.size.maxHeight) lines.push(`    <maxHeight>${config.size.maxHeight}</maxHeight>`)
  lines.push('  </size>')

  // Options
  lines.push('  <options>')
  lines.push(`    <resizable>${config.options.resizable}</resizable>`)
  if (config.options.defaultTeam) {
    lines.push(`    <defaultTeam>${config.options.defaultTeam}</defaultTeam>`)
  }
  lines.push('  </options>')

  // Content
  lines.push('  <content>')
  lines.push(`    <component>${config.content.component}</component>`)
  if (config.content.props && Object.keys(config.content.props).length > 0) {
    lines.push('    <props>')
    for (const [key, value] of Object.entries(config.content.props)) {
      lines.push(`      <${key}>${value}</${key}>`)
    }
    lines.push('    </props>')
  }
  lines.push('  </content>')

  lines.push('</HUDPanel>')
  return lines.join('\n')
}

/**
 * 默认的 HUD Panel 配置（当 XML 文件加载失败时使用）
 */
export const DEFAULT_HUD_CONFIGS: Record<string, HUDPanelConfig> = {
  'vehicle-attitude': {
    id: 'vehicle-attitude',
    title: '车辆姿态',
    position: { bottom: '26px', left: '28px' },
    size: { width: '180px', height: '220px', minWidth: '150px', minHeight: '180px' },
    options: { resizable: true, defaultTeam: 'red' },
    content: { component: 'VehicleAttitude', props: { size: 140 } }
  },
  'module-status': {
    id: 'module-status',
    title: '模块状态',
    position: { bottom: '26px', left: '228px' },
    size: { width: '320px', minWidth: '280px', minHeight: '150px' },
    options: { resizable: true },
    content: { component: 'ModuleStatus' }
  },
  'robot-status': {
    id: 'robot-status',
    title: '本车状态',
    position: { bottom: '26px', right: '28px' },
    size: { width: '320px', minWidth: '280px', minHeight: '200px' },
    options: { resizable: true },
    content: { component: 'RobotStateManager' }
  }
}
