import { describe, expect, it } from 'vitest'
import { fromDraft, toDraft } from './draft'
import { newImageJob, newJob, newTextJob } from './pipeline'

const note = {
  title: '标题',
  domainId: 1,
  tags: ['a'],
  keywords: ['k'],
  summary: '摘要',
  body: '正文',
  image_captions: [],
}

describe('草稿（F10）', () => {
  it('文字文件整理完：存下结果和确认页的修改，恢复后一模一样', () => {
    const job = newTextJob('会议记录.txt', '原文', '原文精修')
    Object.assign(job, { request: '只要决定', source: 'https://a.com', platform: '抖音', author: '小王' })
    job.steps[0].status = 'done'
    job.draft = note
    job.edits = { ...note, title: '改过的标题' }
    const { data, files } = toDraft(job)
    expect(files).toEqual([])
    const back = fromDraft(JSON.parse(JSON.stringify(data)), {})
    expect(back.job).toMatchObject({
      fileName: '会议记录.txt',
      type: '文字',
      transcript: '原文',
      request: '只要决定',
      platform: '抖音',
      edits: { title: '改过的标题' },
    })
    expect(back.atConfirm).toBe(true)
    expect(back.job.steps[0].status).toBe('done')
  })

  it('进行中、失败的步骤恢复成没开始，下次从这一步继续；时间和进度说明不存', () => {
    const job = newJob('a.mp4', '视频', '要点提炼')
    job.steps[0] = { id: 'extract', status: 'done', startedAt: 1, endedAt: 2 }
    job.steps[1] = { id: 'transcribe', status: 'failed', note: '第 2/3 段' }
    job.transcript = undefined
    const back = fromDraft(JSON.parse(JSON.stringify(toDraft(job).data)), {})
    expect(back.job.steps.map((s) => s.status)).toEqual(['pending', 'pending', 'pending'])
    expect(back.atConfirm).toBe(false)
  })

  it('音视频转写完了就不再需要原文件：前两步算完成', () => {
    const job = newJob('a.mp4', '视频', '要点提炼')
    job.steps[0].status = 'done'
    job.steps[1].status = 'done'
    job.transcript = '转写'
    job.duration = 181
    const back = fromDraft(JSON.parse(JSON.stringify(toDraft(job).data)), {})
    expect(back.job.steps.map((s) => s.status)).toEqual(['done', 'done', 'pending'])
    expect(back.needsFile).toBe(false)
  })

  it('音视频还没转写完：要重新放入原文件', () => {
    const job = newJob('a.mp4', '视频', '要点提炼')
    expect(fromDraft(JSON.parse(JSON.stringify(toDraft(job).data)), {}).needsFile).toBe(true)
  })

  it('图片：每张存成单独的文件，裁剪框跟着存', () => {
    const job = newImageJob([new File(['x'], '1.png', { type: 'image/png' })], '视觉收藏')
    job.images![0].crop = { x: 1, y: 2, w: 3, h: 4 }
    job.images![0].autoCrop = null
    job.images![0].width = 330
    job.images![0].aiUrl = 'data:很长'
    const { data, files } = toDraft(job)
    expect(files.map((f) => f.name)).toEqual(['image-0'])
    const back = fromDraft(JSON.parse(JSON.stringify(data)), { 'image-0': new Blob(['x'], { type: 'image/png' }) })
    const img = back.job.images![0]
    expect(img.file.name).toBe('1.png')
    expect(img.width).toBe(330)
    expect(img.crop).toEqual({ x: 1, y: 2, w: 3, h: 4 })
    expect(img.autoCrop).toBeNull()
    expect(img.aiUrl).toBeUndefined() // 压缩版很大，不存，需要时重新生成
  })
})
