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
.settings {
  max-width: 720px;
  margin: 0 auto;
  padding: 24px 24px 96px;
}
h1 {
  font-size: 22px;
  margin: 0 0 16px;
}
h2 {
  font-size: 16px;
  margin: 0 0 8px;
}
h3 {
  font-size: 14px;
  margin: 0;
}
section {
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 16px;
}
.banner {
  background: var(--warn-bg);
  border: 1px solid var(--warn);
  padding: 10px 12px;
  border-radius: 6px;
}
.hint {
  color: var(--muted);
  font-size: 13px;
  margin: 0 0 8px;
}
.row {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}
.path {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
  font-family: Consolas, monospace;
  font-size: 13px;
}
.missing .tag-missing,
.path.missing {
  color: var(--warn);
  font-weight: 600;
}
.service {
  border-top: 1px solid var(--line);
  padding: 12px 0;
}
.service:first-of-type {
  border-top: 0;
  padding-top: 0;
}
.service.missing {
  border-left: 3px solid var(--warn);
  padding-left: 10px;
}
.service-head {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 8px;
}
.service-head .link {
  margin-left: auto;
}
label {
  display: grid;
  grid-template-columns: 72px 1fr;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
  font-size: 13px;
}
input {
  padding: 6px 8px;
  border: 1px solid var(--line);
  border-radius: 4px;
  font: inherit;
  background: var(--bg);
  color: var(--fg);
  min-width: 0;
}
.domains {
  list-style: none;
  padding: 0;
  margin: 0 0 8px;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.domains li {
  display: flex;
  gap: 4px;
  align-items: center;
  border: 1px solid var(--line);
  border-radius: 16px;
  padding: 2px 10px;
}
.ok {
  color: var(--ok);
}
.field-err {
  margin: -2px 0 6px 80px;
  font-size: 12px;
}
.err {
  color: var(--err);
}
.detail pre {
  white-space: pre-wrap;
  font-size: 12px;
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
  gap: 12px;
  padding: 12px 24px;
  background: var(--card);
  border-top: 1px solid var(--line);
}
</style>
