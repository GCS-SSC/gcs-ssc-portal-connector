import { reactive } from 'vue'
// @vitest-environment jsdom
import { FetchResponseError, translateGcsExtensionMessage, type GcsExtensionMessages } from '@gcs-ssc/extensions'
import { instanceKey, resolveAdvancedSurvey, surveyV3Schema } from '@gcs-ssc/survey'
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
      return () => h('button', { ...attrs, disabled: props.disabled, onClick: (event: MouseEvent) => {
        emit('click')
        if (attrs.type === 'submit') (event.currentTarget as HTMLButtonElement).closest('form')
          ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      } }, props.label ?? slots.default?.())
    }
  })
  const workspace = defineComponent({
    setup(_, { slots }) { return () => h('div', { 'data-form-workspace': '' }, [slots.sidebar?.(), slots.default?.()]) }
  })
  const pageSection = defineComponent({
    props: ['title'],
    setup(props, { slots }) { return () => h('section', [h('h2', String(props.title)), slots.actions?.(), slots.default?.()]) }
  })
  const accordionSection = defineComponent({
    props: ['title'],
    setup(props, { slots }) { return () => h('section', [h('h3', String(props.title)), slots.default?.()]) }
  })
  const hero = defineComponent({
    props: ['title', 'description', 'actions'],
    setup(props) { return () => h('header', { 'data-form-hero': '' }, [
      h('h1', String(props.title)), h('p', String(props.description ?? '')),
      ...(props.actions as Array<{ label: string; onClick: () => void }> ?? [])
        .map(action => h('button', { onClick: action.onClick }, action.label))
    ]) }
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
    ExtensionFormField: field, ExtensionInput: input, ExtensionSelect: select, ExtensionSelectMenu: select,
    ExtensionCheckbox: checkbox, ExtensionButton: button, ExtensionSaveButton: button,
    ExtensionIcon: defineComponent({ setup() { return () => h('span') } }),
    ExtensionTable: resourceTable, ExtensionTextarea: textarea, ExtensionModal: modal, ExtensionResourceLayoutCard: resourceTable,
    ExtensionAssessmentSchemaPageSection: pageSection, ExtensionAssessmentSchemaAccordionSection: accordionSection,
    ExtensionEntityEditorWorkspace: workspace, ExtensionEntityHero: hero, ExtensionRouteTabs: routeTabs,
    ExtensionBadge: defineComponent({ setup(_, { slots }) { return () => h('span', slots.default?.()) } }),
    ExtensionAlert: defineComponent({ props: ['title'], setup(props, { slots }) {
      return () => h('div', { role: 'alert' }, [h('strong', props.title), slots.description?.()])
    } })
  }
})

import FormChoiceEditor from '../components/FormChoiceEditor.vue'
import FormCreator from '../components/FormCreator.vue'
import FormLibrary from '../components/FormLibrary.vue'
import IntakeWorkspace from '../components/IntakeWorkspace.vue'
import FormTest from '../components/FormTest.vue'
import FormTestControl from '../components/FormTestControl.vue'
import type { SurveyField } from '@gcs-ssc/survey/vue'
import { ExtensionSelect } from '@gcs-ssc/extensions/ui'
import { readFormDraft } from '../components/form-draft-session'
import PortalConnection from '../components/PortalConnection.vue'
import ProponentVerification from '../components/ProponentVerification.vue'

const button = (wrapper: ReturnType<typeof mount>, label: string) => wrapper.findAll('button').find(item => item.text() === label)!

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
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
  post.mockReset().mockImplementation(async (_path: string, body?: { action?: string }) => body?.action === 'createDraft'
    ? { survey: { id: 'V-ABCDE', revision: 0 }, queued: false }
    : { survey: { id: 'survey_1', revision: 1 }, results: [] })
  put.mockReset().mockResolvedValue({ connection: { portalUrl: 'https://portal.example/', portalAgencyId: 'G-ABCDE', hasCredential: true } })
})

describe('connector form requirements', () => {
  it('creates form pages and questions without randomUUID on a LAN HTTP origin', async () => {
    const browserCrypto = globalThis.crypto
    vi.stubGlobal('crypto', { getRandomValues: browserCrypto.getRandomValues.bind(browserCrypto) })
    try {
      const wrapper = mount(FormCreator, { props: { agencyId: '1' } })
      await flushPromises()
      await wrapper.get('.designer-outline-add').trigger('click')
      expect(wrapper.findAll('.designer-outline-item')).toHaveLength(2)
      await wrapper.findAll('.designer-type').find(item => item.text().includes('Short answer'))!.trigger('click')
      expect(wrapper.text()).toContain('Questions · 1')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('keeps intake request keys valid without randomUUID on a LAN HTTP origin', async () => {
    const browserCrypto = globalThis.crypto
    vi.stubGlobal('crypto', { getRandomValues: browserCrypto.getRandomValues.bind(browserCrypto) })
    try {
      const defaultGet = get.getMockImplementation()!
      get.mockImplementation(async (path: string) => path.endsWith('/intakes')
        ? { intakes: [], streams: [{ id: 'S-ABCDE', nameEn: 'Community', nameFr: 'Communauté' }] }
        : defaultGet(path))
      const wrapper = mount(IntakeWorkspace, { props: { agencyId: '1' } })
      await flushPromises()
      await button(wrapper, 'Create intake opportunity').trigger('click')
      await wrapper.get('input[name="intakeNameEn"]').setValue('Community intake')
      await wrapper.get('input[name="intakeNameFr"]').setValue('Appel communautaire')
      await wrapper.get('select[name="intakeStream"]').setValue('S-ABCDE')
      await wrapper.get('input[name="intakeStartDate"]').setValue('2027-01-01')
      await wrapper.get('input[name="intakeEndDate"]').setValue('2027-12-31')
      await button(wrapper, 'Save intake').trigger('click')
      expect((post.mock.calls[0]?.[1] as { requestKey: string }).requestKey)
        .toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('explains why form design controls are disabled without agency configuration access', async () => {
    const collection = mount(PortalConnection, { props: { agencyId: '1', section: 'forms', enabled: true, readOnly: true } })
    await flushPromises()
    expect(collection.get('[role="alert"]').text()).toContain('Agency Manager access is required')
    expect(button(collection, 'Create form').attributes('disabled')).toBeDefined()
    collection.unmount()

    const defaultGet = get.getMockImplementation()!
    get.mockImplementation(async (path: string) => path.endsWith('/forms/V-ABCDE')
      ? { survey: { id: 'V-ABCDE', revision: 1, definition: {
        schemaVersion: 3, title: { en: 'Project', fr: 'Projet' }, questions: [],
        pages: [{ id: 'page_1', title: { en: 'Page 1', fr: 'Page 1' }, questionIds: [], groups: [], branches: [] }]
      } } } : defaultGet(path))
    const detail = mount(PortalConnection, { props: { agencyId: '1', section: 'forms', detailFormId: 'V-ABCDE', enabled: true, readOnly: true } })
    await flushPromises()
    expect(detail.get('[role="alert"]').text()).toContain('Forms are read-only')
    expect(button(detail, 'Save revision')).toBeUndefined()
    expect(button(detail, 'Add page').attributes('disabled')).toBeDefined()
    expect(detail.find('input[name="formTitleEn"]').exists()).toBe(false)
  })

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

  it('keeps a failed form creation on the list until saving succeeds', async () => {
    post.mockRejectedValueOnce(new Error('Save failed'))
    const wrapper = mount(FormLibrary, { props: { agencyId: '1' } })
    await flushPromises()
    await button(wrapper, 'Create form').trigger('click')
    await wrapper.get('input[name="formTitleEn"]').setValue('Project form')
    await wrapper.get('input[name="formTitleFr"]').setValue('Formulaire de projet')
    const submit = () => wrapper.findAll('[role="dialog"] button').find(item => item.text() === 'Create form')!
    await submit().trigger('click')
    await flushPromises()
    expect(wrapper.emitted('open')).toBeUndefined()
    expect(wrapper.get('[role="dialog"] [role="alert"]').text()).toContain('could not be created')
    await submit().trigger('click')
    await flushPromises()
    expect(wrapper.emitted('open')?.[0]).toEqual(['V-ABCDE'])
  })

  it('opens form design and queues a saved revision without a configured Portal connection', async () => {
    const defaultGet = get.getMockImplementation()!
    let created = false
    get.mockImplementation(async (path: string) => path.endsWith('/connection')
      ? { connection: null }
      : path.endsWith('/forms/V-ABCDE') ? { survey: { id: 'V-ABCDE', revision: 0, definition: {
        schemaVersion: 3, title: { en: 'Project form', fr: 'Formulaire de projet' }, questions: [],
        pages: [{ id: 'page_1', title: { en: 'Page 1', fr: 'Page 1' }, questionIds: [], groups: [], branches: [] }]
      } } }
        : path.endsWith('/forms') && created ? { surveys: [{ id: 'V-ABCDE', revision: 0,
          title: { en: 'Project form', fr: 'Formulaire de projet' }, updatedAt: new Date().toISOString() }] }
      : defaultGet(path))
    post.mockImplementation(async (_path: string, body: { action?: string }) => {
      if (body.action === 'createDraft') { created = true; return { survey: { id: 'V-ABCDE', revision: 0 }, queued: false } }
      return { survey: { id: 'V-ABCDE', revision: 1 }, queued: true }
    })
    const collection = mount(PortalConnection, { props: { agencyId: '1', section: 'forms', enabled: true } })
    await flushPromises()
    expect(collection.text()).toContain('You can design and save forms now')
    await button(collection, 'Create form').trigger('click')
    expect(collection.emitted('openForm')).toBeUndefined()
    expect(collection.find('[data-form-workspace]').exists()).toBe(false)
    await collection.get('input[name="formTitleEn"]').setValue('Project form')
    await collection.get('input[name="formTitleFr"]').setValue('Formulaire de projet')
    await collection.findAll('[role="dialog"] button').find(item => item.text() === 'Create form')!.trigger('click')
    await flushPromises()
    expect(post).toHaveBeenCalledWith('/agencies/1/forms', expect.objectContaining({ action: 'createDraft',
      title: { en: 'Project form', fr: 'Formulaire de projet' } }))
    expect(collection.emitted('openForm')?.[0]).toEqual(['V-ABCDE'])
    collection.unmount()
    const detail = mount(PortalConnection, { props: { agencyId: '1', section: 'forms', detailFormId: 'V-ABCDE', enabled: true } })
    await flushPromises()
    expect(detail.get('[data-form-hero] h1').text()).toBe('Project form')
    await button(detail, 'Edit details').trigger('click')
    expect(detail.get('[role="dialog"]').text()).toContain('Edit form details')
    await button(detail, 'Cancel').trigger('click')
    await detail.findAll('.designer-type').find(item => item.text().includes('Short answer'))!.trigger('click')
    await button(detail, 'Save revision').trigger('click')
    await flushPromises()
    expect(post).toHaveBeenCalledWith('/agencies/1/forms', expect.objectContaining({ action: 'save',
      surveyId: 'V-ABCDE', expectedRevision: 0 }))
    expect(detail.text()).toContain('queued for Portal sync')
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
    expect(post).toHaveBeenCalledWith('/agencies/1/organization-sync')
    expect(state.toastAdd).toHaveBeenCalledWith({
      title: 'Success', description: 'Portal organizations refreshed.', color: 'success'
    })
    expect(wrapper.find('[role="status"]').exists()).toBe(false)
  })

  it.each([
    ['text', 'maxLength', 'maxLength-error', 'Enter a whole number from 1 to 5000.'],
    ['repeat', 'maxItems', 'maxItems-error', 'Enter a whole number from 1 to 50.'],
    ['table', 'maxRows', 'maxRows-error', 'Enter a whole number from 1 to 100.']
  ])('renders required %s limits and blocks a cleared limit at the survey validation boundary', async (type, name, errorId, errorText) => {
    const wrapper = mount(FormCreator, { props: { agencyId: '1' } })
    await flushPromises()
    expect(button(wrapper, 'Edit').attributes('aria-selected')).toBe('true')
    await wrapper.get('input[name="formTitleEn"]').setValue('Title')
    await wrapper.get('input[name="formTitleFr"]').setValue('Titre')
    await button(wrapper, 'Continue to designer').trigger('click')
    if (type === 'repeat') await button(wrapper, 'Add repeating set').trigger('click')
    else await wrapper.findAll('.designer-type').find(item => item.text().includes(({ text: 'Short answer', table: 'Table' } as Record<string, string>)[type]!))!.trigger('click')
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
    await wrapper.get('input[name="formTitleEn"]').setValue('Title')
    await wrapper.get('input[name="formTitleFr"]').setValue('Titre')
    await button(wrapper, 'Continue to designer').trigger('click')
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
      await wrapper.get('input[name="formTitleEn"]').setValue('Draft title')
      await wrapper.get('input[name="formTitleFr"]').setValue('Titre provisoire')
      await button(wrapper, 'Continue to designer').trigger('click')
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
    await wrapper.get('input[name="formTitleEn"]').setValue('Application')
    await wrapper.get('input[name="formTitleFr"]').setValue('Demande')
    await button(wrapper, 'Continue to designer').trigger('click')
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
  it('keeps intake edits visible after a revision conflict and requires review before retry', async () => {
    const defaultGet = get.getMockImplementation()!
    let revision = 2
    get.mockImplementation(async (path: string) => path.endsWith('/intakes')
      ? { intakes: [{ id: 'D-ABCDE', revision, streamId: 'S-ABCDE', nameEn: 'Existing intake',
        nameFr: revision === 2 ? 'Appel existant' : 'Appel modifié ailleurs',
        startDate: '2027-01-01', endDate: '2027-12-31', published: false,
        surveyId: null, surveyRevision: null }],
        streams: [{ id: 'S-ABCDE', nameEn: 'Community', nameFr: 'Communauté' }] }
      : defaultGet(path))
    post.mockImplementation(async (_path: string, body: Record<string, unknown>) => {
      if (body.expectedRevision === 2) {
        revision = 3
        throw new FetchResponseError(new Response(null, { status: 409 }), {
          data: { code: 'GCS_PORTAL_INTAKE_REVISION_CONFLICT' }
        })
      }
      return { intakeId: 'D-ABCDE' }
    })
    const wrapper = mount(IntakeWorkspace, { props: { agencyId: '1' } })
    await flushPromises()
    await button(wrapper, 'Existing intake').trigger('click')
    await button(wrapper, 'Edit intake opportunity').trigger('click')
    await wrapper.get('input[name="intakeNameEn"]').setValue('My draft')
    await button(wrapper, 'Save intake').trigger('click')
    await flushPromises()
    expect(post.mock.calls[0]?.[1]).toMatchObject({ expectedRevision: 2, nameEn: 'My draft' })
    expect(wrapper.get('input[name="intakeNameEn"]').element).toHaveProperty('value', 'My draft')
    expect(wrapper.text()).toContain('Appel modifié ailleurs')
    expect(button(wrapper, 'Save intake').attributes('disabled')).toBeDefined()
    expect(post).toHaveBeenCalledTimes(1)
    await button(wrapper, 'Continue with latest revision').trigger('click')
    await button(wrapper, 'Save intake').trigger('click')
    await flushPromises()
    expect(post.mock.calls[1]?.[1]).toMatchObject({ expectedRevision: 3, nameEn: 'My draft' })
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
    await wrapper.get('input[name="formTitleEn"]').setValue('Application')
    await wrapper.get('input[name="formTitleFr"]').setValue('Demande')
    await button(wrapper, 'Continue to designer').trigger('click')
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

  it('requires both introduction translations when one is supplied', async () => {
    const wrapper = mount(FormCreator, { props: { agencyId: '1' } })
    await flushPromises()
    await wrapper.get('input[name="formTitleEn"]').setValue('Project report')
    await wrapper.get('input[name="formTitleFr"]').setValue('Rapport de projet')
    await wrapper.get('textarea[name="formDescriptionEn"]').setValue('Describe the project.')
    expect(wrapper.get('textarea[name="formDescriptionFr"]').attributes('required')).toBeDefined()
    expect(button(wrapper, 'Continue to designer').attributes('disabled')).toBeDefined()
    await wrapper.get('textarea[name="formDescriptionFr"]').setValue('Décrivez le projet.')
    await button(wrapper, 'Continue to designer').trigger('click')
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('Project report')
  })

  it('creates a form record from its modal and restores later unsaved edits', async () => {
    let created = false
    const defaultGet = get.getMockImplementation()!
    get.mockImplementation(async (path: string) => path === '/agencies/1/forms/V-ABCDE' && created
      ? { survey: { id: 'V-ABCDE', revision: 0, definition: {
        schemaVersion: 3, title: { en: 'Unsaved draft', fr: 'Brouillon non enregistré' }, questions: [],
        pages: [{ id: 'page_1', title: { en: 'Page 1', fr: 'Page 1' }, questionIds: [], groups: [], branches: [] }]
      } } }
      : path === '/agencies/1/forms' && created
      ? { surveys: [{ id: 'V-ABCDE', revision: 0, title: { en: 'Unsaved draft', fr: 'Brouillon non enregistré' },
        updatedAt: new Date().toISOString(), synced: false }], streams: [], agreements: [], calls: [] }
      : defaultGet(path))
    post.mockImplementation(async (_path: string, body: { action?: string }) => {
      if (body.action === 'createDraft') { created = true; return { survey: { id: 'V-ABCDE', revision: 0 }, queued: false } }
      return { survey: { id: 'V-ABCDE', revision: 1 }, queued: true }
    })
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
    expect(firstForms.emitted('openForm')).toBeUndefined()
    expect(firstForms.find('input[name="formTitleEn"]').exists()).toBe(true)
    await firstForms.get('input[name="formTitleEn"]').setValue('Unsaved draft')
    await firstForms.get('input[name="formTitleFr"]').setValue('Brouillon non enregistré')
    await firstForms.findAll('[role="dialog"] button').find(item => item.text() === 'Create form')!.trigger('click')
    await flushPromises()
    expect(firstForms.emitted('openForm')?.[0]).toEqual(['V-ABCDE'])
    firstForms.unmount()

    const firstDetail = mount(PortalConnection, { props: { agencyId: '1', section: 'forms', detailFormId: 'V-ABCDE', enabled: true } })
    await flushPromises()
    expect(firstDetail.emitted('formCollectionLabel')?.[0]).toEqual(['All forms'])
    expect(button(firstDetail, 'Edit').attributes('aria-selected')).toBe('true')
    expect(firstDetail.get('[data-form-workspace] nav').text()).toContain('Flow')
    expect(firstDetail.get('[data-form-workspace] nav').text()).toContain('Publish')
    expect(firstDetail.find('.designer-back').exists()).toBe(false)
    expect(firstDetail.find('.designer-outline').exists()).toBe(false)
    expect(firstDetail.get('.designer-sidebar-outline').text()).toContain('PAGES & SECTIONS')
    await button(firstDetail, 'Add nested section').trigger('click')
    expect(firstDetail.text()).toContain('Section details')
    expect(firstDetail.get('input[name="groupTitleEn"]')).toBeTruthy()
    const sidebarItems = firstDetail.findAll('.designer-sidebar-item')
    expect(sidebarItems).toHaveLength(2)
    const sidebarRows = firstDetail.findAll('.designer-sidebar-row')
    expect(sidebarRows[1]!.attributes('style')).not.toBe(sidebarRows[0]!.attributes('style'))
    await firstDetail.get('.designer-sidebar-disclosure[aria-expanded="true"]').trigger('click')
    expect(firstDetail.findAll('.designer-sidebar-item')).toHaveLength(1)
    await firstDetail.get('.designer-sidebar-disclosure[aria-expanded="false"]').trigger('click')
    expect(firstDetail.findAll('.designer-sidebar-item')).toHaveLength(2)
    await button(firstDetail, 'Publish').trigger('click')
    await firstDetail.findAll('.designer-sidebar-item')[0]!.trigger('click')
    expect(button(firstDetail, 'Edit').attributes('aria-selected')).toBe('true')
    await flushPromises()
    firstDetail.unmount()

    const restored = mount(PortalConnection, { props: { agencyId: '1', section: 'forms', detailFormId: 'V-ABCDE', enabled: true } })
    await flushPromises()
    expect(restored.get('[data-form-hero] h1').text()).toBe('Unsaved draft')
    expect(restored.findAll('.designer-sidebar-item')).toHaveLength(2)
    restored.unmount()
    const library = mount(PortalConnection, { props: { agencyId: '1', section: 'forms', enabled: true } })
    await flushPromises()
    expect(library.text()).toContain('Unsaved draft')
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
    window.sessionStorage.setItem(key, JSON.stringify({ ...draft, tab: 'flow' }))
    expect(readFormDraft('1')?.tab).toBe('flow')
  })

  it('offers only earlier answers and later pages when building a branch', async () => {
    const wrapper = mount(FormCreator, { props: { agencyId: '1' } })
    await flushPromises()
    await button(wrapper, 'Edit').trigger('click')
    await wrapper.findAll('.designer-type').find(item => item.text().includes('Dropdown'))!.trigger('click')
    await wrapper.findAll('button').find(item => item.attributes('aria-label')?.startsWith('Edit choice:'))!.trigger('click')
    await wrapper.get('input[name="choiceEn"]').setValue('Yes')
    await button(wrapper, 'Save choice').trigger('click')
    await wrapper.get('.designer-outline-add').trigger('click')
    await button(wrapper, 'Add an if rule').trigger('click')
    await button(wrapper, 'Flow').trigger('click')
    expect(wrapper.get('.flow-stats').text()).toContain('2 pages')
    expect(wrapper.get('.flow-stats').text()).toContain('1 rule')
    expect(wrapper.findAll('.flow-route--conditional')).toHaveLength(1)
    expect(wrapper.findAll('.flow-route--default')).toHaveLength(1)
    await button(wrapper, 'Edit').trigger('click')
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
    expect(wrapper.get('h4').text()).toBe('First page')
    expect(wrapper.text()).toContain('Page 1')
    expect(wrapper.text()).not.toContain('Responses are valid.')
  })

  it('prevents reordering a dependent question before its source and cleans up deletion', async () => {
    const wrapper = mount(FormCreator, { props: { agencyId: '1' } })
    await flushPromises()
    await button(wrapper, 'Edit').trigger('click')
    const choice = () => wrapper.findAll('.designer-type').find(item => item.text().includes('Dropdown'))!
    await choice().trigger('click')
    await choice().trigger('click')
    const sourceId = wrapper.get('select[name="choiceDependency"]').findAll('option')[1]!.attributes('value')!
    await wrapper.get('select[name="choiceDependency"]').setValue(sourceId)
    expect(button(wrapper, 'Move up').attributes('disabled')).toBeDefined()
    await wrapper.findAll('.designer-question')[0]!.trigger('click')
    await button(wrapper, 'Delete question').trigger('click')
    await wrapper.get('[role=dialog]').findAll('button').find(item => item.text() === 'Delete question')!.trigger('click')
    await wrapper.get('.designer-question').trigger('click')
    expect((wrapper.get('select[name="choiceDependency"]').element as HTMLSelectElement).value).toBe('none')
    expect(wrapper.text()).toContain('Rules and dependencies using it were updated')
  })

  it('adds questions directly to repeating sets and nests another repeating set', async () => {
    const wrapper = mount(FormCreator, { props: { agencyId: '1' } })
    await flushPromises()
    await button(wrapper, 'Add repeating set').trigger('click')
    expect(wrapper.findAll('.designer-outline-item')).toHaveLength(2)
    expect(wrapper.findAll('.designer-outline-item')[1]!.attributes('aria-current')).toBe('location')
    expect(wrapper.text()).toContain('ADD A QUESTION TO THIS SET')
    await wrapper.findAll('.designer-type').find(item => item.text().includes('Short answer'))!.trigger('click')
    const outer = readFormDraft('1')!.definition
    const outerSet = outer.pages[0]!.groups[0]!
    expect(outer.questions.find(item => item.id === outerSet.repeatFor)?.type).toBe('repeat')
    expect(outerSet.questionIds).toHaveLength(1)
    expect(outer.pages[0]!.questionIds).toContain(outerSet.repeatFor)

    await button(wrapper, 'Add nested repeating set').trigger('click')
    expect(wrapper.findAll('.designer-outline-item')).toHaveLength(3)
    expect(wrapper.findAll('.designer-outline-item')[2]!.attributes('aria-current')).toBe('location')
    await wrapper.findAll('.designer-type').find(item => item.text().includes('Number'))!.trigger('click')
    const nested = readFormDraft('1')!.definition
    const nestedSet = nested.pages[0]!.groups[0]!.groups[0]!
    expect(nestedSet.questionIds).toHaveLength(1)
    expect(nested.pages[0]!.groups[0]!.questionIds).toContain(nestedSet.repeatFor)
    const complete = structuredClone(nested)
    complete.title = { en: 'Repeating sets', fr: 'Séries répétables' }
    complete.description = { en: 'Instructions', fr: 'Instructions' }
    const fillDescriptions = (groups: typeof complete.pages[number]['groups']) => {
      for (const group of groups) {
        group.description = { en: 'Instructions', fr: 'Instructions' }
        fillDescriptions(group.groups)
      }
    }
    for (const page of complete.pages) {
      page.description = { en: 'Instructions', fr: 'Instructions' }
      fillDescriptions(page.groups)
    }
    for (const question of complete.questions) question.hint = { en: 'Help', fr: 'Aide' }
    const parsed = surveyV3Schema.safeParse(complete)
    expect(parsed.success, parsed.error?.message).toBe(true)
    if (!parsed.success) throw parsed.error
    const resolved = resolveAdvancedSurvey(parsed.data, {
      [outerSet.repeatFor!]: JSON.stringify([{ id: 'r_outer_1', value: 'First item' }]),
      [instanceKey(nestedSet.repeatFor!, ['r_outer_1'])]: JSON.stringify([{ id: 'r_nested_1', value: 'Nested item' }])
    })
    expect(resolved.pages[0]!.groups[0]!.instanceId).toBe('r_outer_1')
    expect(resolved.pages[0]!.groups[0]!.groups[0]!.instanceId).toBe('r_nested_1')
  })

  it('previews repeating sets without an extra item-name input', async () => {
    const definition = surveyV3Schema.parse({
      schemaVersion: 3, title: { en: 'People', fr: 'Personnes' },
      questions: [
        { id: 'people', type: 'repeat', label: { en: 'People', fr: 'Personnes' }, required: true, maxItems: 3 },
        { id: 'name', type: 'text', label: { en: 'Name', fr: 'Nom' }, required: true, maxLength: 100 }
      ],
      pages: [{ id: 'page', title: { en: 'People', fr: 'Personnes' }, questionIds: ['people'], branches: [],
        groups: [{ id: 'person', title: { en: 'Person {{item}}', fr: 'Personne {{item}}' },
          repeatFor: 'people', questionIds: ['name'], groups: [] }] }]
    })
    const wrapper = mount(FormTest, { props: { definition, locale: 'en' } })
    expect(wrapper.findAll('input[name]')).toHaveLength(0)
    await button(wrapper, 'Add another').trigger('click')
    expect(wrapper.text()).toContain('Person 1')
    expect(wrapper.findAll('input[name]')).toHaveLength(1)
    expect(wrapper.findAll('input[name]').some(input => input.attributes('name')?.startsWith('name@r_'))).toBe(true)
  })

  it('removes a nested repeating set and its internal repeat source', async () => {
    const wrapper = mount(FormCreator, { props: { agencyId: '1' } })
    await flushPromises()
    await button(wrapper, 'Add repeating set').trigger('click')
    await wrapper.findAll('.designer-type').find(item => item.text().includes('Short answer'))!.trigger('click')
    await button(wrapper, 'Add nested repeating set').trigger('click')
    await wrapper.findAll('.designer-type').find(item => item.text().includes('Number'))!.trigger('click')
    const before = readFormDraft('1')!.definition
    expect(before.questions.map(item => item.type)).toEqual(['repeat', 'text', 'repeat', 'number'])
    const confirm = vi.fn().mockReturnValue(false)
    vi.stubGlobal('confirm', confirm)
    try {
      await button(wrapper, 'Remove section and its contents').trigger('click')
      expect(readFormDraft('1')!.definition.questions).toHaveLength(4)
      confirm.mockReturnValue(true)
      await button(wrapper, 'Remove section and its contents').trigger('click')
    } finally { vi.unstubAllGlobals() }
    const after = readFormDraft('1')!.definition
    expect(after.questions.map(item => item.type)).toEqual(['repeat', 'text'])
    expect(after.pages[0]!.groups[0]!.groups).toHaveLength(0)
    expect(after.pages[0]!.groups[0]!.repeatFor).toBe(after.questions[0]!.id)
  })

  it('removes a field directly from its section card', async () => {
    const wrapper = mount(FormCreator, { props: { agencyId: '1' } })
    await flushPromises()
    await button(wrapper, 'Edit').trigger('click')
    await wrapper.findAll('.designer-type').find(item => item.text().includes('Short answer'))!.trigger('click')
    expect(wrapper.find('button[aria-label="Remove field: New question"]').exists()).toBe(false)
    await button(wrapper, 'Delete question').trigger('click')
    expect(wrapper.findAll('.designer-question')).toHaveLength(1)
    await wrapper.get('[role=dialog]').findAll('button').find(item => item.text() === 'Cancel')!.trigger('click')
    expect(wrapper.findAll('.designer-question')).toHaveLength(1)
    await button(wrapper, 'Delete question').trigger('click')
    await wrapper.get('[role=dialog]').findAll('button').find(item => item.text() === 'Delete question')!.trigger('click')
    expect(wrapper.findAll('.designer-question')).toHaveLength(0)
    expect(readFormDraft('1')).toBeNull()
  })

  it('shows the repeating-list actions in French', async () => {
    state.locale = 'fr'
    const wrapper = mount(FormCreator, { props: { agencyId: '1' } })
    await flushPromises()
    await button(wrapper, 'Modifier').trigger('click')
    expect(button(wrapper, 'Ajouter une série répétable')).toBeDefined()
    expect(wrapper.findAll('.designer-type').some(item => item.text().includes('Liste d’éléments'))).toBe(false)
    await button(wrapper, 'Ajouter une série répétable').trigger('click')
    expect(button(wrapper, 'Ajouter une série répétable imbriquée')).toBeDefined()
    expect(button(wrapper, 'Retirer la section et son contenu')).toBeDefined()
    await wrapper.findAll('.designer-type').find(item => item.text().includes('Réponse courte'))!.trigger('click')
    const confirm = vi.fn().mockReturnValue(false)
    vi.stubGlobal('confirm', confirm)
    try {
      await button(wrapper, 'Retirer la section et son contenu').trigger('click')
      expect(confirm).toHaveBeenCalledWith(expect.stringContaining('1 champ?'))
    } finally { vi.unstubAllGlobals() }
  })

  it('keeps a repeat source section until dependent repeat sets are removed', async () => {
    const wrapper = mount(FormCreator, { props: { agencyId: '1' } })
    await flushPromises()
    await button(wrapper, 'Edit').trigger('click')
    await button(wrapper, 'Add nested section').trigger('click')
    await button(wrapper, 'Add nested repeating set').trigger('click')
    const listId = readFormDraft('1')!.definition.questions[0]!.id
    await wrapper.findAll('.designer-outline-item')[0]!.trigger('click')
    await button(wrapper, 'Add nested section').trigger('click')
    await wrapper.get('select[name="repeatFor"]').setValue(listId)
    await wrapper.findAll('.designer-outline-item')[1]!.trigger('click')
    await button(wrapper, 'Remove section and its contents').trigger('click')
    expect(wrapper.text()).toContain('Remove the repeating set that depends on a field')
    expect(readFormDraft('1')!.definition.pages[0]!.groups).toHaveLength(2)
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
    const secondId = readFormDraft('1')!.definition.questions[1]!.id
    expect(secondId).toBeTruthy()
    await sources.findAll('input[type="checkbox"]')[0]!.setValue(true)
    await sources.findAll('input[type="checkbox"]')[1]!.setValue(true)
    await wrapper.findAll('.designer-question')[0]!.trigger('click')
    await button(wrapper, 'Delete question').trigger('click')
    await wrapper.get('[role=dialog]').findAll('button').find(item => item.text() === 'Delete question')!.trigger('click')
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

  it('opens Flow as a separate view and selects a page for editing', async () => {
    const wrapper = mount(FormCreator, { props: { agencyId: '1' } })
    await flushPromises()
    await button(wrapper, 'Edit').trigger('click')
    await wrapper.get('.designer-outline-add').trigger('click')
    await button(wrapper, 'Flow').trigger('click')
    expect(wrapper.findAll('.flow-page-node')).toHaveLength(2)
    expect(wrapper.findAll('.flow-route')).toHaveLength(0)
    expect(wrapper.findAll('[data-flow-kind="direct"]')).toHaveLength(3)
    expect(wrapper.find('.designer-workspace').exists()).toBe(false)
    await wrapper.findAll('.flow-page-node')[0]!.trigger('click')
    expect(button(wrapper, 'Edit').attributes('aria-selected')).toBe('true')
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


describe('form design guidance and valid calculated sources', () => {
  it('offers only earlier accessible sources and inserts exact references without changing required semantics', async () => {
    const wrapper = mount(FormCreator, { props: { agencyId: '1' } })
    await flushPromises()
    const addType = (label: string) => wrapper.findAll('.designer-type').find(item => item.text().includes(label))!
    await addType('Short answer').trigger('click')
    await wrapper.get('input[name="questionEn"]').setValue('Earlier source')
    await addType('Calculated value').trigger('click')
    await addType('Short answer').trigger('click')
    await wrapper.get('input[name="questionEn"]').setValue('Later source')
    await button(wrapper, 'Add repeating set').trigger('click')
    await addType('Short answer').trigger('click')
    await wrapper.get('input[name="questionEn"]').setValue('Repeated source')
    await wrapper.findAll('.designer-outline-item')[0]!.trigger('click')
    await wrapper.findAll('.designer-question')[1]!.trigger('click')
    const sources = wrapper.get('[role="group"][aria-labelledby="computed-sources-label"]')
    expect(sources.findAll('input[type="checkbox"]')).toHaveLength(1)
    expect(sources.text()).toContain('Earlier source')
    expect(sources.text()).not.toContain('Later source')
    expect(sources.text()).not.toContain('Repeated source')
    const template = wrapper.get('input[name="computedTemplate"]')
    expect(template.attributes('required')).toBeDefined()
    expect(template.attributes('aria-describedby')).toContain('computed-template-validation')
    expect(template.attributes('aria-invalid')).toBe('true')
    await sources.get('input[type="checkbox"]').setValue(true)
    const reference = (template.element as HTMLInputElement).value
    expect(reference).toMatch(/^\{\{field_[a-z0-9]+\}\}$/)
    await template.setValue('')
    await wrapper.findAll('button').find(item => item.text().startsWith('Insert reference:'))!.trigger('click')
    expect((template.element as HTMLInputElement).value).toBe(reference)
    expect(template.attributes('aria-invalid')).toBe('false')
    await template.setValue('Total: ' + reference)
    expect(template.attributes('aria-invalid')).toBe('true')
    expect(wrapper.get('#computed-template-validation').text()).toContain('neutral symbols')
    wrapper.unmount()
  })

  it('explains missing sources and keeps guidance available for read-only forms', async () => {
    const wrapper = mount(FormCreator, { props: { agencyId: '1' } })
    await flushPromises()
    await wrapper.findAll('.designer-type').find(item => item.text().includes('Calculated value'))!.trigger('click')
    expect(wrapper.text()).toContain('Add a source question before this question')
    await wrapper.setProps({ disabled: true })
    expect(wrapper.find('[data-design-help="Computed"] summary').exists()).toBe(true)
    await button(wrapper, 'Test this form').trigger('click')
    expect(wrapper.text()).toContain('Preview only')
    expect(post).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})

describe('Test renderer hierarchy and validation', () => {
  const repeatedDefinition = () => surveyV3Schema.parse({
    schemaVersion: 3, title: { en: 'Team', fr: 'Équipe' },
    questions: [
      { id: 'people', type: 'repeat', label: { en: 'People', fr: 'Personnes' }, required: true, maxItems: 2 },
      { id: 'name', type: 'text', label: { en: 'Name', fr: 'Nom' }, required: true, maxLength: 100 },
      { id: 'contacts', type: 'repeat', label: { en: 'Contacts', fr: 'Contacts' }, required: false, maxItems: 2 },
      { id: 'email', type: 'email', label: { en: 'Email', fr: 'Courriel' }, required: true }
    ],
    pages: [{ id: 'page', title: { en: 'People', fr: 'Personnes' }, questionIds: ['people'], branches: [],
      groups: [{ id: 'person', title: { en: 'Person {{item}}', fr: 'Personne {{item}}' }, repeatFor: 'people',
        questionIds: ['name', 'contacts'], groups: [{ id: 'contact', title: { en: 'Contact {{item}}', fr: 'Contact {{item}}' },
          repeatFor: 'contacts', questionIds: ['email'], groups: [] }] }] }]
  })

  it('keeps nested entry fields and removal together, preserving other entries and their answers', async () => {
    const wrapper = mount(FormTest, { props: { definition: repeatedDefinition(), locale: 'en' } })
    const root = wrapper.get('[data-repeat-set]')
    await button(wrapper, 'Add another').trigger('click')
    const first = root.get('[data-repeat-entry]')
    await first.get('input[name^="name@"] ').setValue('Alice')
    await first.findAll('button').find(item => item.text() === 'Add another')!.trigger('click')
    await button(wrapper, 'Check').trigger('click')
    expect(wrapper.findAll('.preview-form a').some(item => item.text().includes('Person 1 · Contact 1 · Email'))).toBe(true)
    await first.get('input[type="email"]').setValue('alice@example.ca')
    // Root Add is below its entries; nested Add stays inside its parent entry.
    await root.findAll('button').filter(item => item.text() === 'Add another').at(-1)!.trigger('click')
    const entries = root.findAll('[data-repeat-entry]').filter(item => !item.element.parentElement?.closest('[data-repeat-entry]'))
    expect(entries).toHaveLength(2)
    await entries[1]!.get('input[name^="name@"] ').setValue('Bob')
    await entries[0]!.findAll('button').find(item => item.attributes('aria-label') === 'Remove Person 1')!.trigger('click')
    expect(wrapper.findAll('input[type="email"]')).toHaveLength(0)
    expect((wrapper.get('input[name^="name@"] ').element as HTMLInputElement).value).toBe('Bob')
    expect(root.text()).toContain('1 of 2 entries')
    expect(wrapper.findAll('[data-repeat-entry]')).toHaveLength(1)
    wrapper.unmount()
  })

  it('associates localized errors with required inputs and recovers through validation', async () => {
    const wrapper = mount(FormTest, { props: { definition: repeatedDefinition(), locale: 'fr' } })
    expect(wrapper.text()).toContain('(obligatoire)')
    await button(wrapper, 'Vérifier').trigger('click')
    expect(wrapper.get('#people-repeat-error').text()).toBe('Saisissez une réponse.')
    await button(wrapper, 'Ajouter un autre élément').trigger('click')
    await button(wrapper, 'Vérifier').trigger('click')
    expect(wrapper.text()).toContain('Vérifiez les réponses indiquées')
    const input = wrapper.get('input[name^="name@"]')
    expect(input.attributes('required')).toBeDefined()
    expect(input.attributes('aria-invalid')).toBe('true')
    expect(wrapper.findAll('[role="alert"]').some(item => item.text() === 'Saisissez une réponse.')).toBe(true)
    await input.setValue('Alice')
    await button(wrapper, 'Vérifier').trigger('click')
    expect(wrapper.text()).toContain('Réponses valides.')
    expect(wrapper.findAll('[role="alert"]')).toHaveLength(0)
    expect(wrapper.findAll('input')).toHaveLength(0)
    wrapper.unmount()
  })
})


describe('Test answer controls', () => {
  const fieldFor = (question: SurveyField['question'], value = ''): SurveyField => ({
    id: question.id, question, label: question.label.en, hint: 'Help text', required: question.required,
    disabled: false, value, error: undefined, options: question.type === 'select'
      ? question.options.map(option => ({value: option.value, label: option.label.en})) : [], setValue: vi.fn()
  })
  const base = { id: 'field', label: { en: 'Field', fr: 'Champ' }, required: true }

  it.each(['text', 'email', 'number', 'date'] as const)('renders %s input semantics and error recovery', async type => {
    const field = fieldFor(type === 'text' ? { ...base, type, maxLength: 100 } : { ...base, type })
    const wrapper = mount(FormTestControl, { props: {field, locale: 'en'} })
    const input = wrapper.get('input')
    expect(input.attributes('type')).toBe(type)
    expect(input.attributes('required')).toBeDefined()
    await input.setValue(type === 'date' ? '2026-09-29' : type === 'number' ? '12.5' : 'value')
    expect(field.setValue).toHaveBeenCalled()
    await wrapper.setProps({ field: { ...field, required: false, disabled: true, error: 'required' } })
    expect(input.attributes('disabled')).toBeDefined()
    expect(input.attributes('aria-invalid')).toBe('true')
    expect(wrapper.get('[role="alert"]').text()).toBe('Enter a response.')
    await wrapper.setProps({ field: { ...field, error: undefined, hint: '' } })
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('renders available dependent choices and read-only computed answers', async () => {
    const field = fieldFor({ ...base, type: 'select', options: [{value: 'yes', label: {en:'Yes',fr:'Oui'}}] })
    const wrapper = mount(FormTestControl, { props: {field,locale:'en'} })
    await wrapper.get('select').setValue('yes')
    expect(field.setValue).toHaveBeenCalledWith('yes')
    wrapper.findComponent(ExtensionSelect).vm.$emit('update:modelValue', undefined)
    expect(field.setValue).toHaveBeenLastCalledWith('')
    await wrapper.setProps({ field: fieldFor({ ...base, type: 'computed', sourceIds: ['source'], template: '{{source}}' }, '12') })
    expect(wrapper.text()).toContain('12')
    expect(wrapper.find('input').exists()).toBe(false)
    await wrapper.setProps({ field: fieldFor({ ...base, type: 'computed', sourceIds: ['source'], template: '{{source}}' }) })
    expect(wrapper.text()).toContain('—')
    wrapper.unmount()
  })

  it.each(['list','repeat'] as const)('adds and removes %s entries while honoring the maximum and disabled state', async type => {
    const field = fieldFor({ ...base, type, maxItems: 1 })
    const wrapper = mount(FormTestControl, { props: {field,locale:'en'} })
    await wrapper.findAll('button').at(-1)!.trigger('click')
    const added = JSON.parse((field.setValue as ReturnType<typeof vi.fn>).mock.calls[0]![0])
    expect(added).toHaveLength(1)
    await wrapper.setProps({field:{...field,value:JSON.stringify(added)}})
    expect(wrapper.findAll('button').at(-1)!.attributes('disabled')).toBeDefined()
    if (type === 'list') {
      await wrapper.get('input').setValue('First')
      expect(JSON.parse((field.setValue as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0])[0].value).toBe('First')
    }
    await wrapper.findAll('button')[0]!.trigger('click')
    expect(field.setValue).toHaveBeenLastCalledWith('[]')
    await wrapper.setProps({field:{...field,disabled:true,value:JSON.stringify(added)}})
    expect(wrapper.findAll('button').every(item => item.attributes('disabled') !== undefined)).toBe(true)
    wrapper.unmount()
  })

  it('uses table column types, requirements and independent cell values', async () => {
    const field = fieldFor({ ...base, type:'table', maxRows:1, columns:[
      {id:'amount',label:{en:'Amount',fr:'Montant'},type:'number',required:true},
      {id:'date',label:{en:'Date',fr:'Date'},type:'date',required:false},
      {id:'note',label:{en:'Note',fr:'Note'},type:'text',required:false}
    ] })
    const wrapper = mount(FormTestControl, {props:{field,locale:'en'}})
    await button(wrapper,'Add row').trigger('click')
    const rows = JSON.parse((field.setValue as ReturnType<typeof vi.fn>).mock.calls[0]![0])
    await wrapper.setProps({field:{...field,value:JSON.stringify(rows)}})
    expect(wrapper.findAll('input').map(input => input.attributes('type'))).toEqual(['number','date','text'])
    expect(wrapper.findAll('input').map(input => input.attributes('required') !== undefined)).toEqual([true,false,false])
    await wrapper.get('input[type="number"]').setValue('12.5')
    expect(JSON.parse((field.setValue as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0])[0].cells.amount).toBe('12.5')
    await button(wrapper,'Remove row').trigger('click')
    expect(field.setValue).toHaveBeenLastCalledWith('[]')
    wrapper.unmount()
  })
})

describe('business authoring interactions', () => {
  it('shows readable source labels and an answer format while keeping raw references advanced', async () => {
    const wrapper = mount(FormCreator, { props: { agencyId: '1' } })
    await flushPromises()
    await wrapper.findAll('.designer-type').find(item => item.text().includes('Short answer'))!.trigger('click')
    await wrapper.get('input[name="questionEn"]').setValue('Project name')
    await wrapper.findAll('.designer-type').find(item => item.text().includes('Calculated value'))!.trigger('click')
    const sources = wrapper.get('[aria-labelledby="computed-sources-label"]')
    expect(sources.text()).toBe('Project name')
    await sources.get('input[type="checkbox"]').setValue(true)
    expect(wrapper.get('[data-computed-format]').text()).toBe('Project name')
    const rawInput = wrapper.get('input[name="computedTemplate"]')
    expect(rawInput.element.closest('details')?.open).toBe(false)
    await button(wrapper, 'Add separator /').trigger('click')
    await button(wrapper, 'Insert reference: Project name').trigger('click')
    expect(wrapper.get('[data-computed-format]').text()).toBe('Project name / Project name')
    wrapper.unmount()
  })

  it('makes route precedence editable without changing the conditions', async () => {
    const wrapper = mount(FormCreator, { props: {agencyId:'1'} })
    await flushPromises()
    await wrapper.findAll('.designer-type').find(item => item.text().includes('Short answer'))!.trigger('click')
    await button(wrapper,'Add an if rule').trigger('click')
    await wrapper.get('select[name="conditionOperator0"]').setValue('equals')
    await wrapper.get('input[name="conditionValue0"]').setValue('first')
    await button(wrapper,'Add an if rule').trigger('click')
    expect(wrapper.findAll('button').filter(item => item.text() === 'Move route up')[0]!.attributes('disabled')).toBeDefined()
    await wrapper.findAll('button').filter(item => item.text() === 'Move route up')[1]!.trigger('click')
    expect(readFormDraft('1')!.definition.pages[0]!.branches[0]!.when.conditions[0]!.operator).toBe('answered')
    expect(readFormDraft('1')!.definition.pages[0]!.branches[1]!.when.conditions[0]).toMatchObject({operator:'equals',value:'first'})
    wrapper.unmount()
  })

  it('renders ordinary nested sections and preserves list-backed repeat groups', async () => {
    const definition = surveyV3Schema.parse({schemaVersion:3,title:{en:'Project',fr:'Projet'}, questions:[
      {id:'items',type:'list',label:{en:'Locations',fr:'Lieux'},required:false,maxItems:3},
      {id:'name',type:'text',label:{en:'Name',fr:'Nom'},required:false,maxLength:100},
      {id:'detail',type:'text',label:{en:'Details',fr:'Détails'},required:false,maxLength:100}
    ],pages:[{id:'page',title:{en:'Project',fr:'Projet'},questionIds:['items'],branches:[],groups:[
      {id:'overview',title:{en:'Overview',fr:'Aperçu'},description:{en:'Project details',fr:'Détails du projet'},questionIds:['detail'],groups:[
        {id:'location',title:{en:'Location {{item}}',fr:'Lieu {{item}}'},repeatFor:'items',questionIds:['name'],groups:[]}
      ]}
    ]}]})
    const wrapper = mount(FormTest,{props:{definition,locale:'en'}})
    expect(wrapper.get('h5').text()).toBe('Overview')
    await button(wrapper,'Add item').trigger('click')
    await wrapper.get('input[name^="items-"]').setValue('Ottawa')
    expect(wrapper.get('h6').text()).toBe('Location Ottawa')
    expect(wrapper.find('[data-repeat-set]').exists()).toBe(false)
    expect(wrapper.findAll('input')).toHaveLength(3)
    wrapper.unmount()
  })
})

import FormGrantElement from '../components/FormGrantElement.vue'
import FormGrantDesigner from '../components/FormGrantDesigner.vue'
import { budgetConfig, activityConfig, budgetEntry, activityEntry, grantForm } from './fixtures/grant-forms'
import { readBudgetAnswer, readActivityAnswer, validateAnswers, designerSurveySchema } from '@gcs-ssc/survey'
import type { AdvancedQuestion } from '@gcs-ssc/survey'

describe('structured budget and activity controls', () => {
  const grantField = (type: 'budget' | 'activities', value = ''): SurveyField => ({
    id: type, question: grantForm().questions.find(question => question.type === type)!, label: type,
    hint: '', required: true, disabled: false, value, error: undefined, options: [], setValue: vi.fn()
  })
  const render = (field: SurveyField) => {
    const wrapper = mount(FormGrantElement, { props: { field, locale: 'en' } })
    field.setValue = (value: string) => { field.value = value; void wrapper.setProps({ field: { ...field } }) }
    return wrapper
  }
  it('adds budget rows with native required controls and readable choices; removing preserves sibling data', async () => {
    const field = grantField('budget', JSON.stringify({ version: 1, rows: [budgetEntry('r_one'), budgetEntry('r_two')] }))
    const wrapper = render(field)
    const name = 'budget-r_one-totalCost'
    expect(wrapper.get(`input[name="${name}"]`).attributes('required')).toBeDefined()
    expect(wrapper.text()).toContain('Staff / Salaries')
    await wrapper.findAll('button').find(button => button.text() === 'Remove entry')!.trigger('click')
    await flushPromises()
    expect(readBudgetAnswer(field.value)!.rows.map(row => row.id)).toEqual(['r_two'])
    expect(readBudgetAnswer(field.value)!.rows[0]!.programFunding).toBe('1000.00')
    wrapper.unmount()
  })
  it('calculates funding, updates exact summary, and retains independent other-source rows', async () => {
    const field = grantField('budget', JSON.stringify({ version: 1, rows: [budgetEntry()] }))
    const wrapper = render(field)
    await wrapper.findAll('button').find(button => button.text() === 'Add a funding source')!.trigger('click')
    await flushPromises()
    const source = readBudgetAnswer(field.value)!.rows[0]!.otherFunding[0]!
    await wrapper.get(`select[name="budget-${source.id}-subtypeId"]`).setValue('province')
    await wrapper.get(`input[name="budget-${source.id}-amount"]`).setValue('500.00')
    await flushPromises()
    expect(wrapper.text()).toContain('1500.00')
    expect(wrapper.text()).toContain('Other funding included in stacking')
    expect(readBudgetAnswer(field.value)!.rows[0]!.otherFunding[0]!.amount).toBe('500.00')
    await wrapper.findAll('button').find(button => button.text() === 'Add a cost')!.trigger('click')
    await flushPromises()
    const charge = readBudgetAnswer(field.value)!.rows[1]!
    await wrapper.get(`select[name="budget-${charge.id}-costItemId"]`).setValue('admin')
    await flushPromises()
    expect(readBudgetAnswer(field.value)!.rows[1]!.programFunding).toBe('100.00')
    expect(wrapper.get(`input[name="budget-${charge.id}-programFunding"]`).attributes('readonly')).toBeDefined()
    wrapper.unmount()
  })
  it('renders field-local money and coverage errors, and switches preview language', async () => {
    const input = budgetEntry(); input.programFunding = '1600'
    const field = grantField('budget', JSON.stringify({ version: 1, rows: [input] })); field.error = 'choice'
    const wrapper = render(field)
    expect(wrapper.text()).toContain('exceeds total cost')
    await wrapper.setProps({ locale: 'fr' })
    expect(wrapper.text()).toContain('dépassent le coût total')
    expect(wrapper.text()).toContain('(obligatoire)')
    expect(wrapper.text()).not.toContain('(required)')
    wrapper.unmount()
  })
  it('does not require every checkbox in an activity selection group and retains bilingual answers', async () => {
    const field = grantField('activities', JSON.stringify({ version: 1, rows: [activityEntry()] }))
    const wrapper = render(field)
    expect(wrapper.get('input[type="checkbox"]').attributes('required')).toBeUndefined()
    expect(wrapper.text()).toContain('Select at least one')
    await wrapper.get('input[name="activities-r_activity-name-en"]').setValue('New title')
    await flushPromises()
    expect(readActivityAnswer(field.value)!.rows[0]!.name.en).toBe('New title')
    await wrapper.setProps({ locale: 'fr' })
    expect(wrapper.get('input[name="activities-r_activity-name-fr"]').attributes('required')).toBeUndefined()
    expect(wrapper.text()).toContain('Résultats')
    wrapper.unmount()
  })
  it('respects disabled state and row limits, with every action inside the form remaining a button', async () => {
    const field = grantField('budget', JSON.stringify({ version: 1, rows: [budgetEntry()] })); field.disabled = true
    const wrapper = render(field)
    expect(wrapper.findAll('button').every(button => button.attributes('disabled') !== undefined)).toBe(true)
    expect(wrapper.findAll('button').every(button => button.attributes('type') === 'button')).toBe(true)
    expect(wrapper.findAll('input').every(input => input.attributes('disabled') !== undefined)).toBe(true)
    wrapper.unmount()
  })
  it('validates v4 forms in Test and local draft storage without changing v3 archives', async () => {
    const definition = grantForm()
    expect(designerSurveySchema.safeParse(definition).success).toBe(true)
    expect(validateAnswers(definition, { budget: JSON.stringify({ version: 1, rows: [budgetEntry()] }),
      activities: JSON.stringify({ version: 1, rows: [activityEntry()] }) })).toEqual({})
  })
  it('loads and synchronizes stream snapshots while preserving activity choices and settings', async () => {
    const question = grantForm().questions.find(question => question.type === 'activities')! as Extract<AdvancedQuestion, { type: 'activities' }>
    get.mockImplementation(async (url: string) => url.endsWith('/form-options')
      ? { streams: [{ id: '10', label: { en: 'Delivery stream', fr: 'Volet de prestation' } }] }
      : { budget: budgetConfig(), activities: { ...activityConfig(), source: { mode: 'stream', agencyId: '1', streamId: '10', capturedAt: '2028-01-01T00:00:00.000Z' }, outcomes: [{ id: 'new_outcome', label: { en: 'New outcome', fr: 'Nouveau résultat' }, gcsId: '100' }] } })
    const wrapper = mount(FormGrantDesigner, { props: { agencyId: '1', question, disabled: false, streamId: '10' } })
    await flushPromises()
    await wrapper.findAll('button').find(button => button.text() === 'Copy current stream settings')!.trigger('click')
    await flushPromises()
    const config = wrapper.emitted('configure')![0]![0] as ReturnType<typeof activityConfig>
    expect(config.outcomes[0]!.gcsId).toBe('100')
    expect(config.responsibleParties).toEqual(question.config.responsibleParties)
    expect(config.bilingual).toBe(false)
    expect(question.config.outcomes[0]!.id).toBe('training')
    wrapper.unmount()
  })
})

describe('stream synchronization lifecycle', () => {
  it('ignores a snapshot that arrives after the selected inspector unmounts', async () => {
    let finish!: (value: unknown) => void
    get.mockImplementation((url: string) => url.endsWith('/form-options') ? Promise.resolve({ streams: [] })
      : new Promise(resolve => { finish = resolve }))
    const question = grantForm().questions.find(question => question.type === 'budget')!
    const wrapper = mount(FormGrantDesigner, { props: { agencyId: '1', question, disabled: false, streamId: '10' } })
    await flushPromises()
    await wrapper.findAll('button').find(button => button.text() === 'Copy current stream settings')!.trigger('click')
    wrapper.unmount()
    finish({ budget: budgetConfig(), activities: activityConfig() })
    await flushPromises()
    expect(wrapper.emitted('configure')).toBeUndefined()
  })
})

describe('inline question authoring', () => {
  it('keeps settings inside the selected question disclosure and adds a long-answer textarea', async () => {
    const wrapper = mount(FormCreator, { props: { agencyId: '1' } })
    await flushPromises()
    await button(wrapper, 'Edit').trigger('click')
    await wrapper.findAll('.designer-type').find(item => item.text().includes('Long answer'))!.trigger('click')
    const question = wrapper.get('.designer-question')
    expect(question.find('input[name="questionEn"]').exists()).toBe(true)
    expect(wrapper.findAll('h2').map(heading => heading.text())).not.toContain('Question settings')
    expect(question.text()).toContain('Delete question')
    await question.get('input[name="questionEn"]').setValue('Project rationale')
    await question.get('input[name="maxLength"]').setValue('2000')
    await button(wrapper, 'Test').trigger('click')
    const control = wrapper.get('textarea')
    expect(control.attributes('rows')).toBe('5')
    expect(control.attributes('maxlength')).toBe('2000')
    wrapper.unmount()
  })
})

describe('choice and table authoring', () => {
  it('offers dropdowns, checkboxes and multi select with options edited in place', async () => {
    const wrapper = mount(FormCreator, { props: { agencyId: '1' } })
    await flushPromises(); await button(wrapper, 'Edit').trigger('click')
    for (const type of ['Dropdown', 'Checkboxes', 'Multi select']) {
      await wrapper.findAll('.designer-type').find(item => item.text().includes(type))!.trigger('click')
      expect(wrapper.findComponent({ name: 'FormChoiceEditor' }).exists()).toBe(true)
      await wrapper.findAll('button').find(item => item.attributes('aria-label')?.startsWith('Edit choice:'))!.trigger('click')
      await wrapper.get('input[name="choiceEn"]').setValue('Option')
      await button(wrapper, 'Save choice').trigger('click')
      await button(wrapper, 'Add choice').trigger('click')
      await wrapper.get('input[name="choiceEn"]').setValue('Another option')
      await wrapper.get('input[name="choiceFr"]').setValue('Autre choix')
      await button(wrapper, 'Save choice').trigger('click')
      expect(wrapper.findComponent({ name: 'FormChoiceEditor' }).props('options')).toHaveLength(2)
      expect(wrapper.find('select[name="choiceDependency"]').exists()).toBe(type === 'Dropdown')
    }
    await wrapper.findAll('.designer-type').find(item => item.text().includes('Table'))!.trigger('click')
    expect(wrapper.get('select[name="tableTotals"]').element.value).toBe('none')
    await wrapper.get('select[name="tableTotals"]').setValue('both')
    await wrapper.get('select[name="columnType0"]').setValue('number')
    await button(wrapper, 'Test').trigger('click')
    await wrapper.findAll('button').find(item => item.text() === 'Add row')!.trigger('click')
    await wrapper.findAll('input[type="number"]').at(-1)!.setValue('0.3')
    expect(wrapper.findAll('output').map(item => item.text())).toEqual(['0.3', '0.3'])
    wrapper.unmount()
  })
  it('marks the checkbox group without requiring each option and preserves stable IDs', async () => {
    const question = { id: 'choices', type: 'checkboxes' as const, label: { en: 'Service areas', fr: 'Domaines' }, required: true, options: [{ value: 'a', label: { en: 'Training', fr: 'Formation' } }, { value: 'b', label: { en: 'Research', fr: 'Recherche' } }] }
    const field = reactive({ question, id: 'choices', label: 'Service areas', hint: '', required: true, disabled: false, value: '[]', error: 'required' as const, options: question.options.map(option => ({ value: option.value, label: option.label.en })), setValue(value: string) { this.value = value } })
    const wrapper = mount(FormTestControl, { props: { field, locale: 'en' } })
    expect(wrapper.get('legend').text()).toContain('(required)')
    expect(wrapper.findAll('input[type="checkbox"]').every(input => input.attributes('required') === undefined)).toBe(true)
    expect(wrapper.get('input[type="checkbox"]').attributes('aria-describedby')).toContain('choices-error')
    await wrapper.get('input[type="checkbox"]').setValue(true)
    expect(field.value).toBe('["a"]')
    await wrapper.setProps({ locale: 'fr' })
    expect(wrapper.get('legend').text()).toContain('(obligatoire)')
    wrapper.unmount()
  })
})

describe('custom grant catalogs', () => {
  it('protects referenced choices and initializes complete custom calculation and funding settings', async () => {
    get.mockResolvedValue({ streams: [] })
    const question = reactive(grantForm().questions.find(question => question.type === 'budget')!) as Extract<AdvancedQuestion, { type: 'budget' }>
    const wrapper = mount(FormGrantDesigner, { props: { agencyId: '1', question, disabled: false, streamId: '10' } }); await flushPromises()
    const catalogs = () => wrapper.findAllComponents({ name: 'GrantOptionEditor' })
    expect(catalogs()).toHaveLength(5)
    catalogs()[0]!.vm.$emit('remove', question.config.categories[0]!.id); await flushPromises()
    expect(question.config.categories).toHaveLength(2); expect(wrapper.find('[role="alert"]').exists()).toBe(true)
    catalogs()[3]!.vm.$emit('remove', question.config.fundingTypes[0]!.id); await flushPromises()
    expect(question.config.fundingTypes).toHaveLength(1)
    for (const catalog of catalogs()) { catalog.vm.$emit('add'); await flushPromises() }
    expect(question.config.categories).toHaveLength(3); expect(question.config.fiscalYears).toHaveLength(2)
    const added = question.config.costItems.at(-1)!
    expect(added.calculation.mode).toBe('manual')
    await wrapper.get(`select[name="budget-${added.id}-category"]`).setValue(question.config.categories[1]!.id)
    await wrapper.get(`select[name="budget-${added.id}-mode"]`).setValue('category')
    expect(added.calculation.sourceCategoryId).toBe(question.config.categories[0]!.id)
    await wrapper.get(`input[name="budget-${added.id}-ratio"]`).setValue('-20.5')
    expect(added.costSharingRatio).toBe(-20.5)
    await wrapper.get(`input[name="budget-${added.id}-ratio"]`).setValue(''); expect(added.costSharingRatio).toBeNull()
    await wrapper.get(`input[name="budget-${added.id}-percentage"]`).setValue('12.5'); expect(added.calculation.percentage).toBe(12.5)
    await wrapper.get(`input[name="budget-${added.id}-percentage"]`).setValue(''); expect(added.calculation.percentage).toBeNull()
    await wrapper.get(`select[name="budget-${added.id}-source"]`).setValue(question.config.categories[0]!.id)
    await wrapper.get(`select[name="budget-${added.id}-mode"]`).setValue('all_other'); expect(added.calculation.sourceCategoryId).toBeNull()
    await wrapper.get(`select[name="budget-${added.id}-mode"]`).setValue('manual'); expect(added.calculation.percentage).toBeNull()
    const source = question.config.fundingSubtypes.at(-1)!, fundingType = question.config.fundingTypes.at(-1)!
    await wrapper.get(`select[name="budget-${source.id}-type"]`).setValue(fundingType.id); expect(source.typeId).toBe(fundingType.id)
    catalogs()[4]!.vm.$emit('remove', source.id); catalogs()[3]!.vm.$emit('remove', fundingType.id); catalogs()[2]!.vm.$emit('remove', added.id); await flushPromises()
    expect(question.config.costItems).toHaveLength(2)
    const year = question.config.fiscalYears.at(-1)!.id; catalogs()[1]!.vm.$emit('remove', year); await flushPromises(); expect(question.config.fiscalYears).toHaveLength(1)
    const category = question.config.categories.at(-1)!.id; catalogs()[0]!.vm.$emit('remove', category); await flushPromises(); expect(question.config.categories).toHaveLength(2)
    await wrapper.get('input[name="budget-maxRows"]').setValue('10'); expect(question.config.maxRows).toBe(10)
    await wrapper.setProps({ disabled: true }); catalogs()[0]!.vm.$emit('add'); await flushPromises(); expect(question.config.categories).toHaveLength(2)
    wrapper.unmount()
  })
  it('keeps stream catalogs locked until customized and reports failed synchronization', async () => {
    const question = reactive(grantForm().questions.find(question => question.type === 'activities')!) as Extract<AdvancedQuestion, { type: 'activities' }>
    question.config.source = { mode: 'stream', agencyId: '1', streamId: '10', capturedAt: '2028-01-01T00:00:00.000Z' }
    get.mockRejectedValue(new Error('offline'))
    const wrapper = mount(FormGrantDesigner, { props: { agencyId: '1', question, disabled: false, streamId: '10' } }); await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('Could not')
    const catalog = wrapper.findAllComponents({ name: 'GrantOptionEditor' })[0]!
    catalog.vm.$emit('add'); await flushPromises(); expect(question.config.outcomes).toHaveLength(1)
    await wrapper.findAll('button').find(button => button.text().toLowerCase().includes('custom'))!.trigger('click'); await flushPromises()
    catalog.vm.$emit('add'); await flushPromises(); expect(question.config.outcomes).toHaveLength(2)
    catalog.vm.$emit('remove', question.config.outcomes.at(-1)!.id); await flushPromises(); expect(question.config.outcomes).toHaveLength(1)
    await wrapper.findAll('button').find(button => button.text() === 'Copy current stream settings')!.trigger('click'); await flushPromises()
    expect(wrapper.get('[role="alert"]').exists()).toBe(true)
    wrapper.unmount()
  })
})

describe('choice table dialogs', () => {
  it('stages bilingual edits, preserves IDs and leaves cancellation unchanged', async () => {
    const options = [{ value: 'training', label: { en: 'Training', fr: 'Formation' } }, { value: 'research', label: { en: 'Research', fr: 'Recherche' } }]
    const wrapper = mount(FormChoiceEditor, { props: { options, disabled: false, questionId: 'question' } })
    await wrapper.get('button[aria-label="Edit choice: Training"]').trigger('click')
    expect(wrapper.get('input[name="choiceEn"]').attributes('required')).toBeDefined()
    expect(wrapper.get('input[name="choiceFr"]').attributes('required')).toBeDefined()
    await wrapper.get('input[name="choiceEn"]').setValue('Updated')
    await button(wrapper, 'Cancel').trigger('click'); expect(options[0]!.label.en).toBe('Training'); expect(wrapper.emitted('update:options')).toBeUndefined()
    await wrapper.get('button[aria-label="Edit choice: Training"]').trigger('click'); await wrapper.get('input[name="choiceEn"]').setValue('Updated')
    await button(wrapper, 'Save choice').trigger('click')
    expect(wrapper.emitted('update:options')![0]![0]).toEqual([{ value: 'training', label: { en: 'Updated', fr: 'Formation' } }, options[1]])
    await button(wrapper, 'Add choice').trigger('click'); expect(button(wrapper, 'Save choice').attributes('disabled')).toBeDefined()
    await wrapper.get('input[name="choiceEn"]').setValue('New'); expect(button(wrapper, 'Save choice').attributes('disabled')).toBeDefined()
    await wrapper.get('input[name="choiceFr"]').setValue('Nouveau'); await button(wrapper, 'Save choice').trigger('click')
    expect((wrapper.emitted('update:options')![1]![0] as typeof options)).toHaveLength(3)
    wrapper.unmount()
  })
  it('confirms removal and closes staged dialogs when the selected question changes', async () => {
    const options = [{ value: 'a', label: { en: 'First', fr: 'Premier' } }, { value: 'b', label: { en: 'Second', fr: 'Deuxième' } }]
    const wrapper = mount(FormChoiceEditor, { props: { options, disabled: false, questionId: 'question' } })
    await wrapper.get('button[aria-label="Delete choice: First"]').trigger('click')
    expect(wrapper.get('[role="dialog"]').text()).toContain('dependent mappings')
    await button(wrapper, 'Cancel').trigger('click'); expect(wrapper.emitted('update:options')).toBeUndefined()
    await wrapper.get('button[aria-label="Delete choice: First"]').trigger('click'); await button(wrapper, 'Delete choice').trigger('click')
    expect(wrapper.emitted('update:options')![0]![0]).toEqual([options[1]])
    await button(wrapper, 'Add choice').trigger('click'); await wrapper.setProps({ questionId: 'other' }); expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    wrapper.unmount()
    state.locale = 'fr'
    const french = mount(FormChoiceEditor, { props: { options, disabled: false, questionId: 'french' } })
    await button(french, 'Ajouter un choix').trigger('click'); expect(french.get('[role="dialog"]').text()).toContain('Anglais'); expect(french.get('[role="dialog"]').text()).toContain('Français')
    await french.setProps({ disabled: true }); expect(button(french, 'Enregistrer le choix').attributes('disabled')).toBeDefined()
    french.unmount()
  })
})
