import { describe, expect, it } from 'vitest'
import { designerSurveySchema, type AdvancedSurvey } from '@gcs-ssc/survey'
import { updateFormChoices } from '../shared/form-choices'
const label = (en: string) => ({ en, fr: en })
const option = (value: string) => ({ value, label: label(value) })
const when = { match: 'all' as const, conditions: [{ questionId: 'parent', operator: 'equals' as const, value: 'first' }] }
const form = (): AdvancedSurvey => ({ schemaVersion: 4, title: label('Application'), questions: [
  { id: 'parent', label: label('Parent'), type: 'select', required: false, options: [option('first'), option('second')] },
  { id: 'child', label: label('Child'), type: 'select', required: false, options: [option('a'), option('b')], dependsOn: { questionId: 'parent', optionsByValue: { first: [option('a')], second: [option('b')] } } },
  { id: 'detail', label: label('Detail'), type: 'text', maxLength: 500, required: false, visibleWhen: when }
], pages: [{ id: 'page', title: label('Page'), questionIds: ['parent', 'child', 'detail'], groups: [{ id: 'group', title: label('Group'), questionIds: [], visibleWhen: when, groups: [] }], branches: [{ when, destination: { kind: 'end' } }] }] })
describe('choice reference lifecycle', () => {
  it('removes deleted parent mappings and rules while preserving remaining valid choices', () => {
    const definition = form(); expect(designerSurveySchema.safeParse(definition).success).toBe(true)
    updateFormChoices(definition, 'parent', [option('second')])
    const child = definition.questions[1]!; expect(child.type === 'select' && child.dependsOn?.optionsByValue).toEqual({ second: [option('b')] })
    expect(definition.questions[2]!.visibleWhen).toBeUndefined(); expect(definition.pages[0]!.groups[0]!.visibleWhen).toBeUndefined(); expect(definition.pages[0]!.branches).toEqual([])
    expect(designerSurveySchema.safeParse(definition).success).toBe(true)
  })
  it('deletes empty target mappings and refreshes copied bilingual labels on rename', () => {
    const definition = form()
    const renamed = { value: 'b', label: { en: 'New label', fr: 'Nouveau libellé' } }
    updateFormChoices(definition, 'child', [renamed])
    const child = definition.questions[1]!; expect(child.type === 'select' && child.dependsOn?.optionsByValue).toEqual({ second: [renamed] })
    expect(designerSurveySchema.safeParse(definition).success).toBe(true)
  })
})
