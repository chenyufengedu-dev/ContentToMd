<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
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
import { saveConfig, pickFolder, folderHasNotes, httpFetch, readUsage } from '../shell/tauri'
import { formatYuan, keyId, summarize, type Price, type UsageRecord } from '../core/cost'
import SettingCard from '../components/SettingCard.vue'
import { Check, ChevronRight, X } from 'lucide-vue-next'

const props = defineProps<{ config: Config; firstRun: boolean }>()
const emit = defineEmits<{ saved: [Config] }>()

// 在副本上编辑，点“保存设置”才写入
const draft = reactive<Config>(JSON.parse(JSON.stringify(props.config)))
const saved = ref(JSON.stringify(props.config))
const dirty = computed(() => JSON.stringify(draft) !== saved.value)

const KINDS = SERVICE_KINDS

// ---- 每把密钥花了多少（F14，设计稿 设计稿/设置页/状态-费用.png）：按 usage.jsonl 里的密钥编号统计 ----
const usage = ref<UsageRecord[]>([])
onMounted(() =>
  readUsage()
    .then((r) => (usage.value = r))
    .catch(() => {}),
)
const keyIds = ref<Partial<Record<ServiceKind, string>>>({})
watch(
  () => KINDS.map((k) => draft.services[k].apiKey),
  async () => {
    for (const k of KINDS) {
      const key = draft.services[k].apiKey.trim()
      keyIds.value[k] = key ? await keyId(key) : undefined
    }
  },
  { immediate: true },
)
// ---- 单价（选填，F14，设计稿 状态-价格收起 / 展开）：平时收起，点“价格（选填）”展开 ----
const PRICE_FIELDS: { key: keyof Price; label: string }[] = [
  { key: 'input', label: '输入' },
  { key: 'cachedInput', label: '缓存命中的输入' },
  { key: 'output', label: '输出' },
]
// 已经填过价格的服务默认展开，免得用户以为没填
const priceOpen = reactive(
  Object.fromEntries(KINDS.map((k) => [k, !!props.config.services[k].price])) as Record<ServiceKind, boolean>,
)
/** 价格 → 三个输入框里的文字 */
const priceTexts = (p?: Price) => Object.fromEntries(PRICE_FIELDS.map((f) => [f.key, String(p?.[f.key] ?? '')]))
/** 输入框里的原样文字：打到一半的“0.”不能被换成 0 或清空，所以不直接显示解析后的数字 */
const priceText = reactive(
  Object.fromEntries(KINDS.map((k) => [k, priceTexts(props.config.services[k].price)])) as Record<
    ServiceKind,
    Record<keyof Price, string>
  >,
)
/** 输入框文字 → 单价：空着是没填（undefined），不是非负数是填错了（NaN） */
const parsePrice = (raw: string) => (raw.trim() ? (Number(raw) >= 0 ? Number(raw) : NaN) : undefined)
const savedPrice = (k: ServiceKind) => (JSON.parse(saved.value) as Config).services[k].price
/** 填的不是数字的那一项（“完成”因此不能点） */
const badPrice = (k: ServiceKind) => PRICE_FIELDS.find((f) => Number.isNaN(parsePrice(priceText[k][f.key])))
/** 价格改了还没保存：收起后“价格（选填）”旁边有个橙色小点 */
const priceDirty = (k: ServiceKind) =>
  JSON.stringify(savedPrice(k) ?? null) !== JSON.stringify(draft.services[k].price ?? null)
/** 保存设置后，价格改过的服务在“价格（选填）”旁边闪几秒“✓ 已保存” */
const priceJustSaved = reactive<Partial<Record<ServiceKind, boolean>>>({})
/** 取消：恢复成上次保存的价格，然后收起 */
function cancelPrice(k: ServiceKind) {
  const p = savedPrice(k)
  draft.services[k].price = p ? { ...p } : undefined
  Object.assign(priceText[k], priceTexts(p))
  priceOpen[k] = false
}
/** 空着或填错的项当没填；三项都没填时整个价格去掉 */
function setPrice(k: ServiceKind, f: keyof Price, raw: string) {
  priceText[k][f] = raw
  const v = parsePrice(raw)
  const price: Price = { ...draft.services[k].price, [f]: Number.isNaN(v) ? undefined : v }
  draft.services[k].price = Object.values(price).some((x) => x !== undefined) ? price : undefined
}

/** 测试连接那一行右边的小字；这把密钥还没用过时不显示 */
function spendText(k: ServiceKind): string {
  const id = keyIds.value[k]
  if (!id) return ''
  const s = summarize(usage.value, id, new Date())
  if (!s.calls) return ''
  // 这把密钥一次都没算过钱（没填价格）：只说用了几次，不显示金额
  if (s.unknown === s.calls) return `这个密钥：共 ${s.calls} 次`
  const y = (v: number) => (v === 0 ? ' 0 元' : formatYuan(v))
  return `这个密钥：本月${y(s.month)} · 累计${y(s.total)} · 共 ${s.calls} 次`
}

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
  // 展开时内容错开入场：第 i 块在 60 + 100×i 毫秒开始，每块 280ms：从下方 8px 淡入上来；
  // 带一点轻模糊，前 40% 的时间里就变清晰，后面都是清楚的（作者觉得模糊久了看着不清楚，不要回弹）
  const enter = (el: Element, i: number) =>
    run(
      el,
      [
        { opacity: 0, filter: 'blur(3px)', transform: 'translateY(8px)' },
        { filter: 'blur(0)', offset: 0.4 },
        { opacity: 1, filter: 'blur(0)', transform: 'none' },
      ],
      { duration: 280, delay: 60 + 100 * i },
    )
  // 收回时内容不错开，快速淡入到右栏的位置
  const fadeIn = (el: Element) => run(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 150, delay: 40 })
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
      // 说明是错开入场的第 1 块
      if (opening) enter(el, 0)
      else fadeIn(el)
    } else {
      // 设置内容：一组一组错开入场（容器在变形，内容不长距离搬家，就地出现）
      const blocks = [...el.children]
      if (opening) blocks.forEach((child, i) => enter(child, i + (card.querySelector('[data-part=desc]') ? 1 : 0)))
      else fadeIn(el)
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
/** 保存成功后左边显示 3 秒“✓ 已保存” */
const justSaved = ref(false)
let justSavedTimer: number | undefined

/** 有没保存的改动（含刚粘贴、还没写进配置的新密钥） */
const pending = computed(() => dirty.value || KINDS.some((k) => newKey[k].trim()))
/** 保存条：有改动、第一次使用、刚保存完（显示“已保存”）时浮在底部，其余时间不出现 */
const barShown = computed(() => pending.value || props.firstRun || justSaved.value)
onBeforeUnmount(() => window.clearTimeout(justSavedTimer))

/** 撤销：恢复成上次保存的样子 */
function revert() {
  Object.assign(draft, JSON.parse(saved.value) as Config)
  for (const k of KINDS) {
    newKey[k] = ''
    cancelPrice(k)
  }
  saveError.value = null
}
async function save() {
  KINDS.forEach(applyKey)
  const priceChanged = KINDS.filter(priceDirty)
  saving.value = true
  saveError.value = null
  try {
    await saveConfig(draft)
    saved.value = JSON.stringify(draft)
    emit('saved', JSON.parse(JSON.stringify(draft)))
    for (const k of priceChanged) priceJustSaved[k] = true
    justSaved.value = true
    window.clearTimeout(justSavedTimer)
    justSavedTimer = window.setTimeout(() => {
      justSaved.value = false
      for (const k of KINDS) priceJustSaved[k] = false
    }, 1200)
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
          <button class="price-toggle" :aria-expanded="priceOpen[k]" @click="priceOpen[k] = !priceOpen[k]">
            价格（选填）<ChevronRight :size="14" class="chev" :class="{ down: priceOpen[k] }" aria-hidden="true" />
            <span v-if="!priceOpen[k] && priceDirty(k)" class="dot" title="价格改了还没保存" />
          </button>
          <Transition name="fade">
            <span v-if="priceJustSaved[k]" class="price-saved"><Check :size="14" aria-hidden="true" />已保存</span>
          </Transition>
          <span v-if="test[k].status === 'ok'" class="ok">✓ {{ test[k].message }}</span>
          <span v-if="test[k].status === 'fail'" class="err">{{ test[k].message }}</span>
          <span v-if="spendText(k)" class="spend">{{ spendText(k) }}</span>
        </div>
        <div v-if="priceOpen[k]" class="price">
          <label v-for="f in PRICE_FIELDS" :key="f.key" class="price-field">
            <span class="price-label">{{ f.label }}</span>
            <span class="price-input">
              <input
                :value="priceText[k][f.key]"
                inputmode="decimal"
                placeholder="未填"
                @input="setPrice(k, f.key, ($event.target as HTMLInputElement).value)"
              />
              <span class="unit">元 / 百万 tokens</span>
            </span>
          </label>
          <p class="price-note">
            填了才会计算花费，按服务返回的用量估算，以服务商账单为准。价格可在服务商官网的价格页查到。
          </p>
          <div class="price-actions">
            <span v-if="badPrice(k)" class="price-status">「{{ badPrice(k)!.label }}」要填数字，比如 0.02</span>
            <button class="soft small" @click="cancelPrice(k)">取消</button>
            <button class="primary small" :disabled="!!badPrice(k)" @click="priceOpen[k] = false">完成</button>
          </div>
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

    <!-- 保存条（Discord、Shopify 后台的做法）：有改动时从底部浮起，保存后显示“已保存”再落下；平时不出现 -->
    <Transition name="bar">
      <div v-if="barShown" class="save-bar" role="status">
        <span v-if="saveError" class="err">保存失败：{{ saveError }}</span>
        <span v-else-if="justSaved && !pending" class="saved-ok"><Check :size="16" aria-hidden="true" />已保存</span>
        <span v-else class="bar-text">{{ firstRun && !pending ? '填好后点“保存设置”' : '有改动还没保存' }}</span>
        <button v-if="pending && !firstRun" class="soft" :disabled="saving" @click="revert">撤销</button>
        <button class="primary" :disabled="saving || (!pending && !firstRun)" @click="save">
          {{ saving ? '保存中…' : '保存设置' }}
        </button>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
/* 和确认页同一套：浅灰底上的白卡片，尺寸只用 src/style.css 的令牌（卡片本身见 SettingCard.vue） */
.settings {
  max-width: 880px;
  margin: 0 auto;
  padding: var(--sp-5) var(--sp-5) calc(var(--h-md) + var(--sp-7) * 2); /* 留出保存条的位置 */
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
.row {
  display: flex;
  gap: var(--sp-2);
  align-items: center;
  flex-wrap: wrap;
}
/* 价格（选填）：灰色小字按钮，箭头展开时朝下；展开的一块浅灰底、无边框 */
.price-toggle {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  height: var(--h-xs);
  padding: 0 var(--sp-2);
  border: 0;
  background: none;
  font-size: var(--fs-sm);
  color: var(--muted);
}
.price-toggle:hover:not(:disabled) {
  background: var(--hover);
}
.chev {
  transition: transform var(--ease);
}
.chev.down {
  transform: rotate(90deg);
}
.price {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--sp-2) var(--sp-4);
  margin-top: var(--sp-3);
  padding: var(--sp-3) var(--sp-4);
  border-radius: var(--radius-md);
  background: var(--card-muted);
}
.price-field {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
  min-width: 0;
}
.price-label {
  font-size: var(--fs-xs);
  color: var(--muted);
}
.price-input {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
}
.price-input input {
  width: 96px;
  height: var(--h-xs);
  font-size: var(--fs-sm);
}
.unit {
  font-size: var(--fs-xs);
  color: var(--faint);
  white-space: nowrap;
}
.price-note {
  grid-column: 1 / -1;
  margin: 0;
  font-size: var(--fs-xs);
  color: var(--faint);
}
.price-actions {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--sp-2);
}
.price-status {
  margin-right: auto;
  font-size: var(--fs-xs);
  color: var(--warn);
}
.price-actions button {
  min-width: 64px;
}
.dot {
  width: 6px;
  height: 6px;
  margin-left: var(--sp-1);
  border-radius: 50%;
  background: var(--attention);
}
.price-saved {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-size: var(--fs-sm);
  color: var(--ok);
}
.spend {
  margin-left: auto;
  font-size: var(--fs-xs);
  color: var(--faint);
}
.soft {
  border: 0;
  background: var(--hover);
}
.soft:hover:not(:disabled) {
  background: var(--line);
}
.soft.small,
.primary.small {
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

.save-bar {
  position: fixed;
  left: 50%;
  bottom: var(--sp-4);
  z-index: 10;
  width: min(480px, calc(100vw - var(--sp-5) * 2));
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding: var(--sp-2) var(--sp-2) var(--sp-2) var(--sp-5);
  border-radius: var(--panel-radius);
  background: var(--card);
  box-shadow: var(--shadow-pop);
  transform: translateX(-50%);
}
.save-bar .bar-text,
.save-bar .saved-ok,
.save-bar .err {
  margin-right: auto;
  font-size: var(--fs-md);
}
.bar-text {
  color: var(--fg);
}
.save-bar .primary {
  min-width: 112px;
}
/* 浮起和落下：只动平移和透明度，快出慢停 */
.bar-enter-active,
.bar-leave-active {
  transition:
    opacity 240ms cubic-bezier(0.2, 0, 0, 1),
    transform 240ms cubic-bezier(0.2, 0, 0, 1);
}
.bar-enter-from,
.bar-leave-to {
  opacity: 0;
  transform: translate(-50%, 16px);
}
.saved-ok {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-1);
  font-weight: var(--fw-label);
  color: var(--ok);
}
/* “已保存”出现和消失：只淡入淡出加一点上移 */
.fade-enter-active,
.fade-leave-active {
  transition:
    opacity var(--ease),
    transform var(--ease);
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
  transform: translateY(4px);
}
</style>
