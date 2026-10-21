<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
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

const props = defineProps<{ config: Config; firstRun: boolean }>()
const emit = defineEmits<{ saved: [Config] }>()

// 在副本上编辑，点“保存设置”才写入
const draft = reactive<Config>(JSON.parse(JSON.stringify(props.config)))
const saved = ref(JSON.stringify(props.config))
const dirty = computed(() => JSON.stringify(draft) !== saved.value)

const KINDS = SERVICE_KINDS

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

    <section>
      <h2>收藏库文件夹</h2>
      <p class="hint">笔记和图片都保存在这里。可以放在 Obsidian 的 vault 里。</p>
      <div class="row">
        <span class="path" :class="{ missing: !draft.vaultPath }">{{ draft.vaultPath || '未配置' }}</span>
        <button @click="chooseVault">选择文件夹</button>
      </div>
    </section>

    <section>
      <h2>模型服务</h2>
      <div
        v-for="k in KINDS"
        :key="k"
        class="service"
        :class="{ missing: !isServiceConfigured(draft.services[k]) && !newKey[k] }"
      >
        <div class="service-head">
          <h3>{{ SERVICE_LABELS[k] }}</h3>
          <span v-if="!isServiceConfigured(draft.services[k]) && !newKey[k]" class="tag-missing">未配置</span>
          <button v-if="k !== 'text'" class="link" @click="copyFromText(k)">与文字整理用同一家</button>
        </div>
        <label
          >接口地址<input
            v-model="draft.services[k].baseUrl"
            placeholder="https://api.example.com/v1"
            spellcheck="false"
        /></label>
        <p v-if="draft.services[k].baseUrl.trim() && checkBaseUrl(draft.services[k].baseUrl)" class="err field-err">
          {{ checkBaseUrl(draft.services[k].baseUrl) }}
        </p>
        <label>模型名<input v-model="draft.services[k].model" spellcheck="false" /></label>
        <label
          >密钥
          <input
            v-model="newKey[k]"
            type="password"
            spellcheck="false"
            autocomplete="off"
            :placeholder="
              draft.services[k].apiKey ? `${maskKey(draft.services[k].apiKey)}（已保存，输入新的可替换）` : '粘贴密钥'
            "
          />
        </label>
        <div class="row">
          <button :disabled="test[k].status === 'testing'" @click="runTest(k)">
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
    </section>

    <section>
      <h2>领域</h2>
      <p class="hint">每个领域对应收藏库里的一个文件夹，用到时才创建。改名只影响以后保存的笔记；“其他”不能删除。</p>
      <ul class="domains">
        <li v-for="d in draft.domains" :key="d.id">
          <template v-if="editingId === d.id">
            <input v-model="editingName" @keyup.enter="finishRename" @keyup.esc="editingId = null" />
            <button @click="finishRename">确定</button>
            <button class="link" @click="editingId = null">取消</button>
          </template>
          <template v-else>
            <span>{{ d.name }}</span>
            <button class="link" @click="startRename(d.id, d.name)">改名</button>
            <button v-if="d.id !== OTHER_DOMAIN_ID" class="link danger" @click="removeDomain(d.id)">删除</button>
          </template>
        </li>
      </ul>
      <div class="row">
        <input v-model="newDomain" placeholder="新领域名" @keyup.enter="addDomain" />
        <button @click="addDomain">添加</button>
      </div>
      <p v-if="domainError" class="err">{{ domainError }}</p>
    </section>

    <section>
      <h2>隐私说明</h2>
      <p>
        <b>会发送给模型服务的内容：</b>提取出的文字、压缩后的图片（长边不超过 1568
        像素）、音频、“本次要求”、已有标签的名称列表。
      </p>
      <p><b>不会发送的内容：</b>其他笔记的正文、文件路径、文件夹结构、用户名等设备信息。</p>
      <p class="hint">密钥只保存在本机的配置文件里（%APPDATA%\ContentToMd\config.json），不在收藏库内。</p>
    </section>

    <footer>
      <span v-if="saveError" class="err">保存失败：{{ saveError }}</span>
      <span v-else-if="!dirty && !firstRun" class="hint">设置已保存</span>
      <button class="primary" :disabled="saving || (!dirty && !KINDS.some((k) => newKey[k]))" @click="save">
        {{ saving ? '保存中…' : '保存设置' }}
      </button>
    </footer>
  </div>
</template>

<style scoped>
/* 和确认页同一套：浅灰底上的白卡片，尺寸只用 src/style.css 的令牌 */
.settings {
  max-width: 720px;
  margin: 0 auto;
  padding: var(--sp-5) var(--sp-5) calc(var(--h-md) + var(--sp-7) * 2);
}
h1 {
  margin: 0 0 var(--sp-4);
  font-size: var(--fs-2xl);
  font-weight: var(--fw-title);
  line-height: 1.35;
  color: var(--fg-strong);
}
h2 {
  margin: 0 0 var(--sp-2);
  font-size: var(--fs-lg);
  font-weight: var(--fw-heading);
  color: var(--fg-strong);
}
h3 {
  margin: 0;
  font-size: var(--fs-md);
  font-weight: var(--fw-heading);
  color: var(--fg-strong);
}
p {
  line-height: 1.7;
}
section {
  margin-bottom: var(--sp-4);
  padding: var(--sp-5);
  background: var(--card);
  border: 1px solid var(--panel-border);
  border-radius: var(--panel-radius);
  box-shadow: var(--shadow-card);
}
.banner {
  margin: 0 0 var(--sp-4);
  padding: var(--sp-3) var(--sp-4);
  background: var(--warn-bg);
  color: var(--warn);
  border-radius: var(--radius-md);
}
.hint {
  margin: 0 0 var(--sp-4);
  color: var(--muted);
  font-size: var(--fs-sm);
}
.row {
  display: flex;
  gap: var(--sp-2);
  align-items: center;
  flex-wrap: wrap;
}
.path {
  flex: 1;
  min-width: 0;
  min-height: var(--h-md);
  display: flex;
  align-items: center;
  padding: 0 var(--px-md);
  background: var(--card-muted);
  border-radius: var(--radius-md);
  overflow-wrap: anywhere;
  font-family: Consolas, monospace;
  font-size: var(--fs-sm);
}
.missing .tag-missing,
.path.missing {
  color: var(--warn);
  font-weight: var(--fw-label);
}
.tag-missing {
  padding: 0 var(--sp-2);
  background: var(--warn-bg);
  border-radius: var(--radius-pill);
  font-size: var(--fs-xs);
}
.service {
  padding: var(--sp-4) 0;
  border-top: 1px solid var(--line);
}
.service:first-of-type {
  padding-top: 0;
  border-top: 0;
}
.service-head {
  display: flex;
  gap: var(--sp-2);
  align-items: center;
  margin-bottom: var(--sp-3);
}
.service-head .link {
  margin-left: auto;
}
label {
  display: grid;
  grid-template-columns: 72px 1fr;
  align-items: center;
  gap: var(--sp-2);
  margin-bottom: var(--sp-2);
  color: var(--muted);
  font-weight: var(--fw-label);
}
input {
  min-width: 0;
  height: var(--h-md);
  box-sizing: border-box;
  padding: 0 var(--px-md);
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  font: inherit;
  font-weight: normal;
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
  border-color: var(--primary);
  box-shadow: 0 0 0 3px var(--primary-soft);
}
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
  gap: var(--sp-1);
  align-items: center;
  padding: 0 calc(var(--px-sm) / 2) 0 var(--px-sm);
  background: var(--chip-bg);
  border-radius: var(--radius-chip);
  font-size: var(--fs-sm);
}
.domains li input,
.domains li button {
  height: var(--h-xs);
}
.ok {
  color: var(--ok);
}
.field-err {
  margin: 0 0 var(--sp-2) calc(72px + var(--sp-2));
  font-size: var(--fs-xs);
}
.err {
  color: var(--err);
}
.detail pre {
  white-space: pre-wrap;
  font-size: var(--fs-xs);
  color: var(--muted);
}
footer {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: var(--sp-4);
  padding: var(--sp-4) var(--sp-5);
  background: var(--card);
  border-top: 1px solid var(--line);
}
footer .hint {
  margin: 0;
}
footer .primary {
  min-width: 160px;
}
</style>
