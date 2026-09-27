import type { Generated, Kysely, Transaction } from 'kysely'
import type { ExtensionSecretDatabase } from '@gcs-ssc/extensions/server'

export interface ConnectorDatabase extends ExtensionSecretDatabase {
  'extensions.gcs_portal_connection': {
    agency_id: string
    portal_agency_id: string
    portal_url: string
    scan_cursor: string | null
    portal_status_ids: Generated<string[]>
    entity_status_ids: Generated<{ claim: string[]; forecast: string[]; funding_application: string[]; other_form: string[] }>
    pull_interval_minutes: number | null
    last_pull_at: Date | null
    last_pull_error: string | null
    pull_lease_until: Date | null
    revision: Generated<number>
    updated_at: Date
  }
  'extensions.gcs_portal_receipt': {
    id: Generated<string>
    agency_id: string
    event_id: string
    submission_id: string
    item_submission_id: string
    kind: string
    source_export: unknown
    gcs_entity_type: string | null
    gcs_entity_id: string | null
    state: 'received' | 'imported' | 'unsupported'
    created_at: Generated<Date>
    updated_at: Generated<Date>
  }
  'extensions.gcs_portal_publication': {
    id: Generated<string>
    agency_id: string
    gcs_agreement_id: string
    portal_organization_id: string
    portal_agreement_id: string
    portal_agreement_revision: number
    portal_set_ids: string[]
    source_digest: string
    published_at: Generated<Date>
  }
  'extensions.gcs_portal_identity': {
    agency_id: string
    portal_organization_id: string
    proponent_id: string
    verified_at: Generated<Date>
  }
  'extensions.gcs_portal_organization': {
    agency_id: string
    portal_organization_id: string
    name: string
    description: string
    owner_name: string
    owner_email: string
    member_count: number
    agreement_count: number
    active: boolean
    synced_at: Generated<Date>
  }
  'extensions.gcs_portal_verification': {
    portal_organization_id: string
    proponent_id: string
    origin_agency_id: string
    verification_note: string | null
    verified_by_user_id: string | null
    verified_at: Generated<Date>
    portal_active: Generated<boolean>
  }
  'extensions.gcs_portal_outbox': {
    id: Generated<string>
    agency_id: string
    agreement_id: string
    portal_organization_id: string
    proponent_id: string
    state: Generated<'pending' | 'leased' | 'delivered' | 'cancelled'>
    attempts: Generated<number>
    next_attempt_at: Generated<Date>
    last_error: string | null
    created_at: Generated<Date>
    updated_at: Generated<Date>
    delivered_at: Date | null
  }
  'extensions.gcs_portal_inbox': {
    agency_id: string
    event_id: string
    kind: string
    submission_id: string
    item_submission_id: string | null
    last_error: string | null
    created_at: Date
    first_seen_at: Generated<Date>
  }
  'extensions.gcs_portal_outcome_outbox': {
    id: Generated<string>
    agency_id: string
    receipt_id: string
    status_id: string
    state: Generated<'pending' | 'leased' | 'delivered'>
    attempts: Generated<number>
    next_attempt_at: Generated<Date>
    last_error: string | null
    created_at: Generated<Date>
    updated_at: Generated<Date>
    delivered_at: Date | null
  }
  Funding_Case_Agreement_Applicant_Recipient: {
    id: string
    egcs_fc_fundingagreement: string
    egcs_fc_applicantrecipient: string
    _deleted: boolean
  }
  Funding_Case_Agreement_Profile: {
    id: string
    egcs_fc_transferpaymentstream: string
    _deleted: boolean
  }
  Transfer_Payment_Stream: {
    id: string
    egcs_tp_transferpaymentprofile: string
    _deleted: boolean
  }
  Transfer_Payment_Profile: {
    id: string
    egcs_tp_agency: string
    _deleted: boolean
  }
}

export type ConnectorDb = Kysely<ConnectorDatabase> | Transaction<ConnectorDatabase>
export const asConnectorDb = (value: unknown): Kysely<ConnectorDatabase> => value as Kysely<ConnectorDatabase>
