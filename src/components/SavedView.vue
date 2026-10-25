<script setup lang="ts">
// 保存成功（设计稿：设计稿/保存成功/定稿-保存成功.webp）。和处理中成一对：
// 左边同一个预览框，放这条笔记的真实文字缩略预览；右边“已保存”、文件名、所在文件夹和两个按钮
import { vPress } from './pressFeedback'
import { computed } from 'vue'
import { Check, CircleAlert, Coins, ExternalLink, Folder } from './icons'
import type { SavedNote } from '../pages/ConfirmPage.vue'
import { formatYuan } from '../core/cost'

const props = defineProps<{
  note: SavedNote
  /** 存放位置（storeLabel）：仓库名 / 子文件夹，或普通文件夹名 */
  location: string
  /** 这一条的估算花费（元，F14）；没填价格、算不出来时不显示 */
  cost?: number
}>()
const emit = defineEmits<{ open: []; next: [] }>()

const parts = computed(() => props.note.path.split(/[\\/]/))
const fileName = computed(() => parts.value.at(-1) ?? '')
const folder = computed(() => [props.location, ...parts.value.slice(0, -1)].join(' / '))
/** 正文前几行；框里放不下的由渐隐遮住 */
const lines = computed(() =>
  props.note.text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 8),
)
</script>

<template>
  <div class="saved">
    <div class="frame note-preview-frame">
      <div class="sheet note-preview-sheet">
        <p class="pv-title">{{ note.title }}</p>
        <p v-if="note.summary" class="pv-summary">{{ note.summary }}</p>
        <div class="pv-body">
          <p v-for="(l, i) in lines" :key="i">{{ l }}</p>
        </div>
      </div>
    </div>

    <div class="status">
      <p class="done"><Check :size="14" aria-hidden="true" />已保存</p>
      <p class="file-name" :title="fileName">{{ fileName }}</p>
      <p class="folder" :title="folder">
        <Folder :size="14" aria-hidden="true" />
        <span class="folder-location">{{ [location, ...parts.slice(0, -2)].join(' / ') }}</span>
        <span class="folder-domain">/ {{ parts.at(-2) }}</span>
      </p>
      <p v-if="cost !== undefined" class="cost">
        <Coins :size="14" aria-hidden="true" />本次估算费用：{{ formatYuan(cost) }}
      </p>

      <div v-if="note.failedImages.length" class="img-fail">
        <p class="img-fail-title">
          <CircleAlert :size="14" aria-hidden="true" />笔记已保存，{{ note.failedImages.length }} 张图片保存失败。
        </p>
        <p class="img-fail-names">{{ note.failedImages.join('、') }}</p>
      </div>

      <div class="buttons">
        <button v-press class="soft" @click="emit('open')">
          <ExternalLink :size="14" aria-hidden="true" />打开笔记
        </button>
        <button v-press="'tactile'" class="primary" @click="emit('next')">
          继续收藏<span class="kbd">Ctrl+Enter</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.saved {
  display: flex;
  gap: var(--sp-6);
  align-items: stretch;
  padding: var(--sp-6);
  background: var(--card);
  border-radius: var(--panel-radius);
  box-shadow: var(--shadow-card);
}

/* ---- 预览框：和处理中同一个相框 ---- */
.sheet p {
  margin: 0;
}
.pv-title {
  font-size: var(--fs-md);
  font-weight: var(--fw-heading);
  color: var(--fg-strong);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pv-summary {
  margin-top: var(--sp-1) !important;
  font-size: var(--fs-xs);
  color: var(--faint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pv-body {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  margin-top: var(--sp-3);
  font-size: var(--fs-xs);
  line-height: 1.9;
  color: var(--muted);
  /* 正文越往下越淡，像一张纸的缩小版 */
  mask-image: linear-gradient(to bottom, #000 55%, transparent);
}
.pv-body p {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ---- 右 ---- */
.status {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
}
.status p {
  margin: 0;
}
.done {
  display: flex;
  align-items: center;
  gap: var(--sp-1);
  font-size: var(--fs-sm);
  font-weight: var(--fw-label);
  color: var(--ok);
}
.file-name {
  margin-top: var(--sp-2) !important;
  font-size: var(--fs-lg);
  font-weight: var(--fw-heading);
  line-height: 1.5;
  color: var(--fg-strong);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  overflow-wrap: anywhere;
}
.folder {
  display: flex;
  align-items: center;
  gap: var(--sp-1);
  margin-top: var(--sp-2) !important;
  font-size: var(--fs-sm);
  color: var(--faint);
}
.folder-location {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.folder-domain {
  flex: none;
  max-width: 50%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--muted);
}
.folder svg,
.cost svg {
  flex: none;
}
.cost {
  display: flex;
  align-items: center;
  gap: var(--sp-1);
  margin-top: var(--sp-1) !important;
  font-size: var(--fs-sm);
  color: var(--faint);
}
.img-fail {
  margin-top: var(--sp-4);
  font-size: var(--fs-sm);
}
.img-fail-title {
  display: flex;
  align-items: center;
  gap: var(--sp-1);
  color: var(--warn);
}
.img-fail-names {
  margin-top: 2px !important;
  padding-left: calc(14px + var(--sp-1));
  color: var(--faint);
}
.buttons {
  display: flex;
  gap: var(--sp-2);
  margin-top: var(--sp-6);
}
.buttons button {
  flex: 1;
  padding: 0 var(--px-sm);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--sp-2);
  white-space: nowrap;
}
.soft {
  border: 0;
  background: var(--hover);
}
.soft:hover:not(:disabled) {
  background: var(--line);
}
.kbd {
  font-size: var(--fs-xs);
  font-weight: 400;
  opacity: 0.7;
}
.open-err {
  margin-top: var(--sp-2) !important;
  font-size: var(--fs-sm);
  color: var(--err);
}
</style>
