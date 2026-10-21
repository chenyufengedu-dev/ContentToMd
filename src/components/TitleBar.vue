<script setup lang="ts">
// 自绘标题栏：软件名、页面切换、窗口按钮。空白处可以拖动窗口、双击最大化
import { Star, Settings, Minus, Square, X } from 'lucide-vue-next'
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
    <nav class="nav">
      <button
        class="nav-item"
        :aria-current="page === 'home' ? 'page' : undefined"
        :disabled="homeDisabled"
        @click="emit('navigate', 'home')"
      >
        <Star :size="16" />收藏
      </button>
      <button
        class="nav-item"
        :aria-current="page === 'settings' ? 'page' : undefined"
        @click="emit('navigate', 'settings')"
      >
        <Settings :size="16" />设置
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
  margin-left: auto;
  display: flex;
  gap: var(--sp-1);
  margin-right: var(--sp-3);
}
.nav-item {
  height: var(--h-sm);
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 var(--px-sm);
  border: 0;
  border-radius: var(--radius-sm);
  background: none;
  color: var(--muted);
  font-size: var(--fs-sm);
}
.nav-item[aria-current='page'] {
  color: var(--primary);
}
.nav-item:hover:not(:disabled) {
  background: var(--hover);
}
.window-controls {
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
