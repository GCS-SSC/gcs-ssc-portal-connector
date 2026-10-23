import { describe, expect, it } from 'vitest'
import extension from '../extension.config.ts'

describe('Portal workspace authorization contract', () => {
  it('declares generic background scheduling and its separate host import capabilities', () => {
    expect(extension.requiredHostCapabilities).toEqual(expect.arrayContaining([
      'background-queue', 'scheduled-agreement-import', 'scheduled-intake-import'
    ]))
    expect(extension.requiredHostCapabilities).not.toContain('l1-queue')
    expect(extension.nitroPlugin).toBe('./server/plugins/outbox.ts')
  })

  it('requires Agency Manager for every agency mutation and Agency Viewer for reads', () => {
    for (const handler of extension.serverHandlers ?? []) {
      if (!handler.rbac) throw new Error(`${handler.method} ${handler.route} lacks RBAC`)
      if (handler.rbac.subject !== 'agency') continue
      expect(handler.rbac.action, `${handler.method} ${handler.route}`).toBe(handler.method === 'get' ? 'read' : 'delete')
    }
  })

  it('allows exact Proponent assignees to link only through the scoped verification handler', () => {
    const path = '/proponents/[proponentId]/verification'
    const read = extension.serverHandlers?.find(item => item.route.endsWith(path) && item.method === 'get')
    expect(read).toMatchObject({ method: 'get',
      rbac: { subject: 'applicant_recipient', action: 'read', entity: { target: 'proponent', param: 'proponentId' } } })
    const write = extension.serverHandlers?.find(item => item.route.endsWith(path) && item.method === 'post')
    expect(write).toMatchObject({ method: 'post',
      rbac: { subject: 'applicant_recipient', action: 'update', entity: { target: 'proponent', param: 'proponentId' } } })
    expect(extension.client?.tabs?.[0]).toMatchObject({
      target: 'proponent', rbac: { subject: 'applicant_recipient', action: 'read' },
      agencyConfigVisibility: { key: 'portalProponentVerificationAccess', values: ['manager', 'contributor'] }
    })
  })
})
