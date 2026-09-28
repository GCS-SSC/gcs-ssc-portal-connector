import { z } from 'zod'
import { surveySchema } from '@gcs-ssc/survey'
import { updatesSchema, submissionSchema, type PortalSubmission } from '../shared/portal-contract.ts'

export interface PortalConnection {
  portalUrl: string
  portalAgencyId: string
  key: string
}

export class PortalRequestError extends Error {
  readonly status: number

  constructor(status: number, path: string) {
    super(`Portal request failed (${status}) at ${path}.`)
    this.name = 'PortalRequestError'
    this.status = status
  }
}

/** Server-only transport. Redirects cannot carry the agency bearer credential elsewhere. */
export const createPortalClient = (connection: PortalConnection, transport: typeof fetch = fetch) => {
  const request = async (path: string, method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' = 'GET', body?: object): Promise<unknown> => {
    const url = new URL(`api/government/${path}`, connection.portalUrl)
    const response = await transport(url, {
      method, redirect: 'manual', signal: AbortSignal.timeout(30000),
      headers: {
        Authorization: `Bearer ${connection.key}`,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    })
    if (!response.ok) throw new PortalRequestError(response.status, path)
    const bytes = await response.arrayBuffer()
    if (bytes.byteLength > 4 * 1024 * 1024) throw new Error('Portal response exceeds 4 MiB.')
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown
  }
  return {
    updates: async (after?: string) => updatesSchema.parse(await request(
      `agencies/${encodeURIComponent(connection.portalAgencyId)}/updates${after ? `?after=${encodeURIComponent(after)}` : ''}`
    )),
    submission: async (submissionId: string): Promise<PortalSubmission> => {
      const response = await request(`submissions/${encodeURIComponent(submissionId)}`)
      return submissionSchema.parse(response && typeof response === 'object' && 'submission' in response
        ? response.submission : null)
    },
    response: async (submissionId: string): Promise<unknown> => await request(
      `submissions/${encodeURIComponent(submissionId)}/response`
    ),
    publishItemReference: async (submissionId: string, itemSubmissionId: string, entityId: string) => {
      const view = z.object({ outcomes: z.array(z.object({
        itemSubmissionId: z.string(), remoteReference: z.string().nullable(), revision: z.number().int()
      })) }).parse(await request(`submissions/${encodeURIComponent(submissionId)}/response`))
      const current = view.outcomes.find((outcome) => outcome.itemSubmissionId === itemSubmissionId)
      if (current?.remoteReference === entityId) return
      if (current?.remoteReference) throw new Error('The portal item already points to another GCS record.')
      await request(`submissions/${encodeURIComponent(submissionId)}/items/${encodeURIComponent(itemSubmissionId)}/outcome`,
        'PUT', { expectedRevision: current?.revision ?? 0, remoteReference: entityId, gcsStatus: null })
    },
    publishItemStatus: async (submissionId: string, itemSubmissionId: string, entityId: string,
      status: { en: string; fr: string; colour: string } | null) => {
      const view = z.object({ outcomes: z.array(z.object({
        itemSubmissionId: z.string(), remoteReference: z.string().nullable(), revision: z.number().int(),
        gcsStatus: z.object({ en: z.string(), fr: z.string(), colour: z.string() }).nullable()
      })) }).parse(await request(`submissions/${encodeURIComponent(submissionId)}/response`))
      const current = view.outcomes.find((outcome) => outcome.itemSubmissionId === itemSubmissionId)
      if (current?.remoteReference && current.remoteReference !== entityId)
        throw new Error('The portal item points to another GCS record.')
      if (JSON.stringify(current?.gcsStatus ?? null) === JSON.stringify(status)
        && current?.remoteReference === entityId) return
      await request(`submissions/${encodeURIComponent(submissionId)}/items/${encodeURIComponent(itemSubmissionId)}/outcome`,
        'PUT', { expectedRevision: current?.revision ?? 0, remoteReference: entityId, gcsStatus: status })
    },
    consume: async (eventId: string, remoteReference: string | null) => await request(
      `agencies/${encodeURIComponent(connection.portalAgencyId)}/updates/${encodeURIComponent(eventId)}/consume`,
      'POST', { remoteReference }
    ),
    structure: async () => z.object({
      programs: z.array(z.object({ id: z.string(), foreignSystemId: z.string().nullable(), sourceSystem: z.string() }).passthrough()),
      streams: z.array(z.object({ id: z.string(), nameEn: z.string(), nameFr: z.string(), foreignSystemId: z.string().nullable(), sourceSystem: z.string() }).passthrough()),
      calls: z.array(z.object({ id: z.string(), streamId: z.string(), nameEn: z.string(), nameFr: z.string(),
        published: z.boolean(), surveyId: z.string().nullable(), surveyRevision: z.number().int().nullable(),
        startDate: z.string(), endDate: z.string(), sourceSystem: z.string(), foreignSystemId: z.string().nullable()
      }).passthrough())
    }).parse(await request(`agencies/${encodeURIComponent(connection.portalAgencyId)}`)),
    surveys: async () => z.object({ surveys: z.array(z.object({
      id: z.string(), revision: z.number().int(), title: z.object({ en: z.string(), fr: z.string() }), updatedAt: z.string()
    })) }).parse(await request(`agencies/${encodeURIComponent(connection.portalAgencyId)}/surveys`)),
    survey: async (id: string) => z.object({ survey: z.object({
      id: z.string(), revision: z.number().int(), definition: surveySchema
    }) }).parse(await request(`surveys/${encodeURIComponent(id)}`)).survey,
    createSurvey: async (definition: z.infer<typeof surveySchema>) => z.object({ survey: z.object({
      id: z.string(), revision: z.number().int()
    }) }).parse(await request('surveys', 'POST', { agencyId: connection.portalAgencyId, definition })).survey,
    updateSurvey: async (id: string, expectedRevision: number, definition: z.infer<typeof surveySchema>) =>
      z.object({ survey: z.object({ id: z.string(), revision: z.number().int() }) }).parse(await request(
        `surveys/${encodeURIComponent(id)}`, 'PUT', { expectedRevision, definition })).survey,
    createCall: async (input: object) => z.object({ id: z.string() }).parse(await request('calls', 'POST', input)).id,
    updateCall: async (id: string, input: object) => z.object({ id: z.string() }).parse(await request(
      `calls/${encodeURIComponent(id)}`, 'PUT', input)).id,
    attachCallSurvey: async (id: string, surveyId: string, revision: number) => await request(
      `calls/${encodeURIComponent(id)}/survey`, 'PUT', { surveyId, revision }),
    publishCall: async (id: string) => await request(`calls/${encodeURIComponent(id)}/publication`,
      'PATCH', { published: true }),
    withdrawCall: async (id: string) => await request(`calls/${encodeURIComponent(id)}/publication`,
      'PATCH', { published: false }),
    deleteCall: async (id: string) => await request(`calls/${encodeURIComponent(id)}`, 'DELETE'),
    organizations: async (after?: string) => z.object({
      organizations: z.array(z.object({
        id: z.string(), name: z.string(), description: z.string(), active: z.boolean(), verified: z.boolean(),
        ownerName: z.string(), ownerEmail: z.email(),
        memberCount: z.coerce.number().int().nonnegative(),
        agreementCount: z.coerce.number().int().nonnegative(),
        foreignApplicantRecipientId: z.string().nullable()
      })),
      nextAfter: z.string().nullable()
    }).parse(await request(`agencies/${encodeURIComponent(connection.portalAgencyId)}/organizations${after ? `?after=${encodeURIComponent(after)}` : ''}`)),
    verifyOrganization: async (organizationId: string, proponentId: string) => await request(
      `agencies/${encodeURIComponent(connection.portalAgencyId)}/organizations/${encodeURIComponent(organizationId)}/verify`,
      'POST', { foreignApplicantRecipientId: proponentId }
    ),
    agreements: async () => z.object({ agreements: z.array(z.object({
      id: z.string(), organizationId: z.string(), revision: z.number().int(),
      streamId: z.string(), nameEn: z.string(), nameFr: z.string(),
      agreementNumber: z.string(), active: z.boolean(),
      config: z.object({ foreignSystemId: z.string().nullable(), sourceSystem: z.string(),
        externalStreamId: z.string().nullable(), externalApplicantRecipientId: z.string().nullable(),
        budgetLines: z.array(z.record(z.string(), z.unknown())),
        fiscalYears: z.array(z.record(z.string(), z.unknown()))
      }).passthrough()
    }).passthrough()) }).parse(await request(`agencies/${encodeURIComponent(connection.portalAgencyId)}/agreements`)),
    sets: async () => z.object({ sets: z.array(z.object({
      id: z.string(), organizationId: z.string(), agreementId: z.string().nullable(),
      published: z.boolean(), revision: z.number().int(), sourceSystem: z.string(),
      foreignSystemId: z.string().nullable(),
      snapshot: z.unknown().nullable(),
      items: z.array(z.object({ id: z.string(), kind: z.string(), fiscalYearId: z.string().optional() }).passthrough())
    }).passthrough()) }).parse(await request(`agencies/${encodeURIComponent(connection.portalAgencyId)}/sets`)),
    createProgram: async (input: object) => z.object({ program: z.object({ id: z.string() }) })
      .parse(await request('programs', 'POST', input)).program.id,
    createStream: async (input: object) => z.object({ stream: z.object({ id: z.string() }) })
      .parse(await request('streams', 'POST', input)).stream.id,
    createAgreement: async (input: object) => z.object({ agreement: z.object({ id: z.string() }) })
      .parse(await request('agreements', 'POST', input)).agreement.id,
    updateAgreement: async (id: string, input: object) => await request(`agreements/${encodeURIComponent(id)}`, 'PUT', input),
    linkOrganization: async (agreementId: string, input: object) => await request(
      `agreements/${encodeURIComponent(agreementId)}/organizations`, 'POST', input
    ),
    createSet: async (input: object) => z.object({ set: z.object({ id: z.string(), revision: z.number().int() }) })
      .parse(await request('sets', 'POST', input)).set,
    publishSet: async (id: string, revision: number) => await request(
      `sets/${encodeURIComponent(id)}/publish`, 'POST', { expectedRevision: revision }
    ),
    withdrawSet: async (id: string, revision: number) => await request(
      `sets/${encodeURIComponent(id)}/withdraw`, 'POST', { expectedRevision: revision }
    )
  }
}
