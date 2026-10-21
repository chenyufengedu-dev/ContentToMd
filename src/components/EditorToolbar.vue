<script setup lang="ts">
// 正文编辑栏：固定在正文上方的一排浅灰图标，没有底色和边框，平时几乎不被注意。
// 按钮用 mousedown.prevent，点按钮时正文不会失去焦点
import { onBeforeUnmount, onMounted, ref } from 'vue'
import type { Editor } from '@tiptap/vue-3'
import { Undo2, Redo2, Bold, List, ListOrdered, Quote } from 'lucide-vue-next'

const props = defineProps<{ editor: Editor }>()

// 编辑器的状态变化 Vue 看不到，每次变化时拨一下计数，按钮的“选中”状态才会跟着刷新
const tick = ref(0)
const bump = () => tick.value++
onMounted(() => props.editor.on('transaction', bump))
onBeforeUnmount(() => props.editor.off('transaction', bump))
const active = (name: string, attrs?: Record<string, unknown>) => tick.value >= 0 && props.editor.isActive(name, attrs)
const canUndo = () => tick.value >= 0 && props.editor.can().undo()
const canRedo = () => tick.value >= 0 && props.editor.can().redo()

const isHeading = () => active('heading', { level: 3 })
const setText = () => props.editor.chain().focus().setParagraph().run()
const setHeading = () => props.editor.chain().focus().setHeading({ level: 3 }).run()
</script>

<template>
  <div class="toolbar" role="toolbar" aria-label="正文编辑" @mousedown.prevent>
    <button
      class="tool"
      aria-label="撤销"
      title="撤销 Ctrl+Z"
      :disabled="!canUndo()"
      @click="editor.chain().focus().undo().run()"
    >
      <Undo2 :size="16" />
    </button>
    <button
      class="tool"
      aria-label="重做"
      title="重做 Ctrl+Y"
      :disabled="!canRedo()"
      @click="editor.chain().focus().redo().run()"
    >
      <Redo2 :size="16" />
    </button>
    <span class="divider" />
    <div class="segmented" role="group" aria-label="段落类型">
      <button class="seg" :class="{ on: !isHeading() }" @click="setText">正文</button>
      <button class="seg" :class="{ on: isHeading() }" @click="setHeading">小标题</button>
    </div>
    <span class="divider" />
    <button
      class="tool"
      :class="{ on: active('bold') }"
      aria-label="加粗"
      title="加粗 Ctrl+B"
      @click="editor.chain().focus().toggleBold().run()"
    >
      <Bold :size="16" />
    </button>
    <button
      class="tool"
      :class="{ on: active('bulletList') }"
      aria-label="列表"
      title="列表"
      @click="editor.chain().focus().toggleBulletList().run()"
    >
      <List :size="16" />
    </button>
    <button
      class="tool"
      :class="{ on: active('orderedList') }"
      aria-label="编号列表"
      title="编号列表"
      @click="editor.chain().focus().toggleOrderedList().run()"
    >
      <ListOrdered :size="16" />
    </button>
    <button
      class="tool"
      :class="{ on: active('blockquote') }"
      aria-label="引用"
      title="引用"
      @click="editor.chain().focus().toggleBlockquote().run()"
    >
      <Quote :size="16" />
    </button>
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  gap: 2px;
}
.tool {
  width: var(--h-xs);
  height: var(--h-xs);
  padding: 0;
  border: 0;
  border-radius: var(--radius-sm);
  background: none;
  color: var(--faint);
  display: grid;
  place-items: center;
}
.tool:hover:not(:disabled) {
  background: var(--hover);
  color: var(--fg-strong);
}
.tool:disabled {
  opacity: 0.4;
}
.tool.on {
  color: var(--accent);
}
.divider {
  width: 1px;
  height: 14px;
  margin: 0 var(--sp-2);
  background: var(--line);
}
.segmented {
  display: flex;
  gap: 2px;
}
.seg {
  height: var(--h-xs);
  padding: 0 var(--sp-2);
  border: 0;
  border-radius: var(--radius-sm);
  background: none;
  color: var(--faint);
  font-size: var(--fs-sm);
}
.seg:hover:not(:disabled) {
  background: var(--hover);
  color: var(--fg-strong);
}
.seg.on {
  color: var(--fg-strong);
}
</style>
