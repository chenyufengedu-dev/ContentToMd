<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { FilePlus2, Link2 } from '../src/components/icons'
import FileTypeIcon from '../src/components/FileTypeIcon.vue'
import ToastHost from '../src/components/ToastHost.vue'
import WelcomeCelebration from '../src/components/WelcomeCelebration.vue'
import { dismiss, toast } from '../src/components/useToast'
import { vPress } from '../src/components/pressFeedback'
import { hasWelcomeCelebrationPlayed, markWelcomeCelebrationPlayed } from './welcomeCelebration'
const props = defineProps<{ result: 'complete' | 'skip'; reduced: boolean }>()
const celebrate = ref(!hasWelcomeCelebrationPlayed())
const mode = ref('要点提炼')
const requirements = ref('')
const formats = ['audio', 'image', 'md', 'pdf', 'docx'] as const
const labels = ['音视频', '截图', 'md / txt', 'pdf', 'docx']
onMounted(() => {
  if (celebrate.value)
    toast(props.result === 'complete' ? '准备好了，放入第一条内容试试。' : '欢迎使用，需要时可到设置完成配置。')
})
onBeforeUnmount(dismiss)
</script>

<template>
  <main class="home" aria-label="导入首页预览">
    <nav aria-label="首页导航"><span class="selected">新增</span><span>收藏库</span><span>设置</span></nav>
    <section class="form">
      <button v-press="'ripple'" class="drop" @click="toast('这是首页预览，导入功能暂未接入。')">
        <FilePlus2 :size="48" /><strong>拖入或粘贴内容</strong>
        <span class="formats"
          ><span v-for="(kind, i) in formats" :key="kind"><FileTypeIcon :kind="kind" />{{ labels[i] }}</span></span
        >
      </button>
      <label
        >来源链接 · 选填<span class="source"><Link2 :size="18" /><input placeholder="粘贴链接或分享文字" /></span
      ></label>
      <fieldset>
        <legend>整理方式</legend>
        <div class="modes">
          <button
            v-for="label in ['要点提炼', '原文精修', '视觉收藏']"
            :key="label"
            v-press
            :class="{ active: mode === label }"
            :aria-pressed="mode === label"
            @click="mode = label"
          >
            {{ label }}
          </button>
        </div>
      </fieldset>
      <label
        >本次要求 · 选填<textarea
          v-model="requirements"
          maxlength="500"
          placeholder="比如：重点写可借鉴的做法 / 只要三句话总结"
        />
      </label>
      <div class="actions"><button disabled>开始处理 Ctrl+Enter</button></div>
    </section>
    <WelcomeCelebration
      v-if="celebrate && !reduced"
      :played="false"
      @played="markWelcomeCelebrationPlayed"
      @finished="celebrate = false"
    />
    <ToastHost />
  </main>
</template>

<style scoped>
.home {
  padding: var(--sp-6);
}
nav {
  position: absolute;
  top: var(--sp-3);
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  padding: var(--sp-1);
  gap: var(--sp-2);
  border-radius: var(--radius-pill);
  background: var(--bg);
}
nav span {
  padding: var(--sp-2) var(--sp-6);
  color: var(--muted);
}
nav .selected {
  background: var(--card);
  border-radius: var(--radius-pill);
  color: var(--fg-strong);
  box-shadow: var(--shadow-card);
}
.form {
  max-width: var(--collect-form-width);
  margin: var(--sp-4) auto;
  padding: var(--sp-6);
  background: var(--card);
  border-radius: var(--panel-radius);
  box-shadow: var(--shadow-card);
  display: grid;
  gap: var(--sp-4);
}
.drop {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--sp-4);
  padding: var(--sp-6);
  min-height: calc(var(--sp-7) * 4);
  background: var(--bg);
  border: 0;
  border-radius: var(--radius-md);
  color: var(--muted);
}
.drop strong {
  color: var(--fg-strong);
}
.formats,
.formats > span {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
}
.formats {
  gap: var(--sp-6);
  flex-wrap: wrap;
  justify-content: center;
}
label,
legend {
  color: var(--muted);
  font-size: var(--fs-md);
}
label {
  display: grid;
  gap: var(--sp-2);
}
.source {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  background: var(--bg);
  padding: 0 var(--sp-4);
  border-radius: var(--radius-md);
}
input {
  min-width: 0;
  flex: 1;
  height: var(--h-md);
  background: transparent;
  border: 0;
}
fieldset {
  border: 0;
  padding: 0;
  margin: 0;
}
legend {
  margin-bottom: var(--sp-2);
}
.modes {
  display: flex;
  gap: var(--sp-2);
  flex-wrap: wrap;
}
button {
  border: 0;
  border-radius: var(--radius-md);
  padding: var(--sp-2) var(--sp-5);
  background: var(--bg);
  color: var(--muted);
}
.modes .active {
  color: var(--accent);
  background: var(--card);
  box-shadow: var(--shadow-card);
}
textarea {
  background: var(--bg);
  padding: var(--sp-4);
  border: 0;
  border-radius: var(--radius-md);
  min-height: calc(var(--h-md) * 2);
  resize: vertical;
}
.actions {
  display: flex;
  justify-content: flex-end;
}
.actions button {
  height: var(--h-md);
}
@media (max-width: 760px) {
  nav {
    position: static;
    transform: none;
    width: fit-content;
    margin: 0 auto var(--sp-4);
  }
  .home {
    padding: var(--sp-4);
  }
}
</style>
