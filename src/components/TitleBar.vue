<script setup lang="ts">
// 自绘标题栏：软件名、正中间的页面切换（胶囊形分段）、窗口按钮。空白处可以拖动窗口、双击最大化
import { Minus, Square, X } from 'lucide-vue-next'
import { minimizeWindow, toggleMaximizeWindow, closeWindow } from '../shell/tauri'

defineProps<{ page: 'home' | 'settings'; homeDisabled: boolean }>()
const emit = defineEmits<{ navigate: ['home' | 'settings'] }>()
</script>

<template>
  <header class="titlebar" data-tauri-drag-region>
    <div class="brand" data-tauri-drag-region>
      <span class="logo" aria-hidden="true" />
      <span data-tauri-drag-region>ContentToMd</span>
    </div>
    <nav class="nav" aria-label="页面">
      <button
        class="nav-item"
        :aria-current="page === 'home' ? 'page' : undefined"
        :disabled="homeDisabled"
        @click="emit('navigate', 'home')"
      >
        收藏
      </button>
      <button
        class="nav-item"
        :aria-current="page === 'settings' ? 'page' : undefined"
        @click="emit('navigate', 'settings')"
      >
        设置
      </button>
    </nav>
    <div class="window-controls">
      <button class="win" aria-label="最小化" @click="minimizeWindow"><Minus :size="16" /></button>
      <button class="win" aria-label="最大化" @click="toggleMaximizeWindow"><Square :size="13" /></button>
      <button class="win close" aria-label="关闭" @click="closeWindow"><X :size="16" /></button>
    </div>
  </header>
</template>

<style scoped>
.titlebar {
  position: relative;
  height: var(--titlebar-h);
  display: flex;
  align-items: center;
  padding-left: var(--sp-4);
  user-select: none;
}
.brand {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  font-size: var(--fs-md);
  color: var(--fg-strong);
}
.logo {
  width: 18px;
  height: 18px;
  border-radius: 5px;
  background: var(--primary);
  position: relative;
}
.logo::after {
  content: '';
  position: absolute;
  inset: 5px;
  border-radius: 2px;
  border: 1.5px solid var(--on-primary);
}
.nav {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 2px;
  padding: 3px;
  border-radius: var(--radius-pill);
  background: var(--hover);
}
.nav-item {
  height: var(--h-xs);
  min-width: 72px;
  padding: 0 var(--px-md);
  border: 0;
  border-radius: var(--radius-pill);
  background: none;
  color: var(--muted);
  font-size: var(--fs-md);
}
.nav-item:hover:not(:disabled) {
  background: none;
  color: var(--fg-strong);
}
.nav-item[aria-current='page'] {
  background: var(--card);
  color: var(--fg-strong);
  font-weight: var(--fw-label);
  box-shadow: var(--shadow-card);
}
.window-controls {
  margin-left: auto;
  display: flex;
  height: 100%;
}
.win {
  width: 46px;
  height: 100%;
  border: 0;
  border-radius: 0;
  background: none;
  color: var(--muted);
  display: grid;
  place-items: center;
}
.win.close:hover:not(:disabled) {
  background: var(--err);
  color: var(--on-primary);
}
</style>
