<script setup lang="ts">
import { vPress } from './pressFeedback'
import { toast } from './useToast'

const props = defineProps<{ detail: string }>()
async function copy() {
  try {
    await navigator.clipboard.writeText(props.detail)
  } catch {
    toast('复制失败，请稍后重试。', { kind: 'error' })
    return
  }
  toast('已复制，反馈问题时可以粘贴给作者。')
}
</script>

<template>
  <button v-press class="link copy-error" @click="copy">复制错误信息</button>
</template>

<style scoped>
.copy-error {
  color: var(--muted);
  font-size: var(--fs-sm);
}
</style>
