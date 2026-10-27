<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import confetti from 'canvas-confetti'
const props = defineProps<{ played: boolean }>()
const emit = defineEmits<{ played: []; finished: [] }>()
const canvas = ref<HTMLCanvasElement>()
const playing = ref(false)
let frame = 0
let celebration: ReturnType<typeof confetti.create> | undefined
function startWhenVisible() {
  if (document.visibilityState !== 'visible' || props.played || celebration) return
  cancelAnimationFrame(frame)
  // 首页可见后先绘制，再发射；后台进入不会消耗首次播放机会。
  frame = requestAnimationFrame(() => {
    frame = requestAnimationFrame(() => {
      if (document.visibilityState !== 'visible' || props.played) return

      if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
        emit('played')
        emit('finished')
        return
      }
      if (!canvas.value) return
      celebration = confetti.create(canvas.value, { resize: true })
      const options = {
        particleCount: 60,
        spread: 65,
        startVelocity: 42,
        gravity: 1,
        ticks: 170,
        scalar: 0.75,
        colors: ['#7772df', '#8bb8df', '#e9bd65', '#dfa4bd', '#a7c8b1'],
        disableForReducedMotion: true,
      }
      playing.value = true
      const finished = Promise.all([
        celebration({ ...options, angle: 60, origin: { x: 0.08, y: 0.95 } }),
        celebration({ ...options, angle: 120, origin: { x: 0.92, y: 0.95 } }),
      ])
      // 等 canvas-confetti 的绘制帧执行后再记录；不可见时留待下一次进入。
      frame = requestAnimationFrame(() => {
        if (document.visibilityState === 'visible') emit('played')
      })
      void finished.then(() => {
        playing.value = false
        emit('finished')
      })
    })
  })
}

onMounted(() => {
  if (props.played) {
    emit('finished')
    return
  }
  document.addEventListener('visibilitychange', startWhenVisible)
  startWhenVisible()
})

onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', startWhenVisible)
  cancelAnimationFrame(frame)
  celebration?.reset()
})
</script>
<template><canvas ref="canvas" class="celebration" :data-playing="playing" aria-hidden="true" /></template>
<style scoped>
.celebration {
  position: fixed;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 50;
}
</style>
