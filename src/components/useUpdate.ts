import { inject, ref, type InjectionKey, type Ref } from 'vue'
import { appVersion, checkAppUpdate, type DownloadEvent } from '../shell/tauri'

interface Update {
  current: string
  version: string
  notes: string
  download?: (onEvent: (event: DownloadEvent) => void) => Promise<void>
  install?: () => Promise<void>
}

export const updateKey: InjectionKey<{ update: Ref<Update | null>; open: () => void }> = Symbol('update')
export const useUpdate = () => inject(updateKey, null)

export function createUpdateCheck() {
  const update = ref<Update | null>(null)
  const visible = ref(false)
  const open = () => {
    if (update.value) visible.value = true
  }

  async function check() {
    if (import.meta.env.MODE === 'test') return
    try {
      const current = await appVersion()
      if (import.meta.env.DEV && import.meta.env.VITE_UPDATE_PREVIEW === '1') {
        update.value = { current, version: '0.2.1', notes: '这是体验用的更新说明。' }
        return
      }
      const release = await checkAppUpdate({ timeout: 8000 })
      if (!release) return
      update.value = {
        current,
        version: release.version,
        notes: release.body ?? '',
        download: (onEvent) => release.download(onEvent, { timeout: 60000 }),
        install: () => release.install(),
      }
    } catch {
      // 更新检查失败不影响启动。
    }
  }
  return { update, visible, open, check }
}
