<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'

export interface SelectOption {
  label: string
  value: string | number
  disabled?: boolean
}

interface Props {
  modelValue: string | number
  options: SelectOption[]
  placeholder?: string
  disabled?: boolean
}

interface Emits {
  (e: 'update:modelValue', value: string | number): void
}

const props = withDefaults(defineProps<Props>(), {
  placeholder: '请选择...',
  disabled: false
})

const emit = defineEmits<Emits>()

const isOpen = ref(false)
const highlightedIndex = ref(-1)
const selectRef = ref<HTMLDivElement>()
const optionsRef = ref<HTMLDivElement>()

// 当前选中项的标签
const selectedLabel = computed(() => {
  const option = props.options.find((opt) => opt.value === props.modelValue)
  return option?.label || props.placeholder
})

// 过滤禁用选项
const availableOptions = computed(() => {
  return props.options.filter((opt) => !opt.disabled)
})

// 切换下拉框
function toggleDropdown(): void {
  if (props.disabled) return
  isOpen.value = !isOpen.value
  if (isOpen.value) {
    highlightedIndex.value = props.options.findIndex((opt) => opt.value === props.modelValue)
  }
}

// 选择选项
function selectOption(option: SelectOption): void {
  if (option.disabled) return
  emit('update:modelValue', option.value)
  isOpen.value = false
  highlightedIndex.value = -1
}

// 键盘导航
function handleKeydown(e: KeyboardEvent): void {
  if (props.disabled) return

  switch (e.key) {
    case 'Enter':
    case ' ':
      e.preventDefault()
      if (!isOpen.value) {
        isOpen.value = true
      } else if (highlightedIndex.value >= 0) {
        selectOption(availableOptions.value[highlightedIndex.value])
      }
      break
    case 'Escape':
      isOpen.value = false
      highlightedIndex.value = -1
      break
    case 'ArrowDown':
      e.preventDefault()
      if (!isOpen.value) {
        isOpen.value = true
      } else {
        highlightedIndex.value = Math.min(
          highlightedIndex.value + 1,
          availableOptions.value.length - 1
        )
        scrollToHighlighted()
      }
      break
    case 'ArrowUp':
      e.preventDefault()
      if (isOpen.value) {
        highlightedIndex.value = Math.max(highlightedIndex.value - 1, 0)
        scrollToHighlighted()
      }
      break
  }
}

// 滚动到高亮项
function scrollToHighlighted(): void {
  if (!optionsRef.value) return
  const optionElements = optionsRef.value.querySelectorAll('.select-option')
  const highlighted = optionElements[highlightedIndex.value] as HTMLElement
  if (highlighted) {
    highlighted.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }
}

// 鼠标移入选项
function handleMouseEnter(index: number): void {
  highlightedIndex.value = index
}

// 点击外部关闭
function handleClickOutside(e: MouseEvent): void {
  if (selectRef.value && !selectRef.value.contains(e.target as Node)) {
    isOpen.value = false
    highlightedIndex.value = -1
  }
}

onMounted(() => {
  document.addEventListener('click', handleClickOutside)
})

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside)
})
</script>

<template>
  <div
    ref="selectRef"
    class="custom-select"
    :class="{ open: isOpen, disabled: disabled }"
    @keydown="handleKeydown"
    tabindex="0"
  >
    <div class="select-trigger" @click="toggleDropdown">
      <span class="select-value">{{ selectedLabel }}</span>
      <svg
        class="select-arrow"
        :class="{ rotated: isOpen }"
        width="12"
        height="8"
        viewBox="0 0 12 8"
        fill="none"
      >
        <path
          d="M1 1L6 6L11 1"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </div>

    <Transition name="dropdown">
      <div v-if="isOpen" ref="optionsRef" class="select-options">
        <div
          v-for="(option, index) in options"
          :key="option.value"
          class="select-option"
          :class="{
            selected: option.value === modelValue,
            highlighted: index === highlightedIndex,
            disabled: option.disabled
          }"
          @click="selectOption(option)"
          @mouseenter="handleMouseEnter(index)"
        >
          {{ option.label }}
          <svg
            v-if="option.value === modelValue"
            class="check-icon"
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
          >
            <path
              d="M13.3333 4L6 11.3333L2.66667 8"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.custom-select {
  position: relative;
  width: 100%;
  font-family: inherit;
  outline: none;
}

.select-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  background-color: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 6px;
  color: var(--color-text);
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s ease;
  user-select: none;
}

.custom-select:hover .select-trigger {
  background-color: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.25);
}

.custom-select.open .select-trigger,
.custom-select:focus .select-trigger {
  background-color: rgba(255, 255, 255, 0.1);
  border-color: var(--color-accent);
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
}

.custom-select.disabled .select-trigger {
  opacity: 0.5;
  cursor: not-allowed;
  background-color: rgba(255, 255, 255, 0.02);
}

.select-value {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.select-arrow {
  flex-shrink: 0;
  margin-left: 8px;
  color: rgba(255, 255, 255, 0.6);
  transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.select-arrow.rotated {
  transform: rotate(180deg);
}

.select-options {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  max-height: 240px;
  overflow-y: auto;
  background: var(--color-background-soft);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 6px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  z-index: 1000;
  padding: 4px;
}

.select-options::-webkit-scrollbar {
  width: 6px;
}

.select-options::-webkit-scrollbar-track {
  background: rgba(255, 255, 255, 0.05);
  border-radius: 3px;
}

.select-options::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.2);
  border-radius: 3px;
}

.select-options::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.3);
}

.select-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  color: var(--color-text);
  font-size: 14px;
  cursor: pointer;
  border-radius: 4px;
  transition: all 0.15s ease;
  user-select: none;
}

.select-option.highlighted {
  background: rgba(59, 130, 246, 0.15);
  color: var(--color-heading);
}

.select-option.selected {
  color: var(--color-accent);
  font-weight: 500;
}

.select-option.disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.select-option:not(.disabled):active {
  background: rgba(59, 130, 246, 0.25);
}

.check-icon {
  flex-shrink: 0;
  margin-left: 8px;
  color: var(--color-accent);
  animation: checkIn 0.2s ease;
}

@keyframes checkIn {
  from {
    opacity: 0;
    transform: scale(0.5);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

/* 下拉动画 */
.dropdown-enter-active {
  animation: dropdownIn 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

.dropdown-leave-active {
  animation: dropdownOut 0.15s cubic-bezier(0.4, 0, 1, 1);
}

@keyframes dropdownIn {
  from {
    opacity: 0;
    transform: translateY(-8px) scaleY(0.95);
  }
  to {
    opacity: 1;
    transform: translateY(0) scaleY(1);
  }
}

@keyframes dropdownOut {
  from {
    opacity: 1;
    transform: translateY(0) scaleY(1);
  }
  to {
    opacity: 0;
    transform: translateY(-8px) scaleY(0.95);
  }
}
</style>
