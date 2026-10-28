<script setup lang="ts">
import { UNSAVED_CHANGES } from '../core/editMessages'
import { vPress } from '../components/pressFeedback'
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import {
  type Config,
  type Domain,
  type ServiceKind,
  SERVICE_KINDS,
  checkBaseUrl,
  SERVICE_LABELS,
  OTHER_DOMAIN_ID,
  isServiceConfigured,
  maskKey,
  checkDomainName,
  nextDomainId,
  checkSubfolder,
  checkNewFolderName,
  switchVaultKind,
  storeLabel,
  notesRoot,
} from '../core/config'
import { testService } from '../core/services'
import CopyErrorButton from '../components/CopyErrorButton.vue'
import { describeError } from '../core/errors'
import {
  saveConfig,
  pickFolder,
  countDomainNotes,
  deleteDomain,
  restoreDomain,
  httpFetch,
  readUsage,
  dirExists,
  inspectCollection,
  listObsidianVaults,
  ensureSubfolder,
  listSubfolders,
  guardClose,
  destroyWindow,
} from '../shell/tauri'
import { formatYuan, keyId, summarize, type Price, type UsageRecord } from '../core/cost'
import SettingCard from '../components/SettingCard.vue'
// 关于卡片带书写动画的数据（约 110KB），用到才加载，不拖慢启动
const AboutCard = defineAsyncComponent(() => import('../components/AboutCard.vue'))
import SelectBox from '../components/SelectBox.vue'
import NoticeDialog from '../components/NoticeDialog.vue'
import UnsavedDialog from '../components/UnsavedDialog.vue'
import { toast } from '../components/useToast'
import { Check, ChevronRight, Circle, CircleCheck, Plus, X } from '../components/icons'

const props = defineProps<{ config: Config; firstRun: boolean }>()
const emit = defineEmits<{ saved: [Config]; pending: [boolean]; domainBusy: [boolean] }>()

// 在副本上编辑，点“保存设置”才写入
const draft = reactive<Config>(JSON.parse(JSON.stringify(props.config)))
const saved = ref(JSON.stringify(props.config))
const dirty = computed(() => {
  const services = { ...draft.services }
  for (const k of KINDS) services[k] = { ...services[k], apiKey: newKey[k].trim() || services[k].apiKey }
  return JSON.stringify({ ...draft, services }) !== saved.value
})

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
const TOKEN_FIELDS: { key: keyof Price; label: string }[] = [
  { key: 'input', label: '输入' },
  { key: 'cachedInput', label: '缓存命中的输入' },
  { key: 'output', label: '输出' },
]
// 语音转写按音频时长计费（免费模型不用填）
const ASR_FIELDS: { key: keyof Price; label: string }[] = [{ key: 'perHour', label: '每小时音频' }]
const ALL_PRICE_KEYS: (keyof Price)[] = ['input', 'cachedInput', 'output', 'perHour']
const priceFields = (k: ServiceKind) => (k === 'asr' ? ASR_FIELDS : TOKEN_FIELDS)
const priceUnit = (k: ServiceKind) => (k === 'asr' ? '元 / 小时' : '元 / 百万 tokens')
// 价格区进入设置页时都收起；填过价格的，按钮上写“已填”
const priceOpen = reactive(Object.fromEntries(KINDS.map((k) => [k, false])) as Record<ServiceKind, boolean>)
/** 价格 → 三个输入框里的文字 */
const priceTexts = (p?: Price) => Object.fromEntries(ALL_PRICE_KEYS.map((key) => [key, String(p?.[key] ?? '')]))
/** 输入框里的原样文字：打到一半的“0.”不能被换成 0 或清空，所以不直接显示解析后的数字 */
const priceText = reactive(
  Object.fromEntries(KINDS.map((k) => [k, priceTexts(props.config.services[k].price)])) as Record<
    ServiceKind,
    Record<keyof Price, string>
  >,
)
/** 输入框文字 → 单价：空着是没填（undefined），不是非负数是填错了（NaN） */
const parsePrice = (raw: string) => {
  if (!raw.trim()) return undefined
  const value = Number(raw)
  return Number.isFinite(value) && value >= 0 ? value : NaN
}
const savedPrice = (k: ServiceKind) => (JSON.parse(saved.value) as Config).services[k].price
/** 填的不是数字的那一项 */
const priceError = (k: ServiceKind) => {
  const field = priceFields(k).find((f) => Number.isNaN(parsePrice(priceText[k][f.key])))
  return field ? `${SERVICE_LABELS[k]}的${field.label}须为大于或等于 0 的数字，例如 0.02。` : undefined
}
/** 价格尚未保存：收起后“价格（选填）”旁边有个橙色小点 */
const priceDirty = (k: ServiceKind) =>
  !!priceError(k) || JSON.stringify(savedPrice(k) ?? null) !== JSON.stringify(draft.services[k].price ?? null)
/** 保存设置后，价格改过的服务在“价格（选填）”旁边闪几秒“✓ 已保存” */
const priceJustSaved = reactive<Partial<Record<ServiceKind, boolean>>>({})
/** 撤销设置时同时恢复价格输入框里的原样文字。 */
function resetPrice(k: ServiceKind) {
  const p = savedPrice(k)
  draft.services[k].price = p ? { ...p } : undefined
  Object.assign(priceText[k], priceTexts(p))
  priceOpen[k] = false
}
/** 错误输入保留原价，保存时统一拦截；全部清空才去掉价格。 */
function setPrice(k: ServiceKind, f: keyof Price, raw: string) {
  priceText[k][f] = raw
  const v = parsePrice(raw)
  if (Number.isNaN(v)) return
  const price: Price = { ...draft.services[k].price, [f]: v }
  draft.services[k].price = Object.values(price).some((x) => x !== undefined) ? price : undefined
}

/** 测试连接那一行右边的小字；这把密钥还没用过时不显示 */
function spendText(k: ServiceKind): string {
  const id = keyIds.value[k]
  if (!id) return ''
  const s = summarize(usage.value, id, new Date())
  if (!s.calls) return ''
  // 这把密钥一次都没算过钱（没填价格）：只说用了几次，不显示金额
  if (s.unknown === s.calls) return `当前密钥已调用 ${s.calls} 次`
  const y = (v: number) => (v === 0 ? ' 0 元' : formatYuan(v))
  return `当前密钥：本月${y(s.month)} · 累计${y(s.total)} · ${s.calls} 次调用`
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

// ---- 收藏库（F31，设计稿 设计稿/设置页/状态-收藏库-Obsidian.webp、状态-收藏库-普通文件夹.webp） ----
const VAULT_KINDS = [
  { kind: 'obsidian', label: '连接 Obsidian 仓库' },
  { kind: 'folder', label: '保存到普通文件夹' },
] as const
const obsidianVaults = ref<{ name: string; path: string }[]>([])
onMounted(() =>
  listObsidianVaults()
    .then((v) => (obsidianVaults.value = v))
    .catch(() => {}),
)
// 一层一层出现：先选仓库 → 选中后才显示连接结果 → 连上了才问存到哪个文件夹
/** 当前路径是不是 Obsidian 仓库（里面有 .obsidian）；null 表示还在查 */
const pathIsVault = ref<boolean | null>(null)
/** 在“连接 Obsidian 仓库”下亲手选过文件夹：只有这时才说“不是仓库”，切过来时原来的普通文件夹不算 */
const pickedHere = ref(false)
watch(
  () => draft.vaultPath,
  async (p) => {
    pathIsVault.value = null
    const r = p ? await dirExists(`${p}\\.obsidian`).catch(() => false) : false
    if (draft.vaultPath === p) pathIsVault.value = r // 查的过程中路径又变了，丢掉旧结果
  },
  { immediate: true },
)
const NOT_VAULT = '这个文件夹不是 Obsidian 仓库（里面没有 .obsidian 文件夹）。'
const vaultName = computed(() => draft.vaultPath.split(/[\\/]/).filter(Boolean).at(-1) ?? '')
const connected = computed(() => draft.vault.kind === 'obsidian' && !!draft.vaultPath && pathIsVault.value === true)

// 下拉框只列出已有文件夹；旁边的新建入口让这一行切换为输入框。
const subfolders = ref<string[]>([])
async function loadSubfolders() {
  const p = draft.vaultPath
  const list = connected.value ? await listSubfolders(p).catch(() => []) : []
  if (draft.vaultPath === p) subfolders.value = list
}
watch(connected, loadSubfolders, { immediate: true })
const subfolderOptions = computed(() => {
  const cur = draft.vault.subfolder.trim()
  const all = cur && !subfolders.value.includes(cur) ? [cur, ...subfolders.value] : subfolders.value
  return [{ value: '', label: '仓库最外层（不另建文件夹）' }, ...all.map((f) => ({ value: f, label: f }))]
})
const subfolderChoice = computed({
  get: () => draft.vault.subfolder.trim(),
  set: (v: string) => {
    draft.vault.subfolder = v
    createdFolder.value = ''
  },
})
const subfolderError = computed(() => (connected.value ? checkSubfolder(draft.vault.subfolder) : null))
/** 笔记最后存成什么样：仓库 / 存放文件夹 / 领域 / 标题.md（领域文件夹在存第一条笔记时自动建） */
const notePathPreview = computed(() => `${storeLabel(draft)} / 领域 / 标题.md`)

const newFolder = ref(false)
const newFolderName = ref('')
const newFolderInput = ref<HTMLInputElement>()
const creatingFolder = ref(false)
const createError = ref('')
/** 刚建好的文件夹名：显示“✓ 已新建文件夹”，换了别的选择就不再显示 */
const createdFolder = ref('')
const newFolderProblem = computed(() =>
  newFolderName.value.trim() ? checkNewFolderName(newFolderName.value, subfolders.value) : null,
)
async function startNewFolder() {
  newFolder.value = true
  newFolderName.value = ''
  createError.value = ''
  await nextTick()
  newFolderInput.value?.focus()
}
async function createFolder() {
  const err = checkNewFolderName(newFolderName.value, subfolders.value)
  if (err) return (createError.value = err)
  const name = newFolderName.value.trim()
  creatingFolder.value = true
  try {
    await ensureSubfolder(draft.vaultPath, name)
  } catch (e) {
    return (createError.value = `文件夹创建失败：${String(e)}`)
  } finally {
    creatingFolder.value = false
  }
  await loadSubfolders()
  draft.vault.subfolder = name
  createdFolder.value = name
  newFolder.value = false
}

// 选中方式下面的白色底块，换方式时滑过去（和标题栏的页面切换一样）；两个按钮宽度不同，按实际位置和宽度放
const kindEls = ref<HTMLElement[]>([])
const kindThumb = ref<Record<string, string>>({})
function placeKindThumb() {
  const el = kindEls.value[VAULT_KINDS.findIndex((v) => v.kind === draft.vault.kind)]
  if (el) kindThumb.value = { width: `${el.offsetWidth}px`, transform: `translateX(${el.offsetLeft}px)` }
}
onMounted(placeKindThumb)
watch(() => draft.vault.kind, placeKindThumb, { flush: 'post' })

/** 连上之后仓库列表收起来，点“更换”才展开 */
const changingVault = ref(false)
const showVaultList = computed(() => !connected.value || changingVault.value)
const VAULT_DESC = '选择笔记和图片的保存位置。'
/** 卡片收起时，说明换成当前存放位置，不点开也知道存在哪；还没选好时显示说明 */
const vaultStatus = computed(() => {
  if (!draft.vaultPath) return undefined
  if (draft.vault.kind === 'folder') return { label: '存放在普通文件夹', value: draft.vaultPath }
  return connected.value ? { label: '存放在 Obsidian 仓库', value: storeLabel(draft) } : undefined
})

function setVaultKind(kind: Config['vault']['kind']) {
  Object.assign(draft, switchVaultKind(draft, kind))
  pickedHere.value = false
  newFolder.value = false
  createdFolder.value = ''
}
function chooseObsidianVault(path: string) {
  pickedHere.value = true
  changingVault.value = false
  if (draft.vaultPath !== path) {
    draft.vaultPath = path
    draft.vault.subfolder = ''
    newFolder.value = false
    createdFolder.value = ''
  }
}
async function pickObsidianFolder() {
  const p = await pickFolder(draft.vaultPath)
  if (p) chooseObsidianVault(p)
}

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

async function runTest(k: ServiceKind) {
  applyKey(k)
  const s = draft.services[k]
  if (!isServiceConfigured(s)) {
    test[k] = { status: 'fail', message: checkBaseUrl(s.baseUrl) ?? '请填写接口地址、模型名和密钥后再测试。' }
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
// 领域列表的增加、改名、删除马上生效、马上写进配置，不排在“保存设置”后面（它们本来就直接动收藏库里的文件夹）；
// 其余设置仍然点“保存设置”才生效，所以这里只把领域写进“上次保存的配置”，不连带保存别的未保存改动
/** 上次保存的配置里的收藏库位置（领域的文件夹操作都按它，不按还没保存的新位置） */
const savedRoot = () => notesRoot(JSON.parse(saved.value) as Config)
const domainBusy = ref(false)
async function persistDomains(): Promise<boolean> {
  const base = JSON.parse(saved.value) as Config
  base.domains = JSON.parse(JSON.stringify(draft.domains))
  const wasBusy = domainBusy.value
  domainBusy.value = true
  try {
    await saveConfig(base)
  } catch (e) {
    draft.domains = (JSON.parse(saved.value) as Config).domains // 没存成就恢复成存好的样子
    domainError.value = `领域列表保存失败：${String(e)}。`
    return false
  } finally {
    domainBusy.value = wasBusy
  }
  saved.value = JSON.stringify(base)
  emit('saved', base)
  return true
}

const newDomain = ref('')
const domainError = ref<string | null>(null)
const editingId = ref<number | null>(null)
const editingName = ref('')

async function addDomain() {
  if (domainBusy.value || saving.value) return
  const err = checkDomainName(newDomain.value, draft.domains)
  domainError.value = err
  if (err) return
  // 新领域放在“其他”前面
  const at = draft.domains.findIndex((d) => d.id === OTHER_DOMAIN_ID)
  draft.domains.splice(at < 0 ? draft.domains.length : at, 0, {
    id: nextDomainId(draft.domains),
    name: newDomain.value.trim(),
  })
  const name = newDomain.value.trim()
  newDomain.value = ''
  if (await persistDomains()) toast(`已新增领域「${name}」。`)
}

function startRename(id: number, name: string) {
  if (domainBusy.value || saving.value) return
  editingId.value = id
  editingName.value = name
  domainError.value = null
}

async function finishRename() {
  if (domainBusy.value || saving.value) return
  const d = draft.domains.find((x) => x.id === editingId.value)
  if (!d) return
  const err = checkDomainName(editingName.value, draft.domains, d.id)
  domainError.value = err
  if (err) return
  d.name = editingName.value.trim()
  editingId.value = null
  if (await persistDomains()) toast(`领域已改名为「${d.name}」。`)
}

/** 确认一次后文件夹进回收站、领域马上从列表里去掉，几秒内可以撤销 */
const askRemove = ref<{ domain: Domain; notes: number } | null>(null)
async function removeDomain(id: number) {
  if (domainBusy.value || saving.value) return
  const d = draft.domains.find((x) => x.id === id)
  if (!d) return
  domainError.value = null
  domainBusy.value = true
  try {
    const notes = (JSON.parse(saved.value) as Config).vaultPath ? await countDomainNotes(savedRoot(), d.name) : 0
    askRemove.value = { domain: d, notes }
  } catch (e) {
    domainError.value = `无法读取领域文件夹“${d.name}”：${String(e)}。`
  } finally {
    domainBusy.value = false
  }
}

/** 把文件夹（连同笔记和只有它们在用的图片）放进回收站，再把领域从列表里去掉并马上保存；几秒内可以撤销 */
async function confirmRemove() {
  if (domainBusy.value || saving.value) return
  const a = askRemove.value
  askRemove.value = null
  if (!a) return
  const d = a.domain
  const at = draft.domains.findIndex((x) => x.id === d.id)
  if (at < 0) return
  const root = savedRoot()
  const hasRoot = !!(JSON.parse(saved.value) as Config).vaultPath
  domainBusy.value = true
  try {
    let images: string[] = []
    let deleted = false
    try {
      if (hasRoot) {
        const result = await deleteDomain(root, d.name)
        images = result.images
        deleted = result.existed
      }
    } catch (e) {
      domainError.value = `领域文件夹删除失败：${String(e)}。`
      return
    }
    draft.domains.splice(at, 1)
    if (!(await persistDomains())) {
      if (deleted) {
        try {
          await restoreDomain(root, d.name, images)
          domainError.value += ' 删除未生效，文件夹已恢复。'
        } catch (e) {
          domainError.value += ` 自动恢复失败。请从 Windows 回收站恢复“${d.name}”及相关图片。详情：${String(e)}`
        }
      }
      return
    }
    toast(
      deleted
        ? `已删除领域“${d.name}”，${a.notes ? `文件夹及 ${a.notes} 篇笔记` : '文件夹'}已移入回收站。`
        : `已删除领域“${d.name}”。`,
      {
        action: {
          label: '撤销',
          run: async () => {
            if (domainBusy.value || saving.value) {
              domainError.value = '设置正在保存，暂时无法撤销。'
              return
            }
            domainBusy.value = true
            try {
              if (deleted) await restoreDomain(root, d.name, images)
              if (!draft.domains.some((x) => x.id === d.id || x.name === d.name))
                draft.domains.splice(Math.min(at, draft.domains.length), 0, d)
              const restoredDomains = [...draft.domains]
              if (await persistDomains()) toast(`已恢复领域「${d.name}」。`)
              else {
                draft.domains = restoredDomains
                domainError.value += ' 文件已恢复。请点击“保存设置”更新领域列表。'
              }
            } catch (e) {
              toast(`撤销失败：${String(e)}。`, { kind: 'error' })
            } finally {
              domainBusy.value = false
            }
          },
        },
      },
    )
  } finally {
    domainBusy.value = false
  }
}

// ---- 保存 ----
const saveError = ref<string | null>(null)
const saving = ref(false)
/** 保存成功后左边显示 3 秒“✓ 已保存” */
const justSaved = ref(false)
let justSavedTimer: number | undefined

/** 有没保存的改动（含刚粘贴、还没写进配置的新密钥） */
const pending = computed(() => dirty.value || KINDS.some((k) => priceError(k)))
/** 保存条：有改动、第一次使用、刚保存完（显示“已保存”）时浮在底部，其余时间不出现 */
const barShown = computed(() => pending.value || props.firstRun || justSaved.value)
onBeforeUnmount(() => window.clearTimeout(justSavedTimer))

/** 撤销：恢复成上次保存的样子 */
function revert() {
  if (domainBusy.value || saving.value) return
  Object.assign(draft, JSON.parse(saved.value) as Config)
  for (const k of KINDS) {
    newKey[k] = ''
    resetPrice(k)
  }
  saveError.value = null
}
/** 只确认本次提交的快照；没有剩余改动时才返回 true，允许切页或关闭。 */
async function save(): Promise<boolean> {
  if (saving.value || domainBusy.value) return false
  for (const k of KINDS) {
    const error = priceError(k)
    if (error) {
      priceOpen[k] = true
      saveError.value = error
      void activate('services')
      return false
    }
  }
  KINDS.forEach(applyKey)
  const priceChanged = KINDS.filter(priceDirty)
  saveError.value = null
  if (draft.vault.kind === 'obsidian') {
    if (!connected.value) {
      saveError.value = '请选择 Obsidian 仓库。'
      return false
    }
    if (subfolderError.value) {
      saveError.value = subfolderError.value
      return false
    }
  }
  const submitted: Config = JSON.parse(JSON.stringify(draft))
  saving.value = true
  try {
    if (submitted.vault.kind === 'obsidian' && submitted.vaultPath && submitted.vault.subfolder.trim())
      await ensureSubfolder(submitted.vaultPath, submitted.vault.subfolder.trim())
    if (submitted.vaultPath && notesRoot(submitted) !== savedRoot())
      submitted.domains = (await inspectCollection(submitted)).config.domains
    await saveConfig(submitted)
    if (notesRoot(draft) === notesRoot(submitted)) draft.domains = submitted.domains
    saved.value = JSON.stringify(submitted)
    emit('saved', submitted)
    for (const k of priceChanged) if (!priceDirty(k)) priceJustSaved[k] = true
    justSaved.value = true
    window.clearTimeout(justSavedTimer)
    justSavedTimer = window.setTimeout(() => {
      justSaved.value = false
      for (const k of KINDS) priceJustSaved[k] = false
    }, 1200)
    // 保存期间的新输入仍待保存，切页/关闭入口必须继续留在设置页。
    return !pending.value
  } catch (e) {
    saveError.value = String(e)
    return false
  } finally {
    saving.value = false
  }
}

// ---- 有没保存的改动：告诉外面（切换页面前要问），关闭软件时自己问 ----
watch(pending, (v) => emit('pending', v))
watch(domainBusy, (v) => emit('domainBusy', v), { flush: 'sync' })
defineExpose({ save })

const askClose = ref(false)
async function saveAndClose() {
  if (await save()) await destroyWindow()
  else askClose.value = false // 没存成：留在设置页，保存条上会写原因
}
let unguard: (() => void) | undefined
let disposed = false
onBeforeUnmount(() => {
  disposed = true
  unguard?.()
})
onMounted(() => {
  guardClose(
    () => domainBusy.value || (pending.value && !props.firstRun),
    () => {
      if (domainBusy.value) toast('领域操作尚未完成，请稍后关闭。', { kind: 'error' })
      else askClose.value = true
    },
  )
    .then((f) => {
      if (disposed) f()
      else unguard = f
    })
    .catch(() => {}) // 浏览器预览里没有窗口
})
</script>

<template>
  <main class="settings" aria-label="设置">
    <p v-if="firstRun" class="banner">请选择收藏库并配置三项模型服务，然后保存设置。</p>

    <SettingCard
      id="vault"
      title="收藏库"
      :desc="VAULT_DESC"
      :status="vaultStatus"
      :open="open === 'vault'"
      :closing="closing === 'vault'"
      @activate="activate('vault')"
    >
      <div class="vault-kinds" role="radiogroup" aria-label="收藏库方式">
        <span class="vault-thumb" :style="kindThumb" aria-hidden="true" />
        <button
          v-for="v in VAULT_KINDS"
          ref="kindEls"
          :key="v.kind"
          v-press
          class="vault-kind"
          :class="{ on: draft.vault.kind === v.kind }"
          role="radio"
          :aria-checked="draft.vault.kind === v.kind"
          @click="setVaultKind(v.kind)"
        >
          {{ v.label }}
        </button>
      </div>
      <div v-if="draft.vault.kind === 'folder'" class="row">
        <span class="path" :class="{ missing: !draft.vaultPath }">{{ draft.vaultPath || '未配置' }}</span>
        <button v-press class="soft" @click="chooseVault">选择文件夹</button>
      </div>
      <div v-else class="obsidian">
        <div v-if="showVaultList" class="field">
          <span v-if="obsidianVaults.length">找到 {{ obsidianVaults.length }} 个 Obsidian 仓库，请选择一个。</span>
          <span v-else>未找到 Obsidian 仓库，请手动选择仓库文件夹。</span>
          <ul v-if="obsidianVaults.length" class="vault-list" role="radiogroup" aria-label="Obsidian 仓库">
            <li v-for="v in obsidianVaults" :key="v.path">
              <button
                v-press
                class="vault-item"
                role="radio"
                :aria-checked="draft.vaultPath === v.path"
                @click="chooseObsidianVault(v.path)"
              >
                <component
                  :is="draft.vaultPath === v.path ? CircleCheck : Circle"
                  :size="16"
                  class="vault-radio"
                  aria-hidden="true"
                />
                <span class="vault-name" :title="v.name">{{ v.name }}</span>
                <span class="vault-path" :title="v.path">{{ v.path }}</span>
              </button>
            </li>
          </ul>
        </div>
        <div v-if="showVaultList">
          <button v-press class="vault-other" @click="pickObsidianFolder">
            {{ obsidianVaults.length ? '选择其他文件夹' : '选择文件夹' }}
          </button>
        </div>
        <p v-if="connected" class="ok vault-state">
          <Check :size="16" aria-hidden="true" />已连接：{{ vaultName }}
          <button v-press class="vault-other" @click="changingVault = !changingVault">
            {{ changingVault ? '收起' : '更换' }}
          </button>
        </p>
        <p v-else-if="pickedHere && pathIsVault === false" class="err vault-state">{{ NOT_VAULT }}</p>
        <div v-if="connected" class="field folder-field">
          <span>存放文件夹</span>
          <div v-if="newFolder" class="new-folder">
            <input
              ref="newFolderInput"
              v-model="newFolderName"
              placeholder="文件夹名称，例如“收藏”"
              aria-label="新文件夹的名字"
              spellcheck="false"
              @input="createError = ''"
              @keydown.enter.prevent="createFolder"
              @keydown.esc.prevent="newFolder = false"
            />
            <button v-press class="soft" @click="newFolder = false">取消</button>
            <button
              v-press
              class="primary"
              :disabled="!newFolderName.trim() || !!newFolderProblem || creatingFolder"
              @click="createFolder"
            >
              {{ creatingFolder ? '新建中…' : '新建' }}
            </button>
          </div>
          <div v-else class="folder-choice">
            <SelectBox v-model="subfolderChoice" :options="subfolderOptions" aria-label="存放文件夹" size="md" />
            <button v-press class="soft" @click="startNewFolder"><Plus :size="16" />新建文件夹</button>
          </div>
          <span v-if="newFolder && (createError || newFolderProblem)" class="err">{{
            createError || newFolderProblem
          }}</span>
          <span v-else-if="newFolder" class="vault-hint">将在仓库根目录创建此文件夹。</span>
          <span v-else-if="subfolderError" class="err">{{ subfolderError }}</span>
          <template v-else>
            <span v-if="createdFolder" class="ok vault-state">
              <Check :size="16" aria-hidden="true" />文件夹“{{ createdFolder }}”已创建；保存设置后使用。
            </span>
            <span class="vault-hint">保存路径：{{ notePathPreview }}</span>
          </template>
        </div>
      </div>
    </SettingCard>

    <SettingCard
      id="services"
      title="模型服务"
      desc="分别配置文字整理、看图理解和语音转写服务。"
      :open="open === 'services'"
      :closing="closing === 'services'"
      @activate="activate('services')"
    >
      <div v-for="k in KINDS" :key="k" class="service">
        <div class="service-head">
          <h3>{{ SERVICE_LABELS[k] }}</h3>
          <span v-if="!isServiceConfigured(draft.services[k]) && !newKey[k]" class="tag-missing">未配置</span>
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
              :placeholder="
                draft.services[k].apiKey ? `${maskKey(draft.services[k].apiKey)}（已保存）` : '输入服务商密钥'
              "
            />
          </label>
        </div>
        <p v-if="draft.services[k].baseUrl.trim() && checkBaseUrl(draft.services[k].baseUrl)" class="err">
          {{ checkBaseUrl(draft.services[k].baseUrl) }}
        </p>
        <div class="row">
          <button v-press class="soft small" :disabled="test[k].status === 'testing'" @click="runTest(k)">
            {{ test[k].status === 'testing' ? '测试中…' : '测试连接' }}
          </button>
          <button v-press class="price-toggle" :aria-expanded="priceOpen[k]" @click="priceOpen[k] = !priceOpen[k]">
            价格（{{ draft.services[k].price ? '已填写' : '选填' }}）<ChevronRight
              :size="14"
              class="chev"
              :class="{ down: priceOpen[k] }"
              aria-hidden="true"
            />
            <span v-if="!priceOpen[k] && priceDirty(k)" class="dot" title="价格修改尚未保存" />
          </button>
          <Transition name="fade">
            <span v-if="priceJustSaved[k]" class="price-saved"><Check :size="14" aria-hidden="true" />已保存</span>
          </Transition>
          <span v-if="test[k].status === 'ok'" class="ok">✓ {{ test[k].message }}</span>
          <span v-if="test[k].status === 'fail'" class="err">{{ test[k].message }}</span>
          <CopyErrorButton v-if="test[k].status === 'fail' && test[k].detail" :detail="test[k].detail" />
          <span v-if="spendText(k)" class="spend">{{ spendText(k) }}</span>
        </div>
        <div v-if="priceOpen[k]" class="price">
          <label v-for="f in priceFields(k)" :key="f.key" class="price-field">
            <span class="price-label">{{ f.label }}</span>
            <span class="price-input">
              <input
                :value="priceText[k][f.key]"
                inputmode="decimal"
                placeholder="未填"
                @input="setPrice(k, f.key, ($event.target as HTMLInputElement).value)"
              />
              <span class="unit">{{ priceUnit(k) }}</span>
            </span>
          </label>
          <p class="price-note">
            {{
              k === 'asr'
                ? '选填，用于估算音频转写费用；免费模型无需填写。以服务商账单为准。'
                : '选填，用于估算费用。价格请查服务商官网，实际费用以账单为准。'
            }}
          </p>
          <div class="price-actions">
            <span v-if="priceError(k)" class="price-status">{{ priceError(k) }}</span>
            <button v-press class="price-collapse" @click="priceOpen[k] = false">
              收起<ChevronRight :size="14" class="collapse-arrow" />
            </button>
          </div>
        </div>
      </div>
    </SettingCard>

    <SettingCard
      id="domains"
      title="领域"
      desc="整理时 AI 会把内容放进合适的领域；没有合适的领域时，会在确认页建议新建一个。也可以在这里自己添加。"
      :open="open === 'domains'"
      :closing="closing === 'domains'"
      @activate="activate('domains')"
    >
      <ul class="domains" :inert="domainBusy || saving">
        <li v-for="d in draft.domains" :key="d.id">
          <template v-if="editingId === d.id">
            <input v-model="editingName" @keyup.enter="finishRename" @keyup.esc="editingId = null" />
            <button v-press class="link" @click="finishRename">确定</button>
            <button v-press class="link" @click="editingId = null">取消</button>
          </template>
          <template v-else>
            <button class="chip-name" title="点击改名" @click="startRename(d.id, d.name)">{{ d.name }}</button>
            <button
              v-if="d.id !== OTHER_DOMAIN_ID"
              v-press="'icon'"
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
        <input
          v-model="newDomain"
          class="grow"
          :disabled="domainBusy || saving"
          placeholder="新领域名"
          @keyup.enter="addDomain"
        />
        <button v-press class="soft" :disabled="domainBusy || saving" @click="addDomain">添加</button>
      </div>
      <p v-if="domainError" class="err">{{ domainError }}</p>
    </SettingCard>

    <UnsavedDialog
      v-if="askClose"
      :busy="saving"
      @save="saveAndClose"
      @discard="destroyWindow()"
      @stay="askClose = false"
    />

    <!-- 删除领域：一次确认中说明笔记数、回收站和撤销 -->
    <NoticeDialog
      v-if="askRemove"
      :title="`删除领域“${askRemove.domain.name}”？`"
      tone="error"
      danger
      cancel-text="取消"
      ok-text="删除"
      @cancel="askRemove = null"
      @ok="confirmRemove"
    >
      <template v-if="askRemove.notes > 0">
        <p>领域文件夹、{{ askRemove.notes }} 篇笔记及仅由它们引用的图片将移入 Windows 回收站。</p>
        <p>删除后可撤销，也可从回收站恢复。</p>
      </template>
      <template v-else>
        <p>将删除该领域设置；如有同名文件夹，也会移入 Windows 回收站。</p>
        <p>删除后可在提示条中撤销。</p>
      </template>
    </NoticeDialog>

    <SettingCard
      id="privacy"
      title="隐私说明"
      :open="open === 'privacy'"
      :closing="closing === 'privacy'"
      @activate="activate('privacy')"
    >
      <ul class="privacy">
        <li>只把你放进来的内容和“本次要求”发给你自己配置的 AI 服务，其他笔记和电脑信息都不发送。</li>
        <li>软件没有自己的服务器，不收集任何使用数据。</li>
        <li>密钥只保存在本机的 Windows 凭据管理器里。</li>
      </ul>
    </SettingCard>

    <SettingCard
      id="about"
      title="关于"
      center
      :open="open === 'about'"
      :closing="closing === 'about'"
      @activate="activate('about')"
    >
      <AboutCard :open="open === 'about'" />
    </SettingCard>

    <!-- 保存条（Discord、Shopify 后台的做法）：有改动时从底部浮起，保存后显示“已保存”再落下；平时不出现 -->
    <Transition name="bar">
      <div v-if="barShown" class="save-bar" role="status">
        <span v-if="saveError" class="err">保存失败：{{ saveError }}</span>
        <span v-else-if="justSaved && !pending" class="saved-ok"><Check :size="16" aria-hidden="true" />已保存</span>
        <span v-else class="bar-text">{{ firstRun && !pending ? '请完成配置后保存' : UNSAVED_CHANGES }}</span>
        <button v-if="pending && !firstRun" v-press class="soft" :disabled="saving || domainBusy" @click="revert">
          撤销
        </button>
        <button
          v-press="'tactile'"
          class="primary"
          :disabled="saving || domainBusy || (!pending && !firstRun)"
          @click="save"
        >
          {{ saving ? '保存中…' : '保存设置' }}
        </button>
      </div>
    </Transition>
  </main>
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
.price-collapse {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--sp-1);
  min-width: 64px;
  height: var(--h-sm);
  padding: 0 var(--px-sm);
  border: 0;
  background: var(--card);
  color: var(--muted);
  font-size: var(--fs-sm);
}
.price-collapse:hover:not(:disabled) {
  background: var(--card);
  color: var(--fg);
}
.collapse-arrow {
  transform: rotate(-90deg);
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

/* ---- 收藏库：一组两选一的胶囊，下面按方式显示 ---- */
/* 尺寸和标题栏的页面切换一样（TitleBar 的 .switch） */
.vault-kinds {
  position: relative;
  display: inline-flex;
  gap: 2px;
  margin-bottom: var(--sp-3);
  padding: 3px;
  background: var(--card-muted);
  border-radius: var(--radius-pill);
}
.vault-thumb {
  position: absolute;
  top: 3px;
  left: 0;
  height: var(--h-xs);
  border-radius: var(--radius-pill);
  background: var(--card);
  box-shadow: var(--shadow-card);
  transition:
    transform 260ms cubic-bezier(0.2, 0, 0, 1),
    width 260ms cubic-bezier(0.2, 0, 0, 1);
}
.vault-kind {
  position: relative; /* 文字在白色底块上面 */
  height: var(--h-xs);
  border: 0;
  border-radius: var(--radius-pill);
  background: none;
  color: var(--muted);
  transition: color 260ms cubic-bezier(0.2, 0, 0, 1);
}
.vault-kind:hover:not(:disabled) {
  background: none;
  color: var(--fg);
}
/* 选中不加粗：字宽一变，底块就对不齐了 */
.vault-kind.on,
.vault-kind.on:hover:not(:disabled) {
  color: var(--accent);
}
.obsidian {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
}
.vault-list {
  margin: 0;
  padding: 0;
  list-style: none;
  background: var(--card-muted);
  border-radius: var(--radius-md);
  overflow: hidden;
}
.vault-list li + li {
  border-top: 1px solid var(--line);
}
/* 每一行都是能点的选项：前面一个圆圈，悬停变色，选中是靛蓝的对勾圆 */
.vault-item {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  width: 100%;
  height: var(--h-md);
  padding: 0 var(--px-sm);
  border: 0;
  border-radius: 0;
  background: none;
  font-size: var(--fs-md);
  color: var(--fg-strong);
  text-align: left;
  cursor: pointer;
}
.vault-item:hover:not(:disabled) {
  background: var(--hover);
}
.vault-radio {
  flex: none;
  color: var(--faint);
}
.vault-item[aria-checked='true'] .vault-radio {
  color: var(--accent);
}
.vault-name {
  flex: none;
  max-width: 50%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: var(--fw-label);
}
.vault-path {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--fs-sm);
  color: var(--faint);
}
/* “选择其他文件夹”：灰色小字加下划线，不抢视线 */
.vault-other {
  height: auto;
  padding: 0;
  border: 0;
  background: none;
  font-size: var(--fs-sm);
  color: var(--muted);
  text-decoration: underline;
  text-underline-offset: 3px;
}
.vault-other:hover:not(:disabled) {
  background: none;
  color: var(--fg);
}
/* 新建文件夹：下拉框那一行原地换成输入框 + 取消 / 新建 */
.new-folder {
  display: flex;
  gap: var(--sp-2);
}
.folder-choice {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--sp-2);
}
.folder-choice button,
.new-folder button {
  height: var(--h-md);
  font-size: var(--fs-action);
  white-space: nowrap;
}
.folder-choice .select,
.new-folder input {
  align-self: center;
}
.folder-choice button {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-2);
}
.folder-field {
  width: 100%;
  max-width: var(--settings-folder-width);
}
.new-folder input {
  flex: 1;
}
.new-folder button {
  flex: none;
}
.vault-hint {
  font-size: var(--fs-xs);
  color: var(--faint);
}
.vault-state {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  margin: 0;
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
.domains li:has(> .chip-name:only-child) {
  padding-right: var(--px-sm);
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
