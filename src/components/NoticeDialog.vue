<script setup lang="ts">
// 居中的小提示框（设计稿：设计稿/确认页/定稿-保存失败弹窗.webp、定稿-关闭确认弹窗.webp）：
// 细线图标 + 标题，几行说明，右下两个按钮。出错时图标和标题是红色，其他时候墨黑。Esc、点遮罩等于点左边按钮
import { vPress } from './pressFeedback'
import { ref, useId } from 'vue'
import { useModal } from './useModal'
import { CircleAlert, Info } from './icons'

/** danger：确认的是删除这类不可恢复的操作，确认按钮用红色 */
/** neutralText：多一个放在最左边的“取消”（比如保存 / 放弃更改 / 取消 三选一），Esc 和点框外算它，不算“放弃” */
const props = defineProps<{
  title: string
  tone?: 'error' | 'info'
  cancelText: string
  okText: string
  danger?: boolean
  neutralText?: string
  /** Esc和遮罩仍走保留内容的neutral回调，不要求显示第三个按钮。 */
  dismissToNeutral?: boolean
}>()
const emit = defineEmits<{ cancel: []; ok: []; neutral: [] }>()
const dismiss = () => (props.neutralText || props.dismissToNeutral ? emit('neutral') : emit('cancel'))

const dialog = ref<HTMLElement>()
const titleId = useId()
useModal(dialog, dismiss)
</script>

<template>
  <div class="mask" @click.self="dismiss">
    <section ref="dialog" class="dialog" role="alertdialog" aria-modal="true" :aria-labelledby="titleId" tabindex="-1">
      <h2 :id="titleId" :class="tone ?? 'info'">
        <component :is="tone === 'error' ? CircleAlert : Info" :size="20" aria-hidden="true" />{{ title }}
      </h2>
      <div class="body"><slot /></div>
      <div class="buttons">
        <button v-if="neutralText" v-press class="neutral" @click="emit('neutral')">{{ neutralText }}</button>
        <button v-press class="soft" @click="emit('cancel')">{{ cancelText }}</button>
        <button v-press="'tactile'" :class="danger ? 'danger' : 'primary'" @click="emit('ok')">{{ okText }}</button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.mask {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: grid;
  place-items: center;
  padding: var(--sp-6);
  background: rgb(15 18 25 / 28%);
}
.dialog {
  width: min(420px, 100%);
  padding: var(--sp-5) var(--sp-5) var(--sp-4);
  background: var(--card);
  border-radius: var(--panel-radius);
  box-shadow: var(--shadow-pop);
}
h2 {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  margin: 0 0 var(--sp-3);
  font-size: var(--fs-lg);
  font-weight: var(--fw-heading);
  color: var(--fg-strong);
}
h2.error {
  color: var(--err);
}
.body :deep(p) {
  margin: 0 0 var(--sp-1);
  font-size: var(--fs-md);
  line-height: 1.7;
  color: var(--fg);
}
.body :deep(.link) {
  padding: 0;
  font-size: inherit;
}
.buttons {
  display: flex;
  justify-content: flex-end;
  gap: var(--sp-2);
  margin-top: var(--sp-5);
}
.buttons button {
  padding: 0 var(--px-md);
}
.neutral {
  margin-right: auto;
  border: 0;
  background: none;
  color: var(--muted);
}
.neutral:hover:not(:disabled) {
  color: var(--fg);
  background: none;
}
.danger {
  border: 0;
  background: var(--err);
  color: var(--on-primary);
}
.danger:hover:not(:disabled) {
  background: var(--err-hover);
}
.soft {
  border: 0;
  background: var(--hover);
}
.soft:hover:not(:disabled) {
  background: var(--line);
}
</style>
