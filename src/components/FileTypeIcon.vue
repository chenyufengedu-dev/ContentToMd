<script setup lang="ts">
// 文件类型图标：每种文件一个自己的颜色。放进去的文件、处理中、投放页底下的“支持哪些”都用它。
// Markdown、PDF、图片三个是作者以前项目里的图标（原样复用）；txt、Word、音频、视频照同样的画法补的。
// 各类型的颜色是图标自己的识别色，设计规范里还没有，待登记
import type { FileKind } from './fileKind'

withDefaults(defineProps<{ kind: FileKind; size?: number }>(), { size: 20 })
</script>

<template>
  <svg :width="size" :height="size" viewBox="0 0 24 24" class="file-icon" aria-hidden="true">
    <template v-if="kind === 'md'">
      <rect x="1" y="1" width="22" height="22" rx="3.7" fill="#637b99" />
      <path fill="#fff" d="M6.55 17.35V6.65H9l3 4.7 3-4.7h2.45v10.7h-2.55v-6.4L12 14.95l-2.9-4v6.4Z" />
    </template>

    <g v-else-if="kind === 'pdf'" transform="translate(1.25 0) scale(.895 1)">
      <path fill="#ef413b" d="M4 1h11.2L23 8.4V20a3 3 0 0 1-3 3H4a3 3 0 0 1-3-3V4a3 3 0 0 1 3-3Z" />
      <path fill="rgba(255,255,255,.42)" d="M15.2 1v5.2a2.2 2.2 0 0 0 2.2 2.2H23Z" />
      <path
        fill="none"
        stroke="#fff"
        stroke-width="1.45"
        stroke-linecap="round"
        stroke-linejoin="round"
        d="M11.2 5.5c.15 4.2-1.55 8.4-4.25 11.75M11.2 5.5c.45 4.35 2.45 7.85 5.7 10M6.95 17.25c3.5-1.45 6.85-1.85 9.95-1.75M6.95 17.25c-2.5 1.05-3.15 2.05-2.55 2.55.65.55 1.75-.45 2.55-2.55Z"
      />
    </g>

    <template v-else-if="kind === 'image'">
      <rect x="1.5" y="1.5" width="21" height="21" rx="2.8" fill="none" stroke="#087eec" stroke-width="2.5" />
      <circle cx="7.5" cy="7.7" r="2.15" fill="#087eec" />
      <path fill="#087eec" d="M3.6 19.1 9.6 12.7l3.5 3.55 2.45-2.5 4.85 5.35Z" />
    </template>

    <!-- 下面四个是照上面的画法补的：文档类沿用 PDF 的折角文档，音视频沿用 Markdown 的实心圆角方块 -->
    <g v-else-if="kind === 'txt' || kind === 'docx'" transform="translate(1.25 0) scale(.895 1)">
      <path
        :fill="kind === 'txt' ? '#8a96a8' : '#2b579a'"
        d="M4 1h11.2L23 8.4V20a3 3 0 0 1-3 3H4a3 3 0 0 1-3-3V4a3 3 0 0 1 3-3Z"
      />
      <path fill="rgba(255,255,255,.42)" d="M15.2 1v5.2a2.2 2.2 0 0 0 2.2 2.2H23Z" />
      <path
        v-if="kind === 'txt'"
        fill="none"
        stroke="#fff"
        stroke-width="1.7"
        stroke-linecap="round"
        d="M6.5 12h11M6.5 15.5h11M6.5 19h6.5"
      />
      <path
        v-else
        fill="none"
        stroke="#fff"
        stroke-width="1.9"
        stroke-linecap="round"
        stroke-linejoin="round"
        d="M5.5 10.5 8.2 19l3.8-7.8 3.8 7.8 2.7-8.5"
      />
    </g>

    <template v-else-if="kind === 'audio'">
      <rect x="1" y="1" width="22" height="22" rx="3.7" fill="#f08a24" />
      <path
        fill="none"
        stroke="#fff"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
        d="M10 16.5V7.2l6.5-1.4v9.2"
      />
      <circle cx="8" cy="16.6" r="2.2" fill="#fff" />
      <circle cx="14.5" cy="15.2" r="2.2" fill="#fff" />
    </template>

    <template v-else>
      <rect x="1" y="1" width="22" height="22" rx="3.7" fill="#10a58a" />
      <path
        fill="#fff"
        stroke="#fff"
        stroke-width="1.6"
        stroke-linejoin="round"
        d="M9.3 7.6v8.8a.5.5 0 0 0 .75.43l7.3-4.4a.5.5 0 0 0 0-.86l-7.3-4.4a.5.5 0 0 0-.75.43Z"
      />
    </template>
  </svg>
</template>

<style scoped>
.file-icon {
  flex: none;
  overflow: visible;
}
</style>
