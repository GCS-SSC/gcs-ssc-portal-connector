// @vitest-environment jsdom
import { FetchResponseError, translateGcsExtensionMessage, type GcsExtensionMessages } from '@gcs-ssc/extensions'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ locale: 'en' as 'en' | 'fr', toastAdd: vi.fn() }))
const get = vi.fn()
const post = vi.fn()
const put = vi.fn()
const hostGet = vi.fn()

vi.mock('@gcs-ssc/extensions/ui', () => {
  const field = defineComponent({
    props: ['label', 'name', 'required', 'description'],
    setup(props, { slots }) {
      return () => h('div', { 'data-field': props.name }, [
        h('label', { for: props.name }, `${props.label}${props.required ? ' (required)' : ''}`),
        props.description ? h('p', props.description) : null,
        slots.default?.()
      ])
    }
  })
  const input = defineComponent({
    props: ['modelValue', 'name', 'type', 'required', 'disabled', 'min', 'max'], emits: ['update:modelValue'],
    setup(props, { attrs, emit }) {
      return () => h('input', { ...attrs, name: props.name, type: props.type, value: props.modelValue,
        required: props.required, disabled: props.disabled, min: props.min, max: props.max,
        onInput: (event: Event) => emit('update:modelValue', (event.target as HTMLInputElement).value) })
    }
  })
  const select = defineComponent({
    props: ['modelValue', 'name', 'items', 'disabled'], emits: ['update:modelValue'],
    setup(props, { attrs, emit }) {
      return () => h('select', { ...attrs, name: props.name, value: props.modelValue, disabled: props.disabled,
        onChange: (event: Event) => emit('update:modelValue', (event.target as HTMLSelectElement).value) },
      (props.items as Array<{ value: string; label: string }> ?? []).map(item => h('option', { value: item.value }, item.label)))
    }
  })
  const checkbox = defineComponent({
    props: ['modelValue', 'label', 'disabled'], emits: ['update:modelValue'],
    setup(props, { attrs, emit }) {
      return () => h('label', [h('input', { ...attrs, type: 'checkbox', checked: props.modelValue, disabled: props.disabled,
        onChange: (event: Event) => emit('update:modelValue', (event.target as HTMLInputElement).checked) }), props.label])
    }
  })
  const textarea = defineComponent({
    props: ['modelValue', 'name', 'required', 'disabled'], emits: ['update:modelValue'],
    setup(props, { attrs, emit }) {
      return () => h('textarea', { ...attrs, name: props.name, required: props.required, disabled: props.disabled,
        value: props.modelValue, onInput: (event: Event) => emit('update:modelValue', (event.target as HTMLTextAreaElement).value) })
    }
  })
  const modal = defineComponent({
    props: ['open', 'title', 'description'],
    setup(props, { slots }) { return () => props.open ? h('div', { role: 'dialog' }, [h('h2', props.title), h('p', props.description), slots.body?.()]) : null }
  })
  const button = defineComponent({
    props: ['label', 'disabled'], emits: ['click'],
    setup(props, { emit, slots }) {
      return () => h('button', { disabled: props.disabled, onClick: () => emit('click') }, props.label ?? slots.default?.())
    }
  })
  const resourceTable = defineComponent({
    props: ['data', 'columns', 'search', 'pagination', 'searchPlaceholder', 'showToolbar'], emits: ['update:search', 'update:pagination'],
    setup(props, { slots, emit }) {
      return () => h('div', { 'data-resource-table': '' }, [
        ...(props.showToolbar === false ? [] : [h('input', { 'aria-label': props.searchPlaceholder, value: props.search,
          onInput: (event: Event) => emit('update:search', (event.target as HTMLInputElement).value) })]),
        ...(props.data as Array<{ id?: string; eventId?: string }> ?? []).map(item => h('div', { 'data-organization-row': item.id, 'data-table-row': item.id ?? item.eventId },
          (props.columns as Array<{ id: string }> ?? []).map(column => h('div',
            slots[`${column.id}-cell`]?.({ row: { original: item } }))))),
        ...((props.data as unknown[] ?? []).length ? [] : [slots.empty?.()])
      ])
    }
  })
  return {
    useExtensionI18n: (messages: GcsExtensionMessages) => ({
      locale: { get value() { return state.locale } },
      t: (key: string, values?: Record<string, string | number>) => translateGcsExtensionMessage(messages, state.locale, key, values)
    }),
    useExtensionToast: () => ({ add: state.toastAdd }),
    useExtensionApi: () => ({ get, post, put }), useHostApi: () => ({ get: hostGet, patch: vi.fn() }),
    ExtensionFormField: field, ExtensionInput: input, ExtensionSelect: select,
    ExtensionCheckbox: checkbox, ExtensionButton: button, ExtensionSaveButton: button,
    ExtensionTextarea: textarea, ExtensionModal: modal, ExtensionResourceLayoutCard: resourceTable,
    ExtensionBadge: defineComponent({ setup(_, { slots }) { return () => h('span', slots.default?.()) } }),
    ExtensionAlert: defineComponent({ props: ['title'], setup(props, { slots }) {
      return () => h('div', { role: 'alert' }, [h('strong', props.title), slots.description?.()])
    } })
  }
})

import FormCreator from '../components/FormCreator.vue'
import PortalConnection from '../components/PortalConnection.vue'
import ProponentVerification from '../components/ProponentVerification.vue'

const button = (wrapper: ReturnType<typeof mount>, label: string) => wrapper.findAll('button').find(item => item.text() === label)!

beforeEach(() => {
  state.locale = 'en'
  state.toastAdd.mockReset()
  get.mockReset().mockImplementation(async (path: string) => {
    if (path.endsWith('/forms')) return { surveys: [], streams: [], agreements: [], calls: [] }
    if (path.endsWith('/connection')) return { connection: { portalUrl: 'https://portal.example/', portalAgencyId: 'G-ABCDE', hasCredential: true } }
    if (path.endsWith('/verification')) return { verifications: [] }
    if (path.endsWith('/receipts')) return { receipts: [] }
    if (path.endsWith('/organizations')) return { organizations: [{ id: 'N-ABCDE', name: 'Test organization', description: 'Agency description',
      ownerName: 'Portal owner', ownerEmail: 'owner@example.ca', memberCount: 3, agreementCount: 1,
      active: true, verified: false, proponentId: null, note: null, verifiedAt: null, syncedAt: new Date().toISOString() }] }
    if (path.endsWith('/backlog')) return { backlog: [], outcomes: [], inbound: [] }
    if (path.endsWith('/settings')) return { statuses: [], settings: null }
    return {}
  })
  hostGet.mockReset().mockResolvedValue({ items: [{ id: '7', egcs_ar_legalname_en: 'Recipient', egcs_ar_legalname_fr: 'Bénéficiaire' }] })
  post.mockReset().mockResolvedValue({ survey: { id: 'survey_1', revision: 1 }, results: [] })
  put.mockReset().mockResolvedValue({ connection: { portalUrl: 'https://portal.example/', portalAgencyId: 'G-ABCDE', hasCredential: true } })
})

describe('connector form requirements', () => {
  it('shows delivery and recent receipts in separate searchable host tables', async () => {
    const defaultGet = get.getMockImplementation()!
    get.mockImplementation(async (path: string) => path.endsWith('/backlog')
      ? { backlog: [], outcomes: [], inbound: [
        { eventId: 'first', submissionId: 'S-ALPHA', kind: 'claim', state: 'imported', lastError: null },
        { eventId: 'second', submissionId: 'S-BETA', kind: 'forecast', state: 'queued', lastError: null }
      ] }
      : path.endsWith('/receipts')
        ? { receipts: [{ id: 'receipt', kind: 'claim', state: 'imported', gcs_entity_id: '123', created_at: new Date().toISOString() }] }
        : defaultGet(path))
    const wrapper = mount(PortalConnection, { props: { agencyId: '1', section: 'delivery', enabled: true } })
    await flushPromises()
    expect(wrapper.findAll('[data-resource-table]')).toHaveLength(2)
    expect(wrapper.findAll('[data-table-row]')).toHaveLength(3)
    await wrapper.get('input[aria-label="Search portal updates"]').setValue('S-BETA')
    expect(wrapper.find('[data-table-row="first"]').exists()).toBe(false)
    expect(wrapper.find('[data-table-row="second"]').exists()).toBe(true)
    expect(wrapper.find('[data-table-row="receipt"]').exists()).toBe(true)
    await wrapper.get('input[aria-label="Search recent deliveries"]').setValue('unmatched')
    expect(wrapper.text()).toContain('No matching recent deliveries.')
  })

  it('refreshes portal updates and receipts after checking for updates', async () => {
    let checked = false
    const defaultGet = get.getMockImplementation()!
    get.mockImplementation(async (path: string) => {
      if (path.endsWith('/backlog')) return { backlog: [], outcomes: [], inbound: checked
        ? [{ eventId: 'new-update', submissionId: 'S-NEW', kind: 'claim', state: 'imported', lastError: null }] : [] }
      if (path.endsWith('/receipts')) return { receipts: checked
        ? [{ id: 'new-receipt', kind: 'claim', state: 'imported', gcs_entity_id: '123', created_at: new Date().toISOString() }] : [] }
      return defaultGet(path)
    })
    post.mockImplementation(async (path: string) => {
      if (path.endsWith('/sync')) { checked = true; return { imported: [{ entityId: '123' }], pending: [] } }
      return {}
    })
    const wrapper = mount(PortalConnection, { props: { agencyId: '1', section: 'delivery', enabled: true } })
    await flushPromises()
    await button(wrapper, 'Check for portal updates').trigger('click')
    await flushPromises()
    expect(post).toHaveBeenCalledWith('/agencies/1/sync')
    expect(checked).toBe(true)
    expect(wrapper.find('[data-table-row="new-update"]').exists()).toBe(true)
    expect(wrapper.find('[data-table-row="new-receipt"]').exists()).toBe(true)
    expect(state.toastAdd).toHaveBeenCalledWith({
      title: 'Success', description: 'Items imported: 1. Items still pending: 0.', color: 'success'
    })
  })

  it('shows a rejected Portal credential in the host error toast', async () => {
    put.mockRejectedValue(new FetchResponseError(new Response(null, { status: 400 }), {
      data: { code: 'GCS_PORTAL_INVALID_CREDENTIAL', message: 'The Portal rejected this API credential.' }
    }))
    const wrapper = mount(PortalConnection, { props: { agencyId: '1', section: 'connection', enabled: true } })
    await flushPromises()
    await button(wrapper, 'Save connection').trigger('click')
    await flushPromises()
    expect(state.toastAdd).toHaveBeenCalledWith({
      title: 'Error', description: 'The Portal rejected this API credential.', color: 'error'
    })
  })

  it('keeps connection actions enabled and explains invalid input when clicked', async () => {
    const wrapper = mount(PortalConnection, { props: { agencyId: '1', section: 'connection', enabled: true } })
    await flushPromises()
    await wrapper.get('input[name="portalUrl"]').setValue('not a URL')
    expect(button(wrapper, 'Save connection').attributes('disabled')).toBeUndefined()
    expect(button(wrapper, 'Test connection').attributes('disabled')).toBeUndefined()
    await button(wrapper, 'Save connection').trigger('click')
    expect(put).not.toHaveBeenCalled()
    expect(state.toastAdd).toHaveBeenCalledWith({
      title: 'Error', description: 'Enter a Portal root URL using HTTPS, or HTTP on localhost.', color: 'error'
    })
  })

  it('explains an invalid API credential after Save is clicked', async () => {
    const wrapper = mount(PortalConnection, { props: { agencyId: '1', section: 'connection', enabled: true } })
    await flushPromises()
    await wrapper.get('input[name="portalKey"]').setValue('invalid-key')
    await button(wrapper, 'Save connection').trigger('click')
    expect(put).not.toHaveBeenCalled()
    expect(state.toastAdd).toHaveBeenCalledWith({
      title: 'Error', description: 'Enter a Portal integration key: gcs_ followed by 43 letters, numbers, hyphens or underscores.', color: 'error'
    })
  })

  it('reports a saved connection even if the organization refresh fails', async () => {
    post.mockRejectedValue(new Error('Portal unavailable'))
    const wrapper = mount(PortalConnection, { props: { agencyId: '1', section: 'connection', enabled: true } })
    await flushPromises()
    await button(wrapper, 'Save connection').trigger('click')
    await flushPromises()
    expect(state.toastAdd).toHaveBeenCalledWith({
      title: 'Success', description: 'Connection saved. A credential is stored for this agency.', color: 'success'
    })
    expect(state.toastAdd).toHaveBeenCalledWith({
      title: 'Error', description: 'Portal organizations could not be refreshed.', color: 'error'
    })
  })


  it('uses host tables for agreement and status deliveries and filters agreement records', async () => {
    const defaultGet = get.getMockImplementation()!
    get.mockImplementation(async (path: string) => path.endsWith('/backlog')
      ? { backlog: [
        { id: 'first', agreementId: '51', organizationId: 'N-ALPHA', state: 'delivered', attempts: 1, nextAttemptAt: new Date().toISOString(), lastError: null },
        { id: 'second', agreementId: '52', organizationId: 'N-BETA', state: 'queued', attempts: 0, nextAttemptAt: new Date().toISOString(), lastError: null }
      ], outcomes: [
        { id: 'outcome', submissionId: 'S-123', kind: 'claim', state: 'queued', attempts: 0, nextAttemptAt: new Date().toISOString(), lastError: null }
      ], inbound: [] }
      : defaultGet(path))
    const wrapper = mount(PortalConnection, { props: { agencyId: '1', section: 'queue', enabled: true } })
    await flushPromises()
    expect(wrapper.findAll('[data-resource-table]')).toHaveLength(2)
    expect(wrapper.findAll('[data-table-row]')).toHaveLength(3)
    await wrapper.get('input[aria-label="Search agreement deliveries"]').setValue('N-BETA')
    expect(wrapper.findAll('[data-table-row]')).toHaveLength(2)
    expect(wrapper.find('[data-table-row="first"]').exists()).toBe(false)
    expect(wrapper.find('[data-table-row="second"]').exists()).toBe(true)
    expect(wrapper.find('[data-table-row="outcome"]').exists()).toBe(true)
  })

  it('opens an agency delivery detail with the saved agreement payload', async () => {
    const defaultGet = get.getMockImplementation()!
    get.mockImplementation(async (path: string) => path.endsWith('/backlog')
      ? { backlog: [{ id: '17', agreementId: '51', organizationId: 'N-ABCDE', state: 'delivered',
        attempts: 1, nextAttemptAt: new Date().toISOString(), lastError: null }], outcomes: [], inbound: [] }
      : path.endsWith('/backlog/17')
        ? { id: '17', agreementId: '51', organizationId: 'N-ABCDE', state: 'delivered', attempts: 1,
          createdAt: '2026-09-26T15:00:00Z', deliveredAt: '2026-09-26T15:30:00Z',
          lastError: null, payload: { agreement: {
            agreementNumber: 'HC-51', nameEn: 'Community agreement', nameFr: 'Entente communautaire',
            streamId: 'stream-1', config: { fiscalYears: [{ id: 'year-1', startYear: 2026 }],
              budgetLines: [{ id: 'line-1', nameEn: 'Outreach', nameFr: 'Sensibilisation',
                fiscalYearId: 'year-1', budgetedAmount: '1200', currency: 'CAD' }] }
          } } }
        : defaultGet(path))
    const wrapper = mount(PortalConnection, { props: { agencyId: '1', section: 'queue', enabled: true } })
    await flushPromises()
    await wrapper.get('button[aria-label="View delivery details"]').trigger('click')
    await flushPromises()
    expect(get).toHaveBeenCalledWith('/agencies/1/backlog/17')
    expect(wrapper.get('[role="dialog"]').text()).toContain('Community agreement')
    expect(wrapper.get('[role="dialog"]').text()).toContain('Outreach')
    expect(wrapper.get('[role="dialog"]').text()).toContain('2026')
    expect(wrapper.get('[role="dialog"]').text()).toContain('CA$1,200.00')
    expect(wrapper.get('[role="dialog"]').text()).toContain('saved when this delivery succeeded')
  })

  it('shows only unverified organizations in the searchable table', async () => {
    const defaultGet = get.getMockImplementation()!
    get.mockImplementation(async (path: string) => path.endsWith('/organizations')
      ? { organizations: [
        { id: 'N-OPEN', name: 'Open organization', description: '', ownerName: 'Owner', ownerEmail: 'owner@example.ca',
          memberCount: 1, agreementCount: 0, active: true, verified: false, proponentId: null, note: null,
          verifiedAt: null, syncedAt: new Date().toISOString() },
        { id: 'N-DONE', name: 'Verified organization', description: '', ownerName: 'Owner', ownerEmail: 'owner@example.ca',
          memberCount: 1, agreementCount: 0, active: true, verified: true, proponentId: '7', note: 'Done',
          verifiedAt: new Date().toISOString(), syncedAt: new Date().toISOString() }
      ] }
      : defaultGet(path))
    const wrapper = mount(PortalConnection, { props: { agencyId: '1', section: 'verification', enabled: true } })
    await flushPromises()
    expect(wrapper.findAll('[data-organization-row]')).toHaveLength(1)
    expect(wrapper.get('[data-organization-row]').attributes('data-organization-row')).toBe('N-OPEN')
    await wrapper.get('input[aria-label="Search Portal organizations"]').setValue('Verified organization')
    expect(wrapper.findAll('[data-organization-row]')).toHaveLength(0)
  })

  it('explains when all synchronized organizations are verified', async () => {
    const defaultGet = get.getMockImplementation()!
    get.mockImplementation(async (path: string) => {
      const response = await defaultGet(path)
      return path.endsWith('/organizations')
        ? { organizations: response.organizations.map((item: Record<string, unknown>) => ({ ...item, verified: true })) }
        : response
    })
    const wrapper = mount(PortalConnection, { props: { agencyId: '1', section: 'verification', enabled: true } })
    await flushPromises()
    expect(wrapper.find('[data-resource-table]').exists()).toBe(false)
    expect(wrapper.text()).toContain('No unverified Portal organizations are available.')
  })

  it('filters the host organization table by name and code', async () => {
    const wrapper = mount(PortalConnection, { props: { agencyId: '1', section: 'verification', enabled: true } })
    await flushPromises()
    expect(wrapper.findAll('[data-organization-row]')).toHaveLength(1)
    await wrapper.get('input[aria-label="Search Portal organizations"]').setValue('n-abcde')
    expect(wrapper.findAll('[data-organization-row]')).toHaveLength(1)
    await wrapper.get('input[aria-label="Search Portal organizations"]').setValue('unrelated')
    expect(wrapper.findAll('[data-organization-row]')).toHaveLength(0)
    expect(wrapper.text()).toContain('No matching Portal organizations.')
  })

  it('shows the host success toast after refreshing portal organizations', async () => {
    const wrapper = mount(PortalConnection, { props: { agencyId: '1', section: 'verification', enabled: true } })
    await flushPromises()
    await button(wrapper, 'Refresh Portal organizations').trigger('click')
    await flushPromises()
    expect(state.toastAdd).toHaveBeenCalledWith({
      title: 'Success', description: 'Portal organizations refreshed.', color: 'success'
    })
    expect(wrapper.find('[role="status"]').exists()).toBe(false)
  })

  it.each([
    ['text', 'maxLength', 'maxLength-error', 'Enter a whole number from 1 to 5000.'],
    ['list', 'maxItems', 'maxItems-error', 'Enter a whole number from 1 to 50.'],
    ['table', 'maxRows', 'maxRows-error', 'Enter a whole number from 1 to 100.']
  ])('renders required %s limits and blocks a cleared limit at the survey validation boundary', async (type, name, errorId, errorText) => {
    const wrapper = mount(FormCreator, { props: { agencyId: '1' } })
    await flushPromises()
    await wrapper.get('input[name="formTitleEn"]').setValue('Title')
    await wrapper.get('input[name="formTitleFr"]').setValue('Titre')
    await wrapper.get('select[name="newQuestionType"]').setValue(type)
    const limit = wrapper.get(`input[name="${name}"]`)
    expect(limit.attributes('required')).toBeDefined()
    await limit.setValue('')
    expect(wrapper.get(`input[name="${name}"]`).element).toHaveProperty('value', '')
    expect(wrapper.get(`input[name="${name}"]`).attributes('aria-describedby')).toBe(errorId)
    expect(wrapper.get(`#${errorId}`).text()).toBe(errorText)
    await button(wrapper, 'Save form revision').trigger('click')
    expect(post).not.toHaveBeenCalled()
  })

  it('identifies computed sources as a required group and requires one before save', async () => {
    const wrapper = mount(FormCreator, { props: { agencyId: '1' } })
    await flushPromises()
    await wrapper.get('input[name="formTitleEn"]').setValue('Title')
    await wrapper.get('input[name="formTitleFr"]').setValue('Titre')
    await wrapper.get('select[name="newQuestionType"]').setValue('text')
    await wrapper.get('select[name="newQuestionType"]').setValue('computed')
    const group = wrapper.get('[role="group"][aria-labelledby="computed-sources-label"]')
    expect(group.attributes('aria-describedby')).toBe('computed-sources-help')
    expect(wrapper.get('#computed-sources-label').text()).toContain('(required)')
    await button(wrapper, 'Save form revision').trigger('click')
    expect(post).not.toHaveBeenCalled()
    await group.get('input[type="checkbox"]').setValue(true)
    await button(wrapper, 'Save form revision').trigger('click')
    expect(post).toHaveBeenCalledWith('/agencies/1/forms', expect.objectContaining({
      definition: expect.objectContaining({ questions: expect.arrayContaining([expect.objectContaining({ type: 'computed', sourceIds: [expect.any(String)] })]) })
    }))
  })

  it('requires a selected synchronized organization, Proponent and note before irreversible verification', async () => {
    const wrapper = mount(PortalConnection, { props: { agencyId: '1', section: 'verification', enabled: true } })
    await flushPromises()
    expect(hostGet).toHaveBeenCalledWith('/api/applicant-recipients?limit=20')
    expect(wrapper.find('input[name="organizationCode"]').exists()).toBe(false)
    await button(wrapper, 'Verify').trigger('click')
    expect(wrapper.get('[role="dialog"]').text()).toContain('cannot be undone')
    await wrapper.get('input[name="proponentSearch"]').setValue('Recipient')
    await button(wrapper, 'Search').trigger('click')
    expect(hostGet).toHaveBeenCalledWith('/api/applicant-recipients?limit=20&search=Recipient')
    expect(wrapper.get('select[name="proponentId"]').attributes('required')).toBeDefined()
    expect(wrapper.get('textarea[name="note"]').attributes('required')).toBeDefined()
    expect(button(wrapper, 'Confirm permanent link').attributes('disabled')).toBeDefined()
    await wrapper.get('select[name="proponentId"]').setValue('7')
    await wrapper.get('textarea[name="note"]').setValue('Confirmed against signed correspondence.')
    expect(button(wrapper, 'Confirm permanent link').attributes('disabled')).toBeUndefined()
    await button(wrapper, 'Confirm permanent link').trigger('click')
    expect(post).toHaveBeenCalledWith('/agencies/1/organizations', {
      organizationId: 'N-ABCDE', proponentId: '7', note: 'Confirmed against signed correspondence.'
    })
  })

  it('validates the manually chosen queue push count', async () => {
    const wrapper = mount(PortalConnection, { props: { agencyId: '1', section: 'queue', enabled: true } })
    await flushPromises()
    await wrapper.get('input[name="pushCount"]').setValue('')
    expect(wrapper.get('input[name="pushCount"]').attributes('required')).toBeDefined()
    expect(wrapper.get('#push-count-error').text()).toBe('Enter a whole number from 1 to 100.')
    expect(button(wrapper, 'Push pending items').attributes('disabled')).toBeDefined()
    await wrapper.get('input[name="pushCount"]').setValue('11')
    await button(wrapper, 'Push pending items').trigger('click')
    expect(post).toHaveBeenCalledWith('/agencies/1/backlog', { limit: 11 })
  })

  it('renders verification requirements and queue validation in French', async () => {
    state.locale = 'fr'
    const wrapper = mount(PortalConnection, { props: { agencyId: '1', section: 'verification', enabled: true } })
    await flushPromises()
    await button(wrapper, 'Vérifier').trigger('click')
    expect(wrapper.get('[data-field="note"] label').text()).toContain('vérifié')
    expect(wrapper.get('textarea[name="note"]').attributes('required')).toBeDefined()
    await wrapper.setProps({ section: 'queue' })
    await wrapper.get('input[name="pushCount"]').setValue('')
    expect(wrapper.get('#push-count-error').text()).toBe('Saisissez un nombre entier de 1 à 100.')
  })
})

describe('Proponent verification entry', () => {
  it('shows the saved verification with its verifier, time, and note without an organization picker', async () => {
    const defaultGet = get.getMockImplementation()!
    get.mockImplementation(async (path: string) => path.endsWith('/verification')
      ? { verifications: [{ organizationId: 'N-ABCDE', organizationName: 'Test organization',
        originAgencyId: '1', note: 'Checked signed records.', verifiedAt: '2026-09-26T15:30:00.000Z',
        active: true, verifierName: 'Alex Manager', verifierEmail: 'alex@example.com' }] }
      : defaultGet(path))
    const wrapper = mount(ProponentVerification, { props: { context: {
      target: 'proponent', applicantRecipientId: '7', ownerType: 'applicantrecipient', ownerId: '7',
      agencies: [{ agencyId: '1', nameEn: 'Agency One', nameFr: 'Agence un', config: {} }]
    } } })
    await flushPromises()
    expect(get).toHaveBeenCalledWith('/agencies/1/proponents/7/verification')
    expect(wrapper.text()).toContain('Current verification')
    expect(wrapper.text()).toContain('Test organization')
    expect(wrapper.text()).toContain('Alex Manager')
    expect(wrapper.text()).toContain('alex@example.com')
    expect(wrapper.text()).toContain('Checked signed records.')
    expect(wrapper.get('time').attributes('datetime')).toBe('2026-09-26T15:30:00.000Z')
    expect(wrapper.find('input[name="organizationSearch"]').exists()).toBe(false)
    expect(get).not.toHaveBeenCalledWith('/agencies/1/organizations')
  })

  it('keeps an inactive verification visible while allowing an eligible replacement search', async () => {
    const defaultGet = get.getMockImplementation()!
    get.mockImplementation(async (path: string) => path.endsWith('/verification')
      ? { verifications: [{ organizationId: 'N-OLDXX', organizationName: 'Previous organization',
        originAgencyId: '1', note: 'Original check.', verifiedAt: '2025-09-26T15:30:00.000Z',
        active: false, verifierName: null }] }
      : defaultGet(path))
    hostGet.mockImplementation(async (path: string) => path.startsWith('/api/extensions/agency/')
      ? { items: [{ extension: { key: 'gcs-ssc-portal-connector' },
        config: { portalProponentVerificationAccess: 'contributor' }, canConfigure: false }] }
      : { can_update: true })
    const wrapper = mount(ProponentVerification, { props: { context: {
      target: 'proponent', applicantRecipientId: '7', ownerType: 'applicantrecipient', ownerId: '7',
      agencies: [{ agencyId: '1', nameEn: 'Agency One', nameFr: 'Agence un', config: {} }]
    } } })
    await flushPromises()
    expect(wrapper.text()).toContain('Previous verification')
    expect(wrapper.text()).toContain('Original check.')
    expect(wrapper.text()).toContain('Verifier not recorded')
    expect(wrapper.find('input[name="organizationSearch"]').exists()).toBe(true)
    expect(wrapper.find('[data-resource-table]').exists()).toBe(false)
  })

  it('searches before showing choices, then requires a note to verify', async () => {
    hostGet.mockImplementation(async (path: string) => path.startsWith('/api/extensions/agency/')
      ? { items: [{ extension: { key: 'gcs-ssc-portal-connector' },
        config: { portalProponentVerificationAccess: 'contributor' }, canConfigure: false }] }
      : { can_update: true })
    let verified = false
    const defaultGet = get.getMockImplementation()!
    get.mockImplementation(async (path: string) => path.endsWith('/verification')
      ? { verifications: verified ? [{ organizationId: 'N-ABCDE', organizationName: 'Test organization',
        originAgencyId: '1', note: 'Verified with agency records.', verifiedAt: '2026-09-26T15:30:00.000Z',
        active: true, verifierName: 'Alex Manager' }] : [] }
      : defaultGet(path))
    post.mockImplementation(async () => { verified = true; return { verified: true } })
    const wrapper = mount(ProponentVerification, { props: { context: {
      target: 'proponent', applicantRecipientId: '7', ownerType: 'applicantrecipient', ownerId: '7',
      agencies: [{ agencyId: '1', nameEn: 'Agency One', nameFr: 'Agence un', config: {} }]
    } } })
    await flushPromises()
    expect(wrapper.find('[data-resource-table]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('cannot be undone')
    await wrapper.get('input[name="organizationSearch"]').setValue('no match')
    await button(wrapper, 'Search').trigger('click')
    expect(wrapper.text()).toContain('No matching Portal organizations.')
    await wrapper.get('input[name="organizationSearch"]').setValue('n-abcde')
    expect(wrapper.find('[data-resource-table]').exists()).toBe(false)
    await button(wrapper, 'Search').trigger('click')
    expect(wrapper.findAll('[data-table-row]')).toHaveLength(1)
    await button(wrapper, 'Verify').trigger('click')
    expect(wrapper.get('[role="dialog"]').text()).toContain('cannot be undone')
    expect(wrapper.get('textarea[name="note"]').attributes('required')).toBeDefined()
    expect(button(wrapper, 'Confirm permanent link').attributes('disabled')).toBeDefined()
    await wrapper.get('textarea[name="note"]').setValue('Verified with agency records.')
    await button(wrapper, 'Confirm permanent link').trigger('click')
    await flushPromises()
    expect(post).toHaveBeenCalledWith('/agencies/1/proponents/7/verification', {
      organizationId: 'N-ABCDE', proponentId: '7', note: 'Verified with agency records.'
    })
    expect(wrapper.text()).toContain('Current verification')
    expect(wrapper.find('input[name="organizationSearch"]').exists()).toBe(false)
    expect(state.toastAdd).toHaveBeenCalledWith({
      title: 'Success', description: 'Portal organization linked to this Proponent.', color: 'success'
    })
  })

  it('hides linking from a Contributor when the setting allows Managers only', async () => {
    hostGet.mockImplementation(async (path: string) => path.startsWith('/api/extensions/agency/')
      ? { items: [{ extension: { key: 'gcs-ssc-portal-connector' },
        config: { portalProponentVerificationAccess: 'manager' }, canConfigure: false }] }
      : { can_update: true })
    const wrapper = mount(ProponentVerification, { props: { context: {
      target: 'proponent', applicantRecipientId: '7', ownerType: 'applicantrecipient', ownerId: '7',
      agencies: [{ agencyId: '1', nameEn: 'Agency One', nameFr: 'Agence un', config: {} }]
    } } })
    await flushPromises()
    expect(wrapper.find('input[name="organizationSearch"]').exists()).toBe(false)
  })

  it('combines eligible agencies and sends verification through the organization source agency', async () => {
    const defaultGet = get.getMockImplementation()!
    get.mockImplementation(async (path: string) => path.endsWith('/organizations')
      ? { organizations: [{
        id: path.includes('/agencies/2/') ? 'N-TWO' : 'N-ONE',
        name: path.includes('/agencies/2/') ? 'Second organization' : 'First organization',
        description: '', ownerName: 'Owner', ownerEmail: 'owner@example.ca', memberCount: 1,
        agreementCount: 0, active: true, verified: false, proponentId: null, note: null, verifiedAt: null
      }] }
      : defaultGet(path))
    hostGet.mockImplementation(async (path: string) => path.startsWith('/api/extensions/agency/')
      ? { items: [{ extension: { key: 'gcs-ssc-portal-connector' },
        config: { portalProponentVerificationAccess: 'contributor' }, canConfigure: false }] }
      : { can_update: true })
    const wrapper = mount(ProponentVerification, { props: { context: {
      target: 'proponent', applicantRecipientId: '7', ownerType: 'applicantrecipient', ownerId: '7',
      agencies: [
        { agencyId: '1', nameEn: 'Agency One', nameFr: 'Agence un', config: {} },
        { agencyId: '2', nameEn: 'Agency Two', nameFr: 'Agence deux', config: {} }
      ]
    } } })
    await flushPromises()
    expect(wrapper.text()).not.toContain('First organization')
    expect(wrapper.text()).not.toContain('Second organization')
    await wrapper.get('input[name="organizationSearch"]').setValue('Second organization')
    await button(wrapper, 'Search').trigger('click')
    expect(wrapper.text()).not.toContain('First organization')
    expect(wrapper.text()).toContain('Second organization')
    await button(wrapper, 'Verify').trigger('click')
    await wrapper.get('textarea[name="note"]').setValue('Confirmed.')
    await button(wrapper, 'Confirm permanent link').trigger('click')
    expect(post).toHaveBeenCalledWith('/agencies/2/proponents/7/verification', {
      organizationId: 'N-TWO', proponentId: '7', note: 'Confirmed.'
    })
  })
})
