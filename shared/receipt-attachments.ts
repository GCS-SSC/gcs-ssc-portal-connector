import { z } from 'zod'

export const receiptAttachmentSchema = z.object({ id: z.string().regex(/^X-[A-Z0-9]+$/), filename: z.string().min(1).max(255),
  size: z.number().int().min(0).max(25 * 1024 * 1024), sha256: z.string().regex(/^[a-f0-9]{64}$/), status: z.literal('ready') })
