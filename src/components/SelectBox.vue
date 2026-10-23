<script setup lang="ts" generic="T extends string | number">
// 自绘下拉框：系统自带的下拉列表样式改不了，和页面格格不入。支持键盘：上下选择、回车确定、Esc 关闭。
// 列表挂到页面最外层、按按钮的位置浮出来：放在卡片里时不会被卡片边缘切掉，也不会被下一张卡片盖住
import { vPress } from './pressFeedback'
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'
import { Check, ChevronDown } from './icons'

const props = defineProps<{
  options: { value: T; label: string }[]
  ariaLabel: string
  size?: 'md' | 'sm'
}>()
const model = defineModel<T>({ required: true })

const open = ref(false)
const highlighted = ref(0)
const root = ref<HTMLElement>()
const list = ref<HTMLElement>()
const listId = useId()
const optionId = (i: number) => `${listId}-${i}`
/** 列表的位置（相对窗口）：按钮下面放得下就放下面，否则放上面 */
const menuStyle = ref<Record<string, string>>({})
const current = computed(() => props.options.find((o) => o.value === model.value)?.label ?? '')

// 列表打开期间每一帧都跟着按钮放：卡片正在展开挪位置、页面滚动时，列表也贴着按钮
let frame = 0
function follow(below: boolean) {
  const r = root.value?.getBoundingClientRect()
  if (r)
    menuStyle.value = {
      left: `${r.left}px`,
      width: `${r.width}px`,
      ...(below ? { top: `${r.bottom}px` } : { bottom: `${window.innerHeight - r.top}px` }),
    }
  frame = requestAnimationFrame(() => follow(below))
}

async function toggle() {
  if (open.value) return close()
  if (!props.options.length) return
  follow(true)
  open.value = true
  highlighted.value = Math.max(
    0,
    props.options.findIndex((o) => o.value === model.value),
  )
  document.addEventListener('pointerdown', onOutside, true)
  await nextTick()
  if (!open.value || !root.value) return
  // 量出列表实际多高再定往上还是往下（只定这一次，免得跟着按钮移动时跳来跳去）
  const r = root.value.getBoundingClientRect()
  const h = list.value?.offsetHeight ?? 0
  if (r.bottom + h > window.innerHeight && r.top > window.innerHeight - r.bottom) {
    cancelAnimationFrame(frame)
    follow(false)
  }
  list.value?.children[highlighted.value]?.scrollIntoView({ block: 'nearest' })
}
function close() {
  open.value = false
  cancelAnimationFrame(frame)
  document.removeEventListener('pointerdown', onOutside, true)
}
function choose(i: number) {
  if (!props.options[i]) return
  model.value = props.options[i].value
  close()
  root.value?.querySelector('button')?.focus()
}
function onFocusOut(e: FocusEvent) {
  if (!(e.relatedTarget instanceof Node) || !root.value?.contains(e.relatedTarget)) close()
}
function onOutside(e: PointerEvent) {
  const t = e.target as Node
  if (!root.value?.contains(t) && !list.value?.contains(t)) close()
}
function onKey(e: KeyboardEvent) {
  if (!open.value) {
    if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
      e.preventDefault()
      void toggle()
    }
    return
  }
  if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    close()
  } else if (e.key === 'Tab') {
    close()
  } else if (e.key === 'Home' || e.key === 'End') {
    e.preventDefault()
    highlighted.value = e.key === 'Home' ? 0 : props.options.length - 1
    list.value?.children[highlighted.value]?.scrollIntoView({ block: 'nearest' })
  } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault()
    const n = props.options.length
    highlighted.value = (highlighted.value + (e.key === 'ArrowDown' ? 1 : n - 1)) % n
    list.value?.children[highlighted.value]?.scrollIntoView({ block: 'nearest' })
  } else if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    choose(highlighted.value)
  }
}
watch(
  () => props.options,
  () => {
    highlighted.value = Math.max(0, Math.min(highlighted.value, props.options.length - 1))
    if (!props.options.length) close()
  },
)
onBeforeUnmount(close)
</script>

<template>
  <div ref="root" class="select" :class="[size ?? 'md', { open }]" @focusout="onFocusOut">
    <button
      v-press
      type="button"
      class="trigger"
      :aria-label="ariaLabel"
      role="combobox"
      aria-haspopup="listbox"
      :aria-expanded="open"
      :aria-controls="open ? listId : undefined"
      :aria-activedescendant="open ? optionId(highlighted) : undefined"
      @click="toggle"
      @keydown="onKey"
    >
      <span class="value">{{ current }}</span>
      <ChevronDown class="arrow" :size="size === 'sm' ? 14 : 18" aria-hidden="true" />
    </button>
    <Teleport to="body">
      <ul v-if="open" :id="listId" ref="list" class="menu" :style="menuStyle" role="listbox" :aria-label="ariaLabel">
        <li
          v-for="(o, i) in options"
          :id="optionId(i)"
          :key="String(o.value)"
          v-press
          role="option"
          :aria-selected="o.value === model"
          :class="{ highlighted: i === highlighted }"
          @pointerenter="highlighted = i"
          @pointerdown.prevent
          @click="choose(i)"
        >
          <span :title="o.label">{{ o.label }}</span>
          <Check v-if="o.value === model" :size="16" aria-hidden="true" />
        </li>
      </ul>
    </Teleport>
  </div>
</template>

<style scoped>
.select {
  position: relative;
}
.trigger {
  width: 100%;
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  border: 1px solid var(--line);
  background: var(--card);
  color: var(--fg);
  text-align: left;
}
.trigger:hover:not(:disabled) {
  background: var(--card);
  border-color: var(--line-strong);
}
.select.open .trigger,
.trigger:focus-visible {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
}
.value {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.arrow {
  flex: none;
  color: var(--muted);
  transition: transform var(--ease);
}
.select.open .arrow {
  transform: rotate(180deg);
}
.md .trigger {
  height: var(--h-md);
  padding: 0 var(--px-sm) 0 var(--px-md);
  border-radius: var(--radius-md);
  font-size: var(--fs-md);
}
.sm .trigger {
  height: var(--h-xs);
  padding: 0 var(--sp-2) 0 var(--px-sm);
  border-radius: var(--radius-chip);
  font-size: var(--fs-sm);
}
.menu {
  position: fixed;
  box-sizing: border-box;
  z-index: 60; /* 比提示框的遮罩（50）高：提示框里也能用 */
  max-height: var(--select-menu-max-height);
  margin: var(--sp-1) 0;
  overflow-y: auto;
  padding: var(--sp-1);
  list-style: none;
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-pop);
  animation: pop var(--ease);
}
.menu li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-3);
  padding: var(--sp-2) var(--sp-3);
  border-radius: var(--radius-sm);
  font-size: var(--fs-md);
  color: var(--fg);
  cursor: pointer;
  white-space: nowrap;
}
.menu li > span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.menu li > svg {
  flex: none;
}
.menu li.highlighted {
  background: var(--hover);
}
.menu li[aria-selected='true'] {
  color: var(--accent);
  font-weight: 600;
}
@keyframes pop {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
}
</style>
