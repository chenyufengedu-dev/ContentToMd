<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import type { Config } from '../core/config'
import type { Job } from '../core/pipeline'
import { buildMarkdown, safeFileTitle, today } from '../core/note'
import { writeNote } from '../shell/tauri'

const props = defineProps<{ config: Config; job: Job; existingTags: string[] }>()
const emit = defineEmits<{ saved: [string]; discard: [] }>()

// 标签和关键词用一个输入框编辑，逗号或顿号分隔
const splitList = (s: string) => [
  ...new Set(
    s
      .split(/[,，、]/)
      .map((x) => x.trim())
      .filter(Boolean),
  ),
]
const d = props.job.draft!
const form = reactive({
  title: d.title,
  domainId: d.domainId,
  tags: d.tags.join('，'),
  keywords: d.keywords.join('，'),
  summary: d.summary,
  body: d.body,
})
const tagList = computed(() => splitList(form.tags))
const known = computed(() => new Set(props.existingTags))
const showSource = ref(false)

const saving = ref(false)
const saveError = ref<string | null>(null)
const titleMissing = computed(() => !form.title.trim())

async function save() {
  if (saving.value || titleMissing.value) return
  saving.value = true
  saveError.value = null
  const domain = props.config.domains.find((x) => x.id === form.domainId)?.name ?? '其他'
  const title = form.title.trim()
  const md = buildMarkdown(
    {
      title,
      domainId: form.domainId,
      tags: tagList.value,
      keywords: splitList(form.keywords),
      summary: form.summary.trim(),
      body: form.body.trim(),
    },
    // 来源、平台、作者由 F02 分享文字解析填入（S1 第 4 步），这一步先留空
    {
      domain,
      type: props.job.type,
      mode: props.job.mode,
      source: '',
      platform: '',
      author: '',
      created: today(),
      cover: '',
    },
  )
  try {
    emit('saved', await writeNote(props.config.vaultPath, domain, safeFileTitle(title), today(), md))
  } catch (e) {
    // 保存失败时编辑中的内容保留（方案第 7 节）
    saveError.value = String(e)
  } finally {
    saving.value = false
  }
}

const confirmingDiscard = ref(false)

// 快捷键：Ctrl+S 保存，Esc 关闭弹出的确认（方案第 11 节）
function onKey(e: KeyboardEvent) {
  if (e.ctrlKey && e.key.toLowerCase() === 's') {
    e.preventDefault()
    save()
  } else if (e.key === 'Escape') confirmingDiscard.value = false
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <main class="confirm" :class="{ split: showSource }">
    <div class="editor">
      <div class="props card">
        <label
          >标题
          <input v-model="form.title" maxlength="30" />
        </label>
        <p v-if="titleMissing" class="err small">标题不能为空</p>
        <label
          >领域
          <select v-model="form.domainId">
            <option v-for="x in config.domains" :key="x.id" :value="x.id">{{ x.name }}</option>
          </select>
        </label>
        <p v-if="job.domainFallback" class="warn-text small">AI 没有选出合适的领域，已暂时放到“其他”，请选一个</p>
        <label
          >标签
          <input v-model="form.tags" placeholder="用逗号分隔" />
        </label>
        <div class="chips">
          <span v-for="t in tagList" :key="t" class="chip">{{ t }}<sup v-if="!known.has(t)" class="new">新</sup></span>
        </div>
        <label
          >关键词
          <input v-model="form.keywords" placeholder="用逗号分隔" />
        </label>
        <label
          >这条讲什么
          <textarea v-model="form.summary" rows="2" />
        </label>
      </div>
      <p class="muted small">{{ job.mode }} · {{ job.type }} · {{ job.fileName }} · 内容来自语音转写，没有分析画面</p>
      <textarea v-model="form.body" class="body" spellcheck="false" />
    </div>

    <aside v-if="showSource" class="source card">
      <h3>原文（转写稿）</h3>
      <div class="source-text">{{ job.transcript }}</div>
    </aside>

    <footer>
      <button class="link" @click="showSource = !showSource">{{ showSource ? '收起原文' : '对照原文' }}</button>
      <span v-if="saveError" class="err">保存失败：{{ saveError }}</span>
      <span class="spacer" />
      <template v-if="confirmingDiscard">
        <span>确定放弃这一条吗？</span>
        <button class="danger-btn" @click="emit('discard')">放弃</button>
        <button @click="confirmingDiscard = false">取消</button>
      </template>
      <template v-else>
        <button @click="confirmingDiscard = true">放弃</button>
        <button class="primary" :disabled="saving || titleMissing" @click="save">
          {{ saving ? '保存中…' : '保存' }} <span class="hint-key">Ctrl+S</span>
        </button>
      </template>
    </footer>
  </main>
</template>

<style scoped>
.confirm {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 16px;
  max-width: 900px;
  margin: 0 auto;
  padding: 16px 24px 80px;
}
.confirm.split {
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  max-width: 1400px;
}
.card {
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 12px 16px;
}
.props label {
  display: grid;
  grid-template-columns: 80px 1fr;
  gap: 8px;
  align-items: center;
  margin-bottom: 8px;
  font-size: 13px;
}
input,
select,
textarea {
  padding: 6px 8px;
  border: 1px solid var(--line);
  border-radius: 4px;
  font: inherit;
  background: var(--bg);
  color: var(--fg);
  min-width: 0;
}
textarea {
  resize: vertical;
}
.body {
  width: 100%;
  box-sizing: border-box;
  min-height: 420px;
  font-family: Consolas, 'Microsoft YaHei UI', monospace;
  font-size: 13px;
  line-height: 1.6;
}
.chips {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin: -2px 0 8px 88px;
}
.chip {
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 1px 8px;
  font-size: 12px;
}
.new {
  color: var(--primary);
  margin-left: 2px;
}
.source {
  max-height: calc(100vh - 160px);
  overflow: auto;
  position: sticky;
  top: 16px;
}
.source h3 {
  font-size: 14px;
  margin: 0 0 8px;
}
.source-text {
  white-space: pre-wrap;
  font-size: 13px;
  line-height: 1.7;
}
.muted {
  color: var(--muted);
}
.small {
  font-size: 12px;
  margin: 0 0 8px 88px;
}
p.muted.small {
  margin: 8px 0;
}
.err {
  color: var(--err);
}
.warn-text {
  color: var(--warn);
}
footer {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  gap: 10px;
  align-items: center;
  padding: 10px 24px;
  background: var(--card);
  border-top: 1px solid var(--line);
}
.spacer {
  flex: 1;
}
.danger-btn {
  background: var(--err);
  border-color: var(--err);
  color: #fff;
}
.hint-key {
  opacity: 0.7;
  font-size: 12px;
  margin-left: 4px;
}
</style>
