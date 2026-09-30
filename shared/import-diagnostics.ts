import { z } from 'zod'

export const importDiagnosticCodes = [
  'importMalformedSubmission', 'importInvalidAnswers', 'importUnsupportedSource', 'importUnverifiedOrganization',
  'importEvidenceConflict', 'importOpportunityMapping', 'importHostUnavailable', 'importMissingGroup',
  'importOpportunityUnavailable', 'importRecipientUnavailable', 'importGroupUnavailable',
  'importIntakeConflict', 'importSourceConflict', 'importApplicationIdConflict', 'importDraftUnavailable'
] as const
export type ImportDiagnosticCode = typeof importDiagnosticCodes[number]
const prefix = 'GCS_PORTAL_IMPORT:'
const diagnosticSchema = z.object({ code: z.enum(importDiagnosticCodes), params: z.object({}).strict() }).strict()

/** Persist only a bounded, validated owning-code envelope; never interpret arbitrary diagnostic text as a key. */
export const readImportDiagnostic = (value: string): z.infer<typeof diagnosticSchema> | null => {
  if (!value.startsWith(prefix) || value.length > 500) return null
  try {
    const parsed = diagnosticSchema.safeParse(JSON.parse(value.slice(prefix.length)))
    return parsed.success ? parsed.data : null
  } catch { return null }
}

export class PortalImportDiagnostic extends Error {
  readonly code: ImportDiagnosticCode
  constructor(code: ImportDiagnosticCode) {
    super(`${prefix}${JSON.stringify({ code, params: {} })}`)
    this.name = 'PortalImportDiagnostic'
    this.code = code
  }
}

export const intakeResultDiagnostic = (status: 'opportunity_unavailable' | 'recipient_unavailable' | 'group_unavailable'
  | 'intake_id_conflict' | 'source_conflict' | 'application_id_conflict' | 'draft_status_unavailable'): ImportDiagnosticCode => ({
  opportunity_unavailable: 'importOpportunityUnavailable', recipient_unavailable: 'importRecipientUnavailable',
  group_unavailable: 'importGroupUnavailable', intake_id_conflict: 'importIntakeConflict',
  source_conflict: 'importSourceConflict', application_id_conflict: 'importApplicationIdConflict',
  draft_status_unavailable: 'importDraftUnavailable'
} as const)[status]
