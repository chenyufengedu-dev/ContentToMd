<script setup lang="ts">
// 设计调节面板：点选项立刻换掉对应的一组设计令牌，在真实页面上比较效果。
// 选择存在浏览器里，刷新后还在；“复制选择”把当前组合复制成一段文字，发给 Claude 即可
import { computed, reactive, ref, watch } from 'vue'
import { SlidersHorizontal, ChevronDown, Copy, RotateCcw } from 'lucide-vue-next'
import { GROUPS, DEFAULT_CHOICE, type Tokens } from './tunerPresets'

const STORE_KEY = 'contenttomd-tuner'
function loadSaved(): Record<string, string> {
  try {
    return { ...DEFAULT_CHOICE, ...JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}') }
  } catch {
    return { ...DEFAULT_CHOICE } // 浏览器不允许读本地存储时就用默认
  }
}

const choice = reactive<Record<string, string>>(loadSaved())
const customColor = ref('')
const open = ref(true)
const copied = ref(false)

/** 每次都按固定顺序把所有组重新套一遍：后面的组（比如“纯白平铺”）可以覆盖前面组的同名令牌 */
function apply() {
  const tokens: Tokens = {}
  for (const g of GROUPS) Object.assign(tokens, g.options.find((o) => o.id === choice[g.id])?.tokens)
  if (choice.accent === 'custom' && /^#[0-9a-f]{6}$/i.test(customColor.value)) {
    const hex = customColor.value
    Object.assign(tokens, {
      '--primary': hex,
      '--primary-hover': `color-mix(in srgb, ${hex} 86%, black)`,
      '--primary-soft': `color-mix(in srgb, ${hex} 9%, white)`,
    })
  }
  const root = document.documentElement.style
  for (const [k, v] of Object.entries(tokens)) root.setProperty(k, v)
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(choice))
  } catch {
    // 存不了也不影响调节，只是刷新后会回到默认
  }
}
watch([choice, customColor], apply, { immediate: true, deep: true })

const summary = computed(() =>
  GROUPS.map((g) => {
    const label =
      choice[g.id] === 'custom' ? `自定义 ${customColor.value}` : g.options.find((o) => o.id === choice[g.id])?.label
    return `${g.label}：${label}`
  }).join('；'),
)

async function copy() {
  try {
    await navigator.clipboard.writeText(`设计调节页选择 —— ${summary.value}`)
    copied.value = true
    setTimeout(() => (copied.value = false), 1500)
  } catch {
    window.prompt('复制下面这段文字：', summary.value)
  }
}

function reset() {
  Object.assign(choice, DEFAULT_CHOICE)
  customColor.value = ''
}
</script>

<template>
  <section class="tuner" :class="{ collapsed: !open }">
    <header class="tuner-head" @click="open = !open">
      <SlidersHorizontal :size="16" />
      <span>设计调节</span>
      <ChevronDown class="caret" :size="16" />
    </header>
    <div v-if="open" class="tuner-body">
      <div v-for="g in GROUPS" :key="g.id" class="group">
        <span class="group-label">{{ g.label }}</span>
        <div class="opts">
          <button
            v-for="o in g.options"
            :key="o.id"
            class="opt"
            :class="{ on: choice[g.id] === o.id }"
            @click="choice[g.id] = o.id"
          >
            <span v-if="g.id === 'accent'" class="swatch" :style="{ background: o.tokens['--primary'] }" />
            {{ o.label }}
          </button>
          <label v-if="g.id === 'accent'" class="opt custom" :class="{ on: choice.accent === 'custom' }">
            <input v-model="customColor" type="color" @input="choice.accent = 'custom'" />
            自定义
          </label>
        </div>
      </div>
      <p class="summary">{{ summary }}</p>
      <div class="tuner-actions">
        <button class="act" @click="reset"><RotateCcw :size="14" />恢复默认</button>
        <button class="act primary-act" @click="copy"><Copy :size="14" />{{ copied ? '已复制' : '复制选择' }}</button>
      </div>
      <p class="hint">试试：点“查看原文对比”、点进标题和正文、展开领域下拉框、把鼠标放在 ⓘ 上</p>
    </div>
  </section>
</template>

<style scoped>
/* 调节面板本身不跟着令牌变，免得调的时候面板也跟着乱 */
.tuner {
  position: fixed;
  right: 20px;
  bottom: 20px;
  z-index: 100;
  width: 340px;
  background: #ffffff;
  border: 1px solid #e3e6eb;
  border-radius: 14px;
  box-shadow: 0 12px 40px rgb(16 24 40 / 18%);
  font-family: 'Microsoft YaHei UI', 'Microsoft YaHei', sans-serif;
  font-size: 13px;
  color: #1f2430;
  overflow: hidden;
}
.tuner-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  font-weight: 600;
  cursor: pointer;
  user-select: none;
  border-bottom: 1px solid #eef0f3;
}
.caret {
  margin-left: auto;
  transition: transform 0.18s;
}
.collapsed .caret {
  transform: rotate(180deg);
}
.collapsed .tuner-head {
  border-bottom: 0;
}
.tuner-body {
  padding: 8px 16px 14px;
  max-height: 70vh;
  overflow-y: auto;
}
.group {
  display: grid;
  grid-template-columns: 40px 1fr;
  gap: 8px;
  padding: 8px 0;
  border-bottom: 1px dashed #eef0f3;
}
.group-label {
  padding-top: 5px;
  color: #6b7280;
}
.opts {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.opt {
  height: 28px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0 10px;
  border: 1px solid #e3e6eb;
  border-radius: 7px;
  background: #ffffff;
  color: #374151;
  font-size: 12px;
  cursor: pointer;
}
.opt:hover {
  background: #f5f6f8;
}
.opt.on {
  border-color: #1f2430;
  background: #1f2430;
  color: #ffffff;
}
.swatch {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  box-shadow: 0 0 0 1px rgb(255 255 255 / 70%);
}
.custom input {
  width: 16px;
  height: 16px;
  padding: 0;
  border: 0;
  background: none;
  cursor: pointer;
}
.summary {
  margin: 10px 0 8px;
  padding: 8px 10px;
  border-radius: 8px;
  background: #f5f6f8;
  font-size: 12px;
  line-height: 1.6;
  color: #4b5563;
}
.tuner-actions {
  display: flex;
  gap: 8px;
}
.act {
  flex: 1;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 1px solid #e3e6eb;
  border-radius: 8px;
  background: #ffffff;
  color: #374151;
  font-size: 12px;
  cursor: pointer;
}
.primary-act {
  border-color: #1f2430;
  background: #1f2430;
  color: #ffffff;
}
.hint {
  margin: 10px 0 0;
  font-size: 12px;
  line-height: 1.6;
  color: #9ca3af;
}
</style>
