<script setup lang="ts">
// ⓘ 提示：鼠标悬停或用键盘聚焦时显示说明气泡
import { Info } from 'lucide-vue-next'

defineProps<{ text: string }>()
</script>

<template>
  <span class="tip">
    <button type="button" class="tip-btn" :aria-label="text"><Info :size="15" aria-hidden="true" /></button>
    <span class="bubble" role="tooltip">{{ text }}</span>
  </span>
</template>

<style scoped>
.tip {
  position: relative;
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
  position: absolute;
  z-index: 30;
  bottom: calc(100% + var(--sp-2));
  left: 50%;
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
  opacity: 0;
  visibility: hidden;
  transform: translate(-50%, 4px);
  transition:
    opacity var(--ease),
    transform var(--ease),
    visibility var(--ease);
  pointer-events: none;
}
.tip:hover .bubble,
.tip-btn:focus-visible + .bubble {
  opacity: 1;
  visibility: visible;
  transform: translate(-50%, 0);
}
</style>
