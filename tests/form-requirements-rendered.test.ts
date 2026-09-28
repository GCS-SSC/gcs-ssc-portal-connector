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
    props: ['label', 'name', 'required', 'description', 'error'],
    setup(props, { slots }) {
      return () => h('div', { 'data-field': props.name }, [
        h('label', { for: props.name }, `${props.label}${props.required ? ' (required)' : ''}`),
        props.description ? h('p', props.description) : null,
        props.error ? h('p', { role: 'alert' }, props.error) : null,
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
    setup(props, { attrs, emit, slots }) {
      return () => h('button', { ...attrs, disabled: props.disabled, onClick: () => emit('click') }, props.label ?? slots.default?.())
    }
  })
  const workspace = defineComponent({
    setup(_, { slots }) { return () => h('div', { 'data-form-workspace': '' }, [slots.sidebar?.(), slots.default?.()]) }
  })
  const routeTabs = defineComponent({
    props: ['modelValue', 'items'], emits: ['update:modelValue'],
    setup(props, { emit }) { return () => h('nav', { 'aria-label': 'Form workflow' },
      (props.items as Array<{ value: string; label: string }>).map(item => h('button', {
        role: 'tab', 'aria-selected': props.modelValue === item.value,
        onClick: () => emit('update:modelValue', item.value)
      }, item.label))) }
  })
  const resourceTable = defineComponent({
    props: ['data', 'columns', 'search', 'pagination', 'searchPlaceholder', 'showToolbar'], emits: ['update:search', 'update:pagination'],
    setup(props, { slots, emit }) {
      return () => h('div', { 'data-resource-table': '' }, [
        ...(props.showToolbar === false ? [] : [h('input', { 'aria-label': props.searchPlaceholder, value: props.search,
          onInput: (event: Event) => emit('update:search', (event.target as HTMLInputElement).value) })]),
        slots.filters?.(), slots.actions?.(),
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
    ExtensionEntityEditorWorkspace: workspace, ExtensionRouteTabs: routeTabs,
    ExtensionBadge: defineComponent({ setup(_, { slots }) { return () => h('span', slots.default?.()) } }),
    ExtensionAlert: defineComponent({ props: ['title'], setup(props, { slots }) {
      return () => h('div', { role: 'alert' }, [h('strong', props.title), slots.description?.()])
    } })
  }
})

import FormCreator from '../components/FormCreator.vue'
import FormLibrary from '../components/FormLibrary.vue'
import IntakeWorkspace from '../components/IntakeWorkspace.vue'
import FormTest from '../components/FormTest.vue'
import { readFormDraft } from '../components/form-draft-session'
import PortalConnection from '../components/PortalConnection.vue'
import ProponentVerification from '../components/ProponentVerification.vue'

const button = (wrapper: ReturnType<typeof mount>, label: string) => wrapper.findAll('button').find(item => item.text() === label)!

beforeEach(() => {
  window.sessionStorage.clear()
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
  it('uses the shared forms table and keeps search, status, and row navigation working', async () => {
    const defaultGet = get.getMockImplementation()!
    get.mockImplementation(async (path: string) => path.endsWith('/forms')
      ? { surveys: [
        { id: 'draft_form', revision: 1, title: { en: 'Draft form', fr: 'Formulaire brouillon' }, updatedAt: '2026-09-28T00:00:00Z' },
        { id: 'published_form', revision: 2, title: { en: 'Published form', fr: 'Formulaire publié' }, updatedAt: '2026-09-27T00:00:00Z' }
      ], publications: [{ surveyId: 'published_form', revision: 2, targetType: 'organization', targetId: 'N-123',
        targetNameEn: 'Example organization', targetNameFr: 'Organisme exemple', published: true }] }
      : defaultGet(path))
    const wrapper = mount(FormLibrary, { props: { agencyId: '1' } })
    await flushPromises()
    expect(wrapper.find('[data-resource-table]').exists()).toBe(true)
    expect(wrapper.findAll('[data-table-row]')).toHaveLength(2)
    await wrapper.get('input[aria-label="Search forms"]').setValue('Draft')
    expect(wrapper.findAll('[data-table-row]')).toHaveLength(1)
    await wrapper.get('input[aria-label="Search forms"]').setValue('')
    await wrapper.get('select').setValue('published')
    expect(wrapper.findAll('[data-table-row]')).toHaveLength(1)
    expect(wrapper.text()).toContain('Published form')
    await wrapper.get('button[aria-label="Edit form: Published form"]').trigger('click')
    expect(wrapper.emitted('open')?.[0]).toEqual(['published_form'])
  })

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
    expect(button(wrapper, 'Edit').attributes('aria-selected')).toBe('true')
    await button(wrapper, 'Settings').trigger('click')
    await wrapper.get('input[name="formTitleEn"]').setValue('Title')
    await wrapper.get('input[name="formTitleFr"]').setValue('Titre')
    await button(wrapper, 'Edit').trigger('click')
    await wrapper.findAll('.designer-type').find(item => item.text().includes(({ text: 'Short answer', list: 'Repeating list', table: 'Table' } as Record<string, string>)[type]!))!.trigger('click')
    const limit = wrapper.get(`input[name="${name}"]`)
    expect(limit.attributes('required')).toBeDefined()
    await limit.setValue('')
    expect(wrapper.get(`input[name="${name}"]`).element).toHaveProperty('value', '')
    expect(wrapper.get(`input[name="${name}"]`).attributes('aria-describedby')).toBe(errorId)
    expect(wrapper.get(`#${errorId}`).text()).toBe(errorText)
    await button(wrapper, 'Save revision').trigger('click')
    expect(post).not.toHaveBeenCalled()
  })

  it('identifies computed sources as a required group and requires one before save', async () => {
    const wrapper = mount(FormCreator, { props: { agencyId: '1' } })
    await flushPromises()
    await button(wrapper, 'Settings').trigger('click')
    await wrapper.get('input[name="formTitleEn"]').setValue('Title')
    await wrapper.get('input[name="formTitleFr"]').setValue('Titre')
    await button(wrapper, 'Edit').trigger('click')
    await wrapper.findAll('.designer-type').find(item => item.text().includes('Short answer'))!.trigger('click')
    await wrapper.findAll('.designer-type').find(item => item.text().includes('Calculated value'))!.trigger('click')
    const group = wrapper.get('[role="group"][aria-labelledby="computed-sources-label"]')
    expect(group.attributes('aria-describedby')).toBe('computed-sources-help')
    expect(wrapper.get('#computed-sources-label').text()).toContain('(required)')
    await button(wrapper, 'Save revision').trigger('click')
    expect(post).not.toHaveBeenCalled()
    await group.get('input[type="checkbox"]').setValue(true)
    await button(wrapper, 'Save revision').trigger('click')
    expect(post, wrapper.text()).toHaveBeenCalledWith('/agencies/1/forms', expect.objectContaining({
      definition: expect.objectContaining({ questions: expect.arrayContaining([expect.objectContaining({
        type: 'computed', sourceIds: [expect.any(String)], template: expect.stringMatching(/^\{\{field_[a-z0-9]+\}\}$/)
      })]) })
    }))
  })

  it('asks before leaving a new form with unsaved changes', async () => {
    const confirm = vi.fn().mockReturnValue(false)
    vi.stubGlobal('confirm', confirm)
    try {
      const wrapper = mount(FormCreator, { props: { agencyId: '1' } })
      await flushPromises()
      await button(wrapper, 'Settings').trigger('click')
      await wrapper.get('input[name="formTitleEn"]').setValue('Draft title')
      await button(wrapper, '← All forms').trigger('click')
      expect(confirm).toHaveBeenCalled()
      expect(wrapper.emitted('close')).toBeUndefined()
      confirm.mockReturnValue(true)
      await button(wrapper, '← All forms').trigger('click')
      expect(wrapper.emitted('close')).toHaveLength(1)
    } finally { vi.unstubAllGlobals() }
  })

  it('keeps other-form destinations in the form designer', async () => {
    const wrapper = mount(FormCreator, { props: { agencyId: '1' } })
    await flushPromises()
    await button(wrapper, 'Publish').trigger('click')
    const headings = wrapper.findAll('h4').map((heading) => heading.text())
    expect(headings.indexOf('Publish to portal')).toBeGreaterThan(-1)
    expect(headings).not.toContain('Publish a funding opportunity')
  })

  it('creates an intake before its form and publishes the attached revision', async () => {
    let intake: Record<string, unknown> | null = null
    const defaultGet = get.getMockImplementation()!
    get.mockImplementation(async (path: string) => path.endsWith('/intakes')
      ? { intakes: intake ? [intake] : [], streams: [{ id: 'S-ABCDE', nameEn: 'Community', nameFr: 'Communauté' }] }
      : defaultGet(path))
    post.mockImplementation(async (_path: string, body: Record<string, unknown>) => {
      if (body.action === 'create') {
        intake = { id: 'D-ABCDE', published: false, surveyId: null, surveyRevision: null,
          ...body, action: undefined }
        return { intakeId: 'D-ABCDE' }
      }
      if (body.action === 'save') {
        intake = { ...intake, surveyId: 'V-ABCDE', surveyRevision: 1 }
        return { survey: { id: 'V-ABCDE', revision: 1 } }
      }
      if (body.action === 'publish') {
        intake = { ...intake, published: true }
        return { intakeId: 'D-ABCDE', published: true }
      }
      return {}
    })
    const wrapper = mount(IntakeWorkspace, { props: { agencyId: '1' } })
    await flushPromises()
    await button(wrapper, 'Create intake opportunity').trigger('click')
    expect(wrapper.get('input[name="intakeNameEn"]').attributes('required')).toBeDefined()
    expect(wrapper.text()).toContain('Opportunity name in French')
    await button(wrapper, 'Save intake').trigger('click')
    expect(post).not.toHaveBeenCalled()
    expect(wrapper.get('input[name="intakeNameEn"]').attributes('aria-invalid')).toBe('true')
    expect(wrapper.text()).toContain('Complete this field.')
    await wrapper.get('input[name="intakeNameEn"]').setValue('Community intake')
    await wrapper.get('input[name="intakeNameFr"]').setValue('Appel communautaire')
    await wrapper.get('select[name="intakeStream"]').setValue('S-ABCDE')
    await wrapper.get('input[name="intakeStartDate"]').setValue('2027-01-01')
    await wrapper.get('input[name="intakeEndDate"]').setValue('2027-12-31')
    await button(wrapper, 'Save intake').trigger('click')
    await flushPromises()
    expect(post.mock.calls[0]?.[1]).toMatchObject({ action: 'create', streamId: 'S-ABCDE',
      nameEn: 'Community intake', nameFr: 'Appel communautaire' })
    await button(wrapper, 'Create application form').trigger('click')
    await flushPromises()
    await button(wrapper, 'Settings').trigger('click')
    await wrapper.get('input[name="formTitleEn"]').setValue('Application')
    await wrapper.get('input[name="formTitleFr"]').setValue('Demande')
    await button(wrapper, 'Edit').trigger('click')
    await wrapper.findAll('.designer-type').find(item => item.text().includes('Short answer'))!.trigger('click')
    await button(wrapper, 'Save revision').trigger('click')
    await flushPromises()
    expect(post.mock.calls.some(([, body]) => (body as Record<string, unknown>).action === 'save'
      && (body as Record<string, unknown>).intakeId === 'D-ABCDE')).toBe(true)
    await button(wrapper, '← Back to intake').trigger('click')
    await button(wrapper, 'Publish intake and form').trigger('click')
    await flushPromises()
    expect(post.mock.calls.at(-1)?.[1]).toEqual({ action: 'publish', intakeId: 'D-ABCDE' })
    expect(wrapper.text()).toContain('Published')
  })

  it('shows French intake labels and validation errors with required control semantics', async () => {
    state.locale = 'fr'
    const defaultGet = get.getMockImplementation()!
    get.mockImplementation(async (path: string) => path.endsWith('/intakes')
      ? { intakes: [], streams: [{ id: 'S-ABCDE', nameEn: 'Community', nameFr: 'Communauté' }] }
      : defaultGet(path))
    const wrapper = mount(IntakeWorkspace, { props: { agencyId: '1' } })
    await flushPromises()
    await button(wrapper, 'Créer un appel de demandes').trigger('click')
    expect(wrapper.text()).toContain('Nom de l’occasion en français')
    await button(wrapper, 'Enregistrer l’appel').trigger('click')
    expect(wrapper.get('input[name="intakeNameFr"]').attributes('required')).toBeDefined()
    expect(wrapper.get('input[name="intakeNameFr"]').attributes('aria-invalid')).toBe('true')
    expect(wrapper.text()).toContain('Remplissez ce champ.')
  })

  it('keeps the existing intake Stream read-only and validates date order before mutation', async () => {
    const defaultGet = get.getMockImplementation()!
    get.mockImplementation(async (path: string) => path.endsWith('/intakes')
      ? { intakes: [{ id: 'D-ABCDE', streamId: 'S-ABCDE', nameEn: 'Existing intake', nameFr: 'Appel existant',
        startDate: '2027-01-01', endDate: '2027-12-31', published: false, surveyId: null, surveyRevision: null }],
        streams: [{ id: 'S-ABCDE', nameEn: 'Community', nameFr: 'Communauté' }] }
      : defaultGet(path))
    const wrapper = mount(IntakeWorkspace, { props: { agencyId: '1' } })
    await flushPromises()
    await button(wrapper, 'Existing intake').trigger('click')
    await button(wrapper, 'Edit intake opportunity').trigger('click')
    expect(wrapper.get('select[name="intakeStream"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('select[name="intakeStream"]').attributes('required')).toBeUndefined()
    await wrapper.get('input[name="intakeEndDate"]').setValue('2026-12-31')
    await button(wrapper, 'Save intake').trigger('click')
    expect(post).not.toHaveBeenCalled()
    expect(wrapper.get('input[name="intakeEndDate"]').attributes('aria-invalid')).toBe('true')
    expect(wrapper.text()).toContain('The closing date must be on or after the opening date.')
  })

  it('keeps a saved intake form available when attachment fails and retries the same revision', async () => {
    const defaultGet = get.getMockImplementation()!
    get.mockImplementation(async (path: string) => path.endsWith('/forms')
      ? { surveys: [{ id: 'V-ABCDE', revision: 1, title: { en: 'Application', fr: 'Demande' },
        updatedAt: new Date().toISOString() }], programs: [], streams: [], agreements: [], organizations: [] }
      : defaultGet(path))
    post.mockImplementation(async (_path: string, body: Record<string, unknown>) => body.action === 'save'
      ? { survey: { id: 'V-ABCDE', revision: 1 }, attached: false }
      : { attached: true })
    const wrapper = mount(FormCreator, { props: { agencyId: '1', intakeId: 'D-ABCDE' } })
    await flushPromises()
    await button(wrapper, 'Settings').trigger('click')
    await wrapper.get('input[name="formTitleEn"]').setValue('Application')
    await wrapper.get('input[name="formTitleFr"]').setValue('Demande')
    await button(wrapper, 'Edit').trigger('click')
    await wrapper.findAll('.designer-type').find(item => item.text().includes('Short answer'))!.trigger('click')
    await button(wrapper, 'Save revision').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('could not be attached')
    expect(readFormDraft('1:intake:D-ABCDE')).toMatchObject({ formId: 'V-ABCDE', revision: 1, attachmentPending: true })
    wrapper.unmount()
    const reopened = mount(FormCreator, { props: { agencyId: '1', intakeId: 'D-ABCDE' } })
    await flushPromises()
    expect(button(reopened, 'Retry attaching form').exists()).toBe(true)
    await button(reopened, 'Retry attaching form').trigger('click')
    await flushPromises()
    expect(post.mock.calls.at(-1)?.[1]).toEqual({ action: 'attachIntakeForm', intakeId: 'D-ABCDE',
      surveyId: 'V-ABCDE', revision: 1 })
    expect(readFormDraft('1:intake:D-ABCDE')).toBeNull()
  })

  it('returns to Settings when a form introduction translation fails validation', async () => {
    const wrapper = mount(FormCreator, { props: { agencyId: '1' } })
    await flushPromises()
    await button(wrapper, 'Settings').trigger('click')
    await wrapper.get('input[name="formTitleEn"]').setValue('Project report')
    await wrapper.get('input[name="formTitleFr"]').setValue('Rapport de projet')
    await wrapper.get('textarea[name="formDescriptionEn"]').setValue('Describe the project.')
    await button(wrapper, 'Edit').trigger('click')
    await wrapper.findAll('.designer-type').find(item => item.text().includes('Short answer'))!.trigger('click')
    await button(wrapper, 'Save revision').trigger('click')
    expect(post).not.toHaveBeenCalled()
    expect(button(wrapper, 'Settings').attributes('aria-selected')).toBe('true')
    expect(wrapper.find('textarea[name="formDescriptionFr"]').exists()).toBe(true)
  })

  it('opens a new form on a detail page and restores its unsaved draft there', async () => {
    const connection = mount(PortalConnection, { props: { agencyId: '1', section: 'connection', enabled: true } })
    await flushPromises()
    expect(get).not.toHaveBeenCalledWith('/agencies/1/forms')
    connection.unmount()

    const firstForms = mount(PortalConnection, { props: { agencyId: '1', section: 'forms', enabled: true } })
    await flushPromises()
    expect(firstForms.find('[data-resource-table]').exists()).toBe(true)
    expect(firstForms.text()).toContain('No forms yet')
    expect(firstForms.get('input[aria-label="Search forms"]').attributes('aria-label')).toBe('Search forms')
    expect(button(firstForms, 'Create form')).toBeDefined()
    await button(firstForms, 'Create form').trigger('click')
    expect(firstForms.emitted('openForm')?.[0]).toEqual([''])
    expect(firstForms.find('input[name="formTitleEn"]').exists()).toBe(false)
    firstForms.unmount()

    const firstDetail = mount(PortalConnection, { props: { agencyId: '1', section: 'forms', detailFormId: '', enabled: true } })
    await flushPromises()
    expect(firstDetail.emitted('formCollectionLabel')?.[0]).toEqual(['All forms'])
    expect(button(firstDetail, 'Edit').attributes('aria-selected')).toBe('true')
    expect(firstDetail.get('[data-form-workspace] nav').text()).toContain('Publish')
    expect(firstDetail.find('.designer-back').exists()).toBe(false)
    await button(firstDetail, 'Settings').trigger('click')
    await firstDetail.get('input[name="formTitleEn"]').setValue('Unsaved draft')
    await flushPromises()
    firstDetail.unmount()

    const restored = mount(PortalConnection, { props: { agencyId: '1', section: 'forms', detailFormId: '', enabled: true } })
    await flushPromises()
    expect((restored.get('input[name="formTitleEn"]').element as HTMLInputElement).value).toBe('Unsaved draft')
    restored.unmount()
    const library = mount(PortalConnection, { props: { agencyId: '1', section: 'forms', enabled: true } })
    await flushPromises()
    expect(library.text()).toContain('No forms yet')
  })

  it('loads a newer server revision instead of restoring a stale saved-form draft', async () => {
    const latest = {
      schemaVersion: 3 as const, title: { en: 'Current version', fr: 'Version actuelle' },
      questions: [{ id: 'field_1', type: 'text' as const, label: { en: 'Question', fr: 'Question' },
        required: false, maxLength: 500 }],
      pages: [{ id: 'page_1', title: { en: 'Page 1', fr: 'Page 1' },
        questionIds: ['field_1'], groups: [], branches: [] }]
    }
    const oldDraft = structuredClone(latest)
    oldDraft.title.en = 'Unsaved older revision'
    window.sessionStorage.setItem('gcs-ssc-portal-connector:forms:1:draft', JSON.stringify({
      formId: 'form_1', revision: 1, definition: oldDraft, saved: JSON.stringify(latest),
      selectedContainerId: 'page_1', selectedQuestionId: '', tab: 'settings', publicationScope: 'agreement',
      agreementId: '', organizationId: '', programId: '', batchStreamId: '', streamId: '', startDate: '', endDate: ''
    }))
    const defaultGet = get.getMockImplementation()!
    get.mockImplementation(async (path: string) => path === '/agencies/1/forms'
      ? { surveys: [{ id: 'form_1', revision: 2, title: latest.title, updatedAt: new Date().toISOString() }],
        programs: [], streams: [], agreements: [], organizations: [], calls: [] }
      : path === '/agencies/1/forms/form_1'
        ? { survey: { id: 'form_1', revision: 2, definition: latest } }
        : defaultGet(path))
    const wrapper = mount(PortalConnection, { props: { agencyId: '1', section: 'forms', detailFormId: 'form_1', enabled: true } })
    await flushPromises()
    expect(get).toHaveBeenCalledWith('/agencies/1/forms/form_1')
    expect(wrapper.text()).toContain('Current version')
    expect(wrapper.text()).not.toContain('Unsaved older revision')
    expect(window.sessionStorage.getItem('gcs-ssc-portal-connector:forms:1:draft')).toBeNull()
  })

  it('ignores a corrupt stored draft instead of rendering malformed form data', async () => {
    window.sessionStorage.setItem('gcs-ssc-portal-connector:forms:1:draft', JSON.stringify({
      formId: '', revision: 0, saved: '{}', definition: { schemaVersion: 3, pages: [], questions: [] }
    }))
    const wrapper = mount(PortalConnection, { props: { agencyId: '1', section: 'forms', detailFormId: '', enabled: true } })
    await flushPromises()
    await button(wrapper, 'Settings').trigger('click')
    expect((wrapper.get('input[name="formTitleEn"]').element as HTMLInputElement).value).toBe('')
    expect(wrapper.text()).toContain('New form')
  })

  it('rejects invalid stored editor tab and publication scope values', () => {
    const draft = {
      formId: '', revision: 0, saved: '{}', selectedContainerId: 'page_1', selectedQuestionId: '',
      tab: 'edit', publicationScope: 'agreement', agreementId: '', organizationId: '', programId: '',
      batchStreamId: '', streamId: '', startDate: '', endDate: '',
      definition: { schemaVersion: 3, title: { en: '', fr: '' }, questions: [], pages: [{
        id: 'page_1', title: { en: 'Page 1', fr: 'Page 1' }, questionIds: [], groups: [], branches: []
      }] }
    }
    const key = 'gcs-ssc-portal-connector:forms:1:draft'
    window.sessionStorage.setItem(key, JSON.stringify({ ...draft, tab: 'unexpected' }))
    expect(readFormDraft('1')).toBeNull()
    window.sessionStorage.setItem(key, JSON.stringify({ ...draft, publicationScope: 'unexpected' }))
    expect(readFormDraft('1')).toBeNull()
    window.sessionStorage.setItem(key, JSON.stringify(draft))
    expect(readFormDraft('1')).not.toBeNull()
  })

  it('offers only earlier answers and later pages when building a branch', async () => {
    const wrapper = mount(FormCreator, { props: { agencyId: '1' } })
    await flushPromises()
    await button(wrapper, 'Edit').trigger('click')
    await wrapper.findAll('.designer-type').find(item => item.text().includes('Choice'))!.trigger('click')
    await wrapper.get('input[name="choiceEn0"]').setValue('Yes')
    await wrapper.get('.designer-outline-add').trigger('click')
    await button(wrapper, 'Add an if rule').trigger('click')
    expect(wrapper.get('.designer-flow-toggle').text()).toContain('2 pages · 1 rule')
    const questionChoices = wrapper.get('select[name="conditionQuestion0"]').findAll('option').map(item => item.text())
    expect(questionChoices).toContain('New question')
    const destinations = wrapper.get('select[name="branchDestination0"]').findAll('option').map(item => item.text())
    expect(destinations).toEqual(['End form'])
    await wrapper.get('select[name="conditionOperator0"]').setValue('equals')
    expect(wrapper.get('select[name="conditionValue0"]').findAll('option').map(item => item.text())).toEqual(['Yes'])
    await wrapper.findAll('.designer-outline-item')[0]!.trigger('click')
    expect(wrapper.get('select[name="pageNext"]').findAll('option').map(item => item.text()))
      .toEqual(['Next page in order', 'Page 2', 'End form'])
  })

  it('returns to the previous page with one click after a completed preview', async () => {
    const wrapper = mount(FormTest, { props: { locale: 'en', definition: {
      schemaVersion: 3, title: { en: 'Report', fr: 'Rapport' },
      questions: [
        { id: 'first', type: 'text', label: { en: 'First', fr: 'Premier' }, required: false, maxLength: 500 },
        { id: 'second', type: 'text', label: { en: 'Second', fr: 'Deuxième' }, required: false, maxLength: 500 }
      ],
      pages: [
        { id: 'page_1', title: { en: 'First page', fr: 'Première page' }, questionIds: ['first'], groups: [], branches: [] },
        { id: 'page_2', title: { en: 'Second page', fr: 'Deuxième page' }, questionIds: ['second'], groups: [], branches: [] }
      ]
    } } })
    await button(wrapper, 'Next').trigger('click')
    await button(wrapper, 'Check').trigger('click')
    expect(wrapper.text()).toContain('Responses are valid.')
    await button(wrapper, 'Previous').trigger('click')
    expect(wrapper.text()).toContain('Page 1 · First page')
    expect(wrapper.text()).not.toContain('Responses are valid.')
  })

  it('prevents reordering a dependent question before its source and cleans up deletion', async () => {
    const wrapper = mount(FormCreator, { props: { agencyId: '1' } })
    await flushPromises()
    await button(wrapper, 'Edit').trigger('click')
    const choice = () => wrapper.findAll('.designer-type').find(item => item.text().includes('Choice'))!
    await choice().trigger('click')
    await choice().trigger('click')
    const sourceId = wrapper.get('select[name="choiceDependency"]').findAll('option')[1]!.attributes('value')!
    await wrapper.get('select[name="choiceDependency"]').setValue(sourceId)
    expect(button(wrapper, 'Move up').attributes('disabled')).toBeDefined()
    await wrapper.findAll('.designer-question')[0]!.trigger('click')
    await button(wrapper, 'Remove question').trigger('click')
    await wrapper.get('.designer-question').trigger('click')
    expect((wrapper.get('select[name="choiceDependency"]').element as HTMLSelectElement).value).toBe('none')
    expect(wrapper.text()).toContain('Rules and dependencies using it were updated')
  })

  it('retargets a calculated template when its referenced source is deleted', async () => {
    const wrapper = mount(FormCreator, { props: { agencyId: '1' } })
    await flushPromises()
    await button(wrapper, 'Edit').trigger('click')
    const addType = (label: string) => wrapper.findAll('.designer-type').find(item => item.text().includes(label))!
    await addType('Short answer').trigger('click')
    await addType('Short answer').trigger('click')
    await addType('Calculated value').trigger('click')
    const sources = wrapper.get('[role="group"][aria-labelledby="computed-sources-label"]')
    const secondId = sources.findAll('label')[1]!.text().match(/\((field_[a-z0-9]+)\)/)?.[1]
    expect(secondId).toBeTruthy()
    await sources.findAll('input[type="checkbox"]')[0]!.setValue(true)
    await sources.findAll('input[type="checkbox"]')[1]!.setValue(true)
    await wrapper.findAll('.designer-question')[0]!.trigger('click')
    await button(wrapper, 'Remove question').trigger('click')
    await wrapper.findAll('.designer-question')[1]!.trigger('click')
    expect((wrapper.get('input[name="computedTemplate"]').element as HTMLInputElement).value).toBe(`{{${secondId}}}`)
  })

  it('clears page routes when an empty destination page is removed', async () => {
    const wrapper = mount(FormCreator, { props: { agencyId: '1' } })
    await flushPromises()
    await button(wrapper, 'Edit').trigger('click')
    await wrapper.get('.designer-outline-add').trigger('click')
    await wrapper.findAll('.designer-outline-item')[0]!.trigger('click')
    await wrapper.get('select[name="pageNext"]').setValue(wrapper.get('select[name="pageNext"]').findAll('option')
      .find((item) => item.text() === 'Page 2')!.attributes('value')!)
    await wrapper.findAll('.designer-outline-item')[1]!.trigger('click')
    await button(wrapper, 'Remove empty group or page').trigger('click')
    expect((wrapper.get('select[name="pageNext"]').element as HTMLSelectElement).value).toBe('next')
    expect(wrapper.text()).toContain('Navigation to that page was updated')
  })

  it('opens the page flow map and selects a page for editing', async () => {
    const wrapper = mount(FormCreator, { props: { agencyId: '1' } })
    await flushPromises()
    await button(wrapper, 'Edit').trigger('click')
    await wrapper.get('.designer-outline-add').trigger('click')
    await wrapper.get('.designer-flow-toggle').trigger('click')
    expect(wrapper.findAll('.flow-page-node')).toHaveLength(2)
    await wrapper.findAll('.flow-page-node')[0]!.trigger('click')
    expect(wrapper.findAll('.designer-outline-item')[0]!.attributes('aria-current')).toBe('location')
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
