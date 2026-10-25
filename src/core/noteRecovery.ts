import { z } from 'zod'
import { NoteDraftSchema } from './note'

const rect = z.object({
  x: z.number().nonnegative(),
  y: z.number().nonnegative(),
  w: z.number().positive(),
  h: z.number().positive(),
})
export const NoteRecoverySchema = z.object({
  version: z.literal(1),
  root: z.string(),
  path: z.string(),
  savedAt: z.number(),
  originalText: z.string(),
  draft: NoteDraftSchema,
  images: z.array(
    z.object({
      index: z.number().int().nonnegative(),
      source: z.string().optional(),
      savedCrop: rect.nullable(),
      crop: rect.nullable(),
      width: z.number().positive().optional(),
    }),
  ),
})
export type NoteRecovery = z.infer<typeof NoteRecoverySchema>

export const RECOVERY_CLEAR_ERROR = '无法清除恢复副本，请检查磁盘权限后重试。'
