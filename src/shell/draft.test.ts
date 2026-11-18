import { expect, it, vi } from 'vitest'
import { clearDraft, saveDraft } from './tauri'
import { newTextJob } from '../core/pipeline'

const { invoke, readStarted, releaseRead } = vi.hoisted(() => {
  let started!: () => void
  let release!: (value: ArrayBuffer) => void
  const startedPromise = new Promise<void>((resolve) => (started = resolve))
  const read = new Promise<ArrayBuffer>((resolve) => (release = resolve))
  return {
    invoke: vi.fn().mockResolvedValue(undefined),
    readStarted: { started, promise: startedPromise, read },
    releaseRead: release,
  }
})
vi.mock('@tauri-apps/api/core', () => ({ invoke }))

it('清除后不会写入此前正在读取的草稿', async () => {
  const read = vi.spyOn(Blob.prototype, 'arrayBuffer').mockImplementationOnce(() => {
    readStarted.started()
    return readStarted.read
  })
  const job = newTextJob('test.md', 'content', '原文精修')
  const stale = saveDraft(job)
  await readStarted.promise
  const clearing = clearDraft()
  releaseRead(new ArrayBuffer(0))
  await Promise.all([stale, clearing])
  expect(invoke.mock.calls.map(([command]) => command)).toEqual(['draft_clear'])
  read.mockRestore()
  await saveDraft(job)
  expect(invoke.mock.calls.at(-1)?.[0]).toBe('draft_write')
})
