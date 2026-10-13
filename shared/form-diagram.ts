import type { GcsExtensionMessageValues } from '@gcs-ssc/extensions'
import type { FlowDiagramDefinition, FlowDiagramNode, FlowDiagramRoute } from '@gcs-ssc/extensions/ui'
import type { AdvancedSurvey, SurveyCondition } from '@gcs-ssc/survey'
import type { messages } from '../i18n/messages'

type FormFlowTranslator = (key: keyof typeof messages.en, values?: GcsExtensionMessageValues) => string

export const createFormFlowDiagram = (
  definition: AdvancedSurvey,
  locale: 'en' | 'fr',
  t: FormFlowTranslator
): FlowDiagramDefinition => {
  const pages = definition.pages
  const questionById = new Map(definition.questions.map(question => [question.id, question]))
  const pageName = (pageId: string) => {
    const page = pages.find(item => item.id === pageId)
    return page?.title[locale] || page?.title.en || pageId
  }
  const destinationId = (destination: AdvancedSurvey['pages'][number]['next']) =>
    destination?.kind === 'page' ? `page:${destination.pageId}` : 'form:end'
  const destinationName = (destination: AdvancedSurvey['pages'][number]['next']) =>
    destination?.kind === 'page' ? pageName(destination.pageId) : t('formFlowEnd')
  const conditionPart = (row: SurveyCondition['conditions'][number]) => {
    const question = questionById.get(row.questionId)
    const label = question?.label[locale] || question?.label.en || row.questionId
    const operators: Record<SurveyCondition['conditions'][number]['operator'], string> = {
      equals: t('formFlowEquals'), notEquals: t('formFlowNotEquals'),
      contains: t('formFlowContains'), greaterThan: t('formFlowGreaterThan'),
      lessThan: t('formFlowLessThan'), answered: t('formFlowAnswered'),
      notAnswered: t('formFlowNotAnswered')
    }
    if (!('value' in row)) return `${label} ${operators[row.operator]}`
    const option = question?.type === 'select' ? question.options.find(item => item.value === row.value) : undefined
    const value = option?.label[locale] || option?.label.en || row.value
    return `${label} ${operators[row.operator]} “${value}”`
  }
  const conditionLabel = (condition: SurveyCondition) => condition.conditions.length
    ? condition.conditions.map(conditionPart).join(condition.match === 'all' ? t('formFlowAnd') : t('formFlowOr'))
    : t('formFlowConditionUnset')
  const pageNodes: FlowDiagramNode[] = pages.map((page, index) => {
    const destination = page.next ?? (pages[index + 1]
      ? { kind: 'page' as const, pageId: pages[index + 1]!.id }
      : { kind: 'end' as const })
    const routes: FlowDiagramRoute[] = page.branches.map((branch, branchIndex) => ({
      targetId: destinationId(branch.destination), kind: 'conditional',
      label: `${t('formFlowIf')} ${branchIndex + 1}`, detail: conditionLabel(branch.when),
      targetLabel: destinationName(branch.destination)
    }))
    routes.push(page.branches.length
      ? { targetId: destinationId(destination), kind: 'default', label: t('formFlowOtherwise'), targetLabel: destinationName(destination) }
      : { targetId: destinationId(destination), kind: 'direct' })
    const title = pageName(page.id)
    return {
      id: `page:${page.id}`, kind: 'step', title,
      eyebrow: `${t('formFlowPageSingular')} ${index + 1}`,
      selectLabel: t('formFlowEditPage', { number: index + 1, name: title }), routes
    }
  })
  const ruleCount = pages.reduce((count, page) => count + page.branches.length, 0)
  const formName = (definition.title[locale] || definition.title.en).trim()
  return {
    title: formName ? `${formName} · ${t('formFlowTitle')}` : t('formFlowTitle'), description: t('formFlowDescription'),
    stats: [
      `${pages.length} ${t(pages.length === 1 ? 'formFlowPageSingular' : 'formFlowPagePlural')}`,
      `${ruleCount} ${t(ruleCount === 1 ? 'formFlowRuleSingular' : 'formFlowRulePlural')}`
    ],
    orderLabel: t('formFlowPagesInOrder'), selectHint: t('formFlowSelectHint'),
    nodes: [
      { id: 'form:start', kind: 'start', title: t('formFlowStart'), routes: [{ targetId: pages[0] ? `page:${pages[0].id}` : 'form:end', kind: 'direct' }] },
      ...pageNodes,
      { id: 'form:end', kind: 'end', title: t('formFlowEnd') }
    ]
  }
}
