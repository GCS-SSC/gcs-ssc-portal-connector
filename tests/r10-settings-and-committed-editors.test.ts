// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h, nextTick, ref } from 'vue'
import Input from '@nuxt/ui/components/Input.vue'
import Select from '@nuxt/ui/components/Select.vue'
import Checkbox from '@nuxt/ui/components/Checkbox.vue'
import FormField from '@nuxt/ui/components/FormField.vue'
import Button from '@nuxt/ui/components/Button.vue'
import PortalConnection from '../components/PortalConnection.vue'
import FormCreator from '../components/FormCreator.vue'
import { createExtensionTestUiRuntime, installExtensionTestUiRuntime } from '@gcs-ssc/extensions/testing'
import { en } from '@nuxt/ui/locale'

const Hero = defineComponent({
  props: ['actions', 'title'],
  setup: props => () => h('div', [h('h3', props.title), ...(props.actions ?? []).map((action: {
    label: string; disabled?: boolean; onClick: () => void
  }) => h('button', { disabled: action.disabled, onClick: action.onClick }, action.label))])
})
const Workspace = defineComponent({ setup: (_, { slots }) => () => h('div', [slots.sidebar?.(), slots.default?.()]) })
/** Waits for transport and rendered state to settle. */
const settle = async () => {
  await nextTick()
  await flushPromises()
  await nextTick()
}
/**
 * Creates a controlled HTTP response deadline.
 * @returns The response promise and its resolver.
 */
const deferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => {
    resolve = done
  })
  return { promise, resolve }
}
const response = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } })
/**
 * Finds the mounted native button used by a user.
 * @param text Visible button text.
 * @returns The matching native button.
 */
const findButton = (text: string) => {
  const button = [...document.body.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent?.trim() === text)
  if (!button) throw new Error(`Missing native button: ${text}`)
  return button
}
/**
 * Activates one enabled native control.
 * @param text Visible button text.
 */
const click = async (text: string) => {
  const button = findButton(text)
  expect(button.disabled).toBe(false)
  button.click()
  await settle()
}
const connection = { portalUrl: 'https://portal.example/', portalAgencyId: 'G-ABCDE', hasCredential: true }
const statusCatalog = ['11', '12', '13', '14', '15'].map(id => ({ id, name_en: 'Status ' + id, name_fr: 'Statut ' + id }))
const settings = () => ({ portalStatusIds: ['11'], entityStatusIds: { claim: ['12'], forecast: ['13'], funding_application: ['14'], other_form: ['15'] }, pullIntervalMinutes: 15 })
const boot = (section: 'statuses' | 'intakes') => {
  installExtensionTestUiRuntime({ components: { ...createExtensionTestUiRuntime().components, UButton: Button, CommonSaveButton: Button, CommonEntityHero: Hero, CommonEntityEditorWorkspace: Workspace, UInput: Input, USelect: Select, UCheckbox: Checkbox, UFormField: FormField } })
  return mount(PortalConnection, { props: { agencyId: '1', section, enabled: true, readOnly: false }, attachTo: document.body, global: { provide: { [Symbol.for('nuxt-ui.locale-context')]: ref(en) }, stubs: { Icon: true } } })
}
/**
 * Supplies unrelated authorized Agency reads.
 * @param path Requested SDK endpoint.
 * @returns The matching collection or connection fixture.
 */
const baseGet = (path: string) => {
  if (path.endsWith('/connection'))
    return { connection }
  if (path.endsWith('/receipts'))
    return { receipts: [] }
  if (path.endsWith('/backlog'))
    return { backlog: [], operations: [], outcomes: [], inbound: [] }
  if (path.endsWith('/organizations'))
    return { organizations: [] }
  if (path.includes('/api/applicant-recipients'))
    return { items: [] }
  throw Error('unhandled ' + path)
}
afterEach(() => {
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  sessionStorage.clear()
})
describe('Portal settings baseline and committed parent settlement', () => {
  it.each(['accepted', 'pending', 'failed'] as const)('F1 actual settings save from %s initial baseline', async (schedule) => {
    let persisted = settings()
    const puts: unknown[] = []
    const held = deferred<Response>()
    let getSettings = 0
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (input, init) => {
      const path = String(input)
      if (path.endsWith('/settings')) {
        if (init?.method === 'PUT') {
          const body = JSON.parse(String(init.body))
          puts.push(body)
          persisted = body
          return response({ settings: persisted, statuses: statusCatalog })
        }
        getSettings++
        if (schedule === 'pending')
          return held.promise
        if (schedule === 'failed')
          return new Response('unavailable', { status: 503 })
        return response({ settings: persisted, statuses: statusCatalog })
      }
      return response(baseGet(path))
    }))
    const w = boot('statuses')
    try {
      await settle()
      expect(getSettings).toBe(1)
      if (schedule === 'accepted') {
        await click('Save sync settings')
        expect(puts).toHaveLength(1)
      } else {
        expect(findButton('Save sync settings').disabled).toBe(true)
        findButton('Save sync settings').click()
        await settle()
        expect(puts).toHaveLength(0)
      }
      expect(persisted).toEqual(settings())
    } finally {
      w.unmount()
      held.resolve(response({ settings: persisted, statuses: statusCatalog }))
      await settle()
    }
  })
  it.each([false, true])('F2 actual PortalConnection parent with delayed Intake update; Back=%s', async (back) => {
    const held = deferred<Response>()
    let reads = 0
    let writes = 0
    let persisted = { id: 'D-ABCDE', revision: 1, published: false, surveyId: null, surveyRevision: null, streamId: 'S-ABCDE', nameEn: 'Initial intake', nameFr: 'Demande initiale', startDate: '2027-01-01', endDate: '2027-12-31' }
    let submitted: {
      expectedRevision: number;
      nameEn: string;
    } | undefined
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (input, init) => {
      const path = String(input)
      if (path.endsWith('/intakes')) {
        if (init?.method === 'POST') {
          writes++
          submitted = JSON.parse(String(init.body))
          return held.promise
        }
        reads++
        return response({ intakes: [persisted], streams: [{ id: 'S-ABCDE', nameEn: 'Stream', nameFr: 'Volet' }] })
      }
      if (path.endsWith('/settings'))
        return response({ settings: settings(), statuses: statusCatalog })
      return response(baseGet(path))
    }))
    const w = boot('intakes')
    try {
      await settle()
      await click('Initial intake')
      await click('Edit intake opportunity')
      const field = document.body.querySelector<HTMLInputElement>('input[name="intakeNameEn"]')!
      expect(field).toBeTruthy()
      field.value = 'Committed intake'
      field.dispatchEvent(new Event('input', { bubbles: true }))
      await settle()
      await click('Save intake')
      expect(writes).toBe(1)
      expect(submitted?.expectedRevision).toBe(1)
      expect(submitted?.nameEn).toBe('Committed intake')
      if (back)
        await click('← Initial intake')
      persisted = { ...persisted, nameEn: 'Committed intake', revision: 2 }
      held.resolve(response({ intakeId: persisted.id }))
      await settle()
      expect(reads).toBe(2)
      expect(w.text()).toContain('Committed intake')
      if (back)
        expect(w.text()).not.toContain('Intake saved.')
    } finally {
      w.unmount()
    }
  })
})
describe('F2 existing FormCreator child occurrence', () => {
  it.each([false, true])('native Save revision with actual Intake parent; Back=%s', async (back) => {
    const held = deferred<Response>()
    let reads = 0, writes = 0
    let persisted = { id: 'D-ABCDE', revision: 1, published: false, surveyId: 'V-ABCDE', surveyRevision: 1, streamId: 'S-ABCDE', nameEn: 'Initial intake', nameFr: 'Demande initiale', startDate: '2027-01-01', endDate: '2027-12-31' }
    const definition = { schemaVersion: 3, title: { en: 'Application', fr: 'Demande' }, questions: [{ id: 'name', type: 'text', label: { en: 'Name', fr: 'Nom' }, required: true, maxLength: 200 }], pages: [{ id: 'page_1', title: { en: 'Page 1', fr: 'Page 1' }, questionIds: ['name'], groups: [], branches: [] }] }
    vi.stubGlobal('confirm', () => true)
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (input, init) => {
      const path = String(input)
      if (path.endsWith('/intakes')) {
        reads++
        return response({ intakes: [persisted], streams: [{ id: 'S-ABCDE', nameEn: 'Stream', nameFr: 'Volet' }] })
      }
      if (path.endsWith('/forms/V-ABCDE'))
        return response({ survey: { id: 'V-ABCDE', revision: 1, definition, synced: true } })
      if (path.endsWith('/forms')) {
        if (init?.method === 'POST') {
          writes++
          const body = JSON.parse(String(init.body))
          expect(body).toMatchObject({ action: 'save', intakeId: 'D-ABCDE', surveyId: 'V-ABCDE', expectedRevision: 1 })
          return held.promise
        }
        return response({ surveys: [{ id: 'V-ABCDE', revision: persisted.surveyRevision, title: definition.title, synced: true }], programs: [], streams: [], agreements: [], organizations: [] })
      }
      if (path.endsWith('/settings'))
        return response({ settings: settings(), statuses: statusCatalog })
      return response(baseGet(path))
    }))
    const w = boot('intakes')
    try {
      await settle()
      await click('Initial intake')
      await click('Edit application form')
      await settle()
      await click('Save revision')
      expect(writes).toBe(1)
      if (back)
        await click('← Back to intake')
      persisted = { ...persisted, surveyRevision: 2 }
      held.resolve(response({ survey: { id: 'V-ABCDE', revision: 2 }, attached: true }))
      await settle()
      if (!back)
        await click('← Back to intake')
      expect(w.text()).toContain('Attached form revision 2')
      expect(reads).toBe(2)
    } finally {
      w.unmount()
    }
  })
})
describe('settings recovery and retained accepted baseline', () => {
  it('admits Save only after the delayed first read settles', async () => {
    const held = deferred<Response>()
    const puts: unknown[] = []
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (input, init) => {
      const path = String(input)
      if (path.endsWith('/settings')) {
        if (init?.method === 'PUT') {
          puts.push(JSON.parse(String(init.body)))
          return response({})
        }
        return held.promise
      }
      return response(baseGet(path))
    }))
    const w = boot('statuses')
    try {
      await settle()
      expect(findButton('Save sync settings').disabled).toBe(true)
      held.resolve(response({ settings: settings(), statuses: statusCatalog }))
      await settle()
      await click('Save sync settings')
      expect(puts).toEqual([settings()])
    } finally {
      w.unmount()
    }
  })
  it('retries only GET after an initial settings failure and preserves explicit clears after recovery', async () => {
    let reads = 0
    const puts: unknown[] = []
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (input, init) => {
      const path = String(input)
      if (path.endsWith('/settings')) {
        if (init?.method === 'PUT') {
          puts.push(JSON.parse(String(init.body)))
          return response({})
        }
        return ++reads === 1 ? new Response('unavailable', { status: 503 }) : response({ settings: settings(), statuses: statusCatalog })
      }
      return response(baseGet(path))
    }))
    const w = boot('statuses')
    try {
      await settle()
      expect(findButton('Save sync settings').disabled).toBe(true)
      await click('Retry')
      expect(puts).toHaveLength(0)
      expect(reads).toBe(2)
      const checked = document.body.querySelector<HTMLButtonElement>('button[role="checkbox"][data-state="checked"]')
      expect(checked).toBeTruthy()
      checked!.click()
      await settle()
      await click('Save sync settings')
      expect(puts).toEqual([{ ...settings(), entityStatusIds: { ...settings().entityStatusIds, claim: [] } }])
    } finally {
      w.unmount()
    }
  })
  it('keeps an accepted cached baseline usable after a later read failure', async () => {
    let reads = 0
    const puts: unknown[] = []
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (input, init) => {
      const path = String(input)
      if (path.endsWith('/settings')) {
        if (init?.method === 'PUT') {
          puts.push(JSON.parse(String(init.body)))
          return response({})
        }
        return ++reads === 1 ? response({ settings: settings(), statuses: statusCatalog }) : new Response('unavailable', { status: 503 })
      }
      return response(baseGet(path))
    }))
    const w = boot('statuses')
    try {
      await settle()
      await w.setProps({ section: 'queue' })
      await settle()
      await w.setProps({ section: 'statuses' })
      await settle()
      await click('Save sync settings')
      expect(puts).toEqual([settings()])
    } finally {
      w.unmount()
    }
  })
})
/**
 * Holds an admitted write while the accepted collection remains readable.
 * @param form Whether the write saves an attached form revision.
 * @param readbackFailure Whether the first committed readback fails.
 * @returns Transport observation, acknowledgment and recovery controls.
 */
const installIntakeFixture = (form: boolean, readbackFailure = false) => {
  const held = deferred<Response>()
  let reads = 0
  let writes = 0
  let failReadback = readbackFailure
  let persisted = { id: 'D-ABCDE', revision: 1, published: false, surveyId: form ? 'V-ABCDE' : null,
    surveyRevision: form ? 1 : null, streamId: 'S-ABCDE', nameEn: 'Initial intake', nameFr: 'Demande initiale', startDate: '2027-01-01', endDate: '2027-12-31' }
  const definition = { schemaVersion: 3, title: { en: 'Application', fr: 'Demande' }, questions: [{ id: 'name', type: 'text', label: { en: 'Name', fr: 'Nom' }, required: true, maxLength: 200 }], pages: [{ id: 'page_1', title: { en: 'Page 1', fr: 'Page 1' }, questionIds: ['name'], groups: [], branches: [] }] }
  vi.stubGlobal('confirm', () => true)
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (input, init) => {
    const path = String(input)
    if (path.endsWith('/intakes')) {
      if (init?.method === 'POST') {
        writes++
        return held.promise
      }
      reads++
      if (reads > 1 && failReadback)
        return new Response('unavailable', { status: 503 })
      return response({ intakes: [persisted], streams: [{ id: 'S-ABCDE', nameEn: 'Stream', nameFr: 'Volet' }] })
    }
    if (path.endsWith('/forms/V-ABCDE'))
      return response({ survey: { id: 'V-ABCDE', revision: 1, definition, synced: true } })
    if (path.endsWith('/forms')) {
      if (init?.method === 'POST') {
        writes++
        return held.promise
      }
      return response({ surveys: [{ id: 'V-ABCDE', revision: 1, title: definition.title, synced: true }], programs: [], streams: [], agreements: [], organizations: [] })
    }
    if (path.endsWith('/settings'))
      return response({ settings: settings(), statuses: statusCatalog })
    return response(baseGet(path))
  }))
  return {
    reads: () => reads, writes: () => writes,
    recover: () => { failReadback = false },
    commit: () => {
      persisted = form ? { ...persisted, surveyRevision: 2 } : { ...persisted, nameEn: 'Committed intake', revision: 2 }
      held.resolve(response(form ? { survey: { id: 'V-ABCDE', revision: 2 }, attached: true } : { intakeId: 'D-ABCDE' }))
    }
  }
}
/**
 * Opens the existing inline editor and activates its native Save control.
 * @param form Whether to use the attached form editor.
 */
const beginIntakeSave = async (form: boolean) => {
  await click('Initial intake')
  await click(form ? 'Edit application form' : 'Edit intake opportunity')
  if (!form) {
    const input = document.body.querySelector<HTMLInputElement>('input[name="intakeNameEn"]')!
    input.value = 'Committed intake'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await settle()
  }
  await click(form ? 'Save revision' : 'Save intake')
}
describe.each([false, true])('captured parent settlement, attached form=%s', form => {
  it('retains readback failure with GET-only Retry after Back and ACK', async () => {
    const fixture = installIntakeFixture(form, true)
    const w = boot('intakes')
    try {
      await settle()
      await beginIntakeSave(form)
      await click(form ? '← Back to intake' : '← Initial intake')
      fixture.commit()
      await settle()
      expect(fixture.reads()).toBe(2)
      expect(fixture.writes()).toBe(1)
      expect(w.text()).toContain('could not be loaded')
      fixture.recover()
      await click('Try again')
      expect(fixture.reads()).toBe(3)
      expect(fixture.writes()).toBe(1)
      expect(w.text()).toContain(form ? 'Attached form revision 2' : 'Committed intake')
    } finally {
      w.unmount()
    }
  })
  it.each(['agency', 'security', 'unmount'] as const)('retires old settlement after %s replacement', async (retirement) => {
    const fixture = installIntakeFixture(form)
    const w = boot('intakes')
    let mounted = true
    try {
      await settle()
      await beginIntakeSave(form)
      if (retirement === 'agency') {
        await w.setProps({ agencyId: '2' })
        await settle()
      } else if (retirement === 'security') {
        await w.setProps({ readOnly: true })
        await settle()
        await w.setProps({ readOnly: false })
        await settle()
      } else {
        w.unmount()
        mounted = false
      }
      const reads = fixture.reads()
      fixture.commit()
      await settle()
      expect(fixture.reads()).toBe(reads)
      expect(fixture.writes()).toBe(1)
      if (mounted)
        expect(w.text()).not.toContain('saved.')
    } finally {
      if (mounted)
        w.unmount()
    }
  })
  it('refreshes the collection without replacing a reopened editor', async () => {
    const fixture = installIntakeFixture(form)
    const w = boot('intakes')
    try {
      await settle()
      await beginIntakeSave(form)
      await click(form ? '← Back to intake' : '← Initial intake')
      await click(form ? 'Edit application form' : 'Edit intake opportunity')
      if (!form) {
        const input = w.get('input[name="intakeNameEn"]')
        await input.setValue('Replacement draft')
      }
      fixture.commit()
      await settle()
      expect(fixture.reads()).toBe(2)
      expect(fixture.writes()).toBe(1)
      if (form) {
        expect(w.findComponent(FormCreator).exists()).toBe(true)
        expect(findButton('Save revision').disabled).toBe(false)
      } else {
        expect(w.get('input[name="intakeNameEn"]').element).toHaveProperty('value', 'Replacement draft')
        expect(findButton('Save intake').disabled).toBe(false)
      }
      expect(w.text()).not.toContain('Intake saved.')
    } finally {
      w.unmount()
    }
  })
})

describe('accepted empty settings and newer dirty fields', () => {
  it('allows an accepted empty status configuration and manual schedule', async () => {
    const empty = { portalStatusIds: [], entityStatusIds: { claim: [], forecast: [], funding_application: [], other_form: [] }, pullIntervalMinutes: null }
    const puts: unknown[] = []
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (input, init) => {
      const path = String(input)
      if (path.endsWith('/settings')) {
        if (init?.method === 'PUT') {
          puts.push(JSON.parse(String(init.body)))
          return response({})
        }
        return response({ settings: empty, statuses: statusCatalog })
      }
      return response(baseGet(path))
    }))
    const w = boot('statuses')
    try {
      await settle()
      await click('Save sync settings')
      expect(puts).toEqual([empty])
    } finally { w.unmount() }
  })
  it('preserves a newer explicit clear when an older accepted read finishes', async () => {
    let reads = 0
    const held = deferred<Response>()
    const puts: unknown[] = []
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (input, init) => {
      const path = String(input)
      if (path.endsWith('/settings')) {
        if (init?.method === 'PUT') {
          puts.push(JSON.parse(String(init.body)))
          return response({})
        }
        return ++reads === 1 ? response({ settings: settings(), statuses: statusCatalog }) : held.promise
      }
      return response(baseGet(path))
    }))
    const w = boot('statuses')
    try {
      await settle()
      await w.setProps({ section: 'queue' })
      await settle()
      await w.setProps({ section: 'statuses' })
      const checked = document.body.querySelector<HTMLButtonElement>('button[role="checkbox"][data-state="checked"]')
      expect(checked).toBeTruthy()
      checked!.click()
      await settle()
      held.resolve(response({ settings: settings(), statuses: statusCatalog }))
      await settle()
      await click('Save sync settings')
      expect(puts).toEqual([{ ...settings(), entityStatusIds: { ...settings().entityStatusIds, claim: [] } }])
    } finally { w.unmount() }
  })
})
