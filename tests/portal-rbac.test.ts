import { describe, expect, it } from 'vitest'
import extension from '../extension.config.ts'

describe('Portal workspace authorization contract', () => {
  it('requires Agency Manager for every agency mutation and Agency Viewer for reads', () => {
    for (const handler of extension.serverHandlers ?? []) {
      if (!handler.rbac) throw new Error(`${handler.method} ${handler.route} lacks RBAC`)
      if (handler.rbac.subject !== 'agency') continue
      expect(handler.rbac.action, `${handler.method} ${handler.route}`).toBe(handler.method === 'get' ? 'read' : 'delete')
    }
  })

  it('allows exact Proponent assignees to link only through the scoped verification handler', () => {
    const handler = extension.serverHandlers?.find(item => item.route.endsWith('/proponents/[proponentId]/verification'))
    expect(handler).toMatchObject({ method: 'post',
      rbac: { subject: 'applicant_recipient', action: 'update', entity: { target: 'proponent', param: 'proponentId' } } })
    expect(extension.client?.tabs?.[0]).toMatchObject({
      target: 'proponent', rbac: { subject: 'applicant_recipient', action: 'read' },
      agencyConfigVisibility: { key: 'portalProponentVerificationAccess', values: ['manager', 'contributor'] }
    })
  })
})
