// @vitest-environment jsdom
import { clearExtensionUiRuntime, setExtensionUiRuntime } from '@gcs-ssc/extensions/ui'
import type { FlowDiagramDefinition } from '@gcs-ssc/extensions/ui'
import { createExtensionTestUiRuntime } from '@gcs-ssc/extensions/testing'
import { translateGcsExtensionMessage } from '@gcs-ssc/extensions'
import { surveyV3Schema } from '@gcs-ssc/survey'
import type { AdvancedSurvey } from '@gcs-ssc/survey'
import { mount } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import FormFlowMap from '../components/FormFlowMap.vue'
import { messages } from '../i18n/messages'
import { createFormFlowDiagram } from '../shared/form-diagram'

const survey = (): AdvancedSurvey => surveyV3Schema.parse({
  schemaVersion: 3, title: { en: 'Application', fr: 'Demande' },
  questions: [{ id: 'choice', type: 'select', required: false, label: { en: 'Eligible', fr: 'Admissible' },
    options: [{ value: 'yes', label: { en: 'Yes', fr: 'Oui' } }] }],
  pages: [
    { id: 'first', title: { en: 'Eligibility', fr: 'Admissibilité' }, questionIds: ['choice'], groups: [], branches: [] },
    { id: 'end', title: { en: 'Project', fr: 'Projet' }, questionIds: [], groups: [], branches: [] },
    { id: 'last', title: { en: 'Review', fr: 'Vérification' }, questionIds: [], groups: [], branches: [] }
  ]
})

const diagram = (definition: AdvancedSurvey, locale: 'en' | 'fr' = 'en') => createFormFlowDiagram(
  definition, locale, (key, values) => translateGcsExtensionMessage(messages, locale, key, values)
)

afterEach(() => clearExtensionUiRuntime())

describe('portal declarative form diagrams', () => {
  it('retains sequential, skip and explicit end routes without changing the survey', () => {
    const definition = survey()
    definition.pages[0]!.next = { kind: 'page', pageId: 'last' }
    definition.pages[1]!.next = { kind: 'end' }
    const original = structuredClone(definition)
    const result = diagram(definition)
    expect(result.title).toBe('Application · Page flow')
    expect(result.nodes.map(node => node.id)).toEqual(['form:start', 'page:first', 'page:end', 'page:last', 'form:end'])
    expect(result.nodes.map(node => node.routes?.[0]?.targetId)).toEqual(['page:first', 'page:last', 'form:end', 'form:end', undefined])
    expect(result.stats).toEqual(['3 pages', '0 rules'])
    expect(result.nodes[1]).toMatchObject({ eyebrow: 'page 1', title: 'Eligibility' })
    expect(result.nodes.every(node => node.selectLabel === undefined)).toBe(true)
    expect(definition).toEqual(original)
    delete definition.pages[0]!.next
    expect(diagram(definition).nodes[1]!.routes).toEqual([{ targetId: 'page:end', kind: 'direct' }])
  })

  it.each(['en', 'fr'] as const)('preserves branch precedence, localized answers and otherwise targets in %s', locale => {
    const definition = survey()
    definition.pages[0]!.branches = [
      { when: { match: 'all', conditions: [{ questionId: 'choice', operator: 'equals', value: 'yes' }, { questionId: 'choice', operator: 'answered' }] },
        destination: { kind: 'page', pageId: 'last' } },
      { when: { match: 'any', conditions: [{ questionId: 'choice', operator: 'notAnswered' }, { questionId: 'choice', operator: 'notEquals', value: 'yes' }] },
        destination: { kind: 'end' } }
    ]
    const result = diagram(definition, locale)
    expect(result.title).toBe(locale === 'en' ? 'Application · Page flow' : 'Demande · Parcours des pages')
    expect(result.stats).toEqual(locale === 'en' ? ['3 pages', '2 rules'] : ['3 pages', '2 règles'])
    expect(result.nodes[1]!.routes).toEqual([
      { targetId: 'page:last', kind: 'conditional', label: locale === 'en' ? 'If 1' : 'Si 1',
        detail: locale === 'en' ? 'Eligible is “Yes” and Eligible is answered' : 'Admissible est égal à “Oui” et Admissible a une réponse',
        targetLabel: locale === 'en' ? 'Review' : 'Vérification' },
      { targetId: 'form:end', kind: 'conditional', label: locale === 'en' ? 'If 2' : 'Si 2',
        detail: locale === 'en' ? 'Eligible is unanswered or Eligible is not “Yes”' : 'Admissible n’a pas de réponse ou Admissible n’est pas égal à “Oui”',
        targetLabel: locale === 'en' ? 'End' : 'Fin' },
      { targetId: 'page:end', kind: 'default', label: locale === 'en' ? 'Otherwise' : 'Sinon', targetLabel: locale === 'en' ? 'Project' : 'Projet' }
    ])
  })

  it('keeps incomplete conditions readable and preserves raw values with missing source labels', () => {
    const definition = survey()
    definition.pages[1]!.title.fr = ''
    definition.questions[0]!.label.fr = ''
    definition.title.fr = ''
    const operators = ['contains', 'greaterThan', 'lessThan'] as const
    definition.pages[0]!.branches = [
      { when: { match: 'all', conditions: [] }, destination: { kind: 'page', pageId: 'end' } },
      ...operators.map(operator => ({ when: { match: 'all' as const, conditions: [{ questionId: 'missing', operator, value: '0' }] }, destination: { kind: 'end' as const } })),
      { when: { match: 'all', conditions: [{ questionId: 'choice', operator: 'equals', value: 'unknown' }] }, destination: { kind: 'end' } }
    ]
    const result = diagram(definition, 'fr')
    expect(result.title).toBe('Application · Parcours des pages')
    expect(result.nodes[2]!.title).toBe('Project')
    expect(result.nodes[1]!.routes!.map(route => route.detail)).toEqual([
      'Condition non définie', 'missing contient “0”', 'missing est supérieur à “0”', 'missing est inférieur à “0”',
      'Eligible est égal à “unknown”', undefined
    ])
  })

  it('routes an empty form from start to end and uses singular counts', () => {
    const definition = survey()
    definition.pages = []
    definition.title = { en: ' ', fr: '' }
    expect(diagram(definition).title).toBe('Page flow')
    expect(diagram(definition).nodes).toEqual([
      { id: 'form:start', kind: 'start', title: 'Start', routes: [{ targetId: 'form:end', kind: 'direct' }] },
      { id: 'form:end', kind: 'end', title: 'End' }
    ])
    definition.pages = [survey().pages[0]!]
    definition.pages[0]!.branches = [{ when: { match: 'all', conditions: [] }, destination: { kind: 'end' } }]
    expect(diagram(definition).stats).toEqual(['1 page', '1 rule'])
  })

  it('hands reactive read-only markup to the SDK without page navigation', async () => {
    const runtime = createExtensionTestUiRuntime()
    const locale = ref('en')
    runtime.composables.useI18n = () => ({ locale, n: value => String(value) })
    const renderer = defineComponent({
      props: ['definition', 'selectedNodeId', 'filename', 'direction'], emits: ['select-node'],
      setup() { return () => h('div') }
    })
    runtime.components.CommonFlowDiagram = renderer
    setExtensionUiRuntime(runtime)
    const wrapper = mount(FormFlowMap, { props: { definition: survey(), locale: 'en' } })
    const host = wrapper.findComponent(renderer)
    expect(host.props('selectedNodeId')).toBeUndefined()
    expect(host.props('filename')).toBe('form-page-flow')
    expect(host.props('direction')).toBe('vertical')
    host.vm.$emit('select-node', 'page:end')
    expect(wrapper.emitted('select-page')).toBeUndefined()
    locale.value = 'fr'
    await wrapper.setProps({ locale: 'fr' })
    const translated = host.props('definition') as FlowDiagramDefinition
    expect(translated.title).toBe('Demande · Parcours des pages')
    expect(translated.nodes[1]!.title).toBe('Admissibilité')
    expect(translated.nodes.every(node => node.selectLabel === undefined)).toBe(true)
    wrapper.unmount()
  })
})
