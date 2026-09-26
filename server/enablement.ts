import { sql } from 'kysely'
import { EXTENSION_KEY } from './authorization.ts'

/** Keep background work inside the same active Agency-extension boundary as hosted routes. */
export const enabledPortalAgency = (agencyIdColumn: string) => sql<boolean>`EXISTS (
  SELECT 1 FROM extensions.agency_enablement AS enablement
  JOIN "Agency_Profile" AS agency ON agency.id = enablement.agency_id
  WHERE enablement.agency_id = ${sql.ref(agencyIdColumn)}
    AND enablement.extension_key = ${EXTENSION_KEY}
    AND enablement.enabled = true
    AND enablement._deleted = false
    AND agency._deleted = false
)`
