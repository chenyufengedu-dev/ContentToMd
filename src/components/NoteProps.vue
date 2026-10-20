<script setup lang="ts">
// 笔记的领域、标签、关键词。两种样式共用一份数据：
// stack：右栏里竖着排（平时）；inline：标题下面一条横排（对照原文时）。
// 每一项带 view-transition-name，两种样式切换时由浏览器做位置过渡
import { computed, nextTick, ref } from 'vue'
import { Plus, X } from 'lucide-vue-next'
import type { Domain } from '../core/config'
import SelectBox from './SelectBox.vue'
import InfoTip from './InfoTip.vue'

const props = defineProps<{
  variant: 'stack' | 'inline'
  domains: Domain[]
  existingTags: string[]
  domainFallback?: boolean
  /** 横排时末尾显示的来源摘要，比如“商务礼仪.mp4 · 3:01 · 语音转写” */
  source?: string
}>()
const domainId = defineModel<number>('domainId', { required: true })
const tags = defineModel<string[]>('tags', { required: true })
const keywords = defineModel<string[]>('keywords', { required: true })

const known = computed(() => new Set(props.existingTags))
const domainOptions = computed(() => props.domains.map((d) => ({ value: d.id, label: d.name })))

type Field = 'tags' | 'keywords'
const adding = ref<Field | null>(null)
const draft = ref('')
const inputEl = ref<HTMLInputElement[]>([])

async function startAdding(f: Field) {
  adding.value = f
  draft.value = ''
  await nextTick()
  inputEl.value[0]?.focus()
}

/** 一次可以输入多个，用逗号或顿号分开；去空白、去重 */
function commit() {
  const list = adding.value === 'tags' ? tags.value : keywords.value
  const next = [...list]
  for (const x of draft.value.split(/[,，、]/).map((s) => s.trim())) if (x && !next.includes(x)) next.push(x)
  if (adding.value === 'tags') tags.value = next
  else keywords.value = next
  adding.value = null
}

const removeTag = (t: string) => (tags.value = tags.value.filter((x) => x !== t))
const removeKeyword = (k: string) => (keywords.value = keywords.value.filter((x) => x !== k))

const TIPS = {
  domain: '决定笔记保存到收藏库的哪个文件夹',
  tags: '用来分类和筛选；带“新”角标的是收藏库里还没有的标签',
  keywords: '用来以后搜索这条笔记',
}
</script>

<template>
  <div class="props" :class="variant">
    <div class="field" style="view-transition-name: prop-domain">
      <div class="field-head">
        <span class="label">领域</span>
        <InfoTip v-if="variant === 'stack'" :text="TIPS.domain" />
      </div>
      <SelectBox
        v-model="domainId"
        class="domain"
        :options="domainOptions"
        aria-label="领域"
        :size="variant === 'stack' ? 'md' : 'sm'"
      />
      <p v-if="domainFallback && variant === 'stack'" class="warn">AI 没有选出合适的领域，已暂时放到“其他”，请选一个</p>
    </div>

    <div class="field" style="view-transition-name: prop-tags">
      <div class="field-head">
        <span class="label">标签</span>
        <InfoTip v-if="variant === 'stack'" :text="TIPS.tags" />
      </div>
      <div class="chips">
        <span v-for="t in tags" :key="t" class="chip">
          {{ t }}
          <button class="chip-x" :aria-label="`删除标签 ${t}`" @click="removeTag(t)"><X :size="13" /></button>
          <span v-if="!known.has(t)" class="new-badge" title="新标签">新</span>
        </span>
        <input
          v-if="adding === 'tags'"
          ref="inputEl"
          v-model="draft"
          class="chip-input"
          aria-label="新标签"
          placeholder="输入后回车"
          @keyup.enter="commit"
          @blur="commit"
          @keyup.esc="adding = null"
        />
        <button v-else class="chip-add" aria-label="添加标签" @click="startAdding('tags')">
          <Plus :size="14" /><span v-if="variant === 'stack'">添加标签</span>
        </button>
      </div>
    </div>

    <div class="field" style="view-transition-name: prop-keywords">
      <div class="field-head">
        <span class="label">关键词</span>
        <InfoTip v-if="variant === 'stack'" :text="TIPS.keywords" />
      </div>
      <div class="chips">
        <span v-for="k in keywords" :key="k" class="chip">
          {{ k }}
          <button class="chip-x" :aria-label="`删除关键词 ${k}`" @click="removeKeyword(k)"><X :size="13" /></button>
        </span>
        <input
          v-if="adding === 'keywords'"
          ref="inputEl"
          v-model="draft"
          class="chip-input"
          aria-label="新关键词"
          placeholder="输入后回车"
          @keyup.enter="commit"
          @blur="commit"
          @keyup.esc="adding = null"
        />
        <button v-else class="chip-add" aria-label="添加关键词" @click="startAdding('keywords')">
          <Plus :size="14" /><span v-if="variant === 'stack'">添加关键词</span>
        </button>
      </div>
    </div>

    <div v-if="variant === 'inline' && source" class="field source">
      <span class="label">来源</span>
      <span class="source-text">{{ source }}</span>
    </div>
  </div>
</template>

<style scoped>
/* ---------- 共用 ---------- */
.label {
  color: var(--fg-strong);
  font-weight: var(--fw-label);
}
.chips {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--sp-2);
}
.chip {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: var(--sp-1);
  border-radius: var(--radius-chip);
  background: var(--chip-bg);
  border: 1px solid var(--chip-border);
  color: var(--fg);
}
.chip-x {
  width: 18px;
  height: 18px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: none;
  color: var(--faint);
  display: grid;
  place-items: center;
}
.chip-x:hover:not(:disabled) {
  background: var(--hover);
  color: var(--fg-strong);
}
.new-badge {
  position: absolute;
  top: -9px;
  right: -8px;
  padding: 0 5px;
  border-radius: var(--radius-pill);
  background: var(--new);
  color: var(--on-primary);
  font-size: var(--fs-2xs);
  line-height: 1.6;
  box-shadow: 0 0 0 2px var(--card);
}
.chip-add {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-1);
  border: 1px dashed var(--line-strong);
  border-radius: var(--radius-chip);
  background: none;
  color: var(--muted);
}
.chip-add:hover:not(:disabled) {
  background: var(--hover);
  color: var(--fg-strong);
}
.chip-input {
  box-sizing: border-box;
  padding: 0 var(--sp-3);
  border: 1px solid var(--primary);
  border-radius: var(--radius-chip);
  box-shadow: 0 0 0 3px var(--primary-soft);
  background: var(--card);
  color: var(--fg);
  font: inherit;
  outline: none;
}

/* ---------- 右栏：竖排 ---------- */
.stack .field + .field {
  margin-top: var(--sp-5);
}
.stack .field-head {
  display: flex;
  align-items: center;
  gap: var(--sp-1);
  margin-bottom: var(--sp-2);
  font-size: var(--fs-md);
}
.stack .chip {
  height: var(--h-sm);
  padding: 0 var(--sp-1) 0 var(--sp-3);
  font-size: var(--fs-sm);
}
.stack .chip-add {
  height: var(--h-sm);
  padding: 0 var(--sp-3);
  font-size: var(--fs-sm);
}
.stack .chip-input {
  width: 130px;
  height: var(--h-sm);
  font-size: var(--fs-sm);
}
.stack .warn {
  margin: var(--sp-2) 0 0;
  font-size: var(--fs-sm);
  color: var(--warn);
}

/* ---------- 标题下：一条横排 ---------- */
.inline {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--sp-2) var(--sp-4);
  padding: var(--sp-2) var(--sp-3);
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  font-size: var(--fs-sm);
}
.inline .field {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
}
.inline .field + .field {
  padding-left: var(--sp-4);
  border-left: 1px solid var(--line);
}
.inline .field-head {
  display: contents;
}
.inline .label {
  color: var(--faint);
  font-weight: 400;
}
.inline .domain {
  min-width: 112px;
}
.inline .chips {
  gap: var(--sp-1);
}
.inline .chip {
  height: var(--h-xs);
  padding: 0 2px 0 var(--sp-2);
  font-size: var(--fs-sm);
}
.inline .chip-x {
  width: 16px;
  height: 16px;
}
.inline .new-badge {
  top: -7px;
  right: -6px;
}
.inline .chip-add {
  width: var(--h-xs);
  height: var(--h-xs);
  padding: 0;
  justify-content: center;
}
.inline .chip-input {
  width: 110px;
  height: var(--h-xs);
  font-size: var(--fs-sm);
}
.inline .source-text {
  color: var(--muted);
}
</style>
