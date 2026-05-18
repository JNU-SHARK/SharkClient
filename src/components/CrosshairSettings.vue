<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import CustomSelect, { type SelectOption } from './CustomSelect.vue'

export interface CrosshairConfig {
  // 准星样式
  style: 'cross' | 'dot' | 'circle' | 'square' | 't-shape'
  // 颜色
  color: string
  // 外边框颜色
  outlineColor: string
  outlineThickness: number
  // 尺寸
  size: number
  thickness: number
  gap: number
  // 中心点
  centerDot: boolean
  centerDotSize: number
  // 动态效果
  dynamic: boolean
  dynamicSplit: number
  // 透明度
  opacity: number
}

interface CrosshairPreset {
  name: string
  config: Partial<CrosshairConfig>
}

interface Props {
  modelValue: CrosshairConfig
}

interface Emits {
  (e: 'update:modelValue', value: CrosshairConfig): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

const config = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value)
})

// 自定义预设名称输入
const customPresetName = ref('')
const showSaveDialog = ref(false)

// 用户自定义预设
const customPresets = ref<CrosshairPreset[]>([])

// 预设颜色
const colorPresets = [
  { name: '绿色', value: '#00ff0d' },
  { name: '红色', value: '#ff0000' },
  { name: '蓝色', value: '#00ffff' },
  { name: '黄色', value: '#ffff00' },
  { name: '白色', value: '#ffffff' },
  { name: '粉色', value: '#ff00ff' }
]

// 默认预设配置
const defaultPresets: CrosshairPreset[] = [
  {
    name: 'CS经典',
    config: {
      style: 'cross',
      size: 12,
      thickness: 2,
      gap: 4,
      centerDot: false,
      color: '#00ff0d',
      outlineThickness: 0,
      opacity: 0.85
    }
  },
  {
    name: 'Valorant',
    config: {
      style: 'cross',
      size: 8,
      thickness: 2,
      gap: 2,
      centerDot: true,
      centerDotSize: 2,
      color: '#ffffff',
      outlineThickness: 1,
      outlineColor: '#000000',
      opacity: 1
    }
  },
  {
    name: '点状',
    config: {
      style: 'dot',
      size: 4,
      centerDotSize: 4,
      color: '#00ffff',
      outlineThickness: 1,
      outlineColor: '#000000',
      opacity: 1
    }
  },
  {
    name: 'T型',
    config: {
      style: 't-shape',
      size: 14,
      thickness: 2,
      gap: 3,
      centerDot: true,
      centerDotSize: 2,
      color: '#ffff00',
      outlineThickness: 1,
      opacity: 0.9
    }
  }
]

// 加载自定义预设
async function loadCustomPresets(): Promise<void> {
  try {
    const presets = await window.api.getCrosshairPresets()
    customPresets.value = presets as CrosshairPreset[]
  } catch (error) {
    console.error('加载自定义准星预设失败:', error)
  }
}

// 保存当前配置为预设
function saveCurrentAsPreset(): void {
  showSaveDialog.value = true
}

// 确认保存预设
async function confirmSavePreset(): Promise<void> {
  if (!customPresetName.value.trim()) {
    alert('请输入预设名称')
    return
  }

  const preset: CrosshairPreset = {
    name: customPresetName.value.trim(),
    config: { ...config.value }
  }

  try {
    window.api.saveCrosshairPreset(preset)
    await loadCustomPresets()
    customPresetName.value = ''
    showSaveDialog.value = false
    console.log('准星预设保存成功:', preset.name)
  } catch (error) {
    console.error('保存准星预设失败:', error)
    alert('保存失败，请重试')
  }
}

// 删除自定义预设
async function deletePreset(presetName: string): Promise<void> {
  if (confirm(`确定删除预设"${presetName}"吗？`)) {
    try {
      window.api.deleteCrosshairPreset(presetName)
      await loadCustomPresets()
      console.log('预设删除成功:', presetName)
    } catch (error) {
      console.error('删除预设失败:', error)
    }
  }
}

// 应用预设
function applyPreset(preset: CrosshairPreset): void {
  config.value = { ...config.value, ...preset.config } as CrosshairConfig
}

function updateConfig<K extends keyof CrosshairConfig>(key: K, value: CrosshairConfig[K]): void {
  config.value = { ...config.value, [key]: value }
}

// 组件挂载时加载预设
onMounted(() => {
  loadCustomPresets()
})

// 准星样式选项
const styleOptions: SelectOption[] = [
  { label: '十字', value: 'cross' },
  { label: 'T型', value: 't-shape' },
  { label: '点状', value: 'dot' },
  { label: '圆形', value: 'circle' },
  { label: '方形', value: 'square' }
]
</script>

<template>
  <div class="crosshair-settings">
    <!-- 预览区域 -->
    <div class="preview-section">
      <h4>实时预览</h4>
      <div class="preview-container">
        <div class="preview-bg">
          <!-- 动态准星预览 -->
          <div
            class="preview-crosshair"
            :style="{
              '--crosshair-color': config.color,
              '--crosshair-outline': config.outlineColor,
              '--crosshair-size': config.size + 'px',
              '--crosshair-thickness': config.thickness + 'px',
              '--crosshair-gap': config.gap + 'px',
              '--crosshair-outline-thickness': config.outlineThickness + 'px',
              '--crosshair-opacity': config.opacity,
              '--center-dot-size': config.centerDotSize + 'px'
            }"
            :data-style="config.style"
            :data-has-dot="config.centerDot"
          >
            <!-- 根据样式渲染不同的准星 -->
            <template v-if="config.style === 'cross'">
              <div class="line line-top"></div>
              <div class="line line-bottom"></div>
              <div class="line line-left"></div>
              <div class="line line-right"></div>
            </template>
            <template v-else-if="config.style === 't-shape'">
              <div class="line line-top"></div>
              <div class="line line-left"></div>
              <div class="line line-right"></div>
            </template>
            <template v-else-if="config.style === 'circle'">
              <div class="shape-circle"></div>
            </template>
            <template v-else-if="config.style === 'square'">
              <div class="shape-square"></div>
            </template>
            <div v-if="config.centerDot" class="center-dot"></div>
          </div>
        </div>
      </div>
    </div>

    <!-- 配置区域 -->
    <div class="config-section">
      <!-- 预设 -->
      <div class="form-group">
        <label>快速预设</label>
        <div class="preset-buttons">
          <!-- 默认预设 -->
          <button
            v-for="preset in defaultPresets"
            :key="preset.name"
            class="preset-btn"
            @click="applyPreset(preset)"
          >
            {{ preset.name }}
          </button>
          <!-- 自定义预设 -->
          <button
            v-for="preset in customPresets"
            :key="preset.name"
            class="preset-btn custom"
            @click="applyPreset(preset)"
            :title="preset.name"
          >
            {{ preset.name }}
            <span class="delete-btn" @click.stop="deletePreset(preset.name)">×</span>
          </button>
          <!-- 保存按钮 -->
          <button class="preset-btn save-btn" @click="saveCurrentAsPreset" title="保存当前配置">
            + 保存
          </button>
        </div>
      </div>

      <!-- 准星样式 -->
      <div class="form-group">
        <label>准星样式</label>
        <CustomSelect v-model="config.style" :options="styleOptions" />
      </div>

      <!-- 颜色 -->
      <div class="form-group">
        <label>颜色</label>
        <div class="color-picker-row">
          <input
            type="color"
            :value="config.color"
            @input="updateConfig('color', ($event.target as HTMLInputElement).value)"
            class="color-input"
          />
          <div class="color-presets">
            <button
              v-for="preset in colorPresets"
              :key="preset.value"
              @click="updateConfig('color', preset.value)"
              class="color-preset-btn"
              :style="{ backgroundColor: preset.value }"
              :title="preset.name"
            ></button>
          </div>
        </div>
      </div>

      <!-- 尺寸参数 -->
      <div class="form-group" v-if="config.style !== 'dot'">
        <label>长度: {{ config.size }}</label>
        <input
          type="range"
          :value="config.size"
          @input="updateConfig('size', Number(($event.target as HTMLInputElement).value))"
          min="4"
          max="30"
          step="1"
          class="slider"
        />
      </div>

      <div v-if="config.style !== 'dot'" class="form-group">
        <label>粗细: {{ config.thickness }}</label>
        <input
          type="range"
          :value="config.thickness"
          @input="updateConfig('thickness', Number(($event.target as HTMLInputElement).value))"
          min="1"
          max="6"
          step="1"
          class="slider"
        />
      </div>

      <div class="form-group" v-if="config.style === 'cross' || config.style === 't-shape'">
        <label>间隙: {{ config.gap }}</label>
        <input
          type="range"
          :value="config.gap"
          @input="updateConfig('gap', Number(($event.target as HTMLInputElement).value))"
          min="0"
          max="15"
          step="1"
          class="slider"
        />
      </div>

      <!-- 外边框 -->
      <div class="form-group">
        <label>外边框粗细: {{ config.outlineThickness }}</label>
        <input
          type="range"
          :value="config.outlineThickness"
          @input="
            updateConfig('outlineThickness', Number(($event.target as HTMLInputElement).value))
          "
          min="0"
          max="3"
          step="1"
          class="slider"
        />
      </div>

      <div class="form-group" v-if="config.outlineThickness > 0">
        <label>外边框颜色</label>
        <input
          type="color"
          :value="config.outlineColor"
          @input="updateConfig('outlineColor', ($event.target as HTMLInputElement).value)"
          class="color-input"
        />
      </div>

      <!-- 中心点 -->
      <div class="form-group">
        <label class="checkbox-label">
          <input
            type="checkbox"
            :checked="config.centerDot"
            @change="updateConfig('centerDot', ($event.target as HTMLInputElement).checked)"
          />
          <span>显示中心点</span>
        </label>
      </div>

      <div class="form-group" v-if="config.centerDot">
        <label>中心点大小: {{ config.centerDotSize }}</label>
        <input
          type="range"
          :value="config.centerDotSize"
          @input="updateConfig('centerDotSize', Number(($event.target as HTMLInputElement).value))"
          min="1"
          max="8"
          step="1"
          class="slider"
        />
      </div>

      <!-- 透明度 -->
      <div class="form-group">
        <label>透明度: {{ Math.round(config.opacity * 100) }}%</label>
        <input
          type="range"
          :value="config.opacity"
          @input="updateConfig('opacity', Number(($event.target as HTMLInputElement).value))"
          min="0.1"
          max="1"
          step="0.05"
          class="slider"
        />
      </div>
    </div>

    <!-- 保存对话框 -->
    <div v-if="showSaveDialog" class="save-dialog-overlay" @click="showSaveDialog = false">
      <div class="save-dialog" @click.stop>
        <h3>保存准星预设</h3>
        <input
          v-model="customPresetName"
          type="text"
          placeholder="输入预设名称..."
          class="preset-name-input"
          @keyup.enter="confirmSavePreset"
        />
        <div class="dialog-actions">
          <button class="dialog-btn cancel" @click="showSaveDialog = false">取消</button>
          <button class="dialog-btn confirm" @click="confirmSavePreset">保存</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.crosshair-settings {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
  padding: 16px 0;
}

.preview-section h4,
.config-section h4 {
  margin: 0 0 12px 0;
  color: rgba(255, 255, 255, 0.9);
  font-size: 14px;
  font-weight: 600;
}

/* 预览区域 */
.preview-container {
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  padding: 12px;
  min-height: 400px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.preview-bg {
  width: 100%;
  height: 300px;
  background:
    linear-gradient(90deg, rgba(255, 255, 255, 0.02) 1px, transparent 1px),
    linear-gradient(rgba(255, 255, 255, 0.02) 1px, transparent 1px);
  background-size: 20px 20px;
  position: relative;
  border-radius: 4px;
  overflow: hidden;
}

.preview-crosshair {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 100px;
  height: 100px;
}

/* 准星线条 */
.line {
  position: absolute;
  background: var(--crosshair-color);
  opacity: var(--crosshair-opacity);
  box-shadow:
    0 0 calc(var(--crosshair-outline-thickness) * 1px) var(--crosshair-outline),
    inset 0 0 calc(var(--crosshair-outline-thickness) * 1px) var(--crosshair-outline);
}

.line-top {
  top: calc(50% - var(--crosshair-gap) - var(--crosshair-size));
  left: 50%;
  width: var(--crosshair-thickness);
  height: var(--crosshair-size);
  transform: translateX(-50%);
}

.line-bottom {
  top: calc(50% + var(--crosshair-gap));
  left: 50%;
  width: var(--crosshair-thickness);
  height: var(--crosshair-size);
  transform: translateX(-50%);
}

.line-left {
  top: 50%;
  left: calc(50% - var(--crosshair-gap) - var(--crosshair-size));
  width: var(--crosshair-size);
  height: var(--crosshair-thickness);
  transform: translateY(-50%);
}

.line-right {
  top: 50%;
  left: calc(50% + var(--crosshair-gap));
  width: var(--crosshair-size);
  height: var(--crosshair-thickness);
  transform: translateY(-50%);
}

/* 中心点 */
.center-dot {
  position: absolute;
  top: 50%;
  left: 50%;
  width: var(--center-dot-size);
  height: var(--center-dot-size);
  background: var(--crosshair-color);
  border-radius: 50%;
  transform: translate(-50%, -50%);
  opacity: var(--crosshair-opacity);
  box-shadow: 0 0 calc(var(--crosshair-outline-thickness) * 1px) var(--crosshair-outline);
}

/* 圆形和方形样式 */
.shape-circle,
.shape-square {
  position: absolute;
  top: 50%;
  left: 50%;
  width: calc(var(--crosshair-size) * 2);
  height: calc(var(--crosshair-size) * 2);
  transform: translate(-50%, -50%);
  border: var(--crosshair-thickness) solid var(--crosshair-color);
  opacity: var(--crosshair-opacity);
  box-shadow:
    0 0 calc(var(--crosshair-outline-thickness) * 1px) var(--crosshair-outline),
    inset 0 0 calc(var(--crosshair-outline-thickness) * 1px) var(--crosshair-outline);
}

.shape-circle {
  border-radius: 50%;
}

/* 配置区域 */
.config-section {
  max-height: 500px;
  overflow-y: auto;
  padding-right: 8px;
}

.config-section::-webkit-scrollbar {
  width: 6px;
}

.config-section::-webkit-scrollbar-track {
  background: rgba(255, 255, 255, 0.05);
  border-radius: 3px;
}

.config-section::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.2);
  border-radius: 3px;
}

.form-group {
  margin-bottom: 16px;
}

.form-group label {
  display: block;
  color: rgba(255, 255, 255, 0.7);
  font-size: 13px;
  margin-bottom: 6px;
}

.form-select {
  width: 100%;
  /* 其他样式继承自全局 select 样式 */
}

.slider {
  width: 100%;
  height: 4px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.1);
  outline: none;
  -webkit-appearance: none;
  appearance: none;
}

.slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #00ff0d;
  cursor: pointer;
  box-shadow: 0 0 8px rgba(0, 255, 13, 0.5);
}

.slider::-moz-range-thumb {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #00ff0d;
  cursor: pointer;
  border: none;
}

.color-picker-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.color-input {
  width: 50px;
  height: 32px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 4px;
  cursor: pointer;
  background: transparent;
}

.color-presets {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.color-preset-btn {
  width: 24px;
  height: 24px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-radius: 4px;
  cursor: pointer;
  transition:
    transform 0.2s,
    border-color 0.2s;
}

.color-preset-btn:hover {
  transform: scale(1.1);
  border-color: rgba(255, 255, 255, 0.8);
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  user-select: none;
}

.checkbox-label input[type='checkbox'] {
  width: 16px;
  height: 16px;
  cursor: pointer;
}

.preset-buttons {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
}

.preset-btn {
  padding: 8px 12px;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 4px;
  color: rgba(255, 255, 255, 0.8);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s;
  position: relative;
}

.preset-btn:hover {
  background: rgba(255, 255, 255, 0.15);
  border-color: rgba(255, 255, 255, 0.3);
  color: white;
}

.preset-btn.custom {
  background: rgba(59, 130, 246, 0.1);
  border-color: rgba(59, 130, 246, 0.3);
  padding-right: 28px;
}

.preset-btn.custom:hover {
  background: rgba(59, 130, 246, 0.2);
  border-color: rgba(59, 130, 246, 0.5);
}

.preset-btn.save-btn {
  background: rgba(34, 197, 94, 0.1);
  border-color: rgba(34, 197, 94, 0.3);
  color: rgba(34, 197, 94, 1);
}

.preset-btn.save-btn:hover {
  background: rgba(34, 197, 94, 0.2);
  border-color: rgba(34, 197, 94, 0.5);
}

.delete-btn {
  position: absolute;
  right: 4px;
  top: 50%;
  transform: translateY(-50%);
  width: 18px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(239, 68, 68, 0.8);
  border-radius: 3px;
  font-size: 14px;
  line-height: 1;
  color: white;
  opacity: 0;
  transition: opacity 0.2s;
}

.preset-btn.custom:hover .delete-btn {
  opacity: 1;
}

.delete-btn:hover {
  background: rgba(239, 68, 68, 1);
}

/* 保存对话框 */
.save-dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
  animation: fadeIn 0.2s ease;
}

@keyframes fadeIn {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

.save-dialog {
  background: var(--color-background-soft);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  padding: 24px;
  min-width: 320px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
  animation: slideIn 0.3s ease;
}

@keyframes slideIn {
  from {
    transform: translateY(-20px);
    opacity: 0;
  }
  to {
    transform: translateY(0);
    opacity: 1;
  }
}

.save-dialog h3 {
  margin: 0 0 16px 0;
  color: var(--color-heading);
  font-size: 16px;
}

.preset-name-input {
  width: 100%;
  padding: 10px 14px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 6px;
  color: var(--color-text);
  font-size: 14px;
  margin-bottom: 16px;
  outline: none;
  transition: all 0.2s;
}

.preset-name-input:focus {
  border-color: var(--color-accent);
  background: rgba(255, 255, 255, 0.08);
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
}

.dialog-actions {
  display: flex;
  gap: 12px;
  justify-content: flex-end;
}

.dialog-btn {
  padding: 8px 20px;
  border: none;
  border-radius: 6px;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s;
}

.dialog-btn.cancel {
  background: rgba(255, 255, 255, 0.08);
  color: var(--color-text);
}

.dialog-btn.cancel:hover {
  background: rgba(255, 255, 255, 0.15);
}

.dialog-btn.confirm {
  background: var(--color-accent);
  color: white;
}

.dialog-btn.confirm:hover {
  background: var(--color-accent-hover);
}
</style>
