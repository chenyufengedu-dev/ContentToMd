// 内置默认指令；首次运行时写进数据目录，之后以用户可编辑的文件为准（方案第 9.7 节）
import common from '../prompts/_通用.md?raw'
import domainSuggestion from '../prompts/_领域建议.md?raw'
import faithful from '../prompts/原文精修.md?raw'
import points from '../prompts/要点提炼.md?raw'
import visual from '../prompts/视觉收藏.md?raw'
import type { Prompts } from './note'

export const DEFAULT_PROMPTS: Prompts = {
  _通用: common.replace('{{领域建议}}', domainSuggestion.trim()),
  原文精修: faithful,
  要点提炼: points,
  视觉收藏: visual,
}
