<!-- filepath: e:\desktop\SharkClientVue\shark_client_vue\src\renderer\src\components\ConfirmationDialog.vue -->
<script setup lang="ts">
defineProps({
  title: {
    type: String,
    default: '确认'
  },
  message: {
    type: String,
    required: true
  }
})

const emit = defineEmits(['confirm', 'cancel'])

const onConfirm = () => {
  emit('confirm')
}

const onCancel = () => {
  emit('cancel')
}
</script>

<template>
  <Transition name="modal-fade">
    <div class="modal-backdrop" @click="onCancel">
      <div class="modal-content" style="width: 400px" @click.stop>
        <h3>{{ title }}</h3>
        <p>{{ message }}</p>
        <div class="modal-actions">
          <button class="modal-button-secondary" @click="onCancel">取消</button>
          <button class="modal-button-danger" @click="onConfirm">确定</button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
p {
  margin: 0;
  color: #d1d5db;
  font-size: 1rem;
}

/* --- DELETED: Button styles moved to modals.css --- */

.dialog-fade-enter-active,
.dialog-fade-leave-active {
  transition: opacity 0.25s ease;
}
.dialog-fade-enter-active .modal-content,
.dialog-fade-leave-active .modal-content {
  transition: transform 0.25s ease;
}

.dialog-fade-enter-from,
.dialog-fade-leave-to {
  opacity: 0;
}
.dialog-fade-enter-from .modal-content,
.dialog-fade-leave-to .modal-content {
  transform: scale(0.95);
}
</style>
