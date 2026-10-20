// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils'
import { computed, defineComponent, h, reactive } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { translateGcsExtensionMessage, type GcsExtensionMessages } from '@gcs-ssc/extensions'

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }))
const hostApi = vi.hoisted(() => ({ get: vi.fn() }))
const current = reactive({ locale: 'en' })
vi.mock('@gcs-ssc/extensions/ui', () => ({
  useExtensionApi: () => api,
  useHostApi: () => hostApi,
  useExtensionI18n: (catalog: GcsExtensionMessages) => ({ locale: computed(() => current.locale),
    t: (key: string, values?: Record<string, string | number>) => translateGcsExtensionMessage(catalog, current.locale, key, values) }),
  ExtensionButton: defineComponent({ props: ['disabled', 'loading'], emits: ['click'], setup: (props, { emit, slots }) =>
    () => h('button', { disabled: props.disabled, 'aria-busy': props.loading, onClick: () => emit('click') }, slots.default?.()) }),
  ExtensionFormField: defineComponent({ props: ['label', 'name', 'required', 'description'], setup: (props, { slots }) =>
    () => h('div', [h('label', { for: props.name }, props.label), h('p', props.description), slots.default?.()]) }),
  ExtensionInput: defineComponent({ props: ['modelValue', 'name', 'disabled'], emits: ['update:modelValue'],
    setup: (props, { attrs, emit }) => () => h('input', { ...attrs, id: props.name, value: props.modelValue,
      disabled: props.disabled, onInput: (event: Event) => {
        if (event.target instanceof HTMLInputElement) emit('update:modelValue', event.target.value)
      } }) }),
  ExtensionSelect: defineComponent({ props: ['modelValue', 'name', 'items', 'disabled'], emits: ['update:modelValue'],
    setup: (props, { attrs, emit }) => () => h('select', { ...attrs, id: props.name, value: props.modelValue,
      disabled: props.disabled, onChange: (event: Event) => {
        if (event.target instanceof HTMLSelectElement) emit('update:modelValue', event.target.value)
      } }, props.items.map((item: { value: string; label: string }) => h('option', { value: item.value }, item.label))) })
}))
import AgreementPortal from '../components/AgreementPortal.vue'

const recipient = { egcs_fc_applicantrecipient: '7', applicant_recipient_name_en: 'Health association', applicant_recipient_name_fr: 'Association de santé' }
const publication = { organizationId: 'N-ABCDE', agreementId: 'portal/agreement', revision: 1, setCount: 2, publishedAt: '2026-10-19T12:00:00Z' }
const connection = { portalUrl: 'https://portal.example.test/base', hasCredential: true }
const wrappers: ReturnType<typeof mount>[] = []
const render = async (props = { agencyId: '1', agreementId: '2' }) => {
  const wrapper = mount(AgreementPortal, { props })
  wrappers.push(wrapper)
  await flushPromises()
  return wrapper
}
beforeEach(() => {
  vi.resetAllMocks()
  current.locale = 'en'
  api.get.mockImplementation(async (path: string) => path.endsWith('/connection') ? { connection } : { publications: [] })
  hostApi.get.mockResolvedValue({ items: [recipient] })
  api.post.mockResolvedValue({ agreementId: '42', setIds: ['a', 'b'] })
})
afterEach(() => { for (const wrapper of wrappers.splice(0)) wrapper.unmount() })

describe('agreement portal rendered publication flow', () => {
  it('validates organization codes and publishes with live bilingual feedback and links', async () => {
    const wrapper = await render()
    expect(hostApi.get).toHaveBeenCalledWith('/api/agreements/2/applicant-recipients')
    expect(wrapper.text()).toContain('Health association')
    expect(wrapper.get('button').attributes('disabled')).toBeDefined()
    expect(wrapper.get('input').attributes('required')).toBeDefined()
    expect(wrapper.get('select').attributes('required')).toBeDefined()
    await wrapper.get('input').setValue('N-AB10I')
    expect(wrapper.get('button').attributes('disabled')).toBeDefined()
    await wrapper.get('input').setValue('N-ABCDE')
    api.get.mockImplementation(async (path: string) => path.endsWith('/connection') ? { connection } : { publications: [publication] })
    await wrapper.get('button').trigger('click')
    await flushPromises()
    expect(api.post).toHaveBeenCalledWith('/agencies/1/publish-agreement', {
      agreementId: '2', proponentId: '7', portalOrganizationId: 'N-ABCDE'
    })
    expect(wrapper.get('[role=status]').text()).toBe('Published agreement 42 and 2 forms to organization N-ABCDE.')
    expect(wrapper.get('a').attributes('href')).toBe('https://portal.example.test/organizations/N-ABCDE/agreements/portal%2Fagreement')
    expect(wrapper.get('a').attributes('rel')).toBe('noopener noreferrer')
    expect(wrapper.get('time').attributes('datetime')).toBe(publication.publishedAt)
    current.locale = 'fr-CA'
    await flushPromises()
    expect(wrapper.text()).toContain('Association de santé')
    expect(wrapper.get('button').text()).toBe('Publier dans le portail')
    expect(wrapper.get('[role=status]').text()).toBe('Entente 42 et 2 formulaires publiés pour l’organisme N-ABCDE.')
    expect(wrapper.text()).not.toContain('Publish to portal')
  })

  it('respects read-only mode and prevents duplicate submissions while busy', async () => {
    const wrapper = await render()
    await wrapper.get('input').setValue('N-ABCDE')
    await wrapper.setProps({ disabled: true })
    for (const control of wrapper.findAll('button, input, select')) expect(control.attributes('disabled')).toBeDefined()
    await wrapper.get('button').trigger('click')
    expect(api.post).not.toHaveBeenCalled()
    await wrapper.setProps({ disabled: false })
    let finish: (value: { agreementId: string; setIds: string[] }) => void = () => {}
    api.post.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    await wrapper.get('button').trigger('click')
    expect(wrapper.get('button').attributes('aria-busy')).toBe('true')
    expect(wrapper.get('input').attributes('disabled')).toBeDefined()
    await wrapper.get('button').trigger('click')
    expect(api.post).toHaveBeenCalledTimes(1)
    finish({ agreementId: '42', setIds: [] })
    await flushPromises()
    expect(wrapper.get('button').attributes('disabled')).toBeUndefined()
  })

  it('translates publication errors live and lets the user retry successfully', async () => {
    const wrapper = await render()
    await wrapper.get('input').setValue('N-ABCDE')
    api.post.mockRejectedValueOnce(new Error('private backend diagnostic'))
    await wrapper.get('button').trigger('click')
    await flushPromises()
    expect(wrapper.get('[role=alert]').text()).toContain('The agreement could not be published.')
    expect(wrapper.text()).not.toContain('private backend diagnostic')
    current.locale = 'fr'
    await flushPromises()
    expect(wrapper.get('[role=alert]').text()).toContain('Impossible de publier l’entente.')
    await wrapper.get('button').trigger('click')
    await flushPromises()
    expect(wrapper.find('[role=alert]').exists()).toBe(false)
    expect(wrapper.get('[role=status]').text()).toContain('Entente 42')
  })

  it('explains missing connection and recipient prerequisites', async () => {
    api.get.mockImplementation(async (path: string) => path.endsWith('/connection') ? { connection: null } : { publications: [publication] })
    const wrapper = await render()
    expect(wrapper.text()).toContain('Ask an agency manager to connect this agency')
    expect(wrapper.find('button').exists()).toBe(false)
    expect(wrapper.find('a').exists()).toBe(false)
    hostApi.get.mockResolvedValue({ items: [] })
    api.get.mockImplementation(async (path: string) => path.endsWith('/connection') ? { connection } : { publications: [] })
    await wrapper.setProps({ agreementId: '3' })
    await flushPromises()
    expect(wrapper.text()).toContain('Link a recipient to this agreement')
    expect(wrapper.find('button').exists()).toBe(false)
  })

  it('reloads identifiers and clears unavailable recipients when context changes', async () => {
    const wrapper = await render()
    hostApi.get.mockResolvedValue({ items: [recipient, { ...recipient, egcs_fc_applicantrecipient: '8', applicant_recipient_name_en: 'Other recipient' }] })
    await wrapper.setProps({ agencyId: '10', agreementId: '20' })
    await flushPromises()
    await wrapper.get('select').setValue('8')
    await wrapper.get('input').setValue('N-ABCDE')
    await wrapper.get('button').trigger('click')
    await flushPromises()
    expect(api.post).toHaveBeenLastCalledWith('/agencies/10/publish-agreement', expect.objectContaining({ agreementId: '20', proponentId: '8' }))
    hostApi.get.mockResolvedValue({ items: [recipient, { ...recipient, egcs_fc_applicantrecipient: '9' }] })
    await wrapper.setProps({ context: { target: 'agreement', agencyId: '11', agreementId: '21', ownerType: 'fundingcaseagreement', ownerId: '21', scope: { type: 'agency', agencyId: '11' } } })
    await flushPromises()
    expect(hostApi.get).toHaveBeenLastCalledWith('/api/agreements/21/applicant-recipients')
    expect(api.get).toHaveBeenCalledWith('/agencies/11/agreements/21/publications')
    expect(wrapper.get('button').attributes('disabled')).toBeDefined()
    await wrapper.get('select').setValue('9')
    await wrapper.get('button').trigger('click')
    await flushPromises()
    expect(api.post).toHaveBeenLastCalledWith('/agencies/11/publish-agreement', expect.objectContaining({ agreementId: '21', proponentId: '9' }))
  })

  it('reports recipient and history load failures bilingually, then recovers', async () => {
    hostApi.get.mockRejectedValueOnce(new Error('recipients unavailable'))
    const wrapper = await render()
    expect(wrapper.get('[role=alert]').text()).toBe('Agreement recipients could not be loaded.')
    current.locale = 'fr'
    await flushPromises()
    expect(wrapper.get('[role=alert]').text()).toBe('Impossible de charger les bénéficiaires de l’entente.')
    api.get.mockImplementationOnce(async () => ({ connection })).mockRejectedValueOnce(new Error('history unavailable'))
    await wrapper.setProps({ agreementId: '3' })
    await flushPromises()
    expect(wrapper.get('[role=alert]').text()).toBe('Impossible de charger l’historique des publications.')
    await wrapper.setProps({ agreementId: '4' })
    await flushPromises()
    expect(wrapper.find('[role=alert]').exists()).toBe(false)
    expect(wrapper.find('input').exists()).toBe(true)
  })

  it('waits for identifiers before calling either API', async () => {
    const wrapper = await render({ agencyId: '', agreementId: '' })
    expect(api.get).not.toHaveBeenCalled()
    expect(hostApi.get).not.toHaveBeenCalled()
    await wrapper.setProps({ agencyId: '1', agreementId: '2' })
    await flushPromises()
    expect(wrapper.find('[role=status]').exists()).toBe(false)
    expect(wrapper.find('select').exists()).toBe(true)
  })
})
