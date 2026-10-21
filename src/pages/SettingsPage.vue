<script setup lang="ts">
import { computed, nextTick, reactive, ref } from 'vue'
import {
  type Config,
  type ServiceKind,
  SERVICE_KINDS,
  checkBaseUrl,
  SERVICE_LABELS,
  OTHER_DOMAIN_ID,
  isServiceConfigured,
  maskKey,
  checkDomainName,
  nextDomainId,
} from '../core/config'
import { testService } from '../core/services'
import { describeError } from '../core/errors'
import { saveConfig, pickFolder, folderHasNotes, httpFetch } from '../shell/tauri'
import SettingCard from '../components/SettingCard.vue'
import { X } from 'lucide-vue-next'

const props = defineProps<{ config: Config; firstRun: boolean }>()
const emit = defineEmits<{ saved: [Config] }>()

// 在副本上编辑，点“保存设置”才写入
const draft = reactive<Config>(JSON.parse(JSON.stringify(props.config)))
const saved = ref(JSON.stringify(props.config))
const dirty = computed(() => JSON.stringify(draft) !== saved.value)

const KINDS = SERVICE_KINDS

// ---- 抽出来的那张卡片：每次进入设置页都从“都没抽出”开始（页面每次重新创建） ----
const open = ref<string | null>(null)
/** 正在收回的卡片：收回动画放完之前，它的标签还留着往卡片里滑 */
const closing = ref<string | null>(null)

async function activate(id: string) {
  if (open.value === id) return
  const before = snapshot()
  closing.value = open.value
  open.value = id
  await nextTick()
  const done = animateSwitch(before, closing.value)
  // 标签缩回卡片的动画真正结束后才把它拿掉
  const was = closing.value
  await done
  if (closing.value === was) closing.value = null
}

// 切换动画，参考 Material 的“容器变形”：整个过程是一个容器在变形，动作同步、同一条曲线、文字不乱跑。
// 展开（像从文件柜里抽出一个文件夹）：
//   0～0.3 秒：卡片往下滑，让出标签的位置；同时标签从卡片后面往上滑出来——卡片下移多少，标签就上移多少，
//              标签在屏幕上停在原处；卡片左上角同时从圆角变直。标题文字全程原地不动。下面的卡片一起往下滑。
//   0.2 秒起：说明在卡片顶部淡入，接着设置内容向左滑开、淡入。
// 收回（倒着来，更快）：设置内容滑回右栏，说明淡入；标签滑回卡片里，同时卡片往上回到原位，左上角变回圆角
const OPEN = 300
const CLOSE = 240
const EASE = 'cubic-bezier(0.2, 0, 0, 1)' // 快出慢停（Material 的 emphasized decelerate）
type Snap = Map<Element, DOMRect>

function parts(): Element[] {
  return [...document.querySelectorAll('.settings [data-card], .settings [data-part]')]
}
function snapshot(): Snap {
  return new Map(parts().map((el) => [el, el.getBoundingClientRect()]))
}
function animateSwitch(before: Snap, closingId: string | null): Promise<unknown> {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return Promise.resolve()
  let closed: Promise<unknown> = Promise.resolve()
  const run = (el: Element, frames: Keyframe[], opts: KeyframeAnimationOptions) =>
    el.animate(frames, { easing: EASE, fill: 'backwards', ...opts })
  // 先把所有新位置量完再开始动画（动画一开始，量到的位置就带上了位移）
  const after: Snap = snapshot()
  const moved = new Map<Element, number>()
  for (const card of document.querySelectorAll('.settings [data-card]')) {
    const a = before.get(card)
    if (a) moved.set(card, a.top - after.get(card)!.top)
  }
  for (const el of parts()) {
    const a = before.get(el)
    const b = after.get(el)
    if (!a || !b) continue
    const part = (el as HTMLElement).dataset.part
    const card = (part ? el.closest('[data-card]') : el) as HTMLElement
    const opening = card.classList.contains('open')
    const closing = card.dataset.card === closingId
    const dur = closing ? CLOSE : OPEN
    const dy = moved.get(card) ?? 0
    if (!part) {
      // 卡片：平移回原位置再滑过来。只用平移（交给显卡做，不用每帧重画整张卡片）；
      // 卡片变高时，下面的卡片同时往下滑，正好把多出来的部分盖住，看上去就是卡片在往下展开
      if (dy) run(el, [{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: dur })
      // 标签总是相对卡片升降一个标签的高度：展开时从卡片圆角的位置升上来，收回时降回去。
      // 上方的卡片没变时，卡片正好下移一个标签的高度，两者抵消，标签在屏幕上停在原处。
      // 卡片自己的圆角不变：标签的左上圆角从和它重合的位置升起，任何一帧轮廓左上角都是圆的
      const tab = el.querySelector('.tab-shape')
      const tabH = parseFloat(getComputedStyle(el).getPropertyValue('--tab-h')) || 0
      if (opening && tab) {
        run(tab, [{ transform: `translateY(${tabH}px)` }, { transform: 'none' }], { duration: dur })
      } else if (closing && tab) {
        closed = run(tab, [{ transform: 'none' }, { transform: `translateY(${tabH}px)` }], {
          duration: dur,
          fill: 'forwards',
        }).finished.catch(() => {})
      }
      continue
    }
    if (!opening && !closing) continue // 其他卡片里面不放动画
    // 卡片里的各块：先抵消卡片的位移，再从原来的屏幕位置滑到新位置
    const tx = a.left - b.left
    const ty = a.top - b.top - dy
    if (part === 'title') {
      // 标题：屏幕上几乎不动（只有和标签里位置的细微差别，跟着卡片同一条曲线走完）
      run(el, [{ transform: `translate(${tx}px, ${ty}px)` }, { transform: 'none' }], { duration: dur })
    } else if (part === 'desc') {
      run(
        el,
        [
          { opacity: 0, transform: 'translateY(4px)' },
          { opacity: 1, transform: 'none' },
        ],
        {
          duration: 240,
          delay: opening ? 200 : 80,
        },
      )
    } else {
      // 设置内容：从原来的屏幕位置滑过去，展开时稍晚开始
      run(
        el,
        [
          { transform: `translate(${tx}px, ${ty}px)`, opacity: 0.3 },
          { transform: 'none', opacity: 1 },
        ],
        { duration: opening ? OPEN + 80 : CLOSE, delay: opening ? 120 : 0 },
      )
    }
  }
  return closed
}

// ---- 收藏库 ----
async function chooseVault() {
  const p = await pickFolder(draft.vaultPath)
  if (p) draft.vaultPath = p
}

// ---- 服务 ----
// 密钥输入框只放新输入的值；留空表示沿用已保存的密钥
const newKey = reactive<Record<ServiceKind, string>>({ text: '', vision: '', asr: '' })
type TestState = { status: 'idle' | 'testing' | 'ok' | 'fail'; message?: string; detail?: string }
const test = reactive<Record<ServiceKind, TestState>>({
  text: { status: 'idle' },
  vision: { status: 'idle' },
  asr: { status: 'idle' },
})

function applyKey(k: ServiceKind) {
  if (newKey[k].trim()) {
    draft.services[k].apiKey = newKey[k].trim()
    newKey[k] = ''
  }
}

function copyFromText(k: ServiceKind) {
  const t = draft.services.text
  draft.services[k] = { ...draft.services[k], baseUrl: t.baseUrl, apiKey: t.apiKey }
}

async function runTest(k: ServiceKind) {
  applyKey(k)
  const s = draft.services[k]
  if (!isServiceConfigured(s)) {
    test[k] = { status: 'fail', message: checkBaseUrl(s.baseUrl) ?? '请先填写接口地址、模型名和密钥' }
    return
  }
  test[k] = { status: 'testing' }
  try {
    await testService(k, s, httpFetch)
    test[k] = { status: 'ok', message: '连接成功' }
  } catch (e) {
    test[k] = { status: 'fail', ...describeError(e) }
  }
}

// ---- 领域 ----
const newDomain = ref('')
const domainError = ref<string | null>(null)
const editingId = ref<number | null>(null)
const editingName = ref('')

function addDomain() {
  const err = checkDomainName(newDomain.value, draft.domains)
  domainError.value = err
  if (err) return
  // 新领域放在“其他”前面
  const at = draft.domains.findIndex((d) => d.id === OTHER_DOMAIN_ID)
  draft.domains.splice(at < 0 ? draft.domains.length : at, 0, {
    id: nextDomainId(draft.domains),
    name: newDomain.value.trim(),
  })
  newDomain.value = ''
}

function startRename(id: number, name: string) {
  editingId.value = id
  editingName.value = name
  domainError.value = null
}

function finishRename() {
  const d = draft.domains.find((x) => x.id === editingId.value)
  if (!d) return
  const err = checkDomainName(editingName.value, draft.domains, d.id)
  domainError.value = err
  if (err) return
  d.name = editingName.value.trim()
  editingId.value = null
}

async function removeDomain(id: number) {
  const d = draft.domains.find((x) => x.id === id)
  if (!d) return
  // 领域下还有笔记时不允许删除（方案第 10.2 节）
  if (draft.vaultPath && (await folderHasNotes(`${draft.vaultPath}\\${d.name}`))) {
    domainError.value = `“${d.name}”里还有笔记，请先把这些笔记移走再删除`
    return
  }
  draft.domains = draft.domains.filter((x) => x.id !== id)
  domainError.value = null
}

// ---- 保存 ----
const saveError = ref<string | null>(null)
const saving = ref(false)
async function save() {
  KINDS.forEach(applyKey)
  saving.value = true
  saveError.value = null
  try {
    await saveConfig(draft)
    saved.value = JSON.stringify(draft)
    emit('saved', JSON.parse(JSON.stringify(draft)))
  } catch (e) {
    saveError.value = String(e)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="settings">
    <h1>设置</h1>
    <p v-if="firstRun" class="banner">第一次使用，请先选择收藏库文件夹，并填好三项服务，然后点“保存设置”。</p>

    <SettingCard
      id="vault"
      title="收藏库文件夹"
      desc="笔记和图片都保存在这里，可以放在 Obsidian 的 vault 里。"
      :open="open === 'vault'"
      :closing="closing === 'vault'"
      @activate="activate('vault')"
    >
      <div class="row">
        <span class="path" :class="{ missing: !draft.vaultPath }">{{ draft.vaultPath || '未配置' }}</span>
        <button class="soft" @click="chooseVault">选择文件夹</button>
      </div>
    </SettingCard>

    <SettingCard
      id="services"
      title="模型服务"
      desc="整理文字、看图、语音转写分别用哪家服务。"
      :open="open === 'services'"
      :closing="closing === 'services'"
      @activate="activate('services')"
    >
      <div v-for="k in KINDS" :key="k" class="service">
        <div class="service-head">
          <h3>{{ SERVICE_LABELS[k] }}</h3>
          <span v-if="!isServiceConfigured(draft.services[k]) && !newKey[k]" class="tag-missing">未配置</span>
          <button v-if="k !== 'text'" class="link" @click="copyFromText(k)">与文字整理用同一家</button>
        </div>
        <div class="fields">
          <label class="field">
            <span>接口地址</span>
            <input v-model="draft.services[k].baseUrl" placeholder="https://api.example.com/v1" spellcheck="false" />
          </label>
          <label class="field">
            <span>模型名</span>
            <input v-model="draft.services[k].model" spellcheck="false" />
          </label>
          <label class="field">
            <span>密钥</span>
            <input
              v-model="newKey[k]"
              type="password"
              spellcheck="false"
              autocomplete="off"
              :placeholder="draft.services[k].apiKey ? `${maskKey(draft.services[k].apiKey)}（已保存）` : '粘贴密钥'"
            />
          </label>
        </div>
        <p v-if="draft.services[k].baseUrl.trim() && checkBaseUrl(draft.services[k].baseUrl)" class="err">
          {{ checkBaseUrl(draft.services[k].baseUrl) }}
        </p>
        <div class="row">
          <button class="soft small" :disabled="test[k].status === 'testing'" @click="runTest(k)">
            {{ test[k].status === 'testing' ? '测试中…' : '测试连接' }}
          </button>
          <span v-if="test[k].status === 'ok'" class="ok">✓ {{ test[k].message }}</span>
          <span v-if="test[k].status === 'fail'" class="err">{{ test[k].message }}</span>
        </div>
        <details v-if="test[k].status === 'fail' && test[k].detail" class="detail">
          <summary>详细信息</summary>
          <pre>{{ test[k].detail }}</pre>
        </details>
      </div>
    </SettingCard>

    <SettingCard
      id="domains"
      title="领域"
      desc="每个领域对应收藏库里的一个文件夹，用到时才创建。点名字可以改名，“其他”不能删除。"
      :open="open === 'domains'"
      :closing="closing === 'domains'"
      @activate="activate('domains')"
    >
      <ul class="domains">
        <li v-for="d in draft.domains" :key="d.id">
          <template v-if="editingId === d.id">
            <input v-model="editingName" @keyup.enter="finishRename" @keyup.esc="editingId = null" />
            <button class="link" @click="finishRename">确定</button>
            <button class="link" @click="editingId = null">取消</button>
          </template>
          <template v-else>
            <button class="chip-name" title="点击改名" @click="startRename(d.id, d.name)">{{ d.name }}</button>
            <button
              v-if="d.id !== OTHER_DOMAIN_ID"
              class="chip-x"
              :aria-label="`删除领域 ${d.name}`"
              @click="removeDomain(d.id)"
            >
              <X :size="13" />
            </button>
          </template>
        </li>
      </ul>
      <div class="row">
        <input v-model="newDomain" class="grow" placeholder="新领域名" @keyup.enter="addDomain" />
        <button class="soft" @click="addDomain">添加</button>
      </div>
      <p v-if="domainError" class="err">{{ domainError }}</p>
    </SettingCard>

    <SettingCard
      id="privacy"
      title="隐私说明"
      :open="open === 'privacy'"
      :closing="closing === 'privacy'"
      @activate="activate('privacy')"
    >
      <ul class="privacy">
        <li>
          会发送给模型服务的内容：提取出的文字、压缩后的图片（长边不超过 1568
          像素）、音频、“本次要求”、已有标签的名称列表。
        </li>
        <li>不会发送的内容：其他笔记的正文、文件路径、文件夹结构、用户名等设备信息。</li>
        <li>密钥只保存在本机的配置文件里（%APPDATA%\ContentToMd\config.json），不在收藏库内。</li>
      </ul>
    </SettingCard>

    <footer>
      <span v-if="saveError" class="err">保存失败：{{ saveError }}</span>
      <span v-else-if="!dirty && !firstRun" class="muted">设置已保存</span>
      <button class="primary" :disabled="saving || (!dirty && !KINDS.some((k) => newKey[k]))" @click="save">
        {{ saving ? '保存中…' : '保存设置' }}
      </button>
    </footer>
  </div>
</template>

<style scoped>
/* 和确认页同一套：浅灰底上的白卡片，尺寸只用 src/style.css 的令牌（卡片本身见 SettingCard.vue） */
.settings {
  max-width: 880px;
  margin: 0 auto;
  padding: var(--sp-5) var(--sp-5) calc(var(--h-md) + var(--sp-7) * 2);
  display: flex;
  flex-direction: column;
  gap: var(--sp-4);
}
h1 {
  margin: 0;
  font-size: var(--fs-2xl);
  font-weight: var(--fw-title);
  line-height: 1.35;
  color: var(--fg-strong);
}
h3 {
  margin: 0;
  font-size: var(--fs-md);
  font-weight: var(--fw-heading);
  color: var(--fg-strong);
}
.banner {
  margin: 0;
  padding: var(--sp-3) var(--sp-4);
  background: var(--warn-bg);
  color: var(--warn);
  border-radius: var(--radius-md);
}
.muted {
  color: var(--muted);
  font-size: var(--fs-sm);
}
.row {
  display: flex;
  gap: var(--sp-2);
  align-items: center;
  flex-wrap: wrap;
}
.soft {
  border: 0;
  background: var(--hover);
}
.soft:hover:not(:disabled) {
  background: var(--line);
}
.soft.small {
  height: var(--h-xs);
  padding: 0 var(--px-sm);
  font-size: var(--fs-sm);
}
input {
  min-width: 0;
  height: var(--h-md);
  box-sizing: border-box;
  padding: 0 var(--px-sm);
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  font: inherit;
  background: var(--card);
  color: var(--fg);
  outline: none;
  transition:
    border-color var(--ease),
    box-shadow var(--ease);
}
input:hover {
  border-color: var(--line-strong);
}
input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
}
.grow {
  flex: 1;
}
.path {
  flex: 1;
  min-width: 0;
  min-height: var(--h-md);
  display: flex;
  align-items: center;
  padding: 0 var(--px-sm);
  background: var(--card-muted);
  border-radius: var(--radius-md);
  overflow-wrap: anywhere;
}
.missing .tag-missing,
.path.missing {
  color: var(--warn);
}
.tag-missing {
  padding: 0 var(--sp-2);
  background: var(--warn-bg);
  border-radius: var(--radius-pill);
  font-size: var(--fs-xs);
}

/* ---- 模型服务：每家一组，三个输入框一行 ---- */
.service + .service {
  margin-top: var(--sp-4);
  padding-top: var(--sp-4);
  border-top: 1px solid var(--line);
}
.service-head {
  display: flex;
  gap: var(--sp-2);
  align-items: center;
  margin-bottom: var(--sp-2);
}
.service-head .link {
  margin-left: auto;
  color: var(--accent);
}
.fields {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: var(--sp-3);
  margin-bottom: var(--sp-2);
}
.field {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
  font-size: var(--fs-xs);
  color: var(--muted);
}
.ok {
  color: var(--ok);
  font-size: var(--fs-sm);
}
.err {
  color: var(--err);
  font-size: var(--fs-sm);
}
.detail pre {
  white-space: pre-wrap;
  font-size: var(--fs-xs);
  color: var(--muted);
}

/* ---- 领域：浅灰小标签，点名字改名，× 删除 ---- */
.domains {
  list-style: none;
  padding: 0;
  margin: 0 0 var(--sp-3);
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-2);
}
.domains li {
  min-height: var(--h-sm);
  display: flex;
  gap: 2px;
  align-items: center;
  padding: 0 calc(var(--px-sm) / 2) 0 var(--px-sm);
  background: var(--chip-bg);
  border-radius: var(--radius-chip);
  font-size: var(--fs-sm);
}
.domains li input {
  height: var(--h-xs);
}
.chip-name {
  height: auto;
  padding: 0;
  border: 0;
  background: none;
  font-size: var(--fs-sm);
}
.chip-name:hover:not(:disabled) {
  background: none;
  color: var(--fg-strong);
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

/* ---- 隐私说明 ---- */
.privacy {
  margin: 0;
  padding-left: var(--sp-4);
  font-size: var(--fs-sm);
  line-height: 1.8;
  color: var(--muted);
}

footer {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 10;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--sp-4);
  padding: var(--sp-3) var(--sp-5);
  background: var(--card);
  border-top: 1px solid var(--line);
}
footer .primary {
  margin-left: auto;
  min-width: 140px;
}
</style>
