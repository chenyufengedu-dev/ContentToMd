<script lang="ts">
export type Page = 'home' | 'library' | 'settings'
</script>

<script setup lang="ts">
// 自绘标题栏：软件名、正中间的页面切换（胶囊形分段）、窗口按钮。空白处可以拖动窗口、双击最大化
import { Minus, Square, X } from 'lucide-vue-next'
import { minimizeWindow, toggleMaximizeWindow, closeWindow } from '../shell/tauri'

/** onlySettings：第一次使用、还没配置完时只能停在设置页 */
const props = defineProps<{ page: Page; onlySettings: boolean }>()
const emit = defineEmits<{ navigate: [Page] }>()
const PAGES: { id: Page; label: string }[] = [
  { id: 'home', label: '新增' },
  { id: 'library', label: '收藏库' },
  { id: 'settings', label: '设置' },
]
</script>

<template>
  <header class="titlebar" data-tauri-drag-region>
    <div class="brand" data-tauri-drag-region>
      <span class="logo" aria-hidden="true" />
      <span data-tauri-drag-region>ContentToMd</span>
    </div>
    <nav class="nav" aria-label="页面">
      <!-- 当前页下面的白色底块，切换时滑过去 -->
      <span class="nav-thumb" :style="{ '--i': PAGES.findIndex((x) => x.id === props.page) }" aria-hidden="true" />
      <button
        v-for="x in PAGES"
        :key="x.id"
        class="nav-item"
        :aria-current="page === x.id ? 'page' : undefined"
        :disabled="onlySettings && x.id !== 'settings'"
        @click="emit('navigate', x.id)"
      >
        {{ x.label }}
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
.nav-thumb {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 80px;
  height: var(--h-xs);
  border-radius: var(--radius-pill);
  background: var(--card);
  box-shadow: var(--shadow-card);
  transform: translateX(calc(var(--i) * (80px + 2px)));
  transition: transform 260ms cubic-bezier(0.2, 0, 0, 1);
}

.nav-item {
  position: relative; /* 文字在白色底块上面 */
  height: var(--h-xs);
  width: 80px;
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
  color: var(--fg-strong);
  font-weight: var(--fw-label);
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
