// 草稿（F10，方案第 6.2、10.1 节）：每一步的结果和确认页的修改存进 %APPDATA%\ContentToMd\drafts\，
// 软件关掉再打开时可以恢复。一次只处理一条，所以只有一份草稿。
// 这里只管“任务 ↔ 可以存盘的数据”的转换；读写文件在外壳（shell/tauri.ts）

import type { Job, JobImage, StepState } from './pipeline'

export const DRAFT_JSON = 'draft.json'

export interface DraftData {
  version: 1
  savedAt: number
  job: Omit<Job, 'steps' | 'wavChunks' | 'images' | 'preview'> & {
    steps: Pick<StepState, 'id' | 'status'>[]
    images?: ({ name: string; type: string } & Pick<JobImage, 'autoCrop' | 'crop' | 'width'>)[]
  }
}

/** 图片原文件另存，草稿里只记文件名 */
export function toDraft(job: Job): { data: DraftData; files: { name: string; blob: Blob }[] } {
  // 音频片段、预览文字只在处理中有用；压缩给看图服务的图很大，恢复后重新生成
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { wavChunks, images, preview, steps, ...rest } = job
  return {
    data: {
      version: 1,
      savedAt: Date.now(),
      job: {
        ...rest,
        steps: steps.map((s) => ({ id: s.id, status: s.status })),
        images: images?.map((i) => ({
          name: i.file.name,
          type: i.file.type,
          autoCrop: i.autoCrop,
          crop: i.crop,
          width: i.width,
        })),
      },
    },
    files: (images ?? []).map((i, n) => ({ name: `image-${n}`, blob: i.file })),
  }
}

/**
 * 恢复：没做完的步骤从头做（进行中、失败的都算没开始）。
 * needsFile：音视频还没转写完，原文件没存，要用户重新放入；atConfirm：已经整理完，直接回确认页
 */
export function fromDraft(
  data: DraftData,
  files: Record<string, Blob>,
): { job: Job; needsFile: boolean; atConfirm: boolean } {
  const { images, steps, ...rest } = data.job
  const job: Job = {
    ...rest,
    steps: steps.map((s) => ({ id: s.id, status: s.status === 'done' ? 'done' : 'pending' })),
    images: images?.map((i, n) => ({
      file: new File([files[`image-${n}`] ?? new Blob()], i.name, { type: i.type }),
      autoCrop: i.autoCrop,
      crop: i.crop,
      width: i.width,
    })),
  }
  const organized = !!job.draft && job.steps.every((s) => s.status === 'done')
  // 图片：压缩版没存，没整理完时“读取图片”要重做
  if (job.images && !organized) job.steps.forEach((s) => (s.status = 'pending'))
  // 音视频：转写完了原文件就用不上了；没转写完时提取声音的结果也没存，要从头来
  const media = job.type === '音频' || job.type === '视频'
  const transcribed = job.steps.find((s) => s.id === 'transcribe')?.status === 'done'
  if (media && !transcribed) job.steps.forEach((s) => (s.status = 'pending'))
  const needsFile = media && !transcribed
  return { job, needsFile, atConfirm: organized }
}
