import { z } from 'zod'

export const intakeDraftSchema = z.object({
  streamId: z.string().regex(/^[A-Z]-[A-HJKMNP-Z2-9]{5,}$/),
  nameEn: z.string().trim().min(1).max(200),
  nameFr: z.string().trim().min(1).max(200),
  startDate: z.iso.date(),
  endDate: z.iso.date()
}).refine((value) => value.endDate >= value.startDate, { path: ['endDate'] })

export type IntakeDraft = z.infer<typeof intakeDraftSchema>
