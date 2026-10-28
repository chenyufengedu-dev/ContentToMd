import { buildMarkdown } from './note'
import { OTHER_DOMAIN_ID } from './config'

export const WELCOME_TITLE = '欢迎使用 ContentToMd'

/** 本地说明笔记，不调用模型或产生服务费用。 */
export function buildWelcomeNote(domain: string, created: string): string {
  return buildMarkdown(
    {
      title: WELCOME_TITLE,
      domainId: OTHER_DOMAIN_ID,
      tags: [],
      keywords: [],
      summary: '放入内容，选一种整理方式，检查后保存到自己的收藏库。',
      body: `## 怎么放内容
把文件拖进新增页、直接粘贴文字或截图，也可以点选文件。

## 选哪种整理方式
- 要点提炼：抓住重点，适合长文章、视频和音频。
- 原文精修：尽量保留原意和细节，修顺表达。
- 视觉收藏：描述图片里的主体和视觉特点，适合设计、穿搭等参考。

## 大约花多少钱
短文字通常是几厘到几分钱；长文、多图和音视频可能更多，取决于模型、长度与服务商单价。这篇欢迎笔记在本地生成，不花钱。
保存成功页显示本条估算费用，设置页可查看本月和累计费用。先在设置里填写服务商单价，没填时会显示价格未知；实际扣费以服务商账单为准。

## 遇到问题
使用过程中如遇问题，可通过“设置 → 关于 → 反馈问题”联系作者。反馈时请提供操作步骤、截图、软件版本和 Windows 版本，请勿包含 API 密钥或私人内容。`,
      image_captions: [],
    },
    { domain, type: '文字', mode: '原文精修', source: '', platform: '', author: '', created, cover: '' },
  )
}
