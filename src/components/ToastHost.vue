<script setup lang="ts">
// 顶部居中的小提示条：在 App 最外层放一个，任何地方调用 toast('已保存。') 都会显示在这里（见 useToast.ts）
import { vPress } from './pressFeedback'
import { Check, CircleAlert } from './icons'
import { current, dismiss } from './useToast'
</script>

<template>
  <Transition name="toast">
    <div v-if="current" :key="current.id" class="toast" role="status" aria-live="polite">
      <component
        :is="current.kind === 'error' ? CircleAlert : Check"
        :class="{ error: current.kind === 'error' }"
        :size="16"
        aria-hidden="true"
      />
      <span>{{ current.text }}</span>
      <button v-if="current.action" v-press class="action" @click="(current.action.run(), dismiss())">
        {{ current.action.label }}
      </button>
    </div>
  </Transition>
</template>

<style scoped>
.toast {
  position: fixed;
  top: calc(var(--titlebar-h) + var(--sp-4));
  left: 50%;
  z-index: 60;
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  max-width: min(520px, calc(100vw - 2 * var(--sp-5)));
  padding: var(--sp-3) var(--sp-5) var(--sp-3) var(--sp-4);
  border-radius: 999px;
  background: var(--card);
  box-shadow: var(--shadow-pop);
  color: var(--fg-strong);
  font-size: var(--fs-md);
  line-height: 1.4;
  transform: translateX(-50%);
}
.toast svg {
  flex: none;
  color: var(--ok);
}
.toast svg.error {
  color: var(--err);
}
.action {
  flex: none;
  margin-left: var(--sp-2);
  padding: 0 var(--sp-3);
  height: var(--h-xs);
  border: 0;
  border-radius: var(--radius-pill);
  background: var(--accent-soft);
  color: var(--accent);
  font-size: var(--fs-sm);
  font-weight: var(--fw-label);
}
.action:hover {
  filter: brightness(0.96);
}
.toast-enter-active,
.toast-leave-active {
  transition:
    opacity 200ms cubic-bezier(0.2, 0, 0, 1),
    translate 200ms cubic-bezier(0.2, 0, 0, 1);
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  translate: 0 -8px;
}
@media (prefers-reduced-motion: reduce) {
  .toast-enter-active,
  .toast-leave-active {
    transition: opacity 120ms;
  }
  .toast-enter-from,
  .toast-leave-to {
    translate: 0 0;
  }
}
</style>
