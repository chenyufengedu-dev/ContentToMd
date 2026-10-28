<script setup lang="ts">
import NoticeDialog from './NoticeDialog.vue'
import { ChevronRight } from './icons'
import { vPress } from './pressFeedback'
import { toast } from './useToast'
import { FEEDBACK_EMAIL, GITHUB_URL, REPO_PUBLIC } from '../core/projectInfo'
import { openLink } from '../shell/tauri'

defineProps<{ version: string }>()
const emit = defineEmits<{ close: [] }>()

async function copyEmail() {
  try {
    await navigator.clipboard.writeText(FEEDBACK_EMAIL)
  } catch {
    toast('邮箱复制失败，请手动复制。', { kind: 'error' })
    return
  }
  toast('邮箱已复制。')
}

async function openIssues() {
  try {
    await openLink(`${GITHUB_URL}/issues`)
  } catch {
    toast('GitHub 页面打开失败，请稍后重试。', { kind: 'error' })
  }
}
</script>

<template>
  <Teleport to="body">
    <NoticeDialog title="反馈问题" cancel-text="关闭" @cancel="emit('close')">
      <p>
        遇到问题或有建议，可以通过以下方式联系到我。附上截图和软件版本<span v-if="version">（v{{ version }}）</span
        >会更快解决。
      </p>
      <div class="feedback-row">
        <span class="feedback-email">邮箱 {{ FEEDBACK_EMAIL }}</span>
        <button v-press class="feedback-action" aria-label="复制邮箱" @click="copyEmail">复制</button>
      </div>
      <div v-if="REPO_PUBLIC" class="feedback-or">或</div>
      <div v-if="REPO_PUBLIC" class="feedback-row">
        <span>在 GitHub 提交问题</span>
        <button v-press class="feedback-action" aria-label="打开 GitHub 问题页" @click="openIssues">
          打开<ChevronRight :size="14" aria-hidden="true" />
        </button>
      </div>
    </NoticeDialog>
  </Teleport>
</template>

<style scoped>
.feedback-row {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: var(--sp-3);
  margin-top: var(--sp-4);
}
.feedback-or {
  margin-top: var(--sp-3);
  color: var(--muted);
}
.feedback-action {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-1);
  height: var(--h-xs);
  padding: 0 var(--sp-1);
  border: 0;
  background: none;
  color: var(--accent);
}
.feedback-action:focus:not(:focus-visible) {
  outline: none;
}
.feedback-action:focus-visible {
  outline: calc(var(--sp-1) / 2) solid var(--accent);
  outline-offset: calc(var(--sp-1) / 2);
}
.feedback-email {
  overflow-wrap: anywhere;
  user-select: text;
}
</style>
