// @vitest-environment jsdom
import { flushPromises, mount, enableAutoUnmount, type VueWrapper } from '@vue/test-utils'
import { computed, defineComponent, h } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { translateGcsExtensionMessage, type GcsExtensionMessages, type ExtensionEntityTabContext } from '@gcs-ssc/extensions'

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), hostGet: vi.fn(), toast: vi.fn() }))
vi.mock('../components/FormCreator.vue', () => ({ default: defineComponent({ setup: () => () => h('div') }) }))
vi.mock('@gcs-ssc/extensions/ui', () => {
  const button = defineComponent({ props: ['label', 'disabled'], emits: ['click'], setup: (props, { emit, slots }) =>
    () => h('button', { disabled: props.disabled, onClick: () => emit('click') }, props.label ?? slots.default?.()) })
  const field = defineComponent({ props: ['label', 'error'], setup: (props, { slots }) =>
    () => h('div', [h('label', props.label), props.error ? h('p', props.error) : null, slots.default?.()]) })
  const input = (tag: 'input' | 'textarea') => defineComponent({ props: ['modelValue', 'name', 'disabled'], emits: ['update:modelValue'],
    setup: (props, { attrs, emit }) => () => h(tag, { ...attrs, name: props.name, value: props.modelValue, disabled: props.disabled,
      onInput: (event: Event) => emit('update:modelValue', (event.target as HTMLInputElement).value) }) })
  const select = defineComponent({ props: ['modelValue', 'name', 'items', 'disabled'], emits: ['update:modelValue'],
    setup: (props, { emit }) => () => h('select', { name: props.name, value: props.modelValue, disabled: props.disabled,
      onChange: (event: Event) => emit('update:modelValue', (event.target as HTMLSelectElement).value) },
    props.items.map((item: { value: string; label: string }) => h('option', { value: item.value }, item.label))) })
  const table = defineComponent({ props: ['data', 'columns'], setup: (props, { slots }) =>
    () => h('div', props.data.flatMap((item: unknown) => props.columns.map((column: { id: string }) =>
      h('div', slots[`${column.id}-cell`]?.({ row: { original: item } }))))) })
  return {
    useExtensionApi: () => api, useHostApi: () => ({ get: api.hostGet }), useExtensionToast: () => ({ add: api.toast }),
    useExtensionI18n: (catalog: GcsExtensionMessages) => ({ locale: computed(() => 'en'),
      t: (key: string, values?: Record<string, string | number>) => translateGcsExtensionMessage(catalog, 'en', key, values) }),
    ExtensionButton: button, ExtensionSaveButton: button, ExtensionFormField: field, ExtensionInput: input('input'),
    ExtensionTextarea: input('textarea'), ExtensionSelect: select, ExtensionResourceLayout: table,
    ExtensionModal: defineComponent({ props: ['open', 'title'], setup: (props, { slots }) =>
      () => props.open ? h('div', { role: 'dialog' }, [h('h2', props.title), slots.body?.()]) : null }),
    ExtensionBadge: defineComponent({ setup: (_, { slots }) => () => h('span', slots.default?.()) }),
    ExtensionAlert: defineComponent({ props: ['description'], setup: props => () => h('p', props.description) })
  }
})
import IntakeWorkspace from '../components/IntakeWorkspace.vue'
import IntakeImportSettings from '../components/IntakeImportSettings.vue'
import ProponentVerification from '../components/ProponentVerification.vue'

enableAutoUnmount(afterEach)
const deferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
const intake = (name: string) => ({ id: name, nameEn: name, nameFr: name, revision: 1, streamId: 'S-ABCDE',
  startDate: '2027-01-01', endDate: '2027-12-31', published: false, surveyId: null, surveyRevision: null })
const streams = [{ id: 'S-ABCDE', nameEn: 'Stream', nameFr: 'Volet' }]
const button = (wrapper: VueWrapper, text: string) => {
  const match = wrapper.findAll('button').find(item => item.text() === text)
  if (!match) throw new Error(`Missing button ${text}`)
  return match
}
const fillIntake = async (wrapper: VueWrapper, name: string) => {
  await wrapper.get('input[name="intakeNameEn"]').setValue(name)
  await wrapper.get('input[name="intakeNameFr"]').setValue(name)
  await wrapper.get('select[name="intakeStream"]').setValue('S-ABCDE')
  await wrapper.get('input[name="intakeStartDate"]').setValue('2027-01-01')
  await wrapper.get('input[name="intakeEndDate"]').setValue('2027-12-31')
}
const proponentContext = (id: string): Extract<ExtensionEntityTabContext, { target: 'proponent' }> => ({
  target: 'proponent', applicantRecipientId: id, ownerType: 'applicantrecipient', ownerId: id,
  agencies: [{ agencyId: '1', nameEn: 'Agency', nameFr: 'Agence', config: {} }]
})
const organization = { id: 'ORG', name: 'Portal organization', description: '', ownerName: 'Owner', ownerEmail: 'owner@example.com',
  memberCount: 1, agreementCount: 0, active: true, verified: false }
const setupVerification = () => {
  api.get.mockImplementation(async (path: string) => path.endsWith('/verification') ? { verifications: [] } : { organizations: [organization] })
  api.hostGet.mockImplementation(async (path: string) => path.startsWith('/api/extensions/agency/')
    ? { items: [{ extension: { key: 'gcs-ssc-portal-connector' }, config: { portalProponentVerificationAccess: 'contributor' }, canConfigure: false }] }
    : { can_update: true })
}
const openConfirmation = async (wrapper: VueWrapper, note: string) => {
  await wrapper.get('input[name="organizationSearch"]').setValue('Portal')
  await button(wrapper, 'Search').trigger('click')
  await button(wrapper, 'Verify').trigger('click')
  await wrapper.get('textarea[name="note"]').setValue(note)
}

beforeEach(() => { vi.resetAllMocks() })
describe('Portal intake request and edit ownership', () => {
  it('rejects an older agency collection response', async () => {
    const old = deferred<{ intakes: ReturnType<typeof intake>[]; streams: typeof streams }>()
    api.get.mockReturnValueOnce(old.promise).mockResolvedValueOnce({ intakes: [intake('Current intake')], streams })
    const wrapper = mount(IntakeWorkspace, { props: { agencyId: '1' } })
    await wrapper.setProps({ agencyId: '2' })
    await flushPromises()
    old.resolve({ intakes: [intake('Previous intake')], streams })
    await flushPromises()
    expect(wrapper.text()).toContain('Current intake')
    expect(wrapper.text()).not.toContain('Previous intake')
  })

  it('cannot refresh a replacement agency after an old save settles', async () => {
    api.get.mockResolvedValue({ intakes: [], streams })
    const old = deferred<{ intakeId: string }>()
    api.post.mockReturnValueOnce(old.promise)
    const wrapper = mount(IntakeWorkspace, { props: { agencyId: '1' } })
    await flushPromises()
    await button(wrapper, 'Create intake opportunity').trigger('click')
    await fillIntake(wrapper, 'Old agency draft')
    await button(wrapper, 'Save intake').trigger('click')
    await wrapper.setProps({ agencyId: '2' })
    await flushPromises()
    old.resolve({ intakeId: 'OLD' })
    await flushPromises()
    expect(api.post.mock.calls[0]?.[0]).toBe('/agencies/1/intakes')
    expect(api.get).toHaveBeenCalledTimes(2)
    expect(button(wrapper, 'Create intake opportunity').exists()).toBe(true)
  })

  it('retains the create key on retry and cannot close a replacement draft', async () => {
    api.get.mockResolvedValue({ intakes: [], streams })
    api.post.mockRejectedValueOnce(new Error('offline'))
    const old = deferred<{ intakeId: string }>()
    api.post.mockReturnValueOnce(old.promise)
    const wrapper = mount(IntakeWorkspace, { props: { agencyId: '1' } })
    await flushPromises()
    await button(wrapper, 'Create intake opportunity').trigger('click')
    await fillIntake(wrapper, 'First draft')
    await button(wrapper, 'Save intake').trigger('click')
    await flushPromises()
    await button(wrapper, 'Save intake').trigger('click')
    expect(api.post.mock.calls[1]?.[1].requestKey).toBe(api.post.mock.calls[0]?.[1].requestKey)
    await button(wrapper, '← All intake opportunities').trigger('click')
    await button(wrapper, 'Create intake opportunity').trigger('click')
    await fillIntake(wrapper, 'Replacement draft')
    old.resolve({ intakeId: 'OLD' })
    await flushPromises()
    expect(wrapper.get('input[name="intakeNameEn"]').element).toHaveProperty('value', 'Replacement draft')
    expect(button(wrapper, 'Save intake').attributes('disabled')).toBeUndefined()
  })
})

describe('Portal Proponent confirmation ownership', () => {
  it('rejects verification evidence from the previous Proponent', async () => {
    const old = deferred<{ verifications: unknown[] }>()
    api.get.mockReturnValueOnce(old.promise).mockResolvedValueOnce({ verifications: [{ organizationId: 'NEW', organizationName: 'Current organization',
      originAgencyId: '1', note: 'Current note', verifiedAt: '2026-01-01T00:00:00Z', active: true, verifierName: 'Current verifier' }] })
    const wrapper = mount(ProponentVerification, { props: { context: proponentContext('7') } })
    await wrapper.setProps({ context: proponentContext('8') })
    await flushPromises()
    old.resolve({ verifications: [{ organizationId: 'OLD', organizationName: 'Old organization', active: true }] })
    await flushPromises()
    expect(wrapper.text()).toContain('Current organization')
    expect(wrapper.text()).not.toContain('Old organization')
    expect(api.hostGet).not.toHaveBeenCalled()
  })

  it('does not close a replacement confirmation after a stale permanent-link response', async () => {
    setupVerification()
    const old = deferred<unknown>()
    api.post.mockReturnValueOnce(old.promise)
    const wrapper = mount(ProponentVerification, { props: { context: proponentContext('7') } })
    await flushPromises()
    await openConfirmation(wrapper, 'First note')
    await button(wrapper, 'Confirm permanent link').trigger('click')
    await wrapper.setProps({ context: proponentContext('8') })
    await flushPromises()
    await openConfirmation(wrapper, 'Replacement note')
    old.resolve({ verified: true })
    await flushPromises()
    expect(api.post).toHaveBeenCalledWith('/agencies/1/proponents/7/verification', {
      organizationId: 'ORG', proponentId: '7', note: 'First note'
    })
    expect(wrapper.get('[role="dialog"] textarea').element).toHaveProperty('value', 'Replacement note')
    expect(button(wrapper, 'Confirm permanent link').attributes('disabled')).toBeUndefined()
    expect(api.toast).not.toHaveBeenCalled()
  })

  it('does not announce or reload a verification after its owner unmounts', async () => {
    setupVerification()
    const pending = deferred<unknown>()
    api.post.mockReturnValueOnce(pending.promise)
    const wrapper = mount(ProponentVerification, { props: { context: proponentContext('7') } })
    await flushPromises()
    await openConfirmation(wrapper, 'Checked records')
    await button(wrapper, 'Confirm permanent link').trigger('click')
    const readCount = api.get.mock.calls.length
    wrapper.unmount()
    pending.resolve({ verified: true })
    await flushPromises()
    expect(api.toast).not.toHaveBeenCalled()
    expect(api.get).toHaveBeenCalledTimes(readCount)
  })
})

it('does not apply saved intake-group evidence to another Agency', async () => {
  api.get.mockResolvedValueOnce({ groups: [{ id: '11', nameEn: 'First group', nameFr: 'Premier' }], intakeGroupId: null, ready: false })
    .mockResolvedValueOnce({ groups: [{ id: '22', nameEn: 'Current group', nameFr: 'Actuel' }], intakeGroupId: '22', ready: true })
  const old = deferred<unknown>()
  api.put.mockReturnValueOnce(old.promise)
  const wrapper = mount(IntakeImportSettings, { props: { agencyId: '1' } })
  await flushPromises()
  await wrapper.get('select').setValue('11')
  await wrapper.get('button').trigger('click')
  await wrapper.setProps({ agencyId: '2' })
  await flushPromises()
  old.resolve({ groups: [{ id: '11', nameEn: 'First group', nameFr: 'Premier' }], intakeGroupId: '11', ready: true })
  await flushPromises()
  expect(wrapper.get('select').element).toHaveProperty('value', '22')
  expect(wrapper.text()).not.toContain('Intake settings saved.')
  expect(wrapper.text()).not.toContain('First group')
})
