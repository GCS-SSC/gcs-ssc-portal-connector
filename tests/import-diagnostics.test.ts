import { describe, expect, it } from 'vitest'
import { translateGcsExtensionMessage } from '@gcs-ssc/extensions'
import { PortalImportDiagnostic, readImportDiagnostic, intakeResultDiagnostic, importDiagnosticCodes } from '../shared/import-diagnostics.ts'
import { importDiagnosticsMessages } from '../i18n/import-diagnostics.ts'
describe('owned import diagnostic interchange', () => {
  it('round-trips only registered codes with the declared empty parameter shape', () => {
    for (const code of importDiagnosticCodes) {
      const message=new PortalImportDiagnostic(code).message
      expect(message.length).toBeLessThan(500)
      expect(readImportDiagnostic(message)).toEqual({code,params:{}})
      expect(translateGcsExtensionMessage(importDiagnosticsMessages,'en',code)).not.toBe(code)
      expect(translateGcsExtensionMessage(importDiagnosticsMessages,'fr',code)).not.toBe(code)
    }
    for (const invalid of ['raw existing diagnostic','GCS_PORTAL_IMPORT:broken',
      'GCS_PORTAL_IMPORT:{"code":"host.secret","params":{}}',
      'GCS_PORTAL_IMPORT:{"code":"importMissingGroup","params":{"extra":"unsafe"}}',
      'GCS_PORTAL_IMPORT:{"code":"importMissingGroup","params":{},"extra":true}'])
      expect(readImportDiagnostic(invalid)).toBeNull()
  })
  it('maps every non-creating Intake result into an actionable owning message', () => {
    const statuses=['opportunity_unavailable','recipient_unavailable','group_unavailable','intake_id_conflict',
      'source_conflict','application_id_conflict','draft_status_unavailable'] as const
    for(const status of statuses) expect(importDiagnosticCodes).toContain(intakeResultDiagnostic(status))
    expect(translateGcsExtensionMessage(importDiagnosticsMessages,'fr',intakeResultDiagnostic('group_unavailable')))
      .toContain('groupe admissible')
  })
})
