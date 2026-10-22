<script setup lang="ts">
// 处理中 / 失败（设计稿：设计稿/处理状态和设置页/定稿-处理中-*.webp）。
// 左边一个缩略图大小的预览框：整理前是笔记骨架加一道很淡的光泽；整理时 AI 生成的文字一个字一个字打出来，
// 骨架被文字挤下去。右边是文件信息和步骤：已完成绿色虚线小圆环，进行中灰色虚线小圆环在转，没开始的不转
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import FileTypeIcon from './FileTypeIcon.vue'
import { kindOfName, type FileKind } from './fileKind'
import { type Job, STEP_LABELS } from '../core/pipeline'
import type { ErrorCode } from '../core/errors'

const props = defineProps<{
  job: Job
  failed: boolean
  summary: { name: string; info: string }
  error: { code?: ErrorCode; message: string; detail?: string } | null
  now: number
}>()
const emit = defineEmits<{ cancel: []; retry: []; back: []; goSettings: [] }>()

/** 右边文件那一行的小图标：图片、文字类按文件名认，音频、视频各一个 */
const fileKind = computed<FileKind>(() =>
  props.job.images
    ? 'image'
    : props.job.type === '音频'
      ? 'audio'
      : props.job.type === '视频'
        ? 'video'
        : kindOfName(props.job.fileName),
)

// ---- 打字机：显示的字数追着 AI 已生成的字数走，匀速约每秒 25 字，看得清、有“正在写”的感觉；落后超过 800 字才加快，免得和真实进度差太远 ----
const shown = ref(0)
const target = computed(() => props.job.preview ?? '')
let timer: number | undefined
watch(
  target,
  (t) => {
    if (t.length < shown.value) shown.value = 0 // 重试时重新开始
    if (timer === undefined && shown.value < t.length) timer = window.setInterval(tick, 40)
  },
  { immediate: true },
)
function tick() {
  const left = target.value.length - shown.value
  if (left <= 0) {
    clearInterval(timer)
    timer = undefined
    return
  }
  shown.value += left > 800 ? Math.ceil(left / 80) : 1
}
onBeforeUnmount(() => clearInterval(timer))
/** 从第一个字一直往下打；框满了旧的行往上移出去（见 .typing 的样式），开头不会被换掉 */
const typed = computed(() => target.value.slice(0, shown.value))
/** 字多到框放不下时，顶部才渐隐（字少时第一行不能被淡掉） */
const typingEl = ref<HTMLElement>()
const overflowing = ref(false)
watch(typed, () =>
  nextTick(() => {
    const el = typingEl.value
    overflowing.value = !!el && el.scrollHeight > el.clientHeight + 1
  }),
)

/** 骨架：两三组“小标题 + 几行段落”，宽度是占框宽的比例 */
const SKELETON = [
  [38, 94, 86, 58],
  [30, 94, 78, 90, 46],
  [34, 92, 72, 84],
  [28, 90, 64],
]

/** 失败时后面没开始的步骤不显示，免得像是还会继续 */
const visibleSteps = computed(() => {
  const at = props.job.steps.findIndex((s) => s.status === 'failed')
  return props.failed && at >= 0 ? props.job.steps.slice(0, at + 1) : props.job.steps
})
const isAuthError = computed(() => props.error?.code === 'auth')
/** 文件本身的问题（读不出声音、没有语音），重试多少次都一样，只给“返回修改” */
const canRetry = computed(() => !['decode', 'no_speech', 'too_long'].includes(props.error?.code ?? ''))
function elapsed(s: { startedAt?: number; endedAt?: number }) {
  if (!s.startedAt) return ''
  return `${Math.round(((s.endedAt ?? props.now) - s.startedAt) / 1000)} 秒`
}
</script>

<template>
  <div class="proc">
    <!-- 左：预览框 -->
    <div class="frame">
      <div class="sheet">
        <div v-if="typed" ref="typingEl" class="typing" :class="{ overflowing }">
          <p class="typed">{{ typed }}<span v-if="!failed" class="caret" /></p>
        </div>
        <div class="skeleton" :class="{ shimmer: !failed }" aria-hidden="true">
          <div v-for="(g, i) in SKELETON" :key="i" class="sk-group">
            <span v-for="(w, j) in g" :key="j" :class="j === 0 ? 'sk-h' : 'sk-l'" :style="{ width: `${w}%` }" />
          </div>
        </div>
      </div>
      <div v-if="!failed" class="generating" :class="{ bottom: typed }">
        <svg class="spinner" viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="8" cy="8" r="6" class="track" />
          <circle cx="8" cy="8" r="6" class="arc" />
        </svg>
        正在生成
      </div>
    </div>

    <!-- 右：文件和步骤 -->
    <div class="status">
      <div class="file">
        <FileTypeIcon class="file-icon" :kind="fileKind" :size="16" />
        <span class="file-name">{{ summary.name }}</span>
        <span class="file-info">{{ summary.info }}</span>
      </div>

      <ol class="steps">
        <li v-for="s in visibleSteps" :key="s.id" class="step" :class="s.status">
          <svg class="ring" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" /></svg>
          <span class="step-name">{{ STEP_LABELS[s.id] }}</span>
          <span class="step-time">{{
            s.status === 'running'
              ? [s.note, elapsed(s)].filter(Boolean).join(' · ')
              : s.status === 'failed'
                ? '失败'
                : s.status === 'done'
                  ? elapsed(s)
                  : ''
          }}</span>
        </li>
      </ol>

      <template v-if="failed && error">
        <!-- 失败：在原来提示语的位置只写一行原因，不加底色；怎么办交给按钮 -->
        <p class="hint fail-reason">{{ error.message }}</p>
        <details v-if="error.detail" class="detail">
          <summary>详细信息</summary>
          <pre>{{ error.detail }}</pre>
        </details>
        <div class="buttons">
          <button v-if="isAuthError" class="primary" @click="emit('goSettings')">去设置</button>
          <button v-else-if="canRetry" class="primary" @click="emit('retry')">重试</button>
          <button :class="canRetry || isAuthError ? 'soft' : 'primary'" @click="emit('back')">返回修改</button>
        </div>
      </template>
      <template v-else>
        <p class="hint">通常需要 20～40 秒，完成后自动进入确认</p>
        <div class="buttons">
          <button class="soft" @click="emit('cancel')">取消</button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.proc {
  display: flex;
  gap: var(--sp-6);
  align-items: stretch;
  padding: var(--sp-6);
  background: var(--card);
  border-radius: var(--panel-radius);
  box-shadow: var(--shadow-card);
}

/* ---- 预览框：一圈厚而淡的灰边，像缩略图的相框 ---- */
.frame {
  position: relative;
  flex: none;
  width: 400px;
  height: 260px;
  padding: 6px;
  border-radius: 20px;
  background: var(--hover);
}
.sheet {
  height: 100%;
  box-sizing: border-box;
  padding: var(--sp-5);
  display: flex;
  flex-direction: column;
  gap: var(--sp-4);
  border-radius: 14px;
  background: var(--card);
  overflow: hidden;
}
/* 打出来的字：框满后贴着底部，旧的行往上移出去，顶部渐隐 */
.typing {
  flex: 0 0 auto; /* 文字不让位，下面的骨架让位 */
  max-height: calc(100% - 28px);
  min-height: 0;
  margin-bottom: 28px; /* 给框底的“正在生成”留位置，最新一行不被压住 */
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  overflow: hidden;
}
.typing.overflowing {
  mask-image: linear-gradient(to bottom, transparent, #000 24px);
}
.typed {
  flex: none;
  margin: 0;
  font-size: var(--fs-sm);
  line-height: 1.8;
  color: var(--fg);
  white-space: pre-line;
}
.caret {
  display: inline-block;
  width: 1px;
  height: 1em;
  margin-left: 2px;
  vertical-align: -2px;
  background: var(--fg-strong);
  animation: blink 1s steps(1) infinite;
}
@keyframes blink {
  50% {
    opacity: 0;
  }
}
.skeleton {
  flex: 1 1 0;
  min-height: 0;
  position: relative;
  display: flex;
  flex-direction: column;
  gap: var(--sp-4);
  overflow: hidden;
  /* 越往下越淡 */
  mask-image: linear-gradient(to bottom, #000 65%, transparent);
}
.sk-group {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}
.sk-h,
.sk-l {
  display: block;
  flex: none;
  border-radius: var(--radius-pill);
  background: var(--hover);
}
.sk-h {
  height: 10px;
  background: var(--line);
}
.sk-l {
  height: 7px;
}
/* 很淡、很窄的光泽缓缓扫过骨架 */
.skeleton.shimmer::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(100deg, transparent 40%, rgb(255 255 255 / 55%) 50%, transparent 60%);
  transform: translateX(-100%);
  animation: shimmer 2.4s ease-in-out infinite;
}
@keyframes shimmer {
  to {
    transform: translateX(100%);
  }
}
/* “正在生成”：还没出字时在框的正中 */
/* 出字以后“正在生成”挪到框底，把整个框让给文字 */
.generating.bottom {
  top: auto;
  bottom: var(--sp-3);
  transform: translateX(-50%);
}
.generating {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding: var(--sp-2) var(--sp-3);
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--card);
  box-shadow: var(--shadow-card);
  font-size: var(--fs-xs);
  color: var(--fg);
  white-space: nowrap;
}
.spinner {
  width: 13px;
  height: 13px;
  animation: spin 0.9s linear infinite;
}
.spinner circle {
  fill: none;
  stroke-width: 2;
}
.spinner .track {
  stroke: var(--line);
}
.spinner .arc {
  stroke: var(--muted);
  stroke-linecap: round;
  stroke-dasharray: 10 40;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

/* ---- 右：文件和步骤 ---- */
.status {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center; /* 右边的文字和按钮整体在竖直方向上居中 */
}
.file {
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: center;
  column-gap: var(--sp-2);
  row-gap: 2px;
}
.file-icon {
  color: var(--muted);
}
.file-name {
  font-size: var(--fs-lg);
  font-weight: var(--fw-heading);
  color: var(--fg-strong);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* 元信息和图标左对齐 */
.file-info {
  grid-column: 1 / -1;
  font-size: var(--fs-sm);
  color: var(--muted);
}
.steps {
  margin: var(--sp-5) 0 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
}
.step {
  display: grid;
  grid-template-columns: 14px 88px auto;
  align-items: center;
  gap: var(--sp-2);
  color: var(--faint);
}
.ring {
  width: 14px;
  height: 14px;
}
.ring circle {
  fill: none;
  stroke: currentColor;
  stroke-width: 1.5;
  stroke-linecap: round;
  stroke-dasharray: 2.2 2.5;
}
.step-time {
  font-size: var(--fs-sm);
  color: var(--faint);
}
.step.done {
  color: var(--ok);
}
.step.running {
  color: var(--fg-strong);
}
.step.running .ring {
  color: var(--muted);
  animation: spin 2.4s linear infinite;
}
.step.failed {
  color: var(--err);
}
.step.failed .step-time {
  color: var(--err);
}
.hint {
  margin: var(--sp-3) 0 0;
  font-size: var(--fs-sm);
  color: var(--faint);
}
.fail-reason {
  color: var(--err);
}
.hint + .hint {
  margin-top: var(--sp-1);
}
.detail {
  margin-top: var(--sp-1);
  font-size: var(--fs-xs);
  color: var(--faint);
}
.detail summary {
  cursor: pointer;
}
.detail pre {
  max-height: 96px;
  overflow: auto;
  white-space: pre-wrap;
}
/* 按钮紧跟在提示语下面 */
.buttons {
  margin-top: var(--sp-4);
  display: flex;
  gap: var(--sp-2);
}
.buttons button {
  height: var(--h-xs);
  padding: 0 var(--px-sm);
  font-size: var(--fs-sm);
}
.soft {
  border: 0;
  background: var(--hover);
}
.soft:hover:not(:disabled) {
  background: var(--line);
}
</style>
