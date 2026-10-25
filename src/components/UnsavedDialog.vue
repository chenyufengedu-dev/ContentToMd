<script setup lang="ts">
// 设置页未保存时切换页面或关闭软件，提供保存、放弃修改和继续设置。
import NoticeDialog from './NoticeDialog.vue'

defineProps<{ busy?: boolean }>()
const emit = defineEmits<{ save: []; discard: []; stay: [] }>()
</script>

<template>
  <NoticeDialog
    title="设置尚未保存"
    neutral-text="继续设置"
    cancel-text="放弃修改"
    :ok-text="busy ? '保存中…' : '保存设置'"
    @neutral="emit('stay')"
    @cancel="emit('discard')"
    @ok="!busy && emit('save')"
  >
    <p>保存后再离开，或放弃本次修改。</p>
    <slot />
  </NoticeDialog>
</template>
