<script setup lang="ts">
// 收藏库页（F21，设计稿：设计稿/收藏库页/基准.webp）：左边按领域、标签筛选，顶部搜索，右边方块卡片。
// 只显示设置里选中的存放文件夹里、各领域文件夹下的笔记。方块和列表两种显示，记住上次选的
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { CircleAlert, Folder, Hash, Inbox, LayoutGrid, List, Search, X } from '../components/icons'
import { type Config, notesRoot } from '../core/config'
import { domainCounts, filterNotes, tagCounts, type LibraryNote } from '../core/library'
import { listNotes } from '../shell/tauri'
import NoteCard from '../components/NoteCard.vue'
import NoteRow from '../components/NoteRow.vue'

const props = defineProps<{ config: Config }>()
const emit = defineEmits<{ goHome: []; goSettings: []; open: [path: string] }>()

const root = computed(() => notesRoot(props.config))
const notes = ref<LibraryNote[]>([])
const failed = ref<string[]>([])
const loading = ref(true)
const loadError = ref('')

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const r = await listNotes(root.value)
    notes.value = r.notes
    failed.value = r.failed
  } catch {
    loadError.value = `收藏库文件夹“${root.value}”找不到了`
  } finally {
    loading.value = false
  }
}
onMounted(load)

// ---- 筛选 ----
const domain = ref<string | null>(null)
const tags = ref<string[]>([])
const query = ref('')
const domains = computed(() =>
  domainCounts(
    notes.value,
    props.config.domains.map((d) => d.name),
  ),
)
/** 标签只列当前领域里出现过的 */
const tagList = computed(() => tagCounts(notes.value.filter((n) => domain.value === null || n.domain === domain.value)))
const shown = computed(() => filterNotes(notes.value, { domain: domain.value, tags: tags.value, query: query.value }))

function chooseDomain(d: string | null) {
  domain.value = d
  // 换了领域，那边没有的标签不再算在筛选里
  const left = new Set(tagList.value.map((t) => t.name))
  tags.value = tags.value.filter((t) => left.has(t))
}
/** 搜索框里空着时按退格：先去掉最后一个标签条件，没有标签了再去掉领域 */
function onBackspace() {
  if (query.value) return
  if (tags.value.length) tags.value = tags.value.slice(0, -1)
  else if (domain.value !== null) chooseDomain(null)
}
function clearFilters() {
  domain.value = null
  tags.value = []
}
function toggleTag(t: string) {
  tags.value = tags.value.includes(t) ? tags.value.filter((x) => x !== t) : [...tags.value, t]
}

// ---- 按需加载：一次放 60 张，滚到底再放（方案：超过 200 条时按需加载） ----
const PAGE = 60
const limit = ref(PAGE)
watch([domain, tags, query], () => (limit.value = PAGE))
const sentinel = ref<HTMLElement>()
let observer: IntersectionObserver | undefined
onMounted(() => {
  observer = new IntersectionObserver((es) => {
    if (es.some((e) => e.isIntersecting)) limit.value += PAGE
  })
  watch(sentinel, (el, old) => {
    if (old) observer?.unobserve(old)
    if (el) observer?.observe(el)
  })
})
onBeforeUnmount(() => observer?.disconnect())

// ---- 显示方式：方块 / 列表，记在本机（只是个人习惯，读写不了就用方块） ----
type View = 'grid' | 'list'
const VIEW_KEY = 'library-view'
function savedView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'grid'
  } catch {
    return 'grid'
  }
}
const view = ref<View>(savedView())
function setView(v: View) {
  view.value = v
  try {
    localStorage.setItem(VIEW_KEY, v)
  } catch {
    // 存不下就只在这次有效
  }
}

/** 点一条笔记：进软件里的笔记页（F22） */
const open = (n: LibraryNote) => emit('open', n.path)
defineExpose({ load })
</script>

<template>
  <div class="library">
    <aside class="filters">
      <p class="group-label">领域</p>
      <ul class="domains">
        <li>
          <button class="domain" :aria-pressed="domain === null" @click="chooseDomain(null)">
            <span>全部</span><span class="count">{{ notes.length }}</span>
          </button>
        </li>
        <li v-for="d in domains" :key="d.name">
          <button class="domain" :aria-pressed="domain === d.name" @click="chooseDomain(d.name)">
            <span>{{ d.name }}</span
            ><span class="count">{{ d.count }}</span>
          </button>
        </li>
      </ul>
      <template v-if="tagList.length">
        <hr />
        <p class="group-label">标签</p>
        <div class="tags">
          <button
            v-for="t in tagList"
            :key="t.name"
            class="tag"
            :aria-pressed="tags.includes(t.name)"
            @click="toggleTag(t.name)"
          >
            {{ t.name }}
          </button>
        </div>
      </template>
    </aside>

    <main class="main">
      <div class="toolbar">
        <label class="search">
          <Search :size="16" aria-hidden="true" />
          <!-- 正在用的筛选条件：领域和标签颜色不同，点 × 取消这个条件 -->
          <span v-if="domain !== null" class="chip chip-domain">
            <Folder :size="13" aria-hidden="true" />{{ domain }}
            <button type="button" :aria-label="`取消领域筛选：${domain}`" @click.prevent="chooseDomain(null)">
              <X :size="12" aria-hidden="true" />
            </button>
          </span>
          <span v-for="t in tags" :key="t" class="chip chip-tag">
            <Hash :size="12" aria-hidden="true" />{{ t }}
            <button type="button" :aria-label="`取消标签筛选：${t}`" @click.prevent="toggleTag(t)">
              <X :size="12" aria-hidden="true" />
            </button>
          </span>
          <input
            v-model="query"
            :placeholder="domain !== null || tags.length ? '' : '搜索标题、关键词、正文'"
            aria-label="搜索收藏"
            spellcheck="false"
            @keydown.delete="onBackspace"
          />
          <button
            v-if="(domain !== null ? 1 : 0) + tags.length >= 2"
            type="button"
            class="clear-all"
            @click.prevent="clearFilters"
          >
            清除条件
          </button>
          <button v-if="query" class="clear" aria-label="清除搜索" @click="query = ''">
            <X :size="14" aria-hidden="true" />
          </button>
        </label>
        <div class="views" role="radiogroup" aria-label="显示方式">
          <button class="view" role="radio" :aria-checked="view === 'list'" title="列表显示" @click="setView('list')">
            <List :size="16" aria-hidden="true" />
          </button>
          <button class="view" role="radio" :aria-checked="view === 'grid'" title="方块显示" @click="setView('grid')">
            <LayoutGrid :size="16" aria-hidden="true" />
          </button>
        </div>
        <span class="total">共 {{ shown.length }} 条</span>
      </div>

      <p v-if="loading" class="hint">正在读取收藏库…</p>
      <div v-else-if="loadError" class="empty">
        <CircleAlert :size="40" aria-hidden="true" />
        <p>{{ loadError }}</p>
        <button class="primary" @click="emit('goSettings')">去设置里重新选择</button>
      </div>
      <div v-else-if="!notes.length" class="empty">
        <Inbox :size="40" aria-hidden="true" />
        <p>还没有收藏</p>
        <button class="primary" @click="emit('goHome')">去放入第一条</button>
      </div>
      <div v-else-if="!shown.length" class="empty">
        <p v-if="query">没有找到包含“{{ query }}”的收藏</p>
        <p v-else>这里还没有收藏</p>
        <button v-if="query" class="link-quiet" @click="query = ''">清除搜索</button>
      </div>
      <template v-else>
        <div v-if="view === 'list'" class="list">
          <NoteRow
            v-for="(n, i) in shown.slice(0, limit)"
            :key="n.path"
            :note="n"
            :index="i"
            :root="root"
            @open="open(n)"
          />
        </div>
        <div v-else class="grid">
          <NoteCard
            v-for="(n, i) in shown.slice(0, limit)"
            :key="n.path"
            :note="n"
            :index="i"
            :root="root"
            @open="open(n)"
          />
        </div>
        <div v-if="limit < shown.length" ref="sentinel" class="sentinel" />
      </template>

      <p v-if="failed.length" class="foot" :title="failed.join('\n')">
        <CircleAlert :size="14" aria-hidden="true" />有 {{ failed.length }} 个文件无法读取，已跳过
      </p>
    </main>
  </div>
</template>

<style scoped>
.library {
  display: grid;
  grid-template-columns: 180px minmax(0, 1fr);
  gap: var(--sp-7);
  padding: var(--sp-6) var(--sp-6) var(--sp-7);
}

/* ---- 左边筛选：直接放在浅灰底上，不套白卡片 ---- */
.filters {
  position: sticky;
  top: var(--sp-6);
  align-self: start;
}
.group-label {
  margin: 0 0 var(--sp-2);
  padding-left: var(--px-sm);
  font-size: var(--fs-sm);
  color: var(--faint);
}
.domains {
  margin: 0;
  padding: 0;
  list-style: none;
}
.domain {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  padding: 0 var(--px-sm);
  border: 0;
  background: none;
  color: var(--fg);
  text-align: left;
}
.domain:hover:not(:disabled) {
  background: var(--hover);
}
.domain[aria-pressed='true'],
.domain[aria-pressed='true']:hover:not(:disabled) {
  background: var(--card);
  color: var(--accent);
  box-shadow: var(--shadow-card);
}
.count {
  font-size: var(--fs-sm);
  color: var(--faint);
  font-variant-numeric: tabular-nums;
}
.domain[aria-pressed='true'] .count {
  color: var(--accent);
}
hr {
  margin: var(--sp-5) var(--px-sm);
  border: 0;
  border-top: 1px solid var(--line);
}
.tags {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-2);
}
.tag {
  height: var(--h-sm);
  padding: 0 var(--px-sm);
  border: 0;
  border-radius: var(--radius-pill);
  background: var(--card); /* 浅灰页面上用白底才看得出是一个个胶囊 */
  font-size: var(--fs-sm);
  color: var(--muted);
}
.tag:hover:not(:disabled) {
  background: var(--card);
  color: var(--fg);
}
.tag[aria-pressed='true'],
.tag[aria-pressed='true']:hover:not(:disabled) {
  background: color-mix(in srgb, var(--tag) 14%, transparent);
  color: var(--tag);
}

/* ---- 右边 ---- */
.toolbar {
  display: flex;
  align-items: center;
  gap: var(--sp-4);
  margin-bottom: var(--sp-5);
}
.search {
  flex: 1;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--sp-2);
  min-height: var(--h-md);
  padding: 4px var(--px-sm);
  border-radius: var(--radius-md);
  background: var(--card);
  color: var(--faint);
  box-shadow: var(--shadow-card);
}
.search:focus-within {
  box-shadow:
    0 0 0 1px var(--accent),
    0 0 0 4px var(--accent-soft);
}
.search input {
  flex: 1;
  min-width: 8em;
  height: 24px;
  border: 0;
  outline: none;
  background: none;
  font: inherit;
  color: var(--fg);
}
.search input::placeholder {
  color: var(--faint);
}
/* 筛选条件：领域是雾靛蓝，标签是青绿，和左边栏选中的颜色一一对应 */
.chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding: 0 4px 0 var(--sp-3);
  border-radius: var(--radius-pill);
  font-size: var(--fs-sm);
  white-space: nowrap;
}
.chip-domain {
  background: var(--accent-soft);
  color: var(--accent);
}
.chip-tag {
  background: color-mix(in srgb, var(--tag) 14%, transparent);
  color: var(--tag);
}
.chip button {
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  padding: 0;
  border: 0;
  border-radius: var(--radius-pill);
  background: none;
  color: inherit;
  opacity: 0.7;
}
.chip button:hover {
  opacity: 1;
  background: color-mix(in srgb, currentColor 14%, transparent);
}
.clear-all {
  height: 24px;
  padding: 0 var(--sp-3);
  border: 0;
  background: none;
  font-size: var(--fs-sm);
  color: var(--muted);
}
.clear-all:hover {
  color: var(--fg);
}
.clear {
  display: grid;
  place-items: center;
  width: var(--h-xs);
  height: var(--h-xs);
  padding: 0;
  border: 0;
  border-radius: var(--radius-pill);
  background: none;
  color: var(--faint);
}
.views {
  display: flex;
  gap: 2px;
}
.view {
  display: grid;
  place-items: center;
  width: var(--h-md);
  padding: 0;
  border: 0;
  background: none;
  color: var(--faint);
}
.view[aria-checked='true'],
.view[aria-checked='true']:hover:not(:disabled) {
  background: var(--card);
  color: var(--fg-strong);
  box-shadow: var(--shadow-card);
}
.total {
  font-size: var(--fs-sm);
  color: var(--faint);
  white-space: nowrap;
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
  gap: var(--sp-5);
}
/* 列表：一张白色大卡片，行之间一条很淡的分隔线 */
.list {
  display: flex;
  flex-direction: column;
  padding: var(--sp-2);
  background: var(--card);
  border-radius: var(--panel-radius);
  box-shadow: var(--shadow-card);
}
.list > * + * {
  box-shadow: inset 0 1px 0 var(--line);
}
.sentinel {
  height: 1px;
}
.hint {
  color: var(--faint);
  font-size: var(--fs-sm);
}
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--sp-3);
  padding: var(--sp-7) 0;
  color: var(--faint);
}
.empty p {
  margin: 0;
  color: var(--muted);
}
.empty .primary {
  padding: 0 var(--px-md);
}
.link-quiet {
  height: auto;
  padding: 0;
  border: 0;
  background: none;
  font-size: var(--fs-sm);
  color: var(--faint);
  text-decoration: underline;
  text-underline-offset: 3px;
}
.link-quiet:hover:not(:disabled) {
  background: none;
  color: var(--fg);
}
.foot {
  display: flex;
  align-items: center;
  gap: var(--sp-1);
  margin: var(--sp-6) 0 0;
  font-size: var(--fs-sm);
  color: var(--faint);
}
.foot svg {
  color: var(--attention);
}
.foot.err {
  color: var(--err);
}
</style>
