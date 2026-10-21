// F02：从抖音、小红书的分享文字里取出链接、平台、作者（方案第 5 节 F02、US1）。
// 分享文字的样子参考 douyin-to-obsidian；认不出平台时只取链接

export interface ShareInfo {
  url: string
  /** 抖音 / 小红书；其他网址为空 */
  platform: string
  author: string
}

const PLATFORMS: { name: string; host: RegExp; author: RegExp }[] = [
  // 7.53 复制打开抖音，看看【作者的作品】标题 … https://v.douyin.com/xxx/
  { name: '抖音', host: /(^|\.)(douyin|iesdouyin)\.com$/, author: /【(.+?)的作品】/ },
  // 【标题 - 作者 | 小红书 - 你的生活指南】 … https://www.xiaohongshu.com/… 或 http://xhslink.com/…
  { name: '小红书', host: /(^|\.)(xiaohongshu|xhslink)\.com$/, author: /【.+? - (.+?) \| 小红书/ },
]

/** 没有链接时返回 null */
export function parseShareText(text: string): ShareInfo | null {
  const m = text.match(/https?:\/\/[^\s，。！、“”【】<>]+/)
  if (!m) return null
  const url = m[0]
  let host = ''
  try {
    host = new URL(url).hostname
  } catch {
    return { url, platform: '', author: '' }
  }
  const p = PLATFORMS.find((x) => x.host.test(host))
  if (!p) return { url, platform: '', author: '' }
  return { url, platform: p.name, author: text.match(p.author)?.[1].trim() ?? '' }
}
