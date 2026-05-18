import { defineStore } from 'pinia'
import { ref } from 'vue'

export interface StyleProp {
  name: string
  type: 'string' | 'number' | 'boolean' | 'color' | 'select'
  label: string
  default: unknown
  options?: string[] // For select type
  min?: number
  max?: number
}

export interface WidgetStyle {
  id: string
  name: string
  component: string // Component name (e.g., 'DataBar')
  description: string
  props: StyleProp[]
  defaultSize: { width: number; height: number }
}

export const useWidgetStylesStore = defineStore('widget-styles', () => {
  const styles = ref<WidgetStyle[]>([
    {
      id: 'data-bar-basic',
      name: '基础数据条',
      component: 'DataBar',
      description: '线性进度条，支持分段显示',
      defaultSize: { width: 200, height: 40 },
      props: [
        { name: 'value', type: 'number', label: '当前值', default: 0 },
        { name: 'max', type: 'number', label: '最大值', default: 100 },
        { name: 'min', type: 'number', label: '最小值', default: 0 },
        { name: 'unit', type: 'string', label: '单位', default: '' },
        { name: 'label', type: 'string', label: '标签', default: 'Energy' },
        { name: 'color', type: 'color', label: '颜色', default: '#3b82f6' },
        { name: 'showValue', type: 'boolean', label: '显示数值', default: true },
        { name: 'segmented', type: 'boolean', label: '分段显示', default: false }
      ]
    },
    {
      id: 'data-ring-basic',
      name: '基础环形图',
      component: 'DataRing',
      description: '环形进度显示',
      defaultSize: { width: 100, height: 100 },
      props: [
        { name: 'value', type: 'number', label: '当前值', default: 0 },
        { name: 'max', type: 'number', label: '最大值', default: 100 },
        { name: 'min', type: 'number', label: '最小值', default: 0 },
        { name: 'unit', type: 'string', label: '单位', default: '%' },
        { name: 'label', type: 'string', label: '标签', default: 'Speed' },
        { name: 'color', type: 'color', label: '颜色', default: '#3b82f6' },
        { name: 'size', type: 'number', label: '尺寸', default: 100 },
        { name: 'strokeWidth', type: 'number', label: '线宽', default: 8 }
      ]
    },
    {
      id: 'data-number-basic',
      name: '数字展示',
      component: 'DataNumber',
      description: '大号数字显示',
      defaultSize: { width: 100, height: 60 },
      props: [
        { name: 'value', type: 'number', label: '数值', default: 0 },
        { name: 'unit', type: 'string', label: '单位', default: '' },
        { name: 'label', type: 'string', label: '标签', default: 'Score' },
        { name: 'color', type: 'color', label: '颜色', default: '#ffffff' },
        {
          name: 'size',
          type: 'select',
          label: '大小',
          default: 'medium',
          options: ['small', 'medium', 'large', 'x-large']
        }
      ]
    },
    {
      id: 'data-text-basic',
      name: '文本标签',
      component: 'DataText',
      description: '普通文本显示',
      defaultSize: { width: 100, height: 30 },
      props: [
        { name: 'text', type: 'string', label: '内容', default: 'Text' },
        { name: 'color', type: 'color', label: '颜色', default: '#ffffff' },
        {
          name: 'align',
          type: 'select',
          label: '对齐',
          default: 'left',
          options: ['left', 'center', 'right']
        },
        { name: 'bold', type: 'boolean', label: '加粗', default: false }
      ]
    },
    {
      id: 'data-waveform-basic',
      name: '基础波形图',
      component: 'DataWaveform',
      description: '实时数据显示波形图',
      defaultSize: { width: 300, height: 100 },
      props: [
        { name: 'value', type: 'number', label: '通道1数值', default: 0 },
        { name: 'label', type: 'string', label: '通道1标签', default: 'CH1' },
        { name: 'color', type: 'color', label: '通道1颜色', default: '#3b82f6' },

        { name: 'value2', type: 'number', label: '通道2数值', default: null },
        { name: 'label2', type: 'string', label: '通道2标签', default: '' },
        { name: 'color2', type: 'color', label: '通道2颜色', default: '#10b981' },

        { name: 'value3', type: 'number', label: '通道3数值', default: null },
        { name: 'label3', type: 'string', label: '通道3标签', default: '' },
        { name: 'color3', type: 'color', label: '通道3颜色', default: '#f59e0b' },

        { name: 'min', type: 'number', label: '最小值', default: 0 },
        { name: 'max', type: 'number', label: '最大值', default: 100 },
        { name: 'autoScale', type: 'boolean', label: '自动缩放', default: false },
        { name: 'historyLength', type: 'number', label: '数据点数', default: 50 },
        { name: 'strokeWidth', type: 'number', label: '线条宽度', default: 2 },
        { name: 'fillArea', type: 'boolean', label: '填充区域', default: true },
        { name: 'unit', type: 'string', label: '单位', default: '' },
        { name: 'showValue', type: 'boolean', label: '显示数值', default: true }
      ]
    },
    {
      id: 'data-bar-dual',
      name: '双段能量条',
      component: 'DataBar',
      description: '双段能量显示（缓冲+实际）',
      defaultSize: { width: 200, height: 60 },
      props: [
        { name: 'value', type: 'number', label: '实际能量', default: 0 },
        { name: 'max', type: 'number', label: '实际最大值', default: 150 },
        { name: 'bufferValue', type: 'number', label: '缓冲能量', default: 0 },
        { name: 'bufferMax', type: 'number', label: '缓冲最大值', default: 60 },
        { name: 'label', type: 'string', label: '标签', default: 'Energy' },
        { name: 'bufferColor', type: 'color', label: '缓冲颜色', default: '#06b6d4' },
        { name: 'actualColor', type: 'color', label: '实际颜色', default: '#f59e0b' },
        { name: 'dualMode', type: 'boolean', label: '双段模式', default: true },
        { name: 'showValue', type: 'boolean', label: '显示数值', default: true }
      ]
    },
    {
      id: 'status-indicator-basic',
      name: '状态指示器',
      component: 'StatusIndicator',
      description: '单个LED状态指示',
      defaultSize: { width: 100, height: 30 },
      props: [
        { name: 'label', type: 'string', label: '标签', default: 'Status' },
        { name: 'active', type: 'boolean', label: '激活', default: false },
        { name: 'activeColor', type: 'color', label: '激活颜色', default: '#10b981' }
      ]
    },
    {
      id: 'multi-status-basic',
      name: '多状态指示器',
      component: 'MultiStatusIndicator',
      description: '多状态LED指示',
      defaultSize: { width: 200, height: 60 },
      props: [
        { name: 'label', type: 'string', label: '标签', default: 'Mode' },
        { name: 'currentValue', type: 'string', label: '当前值', default: 'idle' },
        { name: 'showAllStates', type: 'boolean', label: '显示所有状态', default: false },
        {
          name: 'options',
          type: 'string',
          label: '选项(JSON)',
          default: JSON.stringify([
            { value: 'idle', label: '待机', color: '#60a5fa' },
            { value: 'running', label: '运行', color: '#10b981' },
            { value: 'error', label: '错误', color: '#ef4444' }
          ])
        }
      ]
    }
  ])

  function getStyleById(id: string): WidgetStyle | undefined {
    return styles.value.find((s) => s.id === id)
  }

  function registerStyle(style: WidgetStyle): void {
    styles.value.push(style)
  }

  return {
    styles,
    getStyleById,
    registerStyle
  }
})
