import { defineStore } from 'pinia'
import { ref } from 'vue'

export interface HudPanelTemplate {
  id: string
  title: string
  description: string
  position: {
    bottom?: string
    left?: string
    right?: string
    top?: string
  }
  size: {
    width: string
    height: string
    minWidth?: string
    minHeight?: string
    maxWidth?: string
    maxHeight?: string
  }
  options: {
    resizable: boolean
    defaultTeam?: string
    hideTitleBar?: boolean
    transparent?: boolean
    defaultVisible?: boolean
    opacity?: number
  }
  content: {
    component: string
    props: Record<string, unknown>
  }
  widgets?: Array<{
    id: string
    styleId: string
    position: { x: number; y: number }
    size: { width: number; height: number }
    props: Record<string, unknown>
    zIndex: number
    name?: string
    mqttBinding?: string
    mqttBinding2?: string
    mqttBinding3?: string
    unit?: string
    formula?: string
  }>
}

type HudTemplateFile = {
  filename: string
  content: string
}

type TemplateChangedEvent = {
  eventType: string
  filename: string
}

const BUILTIN_VIDEO_ZOOM_TEMPLATE: HudPanelTemplate = {
  id: 'video-zoom-status',
  title: '图传倍率',
  description: '显示并调整当前图传放大倍数',
  position: {
    top: '74px',
    right: '28px'
  },
  size: {
    width: '220px',
    height: 'auto',
    minWidth: '200px',
    minHeight: '132px',
    maxWidth: '320px',
    maxHeight: '320px'
  },
  options: {
    resizable: true,
    defaultTeam: 'inherit',
    hideTitleBar: true,
    transparent: false,
    defaultVisible: true
  },
  content: {
    component: 'VideoZoomStatus',
    props: {}
  }
}

export const useHudTemplatesStore = defineStore('hud-templates', () => {
  const templates = ref<Record<string, HudPanelTemplate>>({})
  const loading = ref(false)

  // 解析 XML 字符串为对象
  const parseXml = (xmlString: string): HudPanelTemplate | null => {
    try {
      const parser = new DOMParser()
      const xmlDoc = parser.parseFromString(xmlString, 'text/xml')

      const root = xmlDoc.querySelector('HUDPanel')
      if (!root) return null

      const id = root.getAttribute('id') || 'unknown'
      const title = root.querySelector('title')?.textContent || ''
      const description = root.querySelector('description')?.textContent || ''

      // Position
      const posNode = root.querySelector('position')
      const position: HudPanelTemplate['position'] = {}
      if (posNode) {
        if (posNode.querySelector('bottom')) {
          position.bottom = posNode.querySelector('bottom')?.textContent || undefined
        }
        if (posNode.querySelector('left')) {
          position.left = posNode.querySelector('left')?.textContent || undefined
        }
        if (posNode.querySelector('right')) {
          position.right = posNode.querySelector('right')?.textContent || undefined
        }
        if (posNode.querySelector('top')) {
          position.top = posNode.querySelector('top')?.textContent || undefined
        }
      }

      // Size
      const sizeNode = root.querySelector('size')
      const size: HudPanelTemplate['size'] = { width: '200px', height: '150px' }
      if (sizeNode) {
        size.width = sizeNode.querySelector('width')?.textContent || '200px'
        size.height = sizeNode.querySelector('height')?.textContent || '150px'
        size.minWidth = sizeNode.querySelector('minWidth')?.textContent || undefined
        size.minHeight = sizeNode.querySelector('minHeight')?.textContent || undefined
        size.maxWidth = sizeNode.querySelector('maxWidth')?.textContent || undefined
        size.maxHeight = sizeNode.querySelector('maxHeight')?.textContent || undefined
      }

      // Options
      const optsNode = root.querySelector('options')
      const options: HudPanelTemplate['options'] = { resizable: false }
      if (optsNode) {
        options.resizable = optsNode.querySelector('resizable')?.textContent === 'true'
        options.defaultTeam = optsNode.querySelector('defaultTeam')?.textContent || undefined
        options.hideTitleBar = optsNode.querySelector('hideTitleBar')?.textContent === 'true'
        options.transparent = optsNode.querySelector('transparent')?.textContent === 'true'
        const defaultVisibleNode = optsNode.querySelector('defaultVisible')
        if (defaultVisibleNode) {
          options.defaultVisible = defaultVisibleNode.textContent === 'true'
        }
        const opacityNode = optsNode.querySelector('opacity')
        if (opacityNode && opacityNode.textContent) {
          options.opacity = parseFloat(opacityNode.textContent)
        }
      }

      // Content
      const contentNode = root.querySelector('content')
      const content: HudPanelTemplate['content'] = { component: '', props: {} }
      if (contentNode) {
        content.component = contentNode.querySelector('component')?.textContent || ''
        const propsNode = contentNode.querySelector('props')
        if (propsNode) {
          Array.from(propsNode.children).forEach((child) => {
            const propName = child.tagName
            let val: unknown = child.textContent

            // 特殊处理：unit 和 label 始终保持为字符串
            if (propName === 'unit' || propName === 'label') {
              content.props[propName] = val || ''
            } else {
              // 其他属性进行类型转换
              if (val === 'true') val = true
              else if (val === 'false') val = false
              else if (val !== null && val !== '' && !isNaN(Number(val))) val = Number(val)

              content.props[propName] = val
            }
          })
        }
      }

      // Widgets（组件配置）
      const widgetsNode = root.querySelector('widgets')
      const widgets: HudPanelTemplate['widgets'] = []
      if (widgetsNode) {
        Array.from(widgetsNode.querySelectorAll('widget')).forEach((widgetNode) => {
          const widget: NonNullable<HudPanelTemplate['widgets']>[0] = {
            id: widgetNode.getAttribute('id') || '',
            styleId: widgetNode.getAttribute('styleId') || '',
            position: {
              x: Number(widgetNode.getAttribute('x')) || 0,
              y: Number(widgetNode.getAttribute('y')) || 0
            },
            size: {
              width: Number(widgetNode.getAttribute('width')) || 100,
              height: Number(widgetNode.getAttribute('height')) || 50
            },
            props: {},
            zIndex: Number(widgetNode.getAttribute('zIndex')) || 0
          }

          // 可选属性
          const name = widgetNode.getAttribute('name')
          if (name) widget.name = name

          const mqttBinding = widgetNode.getAttribute('mqttBinding')
          if (mqttBinding) widget.mqttBinding = mqttBinding

          const mqttBinding2 = widgetNode.getAttribute('mqttBinding2')
          if (mqttBinding2) widget.mqttBinding2 = mqttBinding2

          const mqttBinding3 = widgetNode.getAttribute('mqttBinding3')
          if (mqttBinding3) widget.mqttBinding3 = mqttBinding3

          const unit = widgetNode.getAttribute('unit')
          if (unit) widget.unit = unit

          const formula = widgetNode.getAttribute('formula')
          if (formula) widget.formula = formula

          // Widget props
          const widgetPropsNode = widgetNode.querySelector('props')
          if (widgetPropsNode) {
            Array.from(widgetPropsNode.children).forEach((child) => {
              const propName = child.tagName
              let val: unknown = child.textContent

              // 特殊处理：unit 和 label 始终保持为字符串
              if (propName === 'unit' || propName === 'label') {
                widget.props[propName] = val || ''
              } else {
                // 其他属性进行类型转换
                if (val === 'true') val = true
                else if (val === 'false') val = false
                else if (val !== null && val !== '' && !isNaN(Number(val))) val = Number(val)

                widget.props[propName] = val
              }
            })
          }

          widgets.push(widget)
        })
      }

      return {
        id,
        title,
        description,
        position,
        size,
        options,
        content,
        widgets: widgets.length > 0 ? widgets : undefined
      }
    } catch (e) {
      console.error('XML Parse Error:', e)
      return null
    }
  }

  const loadTemplates = async (): Promise<void> => {
    if (!window.api?.hud) return
    loading.value = true
    try {
      const files = await window.api.hud.getTemplates()
      const newTemplates: Record<string, HudPanelTemplate> = {}

      files.forEach((file: HudTemplateFile) => {
        const template = parseXml(file.content)
        // 过滤掉示例模板
        if (template && template.title !== '自定义窗口模板') {
          newTemplates[template.id] = template
        }
      })

      if (!newTemplates[BUILTIN_VIDEO_ZOOM_TEMPLATE.id]) {
        newTemplates[BUILTIN_VIDEO_ZOOM_TEMPLATE.id] = BUILTIN_VIDEO_ZOOM_TEMPLATE
      }

      templates.value = newTemplates
      console.log('[HUD Store] Loaded templates:', Object.keys(templates.value))
    } catch (e) {
      console.error('[HUD Store] Failed to load templates:', e)
    } finally {
      loading.value = false
    }
  }

  // 监听模板变化
  if (window.api?.hud?.onTemplateChanged) {
    window.api.hud.onTemplateChanged(async ({ eventType, filename }: TemplateChangedEvent) => {
      console.log(`[HUD Store] Template changed: ${filename} (${eventType})`)
      await loadTemplates()
    })
  }

  const createCustomTemplate = async (): Promise<void> => {
    if (!window.api?.hud) return

    // Calculate next number for title
    let maxNum = 0
    Object.values(templates.value).forEach((t) => {
      if (t.title.startsWith('新建窗口')) {
        const match = t.title.match(/新建窗口\s*(\d*)/)
        if (match) {
          const num = match[1] ? parseInt(match[1]) : 1
          if (num > maxNum) maxNum = num
        }
      }
    })
    const nextNum = maxNum + 1
    const title = `新建窗口 ${nextNum}`

    const timestamp = Date.now()
    const id = `custom-panel-${timestamp}`
    const filename = `CustomPanel-${timestamp}.xml`

    const xmlContent = `<?xml version="1.0" encoding="UTF-8"?>
<HUDPanel id="${id}">
  <title>${title}</title>
  <description>自定义窗口</description>
  
  <position>
    <top>100px</top>
    <left>100px</left>
  </position>
  
  <size>
    <width>300px</width>
    <height>200px</height>
    <minWidth>150px</minWidth>
    <minHeight>100px</minHeight>
  </size>
  
  <options>
    <resizable>true</resizable>
  </options>
  
  <content>
    <!-- 默认无内容，或者可以指定一个 EmptyComponent -->
    <component></component>
    <props>
    </props>
  </content>
</HUDPanel>`

    try {
      await window.api.hud.saveTemplate(filename, xmlContent)
      console.log('[HUD Store] Created custom template:', filename)
      // 手动刷新以确保 UI 立即更新 (防止文件监听延迟)
      await loadTemplates()
    } catch (e) {
      console.error('[HUD Store] Failed to create template:', e)
    }
  }

  const renameTemplate = async (id: string, newTitle: string): Promise<void> => {
    if (!window.api?.hud) return
    try {
      await window.api.hud.updateTemplateTitle(id, newTitle)
      console.log('[HUD Store] Renamed template:', id, newTitle)
      // 手动刷新以确保 UI 立即更新
      await loadTemplates()
    } catch (e) {
      console.error('[HUD Store] Failed to rename template:', e)
    }
  }

  const deleteTemplate = async (id: string): Promise<void> => {
    if (!window.api?.hud) return
    try {
      await window.api.hud.deleteTemplate(id)
      console.log('[HUD Store] Deleted template:', id)
      // Remove from local state immediately
      if (templates.value[id]) {
        delete templates.value[id]
      }
      // Also reload to be sure
      await loadTemplates()
    } catch (e) {
      console.error('[HUD Store] Failed to delete template:', e)
    }
  }

  const saveWidgetsToTemplate = async (
    panelId: string,
    widgets: Array<{
      id: string
      styleId: string
      position: { x: number; y: number }
      size: { width: number; height: number }
      props: Record<string, unknown>
      zIndex: number
      name?: string
      mqttBinding?: string
      mqttBinding2?: string
      mqttBinding3?: string
      unit?: string
      formula?: string
    }>
  ): Promise<void> => {
    if (!window.api?.hud) return

    try {
      const template = templates.value[panelId]
      if (!template) {
        console.error('[HUD Store] Template not found:', panelId)
        return
      }

      // 构建 widgets XML
      let widgetsXml = '  <widgets>\n'
      widgets.forEach((widget) => {
        const attrs = [
          `id="${widget.id}"`,
          `styleId="${widget.styleId}"`,
          `x="${widget.position.x}"`,
          `y="${widget.position.y}"`,
          `width="${widget.size.width}"`,
          `height="${widget.size.height}"`,
          `zIndex="${widget.zIndex}"`
        ]

        if (widget.name) attrs.push(`name="${widget.name}"`)
        if (widget.mqttBinding) attrs.push(`mqttBinding="${widget.mqttBinding}"`)
        if (widget.mqttBinding2) attrs.push(`mqttBinding2="${widget.mqttBinding2}"`)
        if (widget.mqttBinding3) attrs.push(`mqttBinding3="${widget.mqttBinding3}"`)
        if (widget.unit) attrs.push(`unit="${widget.unit}"`)
        if (widget.formula) attrs.push(`formula="${widget.formula}"`)

        widgetsXml += `    <widget ${attrs.join(' ')}>\n`

        // Widget props
        if (Object.keys(widget.props).length > 0) {
          widgetsXml += '      <props>\n'
          Object.entries(widget.props).forEach(([key, value]) => {
            widgetsXml += `        <${key}>${value}</${key}>\n`
          })
          widgetsXml += '      </props>\n'
        }

        widgetsXml += '    </widget>\n'
      })
      widgetsXml += '  </widgets>'

      // 重新构建完整的 XML
      const xmlContent = `<?xml version="1.0" encoding="UTF-8"?>
<HUDPanel id="${template.id}">
  <title>${template.title}</title>
  <description>${template.description}</description>
  
  <position>
${template.position.top ? `    <top>${template.position.top}</top>\n` : ''}${template.position.left ? `    <left>${template.position.left}</left>\n` : ''}${template.position.right ? `    <right>${template.position.right}</right>\n` : ''}${template.position.bottom ? `    <bottom>${template.position.bottom}</bottom>\n` : ''}  </position>
  
  <size>
    <width>${template.size.width}</width>
    <height>${template.size.height}</height>
${template.size.minWidth ? `    <minWidth>${template.size.minWidth}</minWidth>\n` : ''}${template.size.minHeight ? `    <minHeight>${template.size.minHeight}</minHeight>\n` : ''}${template.size.maxWidth ? `    <maxWidth>${template.size.maxWidth}</maxWidth>\n` : ''}${template.size.maxHeight ? `    <maxHeight>${template.size.maxHeight}</maxHeight>\n` : ''}  </size>
  
  <options>
    <resizable>${template.options.resizable}</resizable>
${template.options.defaultTeam ? `    <defaultTeam>${template.options.defaultTeam}</defaultTeam>\n` : ''}  </options>
  
  <content>
    <component>${template.content.component}</component>
    <props>
${Object.entries(template.content.props)
  .map(([key, value]) => `      <${key}>${value}</${key}>`)
  .join('\n')}
    </props>
  </content>

${widgetsXml}
</HUDPanel>`

      // 查找文件名
      const files = await window.api.hud.getTemplates()
      const file = files.find((f: HudTemplateFile) => f.content.includes(`id="${panelId}"`))
      if (!file) {
        console.error('[HUD Store] Template file not found:', panelId)
        return
      }

      await window.api.hud.saveTemplate(file.filename, xmlContent)
      console.log('[HUD Store] Saved widgets to template:', panelId, widgets.length)

      // 更新本地缓存
      template.widgets = widgets

      await loadTemplates()
    } catch (e) {
      console.error('[HUD Store] Failed to save widgets:', e)
    }
  }

  return {
    templates,
    loading,
    loadTemplates,
    createCustomTemplate,
    renameTemplate,
    deleteTemplate,
    saveWidgetsToTemplate
  }
})
