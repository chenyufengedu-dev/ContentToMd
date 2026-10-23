<script setup lang="ts">
// ⓘ 提示：鼠标悬停或用键盘聚焦时显示说明气泡。
// 气泡挂到页面最外层、按图标位置定位，不会被右栏这类可滚动区域的边缘切掉；靠近窗口边缘时自动往里收
import { ref } from 'vue'
import { Info } from './icons'

defineProps<{ text: string }>()

const btn = ref<HTMLElement>()
const pos = ref<{ left: number; top: number; below: boolean } | null>(null)
const MAX_W = 240
const GAP = 8

function show() {
  const r = btn.value?.getBoundingClientRect()
  if (!r) return
  const below = r.top < 72 // 上面放不下时放到下面
  const center = r.left + r.width / 2
  const left = Math.min(Math.max(GAP, center - MAX_W / 2), window.innerWidth - MAX_W - GAP)
  pos.value = { left, top: below ? r.bottom + GAP : r.top - GAP, below }
}
const hide = () => (pos.value = null)
</script>

<template>
  <span class="tip">
    <button
      ref="btn"
      type="button"
      class="tip-btn"
      :aria-label="text"
      @mouseenter="show"
      @mouseleave="hide"
      @focus="show"
      @blur="hide"
    >
      <Info :size="15" aria-hidden="true" />
    </button>
    <Teleport to="body">
      <Transition name="bubble">
        <span
          v-if="pos"
          class="bubble"
          :class="{ below: pos.below }"
          role="tooltip"
          :style="{ left: `${pos.left}px`, top: `${pos.top}px` }"
          >{{ text }}</span
        >
      </Transition>
    </Teleport>
  </span>
</template>

<style scoped>
.tip {
  display: inline-flex;
}
.tip-btn {
  width: 20px;
  height: 20px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: none;
  color: var(--faint);
  display: grid;
  place-items: center;
  cursor: help;
}
.tip-btn:hover:not(:disabled) {
  background: none;
  color: var(--muted);
}
.bubble {
  position: fixed;
  z-index: 100;
  width: max-content;
  max-width: 240px;
  padding: var(--sp-2) var(--sp-3);
  border-radius: var(--radius-sm);
  background: var(--fg-strong);
  color: var(--on-primary);
  font-size: var(--fs-xs);
  font-weight: 400;
  line-height: 1.6;
  white-space: normal;
  box-shadow: var(--shadow-pop);
  transform: translateY(-100%);
  pointer-events: none;
}
.bubble.below {
  transform: none;
}
.bubble-enter-active,
.bubble-leave-active {
  transition: opacity var(--ease);
}
.bubble-enter-from,
.bubble-leave-to {
  opacity: 0;
}
</style>
