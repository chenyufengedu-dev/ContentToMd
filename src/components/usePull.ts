// 收藏库方块卡片和列表行共用的“抽出”动画（docs/动画经验.md 第七节）：
// 一个“抽出程度”（0 平时，1 抽出，弹簧会略超过 1）由弹簧推动，每帧交给 apply 去改几个元素自己的位移和透明度。
// 快速来回时弹簧带着速度转向，不会顿；只有正在动的那一个加 is-live 交给显卡，收回 2 秒没人碰再还回去
import { onBeforeUnmount, type Ref } from 'vue'
import { animate, motionValue } from 'motion'

// 放上去：冲过终点约 4% 再落回，约 0.35 秒停稳；移开：不回弹，约 0.3 秒平滑收回
const OUT = { type: 'spring', stiffness: 300, damping: 25 } as const
const BACK = { type: 'spring', stiffness: 300, damping: 32 } as const
// 马上去掉 is-live 的话，隔一会儿再放上去又要重建图层，那一帧会顿
const LINGER = 2000

export function usePull(el: Ref<HTMLElement | undefined>, apply: (p: number) => void) {
  const progress = motionValue(0)
  progress.on('change', apply)
  let idle: number | undefined
  // 直接改在元素上，不经过界面框架重新渲染
  const setLive = (on: boolean) => el.value?.classList.toggle('is-live', on)
  function release() {
    window.clearTimeout(idle)
    idle = window.setTimeout(() => progress.get() === 0 && setLive(false), LINGER)
  }
  function pull(out: boolean) {
    window.clearTimeout(idle)
    if (out) setLive(true)
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      progress.jump(out ? 1 : 0)
      if (!out) release()
      return
    }
    const a = animate(progress, out ? 1 : 0, out ? OUT : BACK)
    // 完全收回、停稳后才开始计时（中途又放上去时这次动画会被取代，不会走到这里）
    if (!out) void a.then(() => progress.get() === 0 && release())
  }
  /** 用键盘移上来时也抽出 */
  function onFocus() {
    if (el.value?.matches(':focus-visible')) pull(true)
  }
  onBeforeUnmount(() => {
    window.clearTimeout(idle)
    progress.destroy()
  })
  return { pull, onFocus, now: () => progress.get() }
}

export const clamp01 = (x: number) => Math.min(1, Math.max(0, x))
