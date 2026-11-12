// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { translateGcsExtensionMessage, type GcsExtensionMessages } from '@gcs-ssc/extensions'

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), hostGet: vi.fn(), patch: vi.fn(), toast: vi.fn() }))
vi.mock('@gcs-ssc/extensions/ui', () => {
  const content = defineComponent({ setup: (_, { slots }) => () => h('div', slots.default?.()) })
  const input = defineComponent({ props: ['modelValue', 'name', 'disabled'], emits: ['update:modelValue'],
    setup: (props, { emit }) => () => h('input', { name: props.name, value: props.modelValue, disabled: props.disabled,
      onInput: (event: Event) => { if (event.target instanceof HTMLInputElement) emit('update:modelValue', event.target.value) } }) })
  const button = defineComponent({ props: ['label', 'disabled'], emits: ['click'],
    setup: (props, { emit, slots, attrs }) => () => h('button', { ...attrs, disabled: props.disabled, onClick: () => emit('click') }, props.label ?? slots.default?.()) })
  const modal = defineComponent({ props: ['open', 'title'], emits: ['update:open'],
    setup: (props, { slots, emit }) => () => props.open ? h('div', { role: 'dialog' }, [h('h2', props.title),
      h('button', { 'aria-label': 'Close dialog', onClick: () => emit('update:open', false) }, 'Close'), slots.body?.()]) : null })
  const table = defineComponent({ props: ['data', 'columns'], setup: (props, { slots }) => () => h('div', [
    ...((props.data ?? []) as Array<Record<string, unknown>>).map(item => h('div',
      ((props.columns ?? []) as Array<{ id: string }>).map(column => slots[`${column.id}-cell`]?.({ row: { original: item } })))),
    slots.empty?.()
  ]) })
  return {
    useExtensionApi: () => api,
    useHostApi: () => ({ get: api.hostGet, patch: api.patch }),
    useExtensionToast: () => ({ add: api.toast }),
    useExtensionI18n: (messages: GcsExtensionMessages) => ({ locale: { value: 'en' }, t: (key: string, values?: Record<string, string | number>) => translateGcsExtensionMessage(messages, 'en', key, values) }),
    ExtensionAlert: content, ExtensionBadge: content, ExtensionButton: button, ExtensionSaveButton: button,
    ExtensionCheckbox: input, ExtensionFormField: content, ExtensionInput: input, ExtensionSelect: input,
    ExtensionTextarea: input, ExtensionModal: modal, ExtensionResourceLayout: table
  }
})
vi.mock('../components/FormCreator.vue', () => ({ default: { render: () => null } }))
vi.mock('../components/FormLibrary.vue', () => ({ default: { render: () => null } }))
vi.mock('../components/IntakeWorkspace.vue', () => ({ default: { render: () => null } }))
vi.mock('../components/ReceiptEvidence.vue', () => ({ default: { render: () => null } }))
vi.mock('../components/IntakeImportSettings.vue', () => ({ default: { render: () => null } }))
import PortalConnection from '../components/PortalConnection.vue'

const deferred = <T,>() => {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail })
  return { promise, resolve, reject }
}
const connection = (id: string) => ({ portalUrl: `https://agency-${id}.example/`, portalAgencyId: 'G-ABCDE', hasCredential: true })
const response = (path: string) => {
  if (path.endsWith('/connection')) return { connection: connection(path.includes('/2/') ? '2' : '1') }
  if (path.endsWith('/receipts')) return { receipts: [] }
  if (path.endsWith('/backlog')) return { backlog: [], operations: [], outcomes: [], inbound: [] }
  if (path.endsWith('/organizations')) return { organizations: [] }
  if (path.endsWith('/settings')) return { statuses: [], settings: null }
  return {}
}
const button = (wrapper: ReturnType<typeof mount>, label: string) => {
  const item = wrapper.findAll('button').find(item => item.text() === label)
  if (!item) throw new Error(`Missing button: ${label}`)
  return item
}

beforeEach(() => {
  vi.clearAllMocks()
  api.get.mockImplementation(async (path: string) => response(path))
  api.hostGet.mockResolvedValue({ items: [] })
  api.post.mockResolvedValue({ queued: 0, results: [] })
  api.put.mockResolvedValue({ connection: connection('1') })
})

describe('Portal connection request ownership', () => {
  it('ignores an old agency summary while the replacement agency finishes', async () => {
    const oldSummary = deferred<{ connection: ReturnType<typeof connection> }>()
    api.get.mockImplementation((path: string) => path === '/agencies/1/connection' ? oldSummary.promise : Promise.resolve(response(path)))
    const wrapper = mount(PortalConnection, { props: { agencyId: '1', section: 'connection', enabled: true } })
    await wrapper.setProps({ agencyId: '2' })
    await flushPromises()
    expect(wrapper.get('input[name="portalUrl"]').element).toHaveProperty('value', connection('2').portalUrl)
    oldSummary.resolve({ connection: connection('1') })
    await flushPromises()
    expect(wrapper.get('input[name="portalUrl"]').element).toHaveProperty('value', connection('2').portalUrl)
    expect(api.get).not.toHaveBeenCalledWith('/agencies/1/backlog')
    wrapper.unmount()
  })

  it('does not let a saved old agency clear the replacement secret or sync another agency', async () => {
    const oldSave = deferred<{ connection: ReturnType<typeof connection> }>()
    api.put.mockReturnValue(oldSave.promise)
    const wrapper = mount(PortalConnection, { props: { agencyId: '1', section: 'connection', enabled: true } })
    await flushPromises()
    await button(wrapper, 'Save connection').trigger('click')
    await wrapper.setProps({ agencyId: '2' })
    await flushPromises()
    const secret = `gcs_${'A'.repeat(43)}`
    await wrapper.get('input[name="portalKey"]').setValue(secret)
    oldSave.resolve({ connection: connection('1') })
    await flushPromises()
    expect(wrapper.get('input[name="portalUrl"]').element).toHaveProperty('value', connection('2').portalUrl)
    expect(wrapper.get('input[name="portalKey"]').element).toHaveProperty('value', secret)
    expect(api.post).not.toHaveBeenCalled()
    expect(api.toast).not.toHaveBeenCalled()
    expect(button(wrapper, 'Save connection').attributes('disabled')).toBeUndefined()
    wrapper.unmount()
  })

  it('owns repeated opening of the same backlog row by request rather than row ID', async () => {
    const first = deferred<unknown>()
    const second = deferred<unknown>()
    let count = 0
    const item = { id: '17', agreementId: '51', organizationId: 'N-ALPHA', state: 'delivered', attempts: 1, nextAttemptAt: new Date().toISOString(), lastError: null }
    api.get.mockImplementation((path: string) => {
      if (path.endsWith('/backlog/17')) return ++count === 1 ? first.promise : second.promise
      if (path.endsWith('/backlog')) return Promise.resolve({ backlog: [item], operations: [], outcomes: [], inbound: [] })
      return Promise.resolve(response(path))
    })
    const wrapper = mount(PortalConnection, { props: { agencyId: '1', section: 'queue', enabled: true } })
    await flushPromises()
    await wrapper.get('button[aria-label="View delivery details"]').trigger('click')
    await wrapper.get('button[aria-label="Close dialog"]').trigger('click')
    await wrapper.get('button[aria-label="View delivery details"]').trigger('click')
    first.reject(new Error('old connection failed'))
    await flushPromises()
    expect(wrapper.get('[role="dialog"]').text()).not.toContain('could not be loaded')
    expect(wrapper.get('[role="dialog"]').text()).toContain('Loading')
    second.resolve({ ...item, createdAt: '', deliveredAt: null, payload: { agreement: { name: 'New accepted evidence', config: {} } } })
    await flushPromises()
    expect(wrapper.get('[role="dialog"]').text()).not.toContain('Loading')
    wrapper.unmount()
  })

  it('does not publish an error toast from a disposed connection action', async () => {
    const save = deferred<unknown>()
    api.put.mockReturnValue(save.promise)
    const wrapper = mount(PortalConnection, { props: { agencyId: '1', section: 'connection', enabled: true } })
    await flushPromises()
    await button(wrapper, 'Save connection').trigger('click')
    wrapper.unmount()
    save.reject(new Error('offline'))
    await flushPromises()
    expect(api.toast).not.toHaveBeenCalled()
    expect(api.post).not.toHaveBeenCalled()
  })
})

const statusSettings = (claim: string[] = [], pullIntervalMinutes: number | null = null) => ({
  statuses: [{ id: 'status1', name_en: 'Draft', name_fr: 'Brouillon' }],
  settings: { portalStatusIds: [], entityStatusIds: { claim, forecast: [], funding_application: [], other_form: [] },
    pullIntervalMinutes, lastPullAt: null, lastPullError: null }
})
const statusCheckbox = (wrapper: ReturnType<typeof mount>) => wrapper.get('input[data-ui-target="extension.gcs-ssc-portal-connector.portal-connection.visible-status-ids.includes-status.id"]')

describe('Portal settings draft ownership', () => {
  it('preserves local status edits when an older queue refresh finishes', async () => {
    const refresh = deferred<ReturnType<typeof statusSettings>>()
    let settingsReads = 0
    api.get.mockImplementation((path: string) => path.endsWith('/settings')
      ? ++settingsReads === 1 ? Promise.resolve(statusSettings()) : refresh.promise
      : Promise.resolve(response(path)))
    const wrapper = mount(PortalConnection, { props: { agencyId: '1', section: 'statuses', enabled: true } })
    await flushPromises()
    await wrapper.setProps({ section: 'queue' })
    await flushPromises()
    await wrapper.setProps({ section: 'statuses' })
    await statusCheckbox(wrapper).setValue('selected')
    refresh.resolve(statusSettings())
    await flushPromises()
    await button(wrapper, 'Save sync settings').trigger('click')
    await flushPromises()
    expect(api.put).toHaveBeenCalledWith('/agencies/1/settings', expect.objectContaining({
      entityStatusIds: { claim: ['status1'], forecast: [], funding_application: [], other_form: [] }
    }))
    wrapper.unmount()
  })

  it('cannot overwrite a just-saved draft with a queue read started before the edit', async () => {
    const refresh = deferred<ReturnType<typeof statusSettings>>()
    let settingsReads = 0
    api.get.mockImplementation((path: string) => path.endsWith('/settings')
      ? ++settingsReads === 1 ? Promise.resolve(statusSettings()) : refresh.promise
      : Promise.resolve(response(path)))
    const wrapper = mount(PortalConnection, { props: { agencyId: '1', section: 'statuses', enabled: true } })
    await flushPromises()
    await wrapper.setProps({ section: 'queue' })
    await flushPromises()
    await wrapper.setProps({ section: 'statuses' })
    await statusCheckbox(wrapper).setValue('selected')
    await button(wrapper, 'Save sync settings').trigger('click')
    await flushPromises()
    refresh.resolve(statusSettings())
    await flushPromises()
    expect(statusCheckbox(wrapper).element).toHaveProperty('value', 'true')
    await button(wrapper, 'Save sync settings').trigger('click')
    expect(api.put.mock.calls.at(-1)?.[1]).toMatchObject({ entityStatusIds: { claim: ['status1'] } })
    wrapper.unmount()
  })

  it('keeps an edited schedule across refresh but accepts fresh settings after saving', async () => {
    let settings = statusSettings()
    api.get.mockImplementation(async (path: string) => path.endsWith('/settings') ? settings : response(path))
    const wrapper = mount(PortalConnection, { props: { agencyId: '1', section: 'connection', enabled: true } })
    await flushPromises()
    await wrapper.get('input[name="pullSchedule"]').setValue('15')
    await wrapper.setProps({ section: 'queue' })
    await flushPromises()
    await wrapper.setProps({ section: 'connection' })
    expect(wrapper.get('input[name="pullSchedule"]').element).toHaveProperty('value', '15')
    await button(wrapper, 'Save sync settings').trigger('click')
    await flushPromises()
    expect(api.put.mock.calls.at(-1)?.[1]).toMatchObject({ pullIntervalMinutes: 15 })
    settings = statusSettings(['status1'], 30)
    await wrapper.setProps({ section: 'queue' })
    await flushPromises()
    await wrapper.setProps({ section: 'connection' })
    expect(wrapper.get('input[name="pullSchedule"]').element).toHaveProperty('value', '30')
    await wrapper.setProps({ section: 'statuses' })
    expect(statusCheckbox(wrapper).element).toHaveProperty('value', 'true')
    wrapper.unmount()
  })

  it('retains failed-save edits for retry and resets draft ownership for another agency', async () => {
    api.get.mockImplementation(async (path: string) => path.endsWith('/settings')
      ? statusSettings(path.includes('/2/') ? ['status1'] : [], path.includes('/2/') ? 5 : null)
      : response(path))
    api.put.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({})
    const wrapper = mount(PortalConnection, { props: { agencyId: '1', section: 'connection', enabled: true } })
    await flushPromises()
    await wrapper.get('input[name="pullSchedule"]').setValue('15')
    await button(wrapper, 'Save sync settings').trigger('click')
    await flushPromises()
    await button(wrapper, 'Save sync settings').trigger('click')
    await flushPromises()
    expect(api.put.mock.calls[0]?.[1]).toMatchObject({ pullIntervalMinutes: 15 })
    expect(api.put.mock.calls[1]?.[1]).toMatchObject({ pullIntervalMinutes: 15 })
    await wrapper.setProps({ agencyId: '2' })
    await flushPromises()
    expect(wrapper.get('input[name="pullSchedule"]').element).toHaveProperty('value', '5')
    await wrapper.setProps({ section: 'statuses' })
    expect(statusCheckbox(wrapper).element).toHaveProperty('value', 'true')
    wrapper.unmount()
  })

  it('protects accepted settings during save while catalog refreshes remain independent', async () => {
    const refresh = deferred<ReturnType<typeof statusSettings>>()
    const save = deferred<unknown>()
    let settingsReads = 0
    api.get.mockImplementation((path: string) => path.endsWith('/settings')
      ? ++settingsReads === 1 ? Promise.resolve(statusSettings(['status1'])) : refresh.promise
      : Promise.resolve(response(path)))
    api.put.mockReturnValue(save.promise)
    const wrapper = mount(PortalConnection, { props: { agencyId: '1', section: 'statuses', enabled: true } })
    await flushPromises()
    await wrapper.setProps({ section: 'queue' })
    await flushPromises()
    await wrapper.setProps({ section: 'statuses' })
    await button(wrapper, 'Save sync settings').trigger('click')
    const remote = statusSettings()
    remote.statuses.push({ id: 'status2', name_en: 'Approved', name_fr: 'Approuvé' })
    refresh.resolve(remote)
    await flushPromises()
    expect(statusCheckbox(wrapper).element).toHaveProperty('value', 'true')
    expect(wrapper.findAll('input[data-ui-target$="visible-status-ids.includes-status.id"]')).toHaveLength(2)
    save.resolve({})
    await flushPromises()
    expect(statusCheckbox(wrapper).element).toHaveProperty('value', 'true')
    wrapper.unmount()
  })

})
