<script setup lang="ts">
defineProps<{ x: number; y: number; selected: boolean; writable: boolean; password: boolean }>()
const emit = defineEmits<{ action: [command: string] }>()
</script>

<template>
  <div
    class="edit-menu"
    role="menu"
    aria-label="文字编辑"
    :style="{ left: `${x}px`, top: `${y}px` }"
    @mousedown.prevent
  >
    <button role="menuitem" :disabled="!selected || !writable || password" @click="emit('action', 'cut')">
      剪切<kbd>Ctrl+X</kbd>
    </button>
    <button role="menuitem" :disabled="!selected || password" @click="emit('action', 'copy')">
      复制<kbd>Ctrl+C</kbd>
    </button>
    <button role="menuitem" :disabled="!writable" @click="emit('action', 'paste')">粘贴<kbd>Ctrl+V</kbd></button>
    <hr />
    <button role="menuitem" @click="emit('action', 'selectAll')">全选<kbd>Ctrl+A</kbd></button>
  </div>
</template>

<style scoped>
.edit-menu {
  position: fixed;
  z-index: 100;
  width: calc(var(--h-md) * 6);
  padding: var(--sp-1);
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  background: var(--card);
  box-shadow: var(--shadow-pop);
}
.edit-menu button {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  height: var(--h-md);
  padding: 0 var(--px-sm);
  border: 0;
  border-radius: var(--radius-sm);
  color: var(--fg);
  background: transparent;
  font: inherit;
}
.edit-menu button:hover:not(:disabled),
.edit-menu button:focus-visible {
  background: var(--accent-soft);
  color: var(--accent);
  outline: none;
}
.edit-menu button:disabled {
  color: var(--faint);
}
.edit-menu kbd {
  font: inherit;
  font-size: var(--fs-sm);
  color: var(--faint);
}
.edit-menu button:hover:not(:disabled) kbd,
.edit-menu button:focus-visible kbd {
  color: var(--accent);
}
.edit-menu hr {
  border: 0;
  border-top: 1px solid var(--line);
  margin: var(--sp-1) var(--px-sm);
}
</style>
