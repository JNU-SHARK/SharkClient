import { reactive } from 'vue'

// 面板位置信息接口
export interface PanelPosition {
  top: string
  left: string
  right: string
  bottom: string
  width: string
  height: string
}

// 面板信息接口
export interface PanelInfo {
  id: string
  title: string
  getPosition: () => PanelPosition
  setPosition: (pos: Partial<PanelPosition>) => void
}

// 存储面板信息的 Map（按 title 索引）
export const panelRegistry = reactive<Map<string, PanelInfo>>(new Map())

// 旧的 panels Set（保持向后兼容）
export const panels = reactive<Set<HTMLDivElement | null>>(new Set())

export function registerPanelInfo(info: PanelInfo) {
  panelRegistry.set(info.title, info)
}

export function unregisterPanelInfo(title: string) {
  panelRegistry.delete(title)
}

// 获取所有面板的当前位置
export function getAllPanelPositions(): Map<string, PanelPosition> {
  const positions = new Map<string, PanelPosition>()
  for (const [title, info] of panelRegistry) {
    positions.set(title, info.getPosition())
  }
  return positions
}

// 旧版注册函数（保持向后兼容）
export function registerPanel(panelEl: HTMLDivElement | null) {
  if (panelEl) {
    panels.add(panelEl)
  }
}

export function unregisterPanel(panelEl: HTMLDivElement | null) {
  panels.delete(panelEl)
}
