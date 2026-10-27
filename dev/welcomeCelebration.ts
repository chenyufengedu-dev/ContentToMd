const CELEBRATION_KEY = 'contenttomd:preview:welcome-celebration:v1'
let playedInSession = false

export function hasWelcomeCelebrationPlayed(): boolean {
  if (playedInSession) return true
  try {
    return localStorage.getItem(CELEBRATION_KEY) === '1'
  } catch {
    // 浏览器禁止存储时仍允许本次体验，播放后用内存防止同一会话重播。
    return false
  }
}

/** 仅在可见首页开始绘制礼花后记录，不在进入页面时预先消耗机会。 */
export function markWelcomeCelebrationPlayed(): void {
  playedInSession = true
  try {
    localStorage.setItem(CELEBRATION_KEY, '1')
  } catch {
    // 无法跨刷新持久化时，至少在当前会话内保持一次。
  }
}

/** 仅供独立原型的显式体验按钮使用，正式软件不提供重置入口。 */
export function resetWelcomeCelebrationPreview(): void {
  playedInSession = false
  try {
    localStorage.removeItem(CELEBRATION_KEY)
  } catch {
    // 禁止存储时没有可移除的记录，内存状态已重置。
  }
}
