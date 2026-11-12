// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h, nextTick, ref } from 'vue'
import type { ExtensionEntityTabContext } from '@gcs-ssc/extensions'
import App from '@nuxt/ui/components/App.vue'
import Modal from '@nuxt/ui/components/Modal.vue'
import Button from '@nuxt/ui/components/Button.vue'
import Textarea from '@nuxt/ui/components/Textarea.vue'
import Input from '@nuxt/ui/components/Input.vue'
import FormField from '@nuxt/ui/components/FormField.vue'
import { en } from '@nuxt/ui/locale'
import ProponentVerification from '../components/ProponentVerification.vue'
import { createExtensionTestUiRuntime, installExtensionTestUiRuntime } from '@gcs-ssc/extensions/testing'

/** @returns An ES2022 response barrier for the real network fixture. */
const deferredResponse = () => {
  let resolve: (value: Response) => void = () => {
    throw new Error('Response barrier is not initialized')
  }
  const promise = new Promise<Response>(complete => {
    resolve = complete
  })
  return { promise, resolve }
}

const settle = async () => {
  await nextTick()
  await flushPromises()
}
const response = (value: unknown) =>
  new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } })
const verification = {
  organizationId: 'N-ABCDE',
  organizationName: 'Organization One',
  originAgencyId: '1',
  note: 'Checked the identity',
  verifiedAt: '2026-11-11T12:00:00Z',
  active: true,
  verifierName: 'Reviewer',
  verifierEmail: null
}
describe('actual installed modal verification settlement', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })
  it.each([
    'success',
    'close',
    'read-failure',
    'dispose',
    'proponent-roundtrip',
    'agency-roundtrip',
    'context-roundtrip',
    'delayed-read',
    'post-failure',
    'pending-reopen',
    'replacement-opening'
  ])('settles permanent verification through real controls: %s', async scenario => {
    const held = deferredResponse()
    const readback = deferredResponse()
    let postCalls = 0
    let committed = false
    let verificationReads = 0
    let readFailed = false
    const context = ref<Extract<ExtensionEntityTabContext, { target: 'proponent' }>>({
      target: 'proponent',
      applicantRecipientId: '11',
      ownerType: 'applicantrecipient',
      ownerId: '11',
      agencies: [{ agencyId: '1', nameEn: 'Agency One', nameFr: 'Agence un', config: {} }]
    })
    const toast = vi.fn()
    const transport = vi.fn<typeof fetch>(async (input, init) => {
      const path = String(input)
      if (init?.method === 'POST') {
        if (postCalls++ === 0) return held.promise
        committed = true
        return response({ verified: true, queued: 0 })
      }
      if (path.endsWith('/verification')) {
        verificationReads++
        if (committed && scenario === 'delayed-read') return readback.promise
        if (committed && readFailed) return new Response('Unavailable', { status: 503 })
        return response({ verifications: committed ? [verification] : [] })
      }
      if (path.endsWith('/organizations'))
        return response({
          organizations: [
            {
              id: 'N-ABCDE',
              name: 'Organization One',
              description: 'Description',
              ownerName: 'Owner',
              ownerEmail: 'owner@example.test',
              active: true,
              verified: false,
              memberCount: 1,
              agreementCount: 0
            }
          ]
        })
      if (path.includes('/api/applicant-recipients/')) return response({ can_update: true })
      if (path.includes('/api/extensions/agency/'))
        return response({
          items: [
            {
              extension: { key: 'gcs-ssc-portal-connector' },
              config: { portalProponentVerificationAccess: 'contributor' },
              canConfigure: true
            }
          ]
        })
      throw new Error(`Unexpected path ${path}`)
    })
    vi.stubGlobal('fetch', transport)
    const defaults = createExtensionTestUiRuntime()
    installExtensionTestUiRuntime({
      components: {
        ...defaults.components,
        UModal: Modal,
        UButton: Button,
        UInput: Input,
        UTextarea: Textarea,
        UFormField: FormField
      },
      composables: { ...defaults.composables, useToast: () => ({ add: toast }) }
    })
    const wrapper = mount(
      defineComponent({
        setup: () => () =>
          h(App, { locale: en, toaster: null }, { default: () => h(ProponentVerification, { context: context.value }) })
      }),
      {
        attachTo: document.body,
        global: {
          provide: { [Symbol.for('nuxt-ui.locale-context')]: ref(en) },
          components: { UButton: Button },
          stubs: {
            Icon: true,
            UOverlayProvider: true,
            UTooltip: defineComponent({
              setup:
                (_, { slots }) =>
                  () =>
                    slots.default?.()
            }),
            NuxtLink: true
          }
        }
      }
    )
    try {
      await settle()
      const search = wrapper.get('input[name="organizationSearch"]')
      await search.setValue('Organization')
      const button = (text: string) => wrapper.findAll('button').find(item => item.text() === text)!
      await button('Search').trigger('click')
      await settle()
      await button('Verify').trigger('click')
      await settle()
      const note = document.body.querySelector<HTMLTextAreaElement>('textarea[name="note"]')!
      expect(note).not.toBeNull()
      expect(note.required).toBe(true)
      expect(document.body.textContent).toContain('How was this organization verified?')
      note.value = 'Checked the identity'
      note.dispatchEvent(new Event('input', { bubbles: true }))
      await settle()
      const confirm = [...document.body.querySelectorAll<HTMLButtonElement>('button')].find(
        item => item.textContent?.trim() === 'Confirm permanent link'
      )!
      expect(confirm).not.toBeUndefined()
      confirm.click()
      await settle()
      expect(transport.mock.calls.filter(call => call[1]?.method === 'POST')).toHaveLength(1)
      const close = document.body.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!
      expect(close).not.toBeNull()
      expect(close.disabled).toBe(false)
      if (scenario === 'close' || scenario === 'pending-reopen') {
        close.click()
        await settle()
        expect(document.body.querySelector('textarea[name="note"]')).toBeNull()
        if (scenario === 'pending-reopen') {
          // The old transport still owns admission after its opening has gone away.
          const retryChoice = button('Verify')
          expect(retryChoice).toBeDefined()
          await retryChoice?.trigger('click')
          await settle()
          expect(document.body.querySelector('textarea[name="note"]')).toBeNull()
          expect(transport.mock.calls.filter(call => call[1]?.method === 'POST')).toHaveLength(1)
        }
      }
      if (scenario === 'post-failure') {
        held.resolve(new Response('Unavailable', { status: 503 }))
        await settle()
        expect(note.disabled).toBe(false)
        expect(document.body.querySelector('textarea[name="note"]')).not.toBeNull()
        expect(toast).toHaveBeenCalledOnce()
        expect(toast.mock.calls[0]?.[0]).toMatchObject({ color: 'error' })
        confirm.click()
        await settle()
        expect(transport.mock.calls.filter(call => call[1]?.method === 'POST')).toHaveLength(2)
        expect(wrapper.text()).toContain('Current verification')
        return
      }
      if (scenario === 'dispose') wrapper.unmount()
      if (scenario === 'replacement-opening') {
        context.value = { ...context.value, applicantRecipientId: '12', ownerId: '12' }
        await settle()
        await wrapper.get('input[name="organizationSearch"]').setValue('Organization')
        await button('Search').trigger('click')
        await settle()
        await button('Verify').trigger('click')
        await settle()
        const replacement = document.body.querySelector<HTMLTextAreaElement>('textarea[name="note"]')!
        replacement.value = 'Replacement note'
        replacement.dispatchEvent(new Event('input', { bubbles: true }))
        await settle()
      }
      if (scenario === 'proponent-roundtrip') {
        context.value = { ...context.value, applicantRecipientId: '12', ownerId: '12' }
        await settle()
        context.value = { ...context.value, applicantRecipientId: '11', ownerId: '11' }
        await settle()
      }
      if (scenario === 'agency-roundtrip') {
        const original = context.value.agencies
        context.value = { ...context.value, agencies: original.map(agency => ({ ...agency, agencyId: '2' })) }
        await settle()
        context.value = { ...context.value, agencies: original }
        await settle()
      }
      if (scenario === 'context-roundtrip') {
        // Discovery replaces this public context on host actor/permission replacement.
        const original = context.value
        context.value = { ...original }
        await settle()
        context.value = original
        await settle()
      }
      const readsBeforeAck = verificationReads
      readFailed = scenario === 'read-failure'
      committed = true
      held.resolve(response({ verified: true, queued: 0 }))
      await settle()
      if (scenario === 'delayed-read') {
        expect(verificationReads).toBe(2)
        expect(wrapper.text()).not.toContain('Find a Portal organization')
        expect(document.body.querySelector('textarea[name="note"]')).toBeNull()
        expect(transport.mock.calls.filter(call => call[1]?.method === 'POST')).toHaveLength(1)
        readback.resolve(response({ verifications: [verification] }))
        await settle()
      }
      if (['dispose', 'proponent-roundtrip', 'agency-roundtrip', 'context-roundtrip', 'replacement-opening'].includes(scenario)) {
        expect(verificationReads).toBe(readsBeforeAck)
        expect(toast).not.toHaveBeenCalled()
        if (scenario === 'replacement-opening') {
          const replacement = document.body.querySelector<HTMLTextAreaElement>('textarea[name="note"]')!
          expect(replacement.value).toBe('Replacement note')
          expect(replacement.disabled).toBe(false)
        }
      } else if (scenario === 'read-failure') {
        expect(verificationReads).toBe(2)
        expect(wrapper.text()).toContain('Portal organization verification could not be loaded.')
        expect(wrapper.text()).not.toContain('Find a Portal organization')
        expect(document.body.querySelector('textarea[name="note"]')).toBeNull()
        expect(toast).toHaveBeenCalledOnce()
        expect(toast.mock.calls[0]?.[0]).toMatchObject({ color: 'success' })
        readFailed = false
        await button('Retry')?.trigger('click')
        await settle()
        expect(wrapper.text()).toContain('Current verification')
        expect(wrapper.text()).not.toContain('Portal organization verification could not be loaded.')
        expect(transport.mock.calls.filter(call => call[1]?.method === 'POST')).toHaveLength(1)
      } else {
        expect(verificationReads).toBe(2)
        expect(wrapper.text()).toContain('Current verification')
        expect(wrapper.text()).not.toContain('Find a Portal organization')
        expect(toast).toHaveBeenCalledTimes(['close', 'pending-reopen'].includes(scenario) ? 0 : 1)
      }
    } finally {
      wrapper.unmount()
    }
  })
})
