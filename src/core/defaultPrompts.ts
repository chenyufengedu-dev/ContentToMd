// 内置默认指令；首次运行时写进数据目录，之后以用户可编辑的文件为准（方案第 9.7 节）
import common from '../prompts/_通用.md?raw'
import domainSuggestion from '../prompts/_领域建议.md?raw'
import faithful from '../prompts/原文精修.md?raw'
import points from '../prompts/要点提炼.md?raw'
import visual from '../prompts/视觉收藏.md?raw'
import extract from '../prompts/提取内容.md?raw'
import type { Mode, Prompts } from './note'
import type { Config } from './config'

export const DEFAULT_PROMPTS: Prompts = {
  _通用: common.replace('{{领域建议}}', domainSuggestion.trim()),
  原文精修: faithful,
  要点提炼: points,
  视觉收藏: visual,
  提取内容: extract,
}

const commonSections = DEFAULT_PROMPTS._通用.replace(/\r\n/g, '\n').trim().split('\n\n')
const commonFormat = [commonSections[1], ...commonSections.slice(-2)].join('\n\n')
const extractFormat = extract
  .replace(/\r\n/g, '\n')
  .split('\n')
  .filter((line) => line.startsWith('- 图片：') || line.startsWith('- summary'))

export function requiredPromptText(key: keyof Prompts): string {
  if (key === '_通用') return commonFormat
  return key === '提取内容' ? extractFormat.join('\n') : ''
}

export function editablePromptText(key: keyof Prompts, text: string): string {
  text = text.replace(/\r\n/g, '\n')
  const required = requiredPromptText(key)
  if (!required) return text.trim()
  if (key === '_通用')
    return [commonSections[1], ...commonSections.slice(-2)]
      .reduce((value, part) => value.replace(part, ''), text)
      .replace(/^只返回[^\n]*JSON[^\n]*\n(?:(?:[ \t]*[-*][ \t]+[^\n]*|[ \t]*\{\{领域建议\}\})\n?)+/m, '')
      .trim()
  return text
    .split('\n')
    .filter((line) => !extractFormat.includes(line))
    .join('\n')
    .trim()
}

export function promptOverride(base: Prompts, config: Config, mode: Mode): string | undefined {
  const text = config.promptOverrides?.[mode]
  if (text === undefined) return
  if (config.promptFiles?.some((file) => file.mode === mode && file.text === text)) return text
  // 旧版本切回默认时曾把默认正文写成覆盖项。
  if (text === editablePromptText(mode, base[mode]) || text === editablePromptText(mode, DEFAULT_PROMPTS[mode])) return
  return text
}

export function resolvePrompts(base: Prompts, config: Config): Prompts {
  const result = { ...base }
  for (const key of Object.keys(base) as (keyof Prompts)[]) {
    if (key === '_通用') continue
    const text = promptOverride(base, config, key)
    if (text === undefined) continue
    result[key] = [text, requiredPromptText(key)].filter(Boolean).join('\n\n')
  }
  return result
}
