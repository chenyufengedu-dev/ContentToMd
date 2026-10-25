// 截图和照片：检查张数大小、自动裁剪（F29）、压缩后发给看图服务（方案第 9.4、11、12 节）
// 纯计算的部分（裁剪框）不依赖浏览器，可以单独测试；读图、压缩要用 WebView 的画布

export const MAX_IMAGES = 9
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024
/** 发给看图服务前压缩到长边不超过这个值（方案第 13 节隐私说明） */
export const AI_LONG_EDGE = 1568

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}
export interface Pixels {
  data: Uint8ClampedArray // RGBA
  width: number
  height: number
}

/** 和参考颜色相差不超过这个值（各通道之和）算同一种颜色，容忍压缩噪点 */
const TOLERANCE = 30

/**
 * 在 rect 里从四边往里收，去掉纯色（或接近纯色）的边。
 * 边的颜色取 rect 的角：上边和左边看左上角，下边和右边看右下角
 */
export function trimUniformEdges(im: Pixels, rect: Rect): Rect {
  const at = (x: number, y: number) => (y * im.width + x) * 4
  const near = (p: number, ref: number) =>
    Math.abs(im.data[p] - im.data[ref]) +
      Math.abs(im.data[p + 1] - im.data[ref + 1]) +
      Math.abs(im.data[p + 2] - im.data[ref + 2]) <=
    TOLERANCE
  const rowIs = (y: number, x0: number, x1: number, ref: number) => {
    for (let x = x0; x < x1; x++) if (!near(at(x, y), ref)) return false
    return true
  }
  const colIs = (x: number, y0: number, y1: number, ref: number) => {
    for (let y = y0; y < y1; y++) if (!near(at(x, y), ref)) return false
    return true
  }
  const tl = at(rect.x, rect.y)
  const br = at(rect.x + rect.w - 1, rect.y + rect.h - 1)
  let top = rect.y
  let bottom = rect.y + rect.h // 不含
  let left = rect.x
  let right = rect.x + rect.w // 不含
  while (top < bottom && rowIs(top, left, right, tl)) top++
  if (top === bottom) return rect // 整块都是纯色，不裁
  while (bottom > top && rowIs(bottom - 1, left, right, br)) bottom--
  while (left < right && colIs(left, top, bottom, tl)) left++
  while (right > left && colIs(right - 1, top, bottom, br)) right--
  return { x: left, y: top, w: right - left, h: bottom - top }
}

/** AI 给的主体区域 [x, y, 宽, 高]（占整张图的比例）换成像素；格式不对或小于整张 5% 时返回 null */
export function regionToRect(region: unknown, width: number, height: number): Rect | null {
  if (!Array.isArray(region) || region.length !== 4 || !region.every((n) => typeof n === 'number' && isFinite(n)))
    return null
  const clamp = (n: number) => Math.min(1, Math.max(0, n))
  const [x0, y0] = [clamp(region[0]), clamp(region[1])]
  const x1 = clamp(region[0] + region[2])
  const y1 = clamp(region[1] + region[3])
  if ((x1 - x0) * (y1 - y0) < 0.05) return null
  const x = Math.round(x0 * width)
  const y = Math.round(y0 * height)
  return { x, y, w: Math.round(x1 * width) - x, h: Math.round(y1 * height) - y }
}

/**
 * 自动裁剪：先用 AI 给出的主体区域（去掉状态栏、App 界面），再去掉区域里的纯色边。
 * 裁掉的不到 2% 时返回 null，表示不用裁
 */
export function autoCrop(im: Pixels, aiRegion: unknown): Rect | null {
  const full = { x: 0, y: 0, w: im.width, h: im.height }
  const r = trimUniformEdges(im, regionToRect(aiRegion, im.width, im.height) ?? full)
  return r.w * r.h >= full.w * full.h * 0.98 ? null : r
}

/** 放入图片时的检查：不是图片、超过 20MB、超过 9 张的不加入，并说明原因（方案第 7 节 US2） */
export function checkImages<T extends { name: string; size: number; type: string }>(
  existing: number,
  files: T[],
): { accepted: T[]; rejected: { name: string; reason: string }[] } {
  const accepted: T[] = []
  const rejected: { name: string; reason: string }[] = []
  for (const f of files) {
    if (!f.type.startsWith('image/')) rejected.push({ name: f.name, reason: '无法识别为图片，请选择其他文件。' })
    else if (f.size > MAX_IMAGE_BYTES) rejected.push({ name: f.name, reason: '图片超过 20MB，请压缩后重试。' })
    else if (existing + accepted.length >= MAX_IMAGES)
      rejected.push({ name: f.name, reason: `最多可添加 ${MAX_IMAGES} 张图片。` })
    else accepted.push(f)
  }
  return { accepted, rejected }
}

// ---------------- 以下要用 WebView 的画布，不做单元测试 ----------------

/** 读出图片的像素 */
export async function readPixels(blob: Blob): Promise<Pixels> {
  const bmp = await createImageBitmap(blob)
  const canvas = new OffscreenCanvas(bmp.width, bmp.height)
  const g = canvas.getContext('2d')!
  g.drawImage(bmp, 0, 0)
  bmp.close()
  const { data } = g.getImageData(0, 0, canvas.width, canvas.height)
  return { data, width: canvas.width, height: canvas.height }
}

/** 发给看图服务的版本：长边不超过 1568，JPEG，返回 data URL */
export async function toAiDataUrl(blob: Blob): Promise<string> {
  const bmp = await createImageBitmap(blob)
  const scale = Math.min(1, AI_LONG_EDGE / Math.max(bmp.width, bmp.height))
  const canvas = new OffscreenCanvas(Math.round(bmp.width * scale), Math.round(bmp.height * scale))
  const g = canvas.getContext('2d')!
  g.fillStyle = '#fff' // 透明的地方填白，JPEG 没有透明
  g.fillRect(0, 0, canvas.width, canvas.height)
  g.drawImage(bmp, 0, 0, canvas.width, canvas.height)
  bmp.close()
  const out = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 })
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(r.error)
    r.readAsDataURL(out)
  })
}

/** 按裁剪框导出要保存的图片；没有裁剪时原样返回，不重新编码（方案第 10.4 节：不压缩） */
export async function cropForSave(blob: Blob, crop: Rect | null): Promise<Blob> {
  if (!crop) return blob
  const bmp = await createImageBitmap(blob, crop.x, crop.y, crop.w, crop.h)
  const canvas = new OffscreenCanvas(crop.w, crop.h)
  canvas.getContext('2d')!.drawImage(bmp, 0, 0)
  bmp.close()
  // 照片保持 JPEG（高质量），其他一律 PNG，不丢细节
  return blob.type === 'image/jpeg'
    ? canvas.convertToBlob({ type: 'image/jpeg', quality: 0.95 })
    : canvas.convertToBlob({ type: 'image/png' })
}

/** 按宽度等比缩小到 maxW 以内；原图本来就小时不放大 */
export function scaledSize(width: number, height: number, maxW: number): { w: number; h: number } {
  const w = Math.min(width, maxW)
  return { w, h: Math.max(1, Math.round((height * w) / width)) }
}

/** 收藏库卡片用的缩略图宽度：卡片约 190 宽，400 够高清屏用 */
export const THUMB_W = 400
/** 模糊图：200 宽、模糊半径 4（和卡片差不多大，显示时基本不拉伸，不会出马赛克） */
export const BLUR_W = 200
const BLUR_RADIUS = 4

/**
 * 收藏库卡片的封面（F21）：一张缩略图、一张已经模糊好的图。只在内存里用，不写进收藏库。
 * 列表里不放原图（原图长边上千像素，每次显示都要缩小重画）；模糊在这里画一次，显示时不再用模糊滤镜
 */
export async function coverThumbs(blob: Blob): Promise<{ thumb: Blob; blurred: Blob }> {
  const bmp = await createImageBitmap(blob)
  const make = (maxW: number, blur = 0) => {
    const { w, h } = scaledSize(bmp.width, bmp.height, maxW)
    const canvas = new OffscreenCanvas(w, h)
    const g = canvas.getContext('2d')!
    g.imageSmoothingQuality = 'high'
    if (blur) g.filter = `blur(${blur}px)`
    // 模糊会让四边变透明：画得比画布大一圈盖住
    const m = blur * 2
    g.drawImage(bmp, -m, -m, w + 2 * m, h + 2 * m)
    return canvas.convertToBlob({ type: 'image/webp', quality: 0.85 })
  }
  try {
    return { thumb: await make(THUMB_W), blurred: await make(BLUR_W, BLUR_RADIUS) }
  } finally {
    bmp.close()
  }
}
