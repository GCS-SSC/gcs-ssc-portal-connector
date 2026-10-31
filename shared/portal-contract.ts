import { isPersistableMoney, MoneySchema } from '@gcs-ssc/extensions/money'
import { z } from 'zod'

const money = MoneySchema.refine(isPersistableMoney, { message: 'Money exceeds persisted minor-unit precision' })
const externalId = z.string().regex(/^[1-9]\d{0,18}$/).refine((value) => BigInt(value) <= BigInt('9223372036854775807'))

export const updateSchema = z.object({
  eventId: externalId,
  kind: z.enum(['submission_item', 'organization_detail']),
  submissionId: z.string().min(1),
  itemSubmissionId: z.string().nullable(),
  detailId: z.string().nullable(),
  createdAt: z.iso.datetime(),
  consumedAt: z.iso.datetime().nullable(),
  remoteReference: z.string().nullable()
})
export const updatesSchema = z.object({
  updates: z.array(updateSchema),
  nextCursor: externalId.nullable()
})
export type PortalUpdate = z.infer<typeof updateSchema>

const claimLineSchema = z.object({
  budgetLineItemId: externalId,
  submittedCostCategory: z.string().nullable(),
  submittedCostSubsection: z.string().nullable(),
  submittedLineItem: z.string().nullable(),
  description: z.string(),
  amount: money,
  currency: z.string().min(1)
}).refine(line => line.amount.currency === line.currency.toUpperCase(), { path: ['amount'], message: 'Currency mismatch' })
export const claimItemSchema = z.object({
  kind: z.literal('claim'),
  itemSubmissionId: z.string().min(1),
  mappingComplete: z.literal(true),
  claim: z.object({
    agreementId: externalId,
    applicantRecipientId: externalId,
    streamId: externalId,
    fiscalYearId: externalId,
    isFinalForYear: z.boolean(),
    periodStart: z.number().int().min(0).max(11),
    periodEnd: z.number().int().min(0).max(11),
    receivedDate: z.iso.datetime(),
    lineItems: z.array(claimLineSchema).min(1).max(200)
  })
})
export const forecastItemSchema = z.object({
  kind: z.literal('forecast'),
  itemSubmissionId: z.string().min(1),
  mappingComplete: z.literal(true),
  forecast: z.object({
    agreementId: externalId,
    header: z.strictObject({ egcs_fc_fiscalyear: externalId }),
    lineItems: z.array(z.strictObject({
      egcs_fc_fundingagreementbudgetlineitem: externalId,
      egcs_fc_month: z.number().int().min(0).max(11),
      egcs_fc_amount: money,
      egcs_fc_currency: z.string().min(1)
    }).refine(line => line.egcs_fc_amount.currency === line.egcs_fc_currency.toUpperCase(), { path: ['egcs_fc_amount'], message: 'Currency mismatch' })).min(1).max(2400)
  })
})
export const submissionSchema = z.object({
  schemaVersion: z.literal(2),
  submissionId: z.string().min(1),
  organizationId: z.string().min(1),
  agreementReference: z.object({
    externalApplicantRecipientId: externalId.nullable(),
    externalStreamId: externalId.nullable()
  }).passthrough().nullable(),
  items: z.array(z.object({ kind: z.string(), itemSubmissionId: z.string().min(1) }).passthrough()).min(1)
}).passthrough()
export type PortalSubmission = z.infer<typeof submissionSchema>
