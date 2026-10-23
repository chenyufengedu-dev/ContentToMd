<script setup lang="ts">
// 笔记的领域、标签、关键词：右栏「属性信息」里竖着排，所有修改都在这里做。
// 对照原文时标题下那一行只是显示（见 ConfirmPage 的 meta-row），不能改
import { computed, nextTick, ref } from 'vue'
import { Plus, X } from './icons'
import type { Domain } from '../core/config'
import SelectBox from './SelectBox.vue'
import InfoTip from './InfoTip.vue'

const props = defineProps<{
  domains: Domain[]
  existingTags: string[]
  domainFallback?: boolean
}>()
const domainId = defineModel<number>('domainId', { required: true })
const emit = defineEmits<{ newDomain: [] }>()
const tags = defineModel<string[]>('tags', { required: true })
const keywords = defineModel<string[]>('keywords', { required: true })

const known = computed(() => new Set(props.existingTags))
// 下拉最后一项“新增领域…”不是真的领域：选它时不改领域，交给确认页弹框新建（US4）
const NEW_DOMAIN = -1
const domainOptions = computed(() => [
  ...props.domains.map((d) => ({ value: d.id, label: d.name })),
  { value: NEW_DOMAIN, label: '新增领域…' },
])
const domainChoice = computed({
  get: () => domainId.value,
  set: (v: number) => (v === NEW_DOMAIN ? emit('newDomain') : (domainId.value = v)),
})

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
  <div class="props">
    <div class="field">
      <div class="field-head">
        <span class="label">领域</span>
        <InfoTip :text="TIPS.domain" />
      </div>
      <SelectBox v-model="domainChoice" class="domain" :options="domainOptions" aria-label="领域" size="md" />
      <p v-if="domainFallback" class="warn">AI 没有选出合适的领域，已暂时放到“其他”，请选一个</p>
    </div>

    <div class="field">
      <div class="field-head">
        <span class="label">标签</span>
        <InfoTip :text="TIPS.tags" />
      </div>
      <div class="chips">
        <span v-for="t in tags" :key="t" class="chip">
          {{ t }}
          <button class="chip-x" :aria-label="`删除标签 ${t}`" @click="removeTag(t)"><X :size="13" /></button>
          <span v-if="!known.has(t)" class="new-dot" title="新标签：收藏库里还没有，保存后会新建" />
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
          <Plus :size="14" /><span>添加标签</span>
        </button>
      </div>
    </div>

    <div class="field">
      <div class="field-head">
        <span class="label">关键词</span>
        <InfoTip :text="TIPS.keywords" />
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
          <Plus :size="14" /><span>添加关键词</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
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
.new-dot {
  /* 新标签：右上角一个小红点 */
  position: absolute;
  top: -3px;
  right: -3px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--new);
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
  padding: 0 var(--px-sm);
  border: 1px solid var(--accent);
  border-radius: var(--radius-chip);
  box-shadow: 0 0 0 3px var(--accent-soft);
  background: var(--card);
  color: var(--fg);
  font: inherit;
  outline: none;
}

.field + .field {
  margin-top: var(--sp-5);
}
.field-head {
  display: flex;
  align-items: center;
  gap: var(--sp-1);
  margin-bottom: var(--sp-2);
  font-size: var(--fs-md);
}
.chip {
  height: var(--h-sm);
  padding: 0 calc(var(--px-sm) / 2) 0 var(--px-sm);
  font-size: var(--fs-sm);
}
.chip-add {
  height: var(--h-sm);
  padding: 0 var(--px-sm);
  font-size: var(--fs-sm);
}
.chip-input {
  width: 130px;
  height: var(--h-sm);
  font-size: var(--fs-sm);
}
.warn {
  margin: var(--sp-2) 0 0;
  font-size: var(--fs-sm);
  color: var(--warn);
}
</style>
