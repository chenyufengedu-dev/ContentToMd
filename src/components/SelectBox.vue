<script setup lang="ts" generic="T extends string | number">
// 自绘下拉框：系统自带的下拉列表样式改不了，和页面格格不入。支持键盘：上下选择、回车确定、Esc 关闭
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
import { Check, ChevronDown } from 'lucide-vue-next'

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
const current = computed(() => props.options.find((o) => o.value === model.value)?.label ?? '')

async function toggle() {
  if (open.value) return close()
  open.value = true
  highlighted.value = Math.max(
    0,
    props.options.findIndex((o) => o.value === model.value),
  )
  document.addEventListener('pointerdown', onOutside, true)
  await nextTick()
  list.value?.children[highlighted.value]?.scrollIntoView({ block: 'nearest' })
}
function close() {
  open.value = false
  document.removeEventListener('pointerdown', onOutside, true)
}
function choose(i: number) {
  model.value = props.options[i].value
  close()
}
function onOutside(e: PointerEvent) {
  if (!root.value?.contains(e.target as Node)) close()
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
    e.stopPropagation()
    close()
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
onBeforeUnmount(close)
</script>

<template>
  <div ref="root" class="select" :class="[size ?? 'md', { open }]">
    <button
      type="button"
      class="trigger"
      :aria-label="ariaLabel"
      aria-haspopup="listbox"
      :aria-expanded="open"
      @click="toggle"
      @keydown="onKey"
    >
      <span class="value">{{ current }}</span>
      <ChevronDown class="arrow" :size="size === 'sm' ? 14 : 18" aria-hidden="true" />
    </button>
    <ul v-if="open" ref="list" class="menu" role="listbox" :aria-label="ariaLabel">
      <li
        v-for="(o, i) in options"
        :key="String(o.value)"
        role="option"
        :aria-selected="o.value === model"
        :class="{ highlighted: i === highlighted }"
        @pointerenter="highlighted = i"
        @click="choose(i)"
      >
        <span>{{ o.label }}</span>
        <Check v-if="o.value === model" :size="16" aria-hidden="true" />
      </li>
    </ul>
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
.open .trigger,
.trigger:focus-visible {
  outline: none;
  border-color: var(--primary);
  box-shadow: 0 0 0 3px var(--primary-soft);
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
.open .arrow {
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
  position: absolute;
  z-index: 20;
  top: calc(100% + var(--sp-1));
  left: 0;
  min-width: 100%;
  max-height: 320px;
  overflow-y: auto;
  margin: 0;
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
.menu li.highlighted {
  background: var(--hover);
}
.menu li[aria-selected='true'] {
  color: var(--primary);
  font-weight: 600;
}
@keyframes pop {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
}
</style>
