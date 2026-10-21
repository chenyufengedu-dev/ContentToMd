<script setup lang="ts">
// 正文编辑栏：点进正文时出现在正文上方，点到别处时收起（由确认页控制显示）。
// 按钮用 mousedown.prevent，点按钮时正文不会失去焦点，编辑栏也就不会闪掉
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
      <Undo2 :size="17" />
    </button>
    <button
      class="tool"
      aria-label="重做"
      title="重做 Ctrl+Y"
      :disabled="!canRedo()"
      @click="editor.chain().focus().redo().run()"
    >
      <Redo2 :size="17" />
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
      <Bold :size="17" />
    </button>
    <button
      class="tool"
      :class="{ on: active('bulletList') }"
      aria-label="列表"
      title="列表"
      @click="editor.chain().focus().toggleBulletList().run()"
    >
      <List :size="17" />
    </button>
    <button
      class="tool"
      :class="{ on: active('orderedList') }"
      aria-label="编号列表"
      title="编号列表"
      @click="editor.chain().focus().toggleOrderedList().run()"
    >
      <ListOrdered :size="17" />
    </button>
    <button
      class="tool"
      :class="{ on: active('blockquote') }"
      aria-label="引用"
      title="引用"
      @click="editor.chain().focus().toggleBlockquote().run()"
    >
      <Quote :size="17" />
    </button>
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: var(--sp-1);
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  background: var(--card);
  box-shadow: var(--shadow-pop);
}
.tool {
  width: var(--h-xs);
  height: var(--h-xs);
  padding: 0;
  border: 0;
  border-radius: var(--radius-sm);
  background: none;
  color: var(--muted);
  display: grid;
  place-items: center;
}
.tool:hover:not(:disabled) {
  background: var(--hover);
  color: var(--fg-strong);
}
.tool.on {
  background: var(--primary-soft);
  color: var(--primary);
}
.divider {
  width: 1px;
  height: 16px;
  margin: 0 var(--sp-1);
  background: var(--line);
}
.segmented {
  display: flex;
  padding: 2px;
  border-radius: var(--radius-sm);
  background: var(--card-muted);
}
.seg {
  height: calc(var(--h-xs) - 4px);
  padding: 0 var(--px-sm);
  border: 0;
  border-radius: calc(var(--radius-sm) - 2px);
  background: none;
  color: var(--muted);
  font-size: var(--fs-sm);
}
.seg:hover:not(:disabled) {
  background: none;
  color: var(--fg-strong);
}
.seg.on {
  background: var(--card);
  color: var(--fg-strong);
  box-shadow: var(--shadow-card);
}
</style>
