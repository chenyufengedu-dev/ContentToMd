<script setup lang="ts">
// 设置页有没保存的改动时，切换页面或关闭软件前问一句：保存 / 放弃更改 / 取消（留在设置页，点框外、按 Esc 也是取消）
import NoticeDialog from './NoticeDialog.vue'

defineProps<{ busy?: boolean }>()
const emit = defineEmits<{ save: []; discard: []; stay: [] }>()
</script>

<template>
  <NoticeDialog
    title="设置还没保存"
    neutral-text="取消"
    cancel-text="放弃更改"
    :ok-text="busy ? '保存中…' : '保存'"
    @neutral="emit('stay')"
    @cancel="emit('discard')"
    @ok="!busy && emit('save')"
  >
    <p>你改了设置，但还没有保存。现在离开，这些改动会丢掉。</p>
    <slot />
  </NoticeDialog>
</template>
