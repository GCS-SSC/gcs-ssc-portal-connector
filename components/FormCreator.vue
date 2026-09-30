<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { customAlphabet } from 'nanoid'
import { grantConfigurationReady, emptyBudgetConfig, emptyActivityConfig, designerSurveySchema, upgradeToAdvancedSurvey, type AdvancedGroup, type AdvancedQuestion,
  type AdvancedSurvey, type SurveyCondition } from '@gcs-ssc/survey'
import { ExtensionAssessmentSchemaAccordionSection, ExtensionAssessmentSchemaPageSection, ExtensionButton, ExtensionCheckbox, ExtensionEntityEditorWorkspace, ExtensionEntityHero,
  ExtensionFormField, ExtensionIcon, ExtensionInput, ExtensionModal, ExtensionRouteTabs, ExtensionSaveButton,
  ExtensionSelect, ExtensionTextarea, useExtensionApi, useExtensionI18n } from '@gcs-ssc/extensions/ui'
import { messages } from '../i18n/messages'
import { updateFormChoices } from '../shared/form-choices'
import { computedTemplateReady } from '../shared/form-localization'
import FormChoiceEditor from './FormChoiceEditor.vue'
import FormCondition from './FormCondition.vue'
import FormDesignHelp from './FormDesignHelp.vue'
import FormGrantDesigner from './FormGrantDesigner.vue'
import FormFlowMap from './FormFlowMap.vue'
import FormTest from './FormTest.vue'
import { clearFormDraft, readFormDraft, writeFormDraft, writeFormSelection } from './form-draft-session'

const props = defineProps<{ agencyId: string; disabled?: boolean; selectedFormId?: string; intakeId?: string;
  opportunityId?: string; streamId?: string; standalone?: boolean }>()
const emit = defineEmits<{ close: []; saved: [id: string] }>()
const { locale, t } = useExtensionI18n(messages)
const language = computed<'en' | 'fr'>(() => locale.value === 'fr' ? 'fr' : 'en')
const previewLocale = ref<'en' | 'fr'>(language.value)
const tr = (en: string, fr: string) => language.value === 'fr' ? fr : en
const api = useExtensionApi('gcs-ssc-portal-connector')
const draftOwner = computed(() => props.opportunityId
  ? `${props.agencyId}:opportunity:${props.opportunityId}`
  : props.intakeId ? `${props.agencyId}:intake:${props.intakeId}` : props.agencyId)
type Summary = { id: string; revision: number; title: { en: string; fr: string }; updatedAt: string; synced?: boolean }
type Stream = { id: string; nameEn: string; nameFr: string }
type Program = { id: string; nameEn: string; nameFr: string }
type Agreement = { id: string; organizationId: string; streamId: string; nameEn: string; nameFr: string; agreementNumber: string }
type Organization = { id: string; proponentId: string; name: string }
const surveys = ref<Summary[]>([]), programs = ref<Program[]>([]), streams = ref<Stream[]>([])
const formsLoaded = ref(false)
const agreements = ref<Agreement[]>([]), organizations = ref<Organization[]>([])
const formId = ref(''), revision = ref(0), selectedContainerId = ref('page_1'), selectedQuestionId = ref('')
const tab = ref<'edit' | 'flow' | 'test' | 'publish'>('edit')
const workflowTabs = computed(() => [
  { key: 'edit', value: 'edit', label: t('formEditTab'), icon: 'i-lucide-pencil' },
  { key: 'flow', value: 'flow', label: t('formFlowTab'), icon: 'i-lucide-git-branch' },
  { key: 'test', value: 'test', label: t('formTestTab'), icon: 'i-lucide-flask-conical' },
  ...(!props.intakeId && !props.opportunityId ? [{ key: 'publish', value: 'publish', label: t('formPublishTab'), icon: 'i-lucide-send' }] : [])
])
const busy = ref(false), loading = ref(false), error = ref(''), message = ref('')
const attachmentPending = ref(false)
const syncPending = ref(false)
const detailsOpen = ref(false)
const detailsError = ref('')
const detailsDraft = ref({ titleEn: '', titleFr: '', introductionEn: '', introductionFr: '' })
const introductionRequired = computed(() => Boolean(detailsDraft.value.introductionEn.trim() || detailsDraft.value.introductionFr.trim()))
const detailsValid = computed(() => Boolean(
  detailsDraft.value.titleEn.trim() && detailsDraft.value.titleFr.trim()
  && detailsDraft.value.titleEn.trim().length <= 200 && detailsDraft.value.titleFr.trim().length <= 200
  && (!introductionRequired.value || detailsDraft.value.introductionEn.trim() && detailsDraft.value.introductionFr.trim())
  && detailsDraft.value.introductionEn.trim().length <= 2000 && detailsDraft.value.introductionFr.trim().length <= 2000
))
const agreementId = ref('')
const publicationScope = ref<'agreement' | 'program' | 'stream' | 'organization'>('agreement')
const programId = ref(''), batchStreamId = ref(''), organizationId = ref('')
const newDefinition = (): AdvancedSurvey => ({ schemaVersion: 3,
  title: { en: '', fr: '' }, description: { en: '', fr: '' }, questions: [], pages: [{ id: 'page_1', title: { en: 'Page 1', fr: 'Page 1' }, description: { en: '', fr: '' },
    questionIds: [], groups: [], branches: [] }] })
/**
 *
 * @param survey
 */
const ensureEditableText = (survey: AdvancedSurvey) => {
  survey.description ??= { en: '', fr: '' }
  const visit = (groups: AdvancedGroup[]) => { for (const group of groups) { group.description ??= { en: '', fr: '' }; visit(group.groups) } }
  for (const page of survey.pages) { page.description ??= { en: '', fr: '' }; visit(page.groups) }
  for (const question of survey.questions) question.hint ??= { en: '', fr: '' }
  return survey
}
/**
 *
 * @param survey
 */
const forSaving = (survey: AdvancedSurvey) => {
  const copy = JSON.parse(JSON.stringify(survey)) as AdvancedSurvey
  if (!copy.description?.en.trim() && !copy.description?.fr.trim()) delete copy.description
  /**
   *
   * @param groups
   */
  const visit = (groups: AdvancedGroup[]) => {
    for (const group of groups) {
      if (!group.description?.en.trim() && !group.description?.fr.trim()) delete group.description
      visit(group.groups)
    }
  }
  for (const page of copy.pages) {
    if (!page.description?.en.trim() && !page.description?.fr.trim()) delete page.description
    visit(page.groups)
  }
  for (const question of copy.questions) if (!question.hint?.en.trim() && !question.hint?.fr.trim()) delete question.hint
  return copy
}
const definition = ref<AdvancedSurvey>(newDefinition())
const createsLocalDraft = computed(() => Boolean(!formId.value && props.standalone && !props.intakeId && !props.opportunityId))
const editingDetails = computed(() => Boolean(formId.value || (!createsLocalDraft.value
  && definition.value.title.en.trim() && definition.value.title.fr.trim())))
/**
 *
 */
const openDetails = () => {
  detailsError.value = ''
  detailsDraft.value = {
    titleEn: definition.value.title.en, titleFr: definition.value.title.fr,
    introductionEn: definition.value.description?.en ?? '', introductionFr: definition.value.description?.fr ?? ''
  }
  detailsOpen.value = true
}
/**
 *
 */
const applyDetails = async () => {
  if (!detailsValid.value || disabled.value) return
  const title = { en: detailsDraft.value.titleEn.trim(), fr: detailsDraft.value.titleFr.trim() }
  const introduction = { en: detailsDraft.value.introductionEn.trim(), fr: detailsDraft.value.introductionFr.trim() }
  if (createsLocalDraft.value) {
    busy.value = true
    detailsError.value = ''
    try {
      const result = await api.post<{ survey: { id: string; revision: number } }>(`/agencies/${props.agencyId}/forms`, {
        action: 'createDraft', title, introduction
      })
      definition.value.title = title
      definition.value.description = introduction
      formId.value = result.survey.id
      revision.value = result.survey.revision
      syncPending.value = false
      saved.value = JSON.stringify(definition.value)
      clearFormDraft(draftOwner.value)
      message.value = t('formDetailsCreated')
      detailsOpen.value = false
      emit('saved', formId.value)
      await load()
    } catch { detailsError.value = t('formDetailsCreateFailed') } finally { busy.value = false }
    return
  }
  definition.value.title = title
  definition.value.description = introduction
  detailsOpen.value = false
}
const cancelDetails = () => {
  detailsOpen.value = false
  if (!formId.value && !definition.value.title.en.trim() && !definition.value.title.fr.trim()) emit('close')
}
const heroActions = computed(() => props.disabled
  ? []
  : [
      { label: t('formDetailsEdit'), icon: 'i-lucide-edit-3', color: 'neutral' as const,
        variant: 'outline' as const, disabled: busy.value, onClick: openDetails },
      { label: tr('Save revision', 'Enregistrer la version'), icon: 'i-lucide-save',
        disabled: disabled.value, loading: busy.value, onClick: () => { void save() } }
    ])
const heroBadges = computed(() => [...(formId.value
  ? revision.value > 0
    ? [{ variant: 'code', label: String(revision.value), prefixLabel: t('formLibraryRevision') }]
    : [{ enumName: 'publication_state', status: 'draft', label: t('formLibraryDraft') }]
  : []), ...(dirty.value ? [{ variant: 'code', label: t('formUnsavedChanges') }] : [])])
const saved = ref(JSON.stringify(definition.value))
const dirty = computed(() => JSON.stringify(definition.value) !== saved.value)
const disabled = computed(() => props.disabled || busy.value)
const invalidLimit = (value: number, max: number) => !Number.isInteger(value) || value < 1 || value > max
const endpoint = computed(() => props.opportunityId
  ? `/agencies/${props.agencyId}/opportunities/${props.opportunityId}/forms`
  : `/agencies/${props.agencyId}/forms`)
const writeEndpoint = computed(() => props.opportunityId
  ? `/agencies/${props.agencyId}/opportunities/${props.opportunityId}`
  : endpoint.value)
const nextId = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 12)
const uid = (prefix: string) => `${prefix}_${nextId()}`
type Container = AdvancedSurvey['pages'][number] | AdvancedGroup
type Node = { id: string; kind: 'page' | 'group'; title: string; depth: number; pageId: string; parentId?: string; item: Container; repeatFor?: string }
const nodes = computed<Node[]>(() => {
  const result: Node[] = []
  /**
   *
   * @param groups
   * @param depth
   * @param pageId
   * @param parentId
   */
  const visit = (groups: AdvancedGroup[], depth: number, pageId: string, parentId: string) => {
    for (const group of groups) {
      const repeatLabel = group.repeatFor ? definition.value.questions.find(question => question.id === group.repeatFor)?.label[language.value] : undefined
      result.push({ id: group.id, kind: 'group', title: repeatLabel ? `${repeatLabel} · ${t('designEachEntry')}` : group.title[language.value].replaceAll('{{item}}', t('designEachEntry')), depth, pageId, parentId, item: group, repeatFor: group.repeatFor })
      visit(group.groups, depth + 1, pageId, group.id)
    }
  }
  for (const page of definition.value.pages) {
    result.push({ id: page.id, kind: 'page', title: page.title[language.value], depth: 0, pageId: page.id, item: page })
    visit(page.groups, 1, page.id, page.id)
  }
  return result
})
const collapsedNodeIds = ref(new Set<string>())
const expandableNodeIds = computed(() => new Set(nodes.value.map(node => node.parentId).filter((id): id is string => Boolean(id))))
const visibleNodes = computed(() => {
  const byId = new Map(nodes.value.map(node => [node.id, node]))
  return nodes.value.filter(node => {
    let parentId = node.parentId
    while (parentId) {
      if (collapsedNodeIds.value.has(parentId)) return false
      parentId = byId.get(parentId)?.parentId
    }
    return true
  })
})
/**
 *
 * @param node
 */
const toggleNode = (node: Node) => {
  const next = new Set(collapsedNodeIds.value)
  if (next.has(node.id)) next.delete(node.id)
  else {
    next.add(node.id)
    const byId = new Map(nodes.value.map(item => [item.id, item]))
    let parentId = byId.get(selectedContainerId.value)?.parentId
    while (parentId) {
      if (parentId === node.id) {
        selectedContainerId.value = node.id
        selectedQuestionId.value = ''
        break
      }
      parentId = byId.get(parentId)?.parentId
    }
  }
  collapsedNodeIds.value = next
}
const selected = computed(() => nodes.value.find((node) => node.id === selectedContainerId.value) ?? nodes.value[0])
const pendingDeleteId = ref<string | null>(null)
const pendingDeleteQuestion = computed(() => definition.value.questions.find(question => question.id === pendingDeleteId.value))
const instructionsRequired = computed(() => Boolean(selected.value?.item.description?.en.trim() || selected.value?.item.description?.fr.trim()))
const selectedQuestion = computed(() => definition.value.questions.find((question) => question.id === selectedQuestionId.value))
const selectQuestion = async (id: string) => {
  if (selectedQuestionId.value === id) return
  const focused = document.activeElement?.closest('.designer-question')
  selectedQuestionId.value = id
  await nextTick()
  if (focused) document.querySelector<HTMLElement>(`[data-question-id="${id}"] button`)?.focus()
}
const repeatSource = computed(() => {
  const node = selected.value
  return node?.kind === 'group' && node.repeatFor
    ? definition.value.questions.find((question) => question.id === node.repeatFor && question.type === 'repeat') as Extract<AdvancedQuestion, { type: 'repeat' }> | undefined
    : undefined
})
const areaQuestions = computed(() => selected.value?.item.questionIds
  .map((id) => definition.value.questions.find((question) => question.id === id))
  .filter((question): question is AdvancedQuestion => question !== undefined && question.type !== 'repeat') ?? [])
const questionTypes = computed(() => [
  { value: 'textarea', label: t('formLongAnswer'), glyph: '¶' },
  { value: 'text', label: tr('Short answer', 'Réponse courte'), glyph: 'T' },
  { value: 'email', label: tr('Email', 'Courriel'), glyph: '@' },
  { value: 'number', label: tr('Number', 'Nombre'), glyph: '#' },
  { value: 'date', label: tr('Date', 'Date'), glyph: '▦' },
  { value: 'select', label: tr('Dropdown', 'Liste déroulante'), glyph: '▾' },
  { value: 'checkboxes', label: tr('Checkboxes', 'Cases à cocher'), glyph: '☑' },
  { value: 'multiselect', label: tr('Multi select', 'Sélection multiple'), glyph: '☷' },
  { value: 'budget', label: t('grantBudget'), glyph: '$' },
  { value: 'activities', label: t('grantActivities'), glyph: '✓' },
  { value: 'table', label: tr('Table', 'Tableau'), glyph: '▤' },
  { value: 'computed', label: tr('Calculated value', 'Valeur calculée'), glyph: '∑' }
] as const)
const typeName = (type: AdvancedQuestion['type']) => questionTypes.value.find((item) => item.value === type)?.label ?? type
const bilingual = (value?: { en: string; fr: string }) => Boolean(value?.en.trim() && value.fr.trim())
const publicationChecks = computed(() => {
  const allContainers: Container[] = []
  const collect = (item: Container) => { allContainers.push(item); item.groups.forEach(collect) }
  definition.value.pages.forEach(collect)
  const contentPair = (value?: { en: string; fr: string }) => !value?.en.trim() && !value?.fr.trim() || bilingual(value)
  return [
    { label: tr('Form title in English and French', 'Titre du formulaire en anglais et en français'), ok: bilingual(definition.value.title), target: 'details' as const },
    { label: tr('Page and section headings in both languages', 'Titres des pages et des sections dans les deux langues'), ok: allContainers.every((item) => bilingual(item.title)), target: 'edit' as const },
    { label: tr('Form introduction translated when provided', 'Introduction du formulaire traduite, si elle est fournie'), ok: contentPair(definition.value.description), target: 'details' as const },
    { label: tr('Page and section instructions translated when provided', 'Instructions des pages et des sections traduites, si elles sont fournies'), ok: allContainers.every((item) => contentPair(item.description)), target: 'edit' as const },
    { label: tr('At least one question', 'Au moins une question'), ok: definition.value.questions.length > 0, target: 'edit' as const },
    { label: tr('Questions and help text translated', 'Questions et textes d’aide traduits'), ok: definition.value.questions.every((item) => bilingual(item.label) && contentPair(item.hint)), target: 'edit' as const },
    { label: tr('Choices and table columns translated', 'Choix et colonnes de tableau traduits'), ok: definition.value.questions.every((item) => (item.type === 'select' || item.type === 'checkboxes' || item.type === 'multiselect')
      ? item.options.every((option) => bilingual(option.label))
      : item.type === 'table'
        ? item.columns.every((column) => bilingual(column.label))
        : true), target: 'edit' as const },
    { label: tr('Calculated values use selected fields without fixed text', 'Les valeurs calculées utilisent les champs sélectionnés sans texte fixe'),
      ok: definition.value.questions.every((item) => item.type !== 'computed' || computedTemplateReady(item.template, item.sourceIds)), target: 'edit' as const },
    { label: t('grantReadyBudget'), ok: definition.value.questions.every(item => item.type !== 'budget' || grantConfigurationReady(item)), target: 'edit' as const },
    { label: t('grantReadyActivities'), ok: definition.value.questions.every(item => item.type !== 'activities' || grantConfigurationReady(item)), target: 'edit' as const },
    { label: tr('Latest revision saved', 'Dernière version enregistrée'), ok: Boolean(formId.value) && revision.value > 0 && !dirty.value, target: 'edit' as const },
    { label: t('formSyncPendingCheck'),
      ok: !syncPending.value, target: 'edit' as const }
  ]
})
const readyToPublish = computed(() => publicationChecks.value.every((check) => check.ok))
type ConditionQuestion = { id: string; label: string; type: AdvancedQuestion['type']; options?: { value: string; label: string }[] }
/**
 *
 * @param kind
 * @param targetId
 * @param survey
 */
const conditionChoicesFor = (kind: 'question' | 'group' | 'page', targetId: string, survey = definition.value): ConditionQuestion[] => {
  const seen: { question: AdvancedQuestion; scope: string[] }[] = []
  let eligible: typeof seen = []
  const capture = (scope: string[]) => {
    eligible = seen.filter((item) => item.scope.every((part, index) => scope[index] === part))
  }
  /**
   *
   * @param ids
   * @param scope
   */
  const place = (ids: string[], scope: string[]) => {
    for (const id of ids) {
      if (kind === 'question' && id === targetId) capture(scope)
      const question = survey.questions.find((item) => item.id === id)
      if (question) seen.push({ question, scope })
    }
  }
  /**
   *
   * @param groups
   * @param ancestors
   */
  const visit = (groups: AdvancedGroup[], ancestors: string[]) => {
    for (const group of groups) {
      if (kind === 'group' && group.id === targetId) capture(ancestors)
      const scope = group.repeatFor ? [...ancestors, group.repeatFor] : ancestors
      place(group.questionIds, scope)
      visit(group.groups, scope)
    }
  }
  for (const page of survey.pages) {
    place(page.questionIds, [])
    visit(page.groups, [])
    if (kind === 'page' && page.id === targetId) capture([])
  }
  return eligible.map(({ question }) => ({
    id: question.id, label: question.label[language.value] || question.id, type: question.type,
    ...((question.type === 'select' || question.type === 'checkboxes' || question.type === 'multiselect')
      ? { options: question.options.map((option) => ({
          value: option.value, label: option.label[language.value] || option.value
        })) }
      : {})
  }))
}
/**
 *
 * @param survey
 */
const referencesValid = (survey: AdvancedSurvey) => {
  const eligible = (kind: 'question' | 'group' | 'page', id: string) =>
    new Set(conditionChoicesFor(kind, id, survey).map((item) => item.id))
  const conditionValid = (when: SurveyCondition | undefined, choices: Set<string>) =>
    (when?.conditions ?? []).every((item) => choices.has(item.questionId))
  for (const question of survey.questions) {
    const choices = eligible('question', question.id)
    if (!conditionValid(question.visibleWhen, choices)) return false
    if (question.type === 'select' && question.dependsOn && !choices.has(question.dependsOn.questionId)) return false
    if (question.type === 'computed' && question.sourceIds.some((id) => !choices.has(id))) return false
  }
  const visit = (groups: AdvancedGroup[]): boolean => groups.every((group) => {
    const choices = eligible('group', group.id)
    return conditionValid(group.visibleWhen, choices) && (!group.repeatFor || choices.has(group.repeatFor)) && visit(group.groups)
  })
  return survey.pages.every((page) =>
    page.branches.every((branch) => conditionValid(branch.when, eligible('page', page.id))) && visit(page.groups))
}
const questionConditionOptions = computed(() => selectedQuestion.value
  ? conditionChoicesFor('question', selectedQuestion.value.id)
  : [])
const computedSourceOptions = computed(() => questionConditionOptions.value.filter(question => question.type !== 'budget' && question.type !== 'activities').map((question) => ({
  value: question.id, label: question.label
})))
const computedFormatLabel = computed(() => {
  const question = selectedQuestion.value
  if (question?.type !== 'computed' || !question.sourceIds.length) return t('designFormatEmpty')
  return question.template.replace(/\{\{([a-zA-Z][a-zA-Z0-9_-]{0,63})\}\}/g, (_reference, id: string) =>
    definition.value.questions.find(source => source.id === id)?.label[language.value] ?? t('designFormatEmpty'))
})
const groupConditionOptions = computed(() => selected.value?.kind === 'group'
  ? conditionChoicesFor('group', selected.value.id)
  : [])
const listOptions = computed(() => groupConditionOptions.value.filter((question) => question.type === 'list' || question.type === 'repeat')
  .map((question) => ({ value: question.id, label: question.label })))
const branchConditionOptions = computed(() => selected.value?.kind === 'page'
  ? conditionChoicesFor('page', selected.value.id)
  : [])
const selectOptions = computed(() => questionConditionOptions.value.filter((question) => question.type === 'select')
  .map((question) => ({ value: question.id, label: question.label })))
const selectedDependency = computed(() => {
  const question = selectedQuestion.value
  return question?.type === 'select' && question.dependsOn
    ? definition.value.questions.find((item) => item.id === question.dependsOn!.questionId && item.type === 'select')
    : undefined
})
const sourceChoices = computed(() => selectedDependency.value?.type === 'select' ? selectedDependency.value.options : [])
/**
 *
 * @param page
 * @param includeNext
 */
const pageDestinations = (page: AdvancedSurvey['pages'][number], includeNext = false) => [
  ...(includeNext ? [{ value: 'next', label: tr('Next page in order', 'Page suivante dans l’ordre') }] : []),
  ...definition.value.pages.slice(definition.value.pages.findIndex((item) => item.id === page.id) + 1)
    .map((item) => ({ value: item.id, label: item.title[language.value] || item.id })),
  { value: 'end', label: tr('End form', 'Terminer le formulaire') }
]
/**
 *
 * @param pageId
 */
const openFlowPage = (pageId: string) => {
  selectedContainerId.value = pageId
  selectedQuestionId.value = ''
  tab.value = 'edit'
}

/**
 *
 */
const load = async () => {
  loading.value = true; error.value = ''; formsLoaded.value = false
  try {
    const result = await api.get<{ surveys: Summary[]; programs: Program[]; streams: Stream[];
      agreements: Agreement[]; organizations: Organization[] }>(endpoint.value)
    surveys.value = result.surveys ?? []; programs.value = result.programs ?? []; streams.value = result.streams ?? []
    agreements.value = result.agreements ?? []; organizations.value = result.organizations ?? []
    const current = surveys.value.find(item => item.id === formId.value)
    if (current) syncPending.value = current.revision > 0 && current.synced === false
    formsLoaded.value = true
  } catch { error.value = t('formLibraryLoadFailed') } finally { loading.value = false }
}
/**
 *
 */
const resetForm = () => {
  formId.value = ''; revision.value = 0; definition.value = newDefinition()
  collapsedNodeIds.value = new Set<string>()
  syncPending.value = false
  selectedContainerId.value = 'page_1'; selectedQuestionId.value = ''; tab.value = 'edit'
  saved.value = JSON.stringify(definition.value)
}
/**
 *
 * @param id
 */
const selectForm = async (id: string) => {
  if (dirty.value && !confirm(tr('Discard unsaved form changes?', 'Abandonner les modifications non enregistrées?'))) return
  error.value = ''; message.value = ''
  if (!id) {
    resetForm()
    return
  }
  loading.value = true
  try {
    const result = await api.get<{ survey: { id: string; revision: number; definition: AdvancedSurvey; synced?: boolean } }>(`${endpoint.value}/${id}`)
    formId.value = result.survey.id; revision.value = result.survey.revision
    syncPending.value = result.survey.revision > 0 && result.survey.synced === false
    definition.value = ensureEditableText(upgradeToAdvancedSurvey(result.survey.definition))
    collapsedNodeIds.value = new Set<string>()
    selectedContainerId.value = definition.value.pages[0]!.id; selectedQuestionId.value = ''; tab.value = 'edit'
    saved.value = JSON.stringify(definition.value)
  } catch { error.value = tr('The form could not be opened.', 'Impossible d’ouvrir le formulaire.') } finally { loading.value = false }
}
/**
 *
 */
const closeDesigner = () => {
  if (dirty.value && !confirm(tr('Discard unsaved form changes?', 'Abandonner les modifications non enregistrées?'))) return
  if (dirty.value && attachmentPending.value) definition.value = JSON.parse(saved.value) as AdvancedSurvey
  if (attachmentPending.value) persistDraft()
  else clearFormDraft(draftOwner.value)
  emit('close')
}
/**
 *
 */
const save = async () => {
  if (disabled.value) return
  const parsed = designerSurveySchema.safeParse(forSaving(definition.value))
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((issue) => {
      if (issue.path[0] === 'title') return t('formInvalidName')
      if (issue.path[0] === 'description') return t('formInvalidIntroduction')
      if (issue.path[0] === 'questions' && typeof issue.path[1] === 'number') {
        const question = definition.value.questions[issue.path[1]]
        const section = question?.type === 'computed' ? t('formQuestionCalculation')
          : question?.type === 'table' ? t('formQuestionTable')
            : ['select', 'checkboxes', 'multiselect'].includes(question?.type ?? '') ? t('formQuestionChoices')
              : t('formInvalidQuestionSettings')
        return t('formInvalidQuestion', { number: issue.path[1] + 1, title: question?.label[language.value] || t('formUntitled'), section })
      }
      return t('formInvalidStructure')
    }))].slice(0, 4)
    error.value = t('formInvalidDefinition', { fields: fields.join(' · ') })
    if (parsed.error.issues.some((issue) => issue.path[0] === 'title' || issue.path[0] === 'description')) openDetails()
    else tab.value = 'edit'
    return
  }
  busy.value = true; error.value = ''; message.value = ''
  try {
    const result = await api.post<{ survey: { id: string; revision: number }; attached?: boolean; queued?: boolean }>(writeEndpoint.value, {
      action: props.opportunityId ? 'saveForm' : 'save',
      ...(formId.value ? { surveyId: formId.value, expectedRevision: revision.value } : {}),
      ...(props.intakeId ? { intakeId: props.intakeId } : {}),
      definition: parsed.data
    })
    formId.value = result.survey.id; revision.value = result.survey.revision
    syncPending.value = Boolean(result.queued)
    definition.value = ensureEditableText(parsed.data); saved.value = JSON.stringify(definition.value)
    attachmentPending.value = Boolean(props.intakeId && result.attached === false)
    if (!props.intakeId && !props.opportunityId) writeFormSelection(props.agencyId, formId.value)
    if (attachmentPending.value) persistDraft()
    else clearFormDraft(draftOwner.value)
    message.value = attachmentPending.value
      ? ''
      : result.queued
        ? t('formQueuedSave')
        : tr('Form revision saved.', 'Version du formulaire enregistrée.')
    emit('saved', formId.value)
    await load()
    if (attachmentPending.value) error.value = t('intakeAttachFailed')
  } catch { error.value = tr('Save failed. Reload if another editor saved a newer revision.', 'Échec de l’enregistrement. Rechargez si une autre version a été enregistrée.') } finally { busy.value = false }
}
/**
 *
 */
const retryAttachment = async () => {
  if (!props.intakeId || !formId.value || !revision.value || disabled.value || busy.value) return
  busy.value = true; error.value = ''; message.value = ''
  try {
    await api.post(endpoint.value, { action: 'attachIntakeForm', intakeId: props.intakeId,
      surveyId: formId.value, revision: revision.value })
    attachmentPending.value = false
    clearFormDraft(draftOwner.value)
    message.value = t('intakeAttachSuccess')
    emit('saved', formId.value)
  } catch { error.value = t('intakeAttachFailed') } finally { busy.value = false }
}
/**
 *
 * @param action
 */
const publish = async (action: 'publishAgreement' | 'publishScope' | 'publishOrganization') => {
  if (disabled.value || !readyToPublish.value) return
  busy.value = true; error.value = ''; message.value = ''
  try {
    const common = { surveyId: formId.value, revision: revision.value }
    const body = action === 'publishAgreement'
      ? { action, ...common, agreementId: agreementId.value,
          organizationId: agreements.value.find((item) => item.id === agreementId.value)?.organizationId }
      : action === 'publishOrganization'
        ? { action, ...common, organizationId: organizationId.value }
        : { action, ...common, scope: publicationScope.value, scopeId: publicationScope.value === 'program' ? programId.value : batchStreamId.value }
    await api.post(endpoint.value, body)
    message.value = t('formPublished')
    await load()
  } catch { error.value = tr('Publication failed. Check the selected target, dates, and saved revision.', 'Échec de la publication. Vérifiez la cible, les dates et la version enregistrée.') } finally { busy.value = false }
}
/**
 *
 */
const addPage = () => {
  const id = uid('page')
  definition.value.pages.push({ id, title: { en: `Page ${definition.value.pages.length + 1}`, fr: `Page ${definition.value.pages.length + 1}` }, description: { en: '', fr: '' },
    questionIds: [], groups: [], branches: [] })
  selectedContainerId.value = id; selectedQuestionId.value = ''
}
/**
 *
 */
const addGroup = () => {
  const target = selected.value?.item
  if (!target) return
  const id = uid('group')
  target.groups.push({ id, title: { en: 'New section', fr: 'Nouvelle section' }, description: { en: '', fr: '' }, questionIds: [], groups: [] })
  selectedContainerId.value = id; selectedQuestionId.value = ''
}
/**
 *
 * @param target
 * @param listId
 */
const addRepeatGroup = (target: Container, listId: string) => {
  error.value = ''
  const existing = target.groups.find((group) => group.repeatFor === listId)
  if (existing) {
    selectedContainerId.value = existing.id; selectedQuestionId.value = ''
    return
  }
  const id = uid('group')
  const source = definition.value.questions.find((question) => question.id === listId)
  const title = source?.type === 'repeat'
    ? { en: `${source.label.en} · Entry {{item}}`, fr: `${source.label.fr} · Entrée {{item}}` }
    : { en: 'Details for {{item}}', fr: 'Détails pour {{item}}' }
  target.groups.push({ id, title,
    description: { en: '', fr: '' }, repeatFor: listId, questionIds: [], groups: [] })
  selectedContainerId.value = id; selectedQuestionId.value = ''
}
/**
 *
 * @param type
 */
const addQuestion = (type: AdvancedQuestion['type']) => {
  const target = selected.value?.item
  if (!target) return
  const id = uid('field')
  const base = { id, label: { en: 'New question', fr: 'Nouvelle question' }, hint: { en: '', fr: '' }, required: false }
  const question: AdvancedQuestion = type === 'text' || type === 'textarea'
    ? { ...base, type, maxLength: type === 'textarea' ? 2000 : 500 }
    : type === 'select' || type === 'checkboxes' || type === 'multiselect'
      ? { ...base, type, options: [{ value: 'option_1', label: { en: 'Option 1', fr: 'Option 1' } }] }
      : type === 'list' || type === 'repeat'
        ? { ...base, type, maxItems: 10 }
        : type === 'table'
          ? { ...base, type, maxRows: 20,
              columns: [{ id: 'column_1', label: { en: 'Column 1', fr: 'Colonne 1' }, type: 'text', required: true }] }
          : type === 'computed'
            ? { ...base, type, template: '{{source}}', sourceIds: [] }
            : type === 'budget'
              ? { ...base, label: { en: 'Project budget', fr: 'Budget du projet' }, type, config: emptyBudgetConfig() }
              : type === 'activities'
                ? { ...base, label: { en: 'Project activities', fr: 'Activités du projet' }, type, config: emptyActivityConfig() }
                : { ...base, type }
  if (type === 'budget' || type === 'activities' || type === 'textarea' || type === 'checkboxes' || type === 'multiselect') definition.value.schemaVersion = 4
  definition.value.questions.push(question)
  target.questionIds.push(id)
  selectedQuestionId.value = id
  error.value = ''
  if (type !== 'repeat') void selectQuestion(id)
}
/**
 *
 */
const addFieldsForList = () => {
  const target = selected.value?.item
  const question = selectedQuestion.value
  if (!target || question?.type !== 'list') return
  addRepeatGroup(target, question.id)
}
/**
 *
 */
const addRepeatingSet = () => {
  const target = selected.value?.item
  if (!target) return
  const setNumber = nodes.value.filter((node) => node.repeatFor).length + 1
  addQuestion('repeat')
  const listId = selectedQuestionId.value
  const list = definition.value.questions.find((question) => question.id === listId)
  if (list) list.label = { en: `Set ${setNumber}`, fr: `Série ${setNumber}` }
  addRepeatGroup(target, listId)
}
/**
 *
 * @param id
 */
const removeQuestionById = (id: string) => {
  if (!id) return
  definition.value.questions = definition.value.questions.filter((item) => item.id !== id)
  for (const node of nodes.value) node.item.questionIds = node.item.questionIds.filter((key) => key !== id)
  const cleanCondition = (condition?: SurveyCondition) => {
    const conditions = condition?.conditions.filter((item) => item.questionId !== id)
    return conditions?.length ? { ...condition!, conditions } : undefined
  }
  for (const question of definition.value.questions) {
    question.visibleWhen = cleanCondition(question.visibleWhen)
    if (question.type === 'select' && question.dependsOn?.questionId === id) question.dependsOn = undefined
    if (question.type === 'computed') {
      question.sourceIds = question.sourceIds.filter((source) => source !== id)
      question.template = question.template.replaceAll(`{{${id}}}`, '')
      const remainingReferences = [...question.template.matchAll(/\{\{([a-zA-Z][a-zA-Z0-9_-]{0,63})\}\}/g)]
        .map((match) => match[1]!)
      if (!remainingReferences.some((source) => question.sourceIds.includes(source))) {
        question.template = question.sourceIds[0] ? `{{${question.sourceIds[0]}}}` : '{{source}}'
      }
    }
  }
  /**
   *
   * @param groups
   */
  const cleanGroups = (groups: AdvancedGroup[]) => {
    for (const group of groups) {
      group.visibleWhen = cleanCondition(group.visibleWhen)
      if (group.repeatFor === id) group.repeatFor = undefined
      cleanGroups(group.groups)
    }
  }
  for (const page of definition.value.pages) {
    page.branches = page.branches.flatMap((branch) => {
      const when = cleanCondition(branch.when)
      return when ? [{ ...branch, when }] : []
    })
    cleanGroups(page.groups)
  }
  if (selectedQuestionId.value === id) selectedQuestionId.value = ''
}
/**
 *
 * @param id
 */
const removeQuestion = (id = selectedQuestionId.value) => {
  if (!id) return
  if (nodes.value.some((node) => node.repeatFor === id)) {
    error.value = t('formRemoveRepeatSourceFirst')
    return
  }
  removeQuestionById(id)
  error.value = ''
  message.value = tr('Question removed. Rules and dependencies using it were updated; check any calculated values.',
    'Question retirée. Les règles et dépendances qui l’utilisaient ont été mises à jour; vérifiez les valeurs calculées.')
}
/**
 *
 * @param survey
 * @param id
 */
const containerIn = (survey: AdvancedSurvey, id: string): Container | undefined => {
  /**
   *
   * @param groups
   */
  const visit = (groups: AdvancedGroup[]): AdvancedGroup | undefined => {
    for (const group of groups) {
      if (group.id === id) return group
      const nested = visit(group.groups)
      if (nested) return nested
    }
  }
  for (const page of survey.pages) {
    if (page.id === id) return page
    const group = visit(page.groups)
    if (group) return group
  }
}
/**
 *
 * @param direction
 */
const canMoveQuestion = (direction: -1 | 1) => {
  const trial = JSON.parse(JSON.stringify(definition.value)) as AdvancedSurvey
  const ids = containerIn(trial, selectedContainerId.value)?.questionIds
  if (!ids) return false
  const index = ids.indexOf(selectedQuestionId.value), destination = index + direction
  if (index < 0 || destination < 0 || destination >= ids.length) return false
  ;[ids[index], ids[destination]] = [ids[destination]!, ids[index]!]
  return referencesValid(trial)
}
/**
 *
 * @param direction
 */
const moveQuestion = (direction: -1 | 1) => {
  if (!canMoveQuestion(direction)) {
    error.value = tr('This move would put a question before a rule or dependency it needs.',
      'Ce déplacement placerait une question avant une règle ou une dépendance nécessaire.')
    return
  }
  const ids = selected.value?.item.questionIds
  if (!ids) return
  const index = ids.indexOf(selectedQuestionId.value), destination = index + direction
  if (index < 0 || destination < 0 || destination >= ids.length) return
  ;[ids[index], ids[destination]] = [ids[destination]!, ids[index]!]
}
/**
 *
 * @param targetId
 */
const placeQuestion = (targetId: string) => {
  const questionId = selectedQuestionId.value
  const trial = JSON.parse(JSON.stringify(definition.value)) as AdvancedSurvey
  /**
   *
   * @param groups
   */
  const removeFrom = (groups: AdvancedGroup[]) => {
    for (const group of groups) {
      group.questionIds = group.questionIds.filter((id) => id !== questionId)
      removeFrom(group.groups)
    }
  }
  for (const page of trial.pages) { page.questionIds = page.questionIds.filter((id) => id !== questionId); removeFrom(page.groups) }
  const trialTarget = containerIn(trial, targetId)
  if (!trialTarget) return
  trialTarget.questionIds.push(questionId)
  if (!referencesValid(trial)) {
    error.value = tr('This placement would break an existing rule or dependency. Move its source question first.',
      'Cet emplacement invaliderait une règle ou une dépendance. Déplacez d’abord la question source.')
    return
  }
  for (const node of nodes.value) node.item.questionIds = node.item.questionIds.filter((id) => id !== questionId)
  const target = nodes.value.find((node) => node.id === targetId)
  target?.item.questionIds.push(questionId)
  selectedContainerId.value = targetId
  error.value = ''
}
/**
 *
 */
const removeContainer = () => {
  const node = selected.value
  if (!node) return
  if (node.kind === 'page' && (node.item.questionIds.length || node.item.groups.length)) {
    error.value = tr('Move or remove this container’s questions and groups first.', 'Déplacez ou retirez d’abord les questions et les groupes de ce conteneur.')
    return
  }
  if (node.kind === 'page') {
    if (definition.value.pages.length <= 1) return
    definition.value.pages = definition.value.pages.filter((item) => item.id !== node.id)
    for (const page of definition.value.pages) {
      if (page.next?.kind === 'page' && page.next.pageId === node.id) page.next = undefined
      for (const branch of page.branches) if (branch.destination.kind === 'page' && branch.destination.pageId === node.id)
        branch.destination = { kind: 'end' }
    }
    message.value = tr('Page removed. Navigation to that page was updated.', 'Page retirée. La navigation vers cette page a été mise à jour.')
  } else {
    const group = node.item as AdvancedGroup
    const parentId = nodes.value.find((item) => item.item.groups.some((child) => child.id === node.id))?.id
    const questionIds: string[] = []
    const groupIds = new Set<string>()
    /**
     *
     * @param item
     */
    const collect = (item: AdvancedGroup) => {
      groupIds.add(item.id)
      questionIds.push(...item.questionIds)
      item.groups.forEach(collect)
    }
    collect(group)
    if (nodes.value.some((item) => item.repeatFor && questionIds.includes(item.repeatFor) && !groupIds.has(item.id))) {
      error.value = t('formRemoveDependentSetFirst')
      return
    }
    if (questionIds.length || group.groups.length) {
      const fieldNoun = questionIds.length === 1 ? t('formFieldSingular') : t('formFieldPlural')
      if (!confirm(t('formRemoveSetConfirm', { count: questionIds.length, fieldNoun }))) return
    }
    for (const id of questionIds) removeQuestionById(id)
    if (group.repeatFor && definition.value.questions.find((question) => question.id === group.repeatFor)?.type === 'repeat'
      && !nodes.value.some((item) => item.id !== group.id && item.repeatFor === group.repeatFor))
      removeQuestionById(group.repeatFor)
    for (const parent of nodes.value) parent.item.groups = parent.item.groups.filter((item) => item.id !== node.id)
    message.value = t('formSetRemoved')
    selectedContainerId.value = parentId ?? definition.value.pages[0]!.id
  }
  error.value = ''
  if (node.kind === 'page') selectedContainerId.value = definition.value.pages[0]!.id
  selectedQuestionId.value = ''
}
/**
 *
 */
const updateChoices = (options: { value: string; label: { en: string; fr: string } }[]) => {
  updateFormChoices(definition.value, selectedQuestionId.value, options)
}
/**
 *
 */
const addColumn = () => {
  const question = selectedQuestion.value
  if (question?.type !== 'table') return
  question.columns.push({ id: uid('column'), label: { en: 'New column', fr: 'Nouvelle colonne' }, type: 'text', required: false })
}
/**
 *
 * @param id
 * @param checked
 */
const toggleComputedSource = (id: string, checked: boolean) => {
  const question = selectedQuestion.value
  if (question?.type !== 'computed') return
  const previous = question.sourceIds[0]
  question.sourceIds = checked ? [...new Set([...question.sourceIds, id])] : question.sourceIds.filter((source) => source !== id)
  if (question.template === '{{source}}' || (previous && question.template === `{{${previous}}}`)) {
    question.template = question.sourceIds[0] ? `{{${question.sourceIds[0]}}}` : '{{source}}'
  }
}
/**
 *
 * @param id
 */
const insertComputedReference = (id: string) => {
  const question = selectedQuestion.value
  if (disabled.value || question?.type !== 'computed' || !question.sourceIds.includes(id)) return
  const reference = `{{${id}}}`
  question.template = question.template === '{{source}}' ? reference : `${question.template}${reference}`
}
/**
 *
 * @param sourceId
 */
const setDependency = (sourceId: string) => {
  const question = selectedQuestion.value
  if (question?.type !== 'select') return
  question.dependsOn = sourceId === 'none' ? undefined : { questionId: sourceId, optionsByValue: {} }
}
/**
 *
 * @param parentValue
 * @param optionValue
 * @param checked
 */
const toggleDependentOption = (parentValue: string, optionValue: string, checked: boolean) => {
  const question = selectedQuestion.value
  if (question?.type !== 'select' || !question.dependsOn) return
  const current = question.dependsOn.optionsByValue[parentValue] ?? []
  question.dependsOn.optionsByValue[parentValue] = checked
    ? [...current, ...question.options.filter((option) => option.value === optionValue)]
    : current.filter((option) => option.value !== optionValue)
}
/**
 *
 * @param page
 */
const addBranch = (page: AdvancedSurvey['pages'][number]) => {
  const source = branchConditionOptions.value[0]
  if (!source) return
  page.branches.push({ when: { match: 'all', conditions: [{ questionId: source.id, operator: 'answered' }] },
    destination: { kind: 'end' } })
}
/**
 *
 * @param page
 * @param index
 * @param direction
 */
const moveBranch = (page: AdvancedSurvey['pages'][number], index: number, direction: -1 | 1) => {
  const destination = index + direction
  if (disabled.value || destination < 0 || destination >= page.branches.length) return
  const branch = page.branches.splice(index, 1)[0]!
  page.branches.splice(destination, 0, branch)
}
const setBranchCondition = (page: AdvancedSurvey['pages'][number], index: number, value: SurveyCondition | undefined) => {
  if (value) page.branches[index]!.when = value
}
/**
 *
 * @param page
 * @param index
 * @param value
 */
const setDestination = (page: AdvancedSurvey['pages'][number], index: number, value: string) => {
  if (!pageDestinations(page, index < 0).some((item) => item.value === value)) return
  const target = value === 'end' ? { kind: 'end' as const } : { kind: 'page' as const, pageId: value }
  if (index < 0) page.next = value === 'next' ? undefined : target
  else page.branches[index]!.destination = target
}
const destinationValue = (destination: AdvancedSurvey['pages'][number]['next']) =>
  destination?.kind === 'page' ? destination.pageId : destination?.kind === 'end' ? 'end' : 'next'
/**
 *
 */
const restoreDraft = () => {
  const draft = readFormDraft(draftOwner.value)
  if (!draft || (draft.formId !== (props.selectedFormId ?? '')
    && !(props.intakeId && draft.attachmentPending && !props.selectedFormId))) return false
  if (draft.formId && formsLoaded.value && surveys.value.find((item) => item.id === draft.formId)?.revision !== draft.revision) {
    clearFormDraft(draftOwner.value)
    return false
  }
  formId.value = draft.formId; revision.value = draft.revision
  syncPending.value = draft.revision > 0 && surveys.value.find(item => item.id === draft.formId)?.synced === false
  attachmentPending.value = Boolean(draft.attachmentPending)
  definition.value = ensureEditableText(draft.definition); saved.value = draft.saved
  selectedContainerId.value = draft.selectedContainerId || definition.value.pages[0]?.id || 'page_1'
  selectedQuestionId.value = draft.selectedQuestionId || ''
  tab.value = draft.tab === 'settings' ? 'edit' : draft.tab || 'edit'
  publicationScope.value = draft.publicationScope || 'agreement'
  agreementId.value = draft.agreementId || ''; organizationId.value = draft.organizationId || ''
  programId.value = draft.programId || ''; batchStreamId.value = draft.batchStreamId || ''
  return true
}
/**
 *
 */
const persistDraft = () => {
  if (!dirty.value && !attachmentPending.value) { clearFormDraft(draftOwner.value); return }
  writeFormDraft(draftOwner.value, {
    formId: formId.value, revision: revision.value, definition: definition.value,
    saved: saved.value, selectedContainerId: selectedContainerId.value,
    selectedQuestionId: selectedQuestionId.value, tab: tab.value, publicationScope: publicationScope.value,
    agreementId: agreementId.value, organizationId: organizationId.value,
    programId: programId.value, batchStreamId: batchStreamId.value,
    attachmentPending: attachmentPending.value
  })
}
onMounted(async () => {
  if (!props.selectedFormId) {
    restoreDraft()
    if (!formId.value) openDetails()
    void load()
    return
  }
  await load()
  if (!restoreDraft()) await selectForm(props.selectedFormId)
})
watch([definition, formId, revision, saved, selectedContainerId, selectedQuestionId, tab,
  publicationScope, agreementId, organizationId, programId, batchStreamId, attachmentPending],
persistDraft, { deep: true })
watch(language, (value) => { previewLocale.value = value })
watch(() => props.agencyId, () => {
  resetForm(); surveys.value = []; programs.value = []; streams.value = []
  agreements.value = []; organizations.value = []; void load()
})
</script>

<template>
  <section class="designer space-y-5" :aria-label="tr('Form designer', 'Concepteur de formulaires')">
    <button v-if="!standalone" type="button" class="designer-back" @click="closeDesigner">
      ← {{ props.opportunityId ? tr('Back to opportunity', 'Retour à l’occasion') : props.intakeId ? tr('Back to intake', 'Retour à l’appel') : tr('All forms', 'Tous les formulaires') }}
    </button>
    <ExtensionEntityHero
      icon="i-lucide-list" :title="definition.title[language] || t('formUntitled')"
      :description="definition.description?.[language] || undefined" :badges="heroBadges" :actions="heroActions" />
    <p v-if="loading" role="status">
      {{ tr('Loading forms…', 'Chargement des formulaires…') }}
    </p>
    <ExtensionEntityEditorWorkspace content-test-id="form-detail-content">
      <template #sidebar>
        <ExtensionRouteTabs
          v-model="tab" :items="workflowTabs" :priority-values="['edit', 'flow', 'test', 'publish']" orientation="vertical"
          :ui="{ root: 'w-full', list: 'w-full flex-col items-stretch p-0', trigger: 'w-full justify-start' }" />
        <nav class="designer-sidebar-outline" :aria-label="tr('Form pages and sections', 'Pages et sections du formulaire')">
          <h4 class="designer-eyebrow px-3">
            {{ tr('PAGES & SECTIONS', 'PAGES ET SECTIONS') }}
          </h4>
          <ul class="mt-2 space-y-1 text-sm">
            <li v-for="node in visibleNodes" :key="node.id">
              <div
                class="designer-sidebar-row" :class="{ 'designer-sidebar-row--active': tab === 'edit' && selectedContainerId === node.id }"
                :style="{ paddingInlineStart: `${8 + Math.min(node.depth, 4) * 8}px` }">
                <button
                  v-if="expandableNodeIds.has(node.id)" type="button" class="designer-sidebar-disclosure"
                  :aria-label="`${collapsedNodeIds.has(node.id) ? tr('Expand', 'Développer') : tr('Collapse', 'Réduire')} ${node.title || node.id}`"
                  :aria-expanded="!collapsedNodeIds.has(node.id)" @click="toggleNode(node)">
                  <ExtensionIcon
                    :name="collapsedNodeIds.has(node.id) ? 'i-lucide-chevron-right' : 'i-lucide-chevron-down'"
                    class="size-4" aria-hidden="true" />
                </button>
                <span v-else class="designer-sidebar-disclosure" aria-hidden="true" />
                <button
                  type="button" class="designer-sidebar-item" :title="node.title || node.id"
                  :aria-current="tab === 'edit' && selectedContainerId === node.id ? 'location' : undefined"
                  @click="tab = 'edit'; selectedContainerId = node.id; selectedQuestionId = ''">
                  <ExtensionIcon
                    :name="node.kind === 'page' ? 'i-lucide-file-text' : node.repeatFor ? 'i-lucide-repeat' : 'i-lucide-layers'"
                    class="size-4 shrink-0" aria-hidden="true" />
                  <span class="min-w-0 truncate">{{ node.title || node.id }}</span>
                </button>
              </div>
            </li>
          </ul>
          <ExtensionButton
            color="neutral" variant="ghost" icon="i-lucide-plus"
            class="designer-outline-add mt-2 w-full justify-start" :disabled="disabled" @click="tab = 'edit'; addPage()">
            {{ tr('Add page', 'Ajouter une page') }}
          </ExtensionButton>
        </nav>
      </template>
      <div>
        <div class="designer-content min-w-0 space-y-5">
          <template v-if="tab === 'edit'">
            <template v-if="selected">
              <div class="designer-workspace">
                <div class="designer-canvas space-y-6">
                  <ExtensionAssessmentSchemaPageSection
                    section-id="form-container-details"
                    :title="selected.title || (selected.kind === 'page' ? tr('Untitled page', 'Page sans titre') : tr('Untitled section', 'Section sans titre'))">
                    <ExtensionAssessmentSchemaAccordionSection :key="selected.id" :title="selected.kind === 'page' ? tr('Page details', 'Détails de la page') : tr('Section details', 'Détails de la section')" :default-open="!selected.item.questionIds.length && !selected.item.groups.length">
                      <div class="space-y-3">
                        <div class="grid gap-3 sm:grid-cols-2">
                          <ExtensionFormField :label="tr('Heading · English', 'Titre · anglais')" name="groupTitleEn" required>
                            <ExtensionInput v-model="selected.item.title.en" name="groupTitleEn" required :disabled="disabled" />
                          </ExtensionFormField>
                          <ExtensionFormField :label="tr('Heading · French', 'Titre · français')" name="groupTitleFr" required>
                            <ExtensionInput v-model="selected.item.title.fr" name="groupTitleFr" required :disabled="disabled" />
                          </ExtensionFormField>
                          <ExtensionFormField :label="tr('Instructions · English', 'Instructions · anglais')" name="groupDescriptionEn" :required="instructionsRequired"
                            :description="t('formInstructionsHelp')"
                            :error="instructionsRequired && !selected.item.description!.en.trim() ? t('formInstructionsPairRequired') : undefined">
                            <ExtensionTextarea v-model="selected.item.description!.en" name="groupDescriptionEn" class="w-full" :rows="3" :required="instructionsRequired" :disabled="disabled" />
                          </ExtensionFormField>
                          <ExtensionFormField :label="tr('Instructions · French', 'Instructions · français')" name="groupDescriptionFr" :required="instructionsRequired"
                            :description="t('formInstructionsHelp')"
                            :error="instructionsRequired && !selected.item.description!.fr.trim() ? t('formInstructionsPairRequired') : undefined">
                            <ExtensionTextarea v-model="selected.item.description!.fr" name="groupDescriptionFr" class="w-full" :rows="3" :required="instructionsRequired" :disabled="disabled" />
                          </ExtensionFormField>
                        </div>
                        <ExtensionFormField v-if="selected.kind === 'group'" :label="tr('Repeat this group for each item in', 'Répéter ce groupe pour chaque élément de')" name="repeatFor">
                          <ExtensionSelect
                            :model-value="(selected.item as AdvancedGroup).repeatFor ?? 'none'" name="repeatFor" value-key="value" :disabled="disabled"
                            :items="[{ value: 'none', label: tr('Do not repeat', 'Ne pas répéter') }, ...listOptions]"
                            @update:model-value="(selected.item as AdvancedGroup).repeatFor = String($event) === 'none' ? undefined : String($event)" />
                        </ExtensionFormField>
                        <FormDesignHelp v-if="selected.kind === 'group'" topic="Repeats" />
                        <div v-if="repeatSource" class="grid gap-3 sm:grid-cols-2">
                          <ExtensionFormField :label="tr('Set label · English', 'Libellé de la série · anglais')" name="repeatLabelEn" required>
                            <ExtensionInput v-model="repeatSource.label.en" name="repeatLabelEn" required :disabled="disabled" />
                          </ExtensionFormField>
                          <ExtensionFormField :label="tr('Set label · French', 'Libellé de la série · français')" name="repeatLabelFr" required>
                            <ExtensionInput v-model="repeatSource.label.fr" name="repeatLabelFr" required :disabled="disabled" />
                          </ExtensionFormField>
                          <ExtensionFormField :label="tr('Maximum repetitions', 'Nombre maximal de répétitions')" name="maxItems" required>
                            <ExtensionInput
                              :model-value="repeatSource.maxItems || ''" name="maxItems" type="number" min="1" max="50" required :disabled="disabled"
                              :aria-invalid="invalidLimit(repeatSource.maxItems, 50)" :aria-describedby="invalidLimit(repeatSource.maxItems, 50) ? 'maxItems-error' : undefined"
                              @update:model-value="repeatSource.maxItems = Number($event)" />
                            <p v-if="invalidLimit(repeatSource.maxItems, 50)" id="maxItems-error" role="alert" class="text-sm text-error">
                              {{ t('maxItemsInvalid') }}
                            </p>
                          </ExtensionFormField>
                          <ExtensionCheckbox v-model="repeatSource.required" :label="tr('At least one required', 'Au moins un élément requis')" :disabled="disabled" />
                        </div>
                        <div v-if="selected.kind === 'group'">
                          <p class="text-sm font-medium">
                            {{ tr('Show this group when', 'Afficher ce groupe lorsque') }}
                          </p>
                          <FormDesignHelp topic="Visibility" />
                          <FormCondition v-model="(selected.item as AdvancedGroup).visibleWhen" :questions="groupConditionOptions" :locale="language" :disabled="disabled" />
                        </div>
                        <div class="flex flex-wrap gap-2 pt-2">
                          <ExtensionButton color="neutral" variant="outline" :disabled="disabled" @click="addGroup">
                            {{ tr('Add nested section', 'Ajouter une section imbriquée') }}
                          </ExtensionButton>
                          <ExtensionButton color="neutral" variant="outline" :disabled="disabled" @click="addRepeatingSet">
                            {{ selected.kind === 'page' ? t('formAddRepeatSet') : t('formAddNestedRepeatSet') }}
                          </ExtensionButton>
                          <ExtensionButton color="neutral" variant="ghost" :disabled="disabled || (selected.kind === 'page' && definition.pages.length === 1)" @click="removeContainer">
                            {{ selected.kind === 'group' ? t('formRemoveSet') : tr('Remove empty group or page', 'Retirer le groupe ou la page vide') }}
                          </ExtensionButton>
                        </div>
                      </div>
                    </ExtensionAssessmentSchemaAccordionSection>
                  </ExtensionAssessmentSchemaPageSection>
                  <ExtensionAssessmentSchemaPageSection section-id="form-questions" :title="`${tr('Questions', 'Questions')} · ${areaQuestions.length}`">
                    <div class="designer-question-stack">
                      <p v-if="selected.kind === 'group' && selected.repeatFor" class="text-sm text-muted">
                        {{ t('formRepeatSetHelp') }}
                      </p>
                      <p v-if="!areaQuestions.length" class="designer-empty">
                        {{ selected.kind === 'group' && selected.repeatFor ? t('formEmptyRepeatSet') : tr('Start with a question. Select a type below to add it to this page.', 'Commencez par une question. Sélectionnez un type ci-dessous pour l’ajouter à cette page.') }}
                      </p>
                      <ol class="space-y-3">
                        <li v-for="(question, index) in areaQuestions" :key="question.id" class="relative">
                          <div class="designer-question" :data-question-id="question.id" @click="selectQuestion(question.id)">
                            <ExtensionAssessmentSchemaAccordionSection
                              :key="`${question.id}:${selectedQuestionId === question.id}`"
                              :title="`${index + 1}. ${question.label[language] || tr('Untitled question', 'Question sans titre')}${question.required ? ' *' : ''} · ${typeName(question.type)}`"
                              :default-open="selectedQuestionId === question.id">
                              <div v-if="selectedQuestion && selectedQuestion.id === question.id" class="space-y-4">
                                <p class="designer-eyebrow">
                                  {{ typeName(selectedQuestion.type) }}
                                </p>
                                <div class="grid gap-4 md:grid-cols-2">
                                  <ExtensionFormField :label="tr('Question in English', 'Question en anglais')" name="questionEn" required>
                                    <ExtensionInput v-model="selectedQuestion.label.en" name="questionEn" required :disabled="disabled" />
                                  </ExtensionFormField>
                                  <ExtensionFormField :label="tr('Question in French', 'Question en français')" name="questionFr" required>
                                    <ExtensionInput v-model="selectedQuestion.label.fr" name="questionFr" required :disabled="disabled" />
                                  </ExtensionFormField>
                                </div>

                                <ExtensionCheckbox v-if="selectedQuestion.type !== 'computed'" v-model="selectedQuestion.required" :label="tr('Required response', 'Réponse obligatoire')" :disabled="disabled" />
                                <div class="question-settings-disclosures">
                                <ExtensionAssessmentSchemaAccordionSection :title="t('formQuestionPosition')" level="sub">
<ExtensionFormField :label="tr('Place in', 'Placer dans')" name="questionPlacement">
                                  <ExtensionSelect
                                    :model-value="selected.id" name="questionPlacement" value-key="value" :disabled="disabled"
                                    :items="nodes.map((node) => ({ value: node.id, label: `${'· '.repeat(node.depth)}${node.title}` }))"
                                    @update:model-value="placeQuestion(String($event))" />
                                </ExtensionFormField>
                                <div class="designer-position-actions">
                                  <ExtensionButton color="neutral" variant="outline" :disabled="disabled || !canMoveQuestion(-1)" @click="moveQuestion(-1)">
                                    {{ tr('Move up', 'Monter') }}
                                  </ExtensionButton>
                                  <ExtensionButton color="neutral" variant="outline" :disabled="disabled || !canMoveQuestion(1)" @click="moveQuestion(1)">
                                    {{ tr('Move down', 'Descendre') }}
                                  </ExtensionButton>

                                </div>
                                <ExtensionFormField v-if="selectedQuestion.type === 'text' || selectedQuestion.type === 'textarea'" :label="tr('Maximum characters', 'Nombre maximal de caractères')" name="maxLength" required>
                                  <ExtensionInput
                                    :model-value="selectedQuestion.maxLength || ''" name="maxLength" type="number" min="1" max="5000" required :disabled="disabled"
                                    :aria-invalid="invalidLimit(selectedQuestion.maxLength, 5000)" :aria-describedby="invalidLimit(selectedQuestion.maxLength, 5000) ? 'maxLength-error' : undefined"
                                    @update:model-value="selectedQuestion.maxLength = Number($event)" />
                                  <p v-if="invalidLimit(selectedQuestion.maxLength, 5000)" id="maxLength-error" role="alert" class="text-sm text-error">
                                    {{ t('maxLengthInvalid') }}
                                  </p>
                                </ExtensionFormField>
                                <ExtensionFormField v-if="selectedQuestion.type === 'list'" :label="tr('Maximum items', 'Nombre maximal d’éléments')" name="maxItems" required>
                                  <ExtensionInput
                                    :model-value="selectedQuestion.maxItems || ''" name="maxItems" type="number" min="1" max="50" required :disabled="disabled"
                                    :aria-invalid="invalidLimit(selectedQuestion.maxItems, 50)" :aria-describedby="invalidLimit(selectedQuestion.maxItems, 50) ? 'maxItems-error' : undefined"
                                    @update:model-value="selectedQuestion.maxItems = Number($event)" />
                                  <p v-if="invalidLimit(selectedQuestion.maxItems, 50)" id="maxItems-error" role="alert" class="text-sm text-error">
                                    {{ t('maxItemsInvalid') }}
                                  </p>
                                </ExtensionFormField>
                                <ExtensionFormField v-if="selectedQuestion.type === 'table'" :label="tr('Maximum rows', 'Nombre maximal de lignes')" name="maxRows" required>
                                    <ExtensionInput
                                      :model-value="selectedQuestion.maxRows || ''" name="maxRows" type="number" min="1" max="100" required :disabled="disabled"
                                      :aria-invalid="invalidLimit(selectedQuestion.maxRows, 100)" :aria-describedby="invalidLimit(selectedQuestion.maxRows, 100) ? 'maxRows-error' : undefined"
                                      @update:model-value="selectedQuestion.maxRows = Number($event)" />
                                    <p v-if="invalidLimit(selectedQuestion.maxRows, 100)" id="maxRows-error" role="alert" class="text-sm text-error">
                                      {{ t('maxRowsInvalid') }}
                                    </p>
                                  </ExtensionFormField>
                                </ExtensionAssessmentSchemaAccordionSection>
                                <ExtensionAssessmentSchemaAccordionSection :title="t('formQuestionHelp')" level="sub"><div class="grid gap-4 md:grid-cols-2">
                                  <ExtensionFormField :label="tr('Help text · English', 'Texte d’aide · anglais')" name="questionHintEn">
                                    <ExtensionTextarea v-model="selectedQuestion.hint!.en" name="questionHintEn" class="w-full" :rows="3" :required="false" :disabled="disabled" />
                                  </ExtensionFormField>
                                  <ExtensionFormField :label="tr('Help text · French', 'Texte d’aide · français')" name="questionHintFr">
                                    <ExtensionTextarea v-model="selectedQuestion.hint!.fr" name="questionHintFr" class="w-full" :rows="3" :required="false" :disabled="disabled" />
                                  </ExtensionFormField>
                                </div></ExtensionAssessmentSchemaAccordionSection>
<div v-if="selectedQuestion.type === 'list'" class="space-y-2 border-t border-default pt-4">
                                  <p class="text-sm text-muted">
                                    {{ t('formListFieldsHelp') }}
                                  </p>
                                  <ExtensionButton color="neutral" variant="outline" :disabled="disabled" @click="addFieldsForList">
                                    {{ t('formAddFieldsForList') }}
                                  </ExtensionButton>
                                </div>
                                <template v-if="selectedQuestion.type === 'select' || selectedQuestion.type === 'checkboxes' || selectedQuestion.type === 'multiselect'">
                                  <ExtensionAssessmentSchemaAccordionSection :title="t('formQuestionChoices')" level="sub" :default-open="true">
                                    <FormChoiceEditor :question-id="selectedQuestion.id" :options="selectedQuestion.options" :disabled="Boolean(disabled)" @update:options="updateChoices" />
                                  </ExtensionAssessmentSchemaAccordionSection>
<ExtensionAssessmentSchemaAccordionSection v-if="selectedQuestion.type === 'select'" :title="t('formQuestionDependencies')" level="sub">
                                  <ExtensionFormField :label="tr('Choices depend on', 'Choix selon la réponse à')" name="choiceDependency">
                                    <ExtensionSelect
                                      :model-value="selectedQuestion.dependsOn?.questionId ?? 'none'" name="choiceDependency" value-key="value" :disabled="disabled"
                                      :items="[{ value: 'none', label: tr('No dependency', 'Aucune dépendance') }, ...selectOptions.filter((item) => item.value !== selectedQuestion!.id)]"
                                      @update:model-value="setDependency(String($event))" />
                                  </ExtensionFormField>
                                  <FormDesignHelp topic="Dependencies" />
                                  <p v-if="!selectOptions.length" class="text-sm text-muted">
                                    {{ t('designNoChoiceSources') }}
                                  </p>
                                  <div v-if="selectedQuestion.dependsOn" class="space-y-3">
                                    <p class="text-sm text-muted">
                                      {{ tr('Choose which answers applicants can select for each answer to the earlier question.', 'Choisissez les réponses que les demandeurs pourront sélectionner pour chaque réponse à la question précédente.') }}
                                    </p>
                                    <div v-for="source in sourceChoices" :key="source.value" class="rounded-md border border-default p-3">
                                      <p class="mb-2 text-sm font-semibold">
                                        {{ tr('If the earlier answer is', 'Si la réponse précédente est') }} “{{ source.label[language] }}”
                                      </p>
                                      <p v-if="!selectedQuestion.dependsOn.optionsByValue[source.value]?.length" class="mb-2 text-sm text-warning">
                                        {{ t('designNoMappedChoices') }}
                                      </p>
                                      <div class="grid gap-2">
                                        <ExtensionCheckbox
                                          v-for="choice in selectedQuestion.options" :key="choice.value"
                                          :label="choice.label[language]" :disabled="disabled"
                                          :model-value="selectedQuestion.dependsOn.optionsByValue[source.value]?.some((item) => item.value === choice.value) ?? false"
                                          @update:model-value="toggleDependentOption(source.value, choice.value, Boolean($event))" />
                                      </div>
                                    </div>
                                  </div>
                                </ExtensionAssessmentSchemaAccordionSection>
                                  </template>
                                <ExtensionAssessmentSchemaAccordionSection v-if="selectedQuestion.type === 'budget' || selectedQuestion.type === 'activities'" :title="t('formQuestionGrant')" level="sub">
<FormGrantDesigner
                                  v-if="selectedQuestion.type === 'budget' || selectedQuestion.type === 'activities'"
                                  :key="selectedQuestion.id" :question="selectedQuestion" :agency-id="agencyId" :stream-id="streamId" :disabled="disabled"
                                  @configure="selectedQuestion.config = $event as typeof selectedQuestion.config" /></ExtensionAssessmentSchemaAccordionSection>
                                <ExtensionAssessmentSchemaAccordionSection v-if="selectedQuestion.type === 'table'" :title="t('formQuestionTable')" level="sub">
                                  <div class="designer-settings-body">
                                  <ExtensionFormField :label="tr('Totals', 'Totaux')" name="tableTotals" :description="tr('Only number columns are included. Totals update automatically.', 'Seules les colonnes numériques sont incluses. Les totaux sont recalculés automatiquement.')">
                                    <ExtensionSelect :model-value="'totals' in selectedQuestion ? selectedQuestion.totals ?? 'none' : 'none'" name="tableTotals" value-key="value" :disabled="disabled"
                                      :items="[{ value: 'none', label: tr('None', 'Aucun') }, { value: 'rows', label: tr('Rows', 'Lignes') }, { value: 'columns', label: tr('Columns', 'Colonnes') }, { value: 'both', label: tr('Rows and columns', 'Lignes et colonnes') }]"
                                      @update:model-value="Object.assign(selectedQuestion!, { totals: $event }); definition.schemaVersion = 4" />
                                  </ExtensionFormField>
                                  <div class="designer-columns">
                                    <div class="designer-settings-toolbar">
                                      <h5 class="font-medium">{{ tr('Table columns', 'Colonnes du tableau') }}</h5>
                                      <ExtensionButton color="neutral" variant="outline" icon="i-lucide-plus" :disabled="disabled || selectedQuestion.columns.length >= 20" @click="addColumn">
                                        {{ tr('Add column', 'Ajouter une colonne') }}
                                      </ExtensionButton>
                                    </div>
                                  <div v-for="(column, index) in selectedQuestion.columns" :key="index" class="designer-column">
                                    <div class="designer-settings-toolbar">
                                      <h6 class="font-medium">{{ t('formTableColumnTitle', { number: index + 1 }) }}</h6>
                                      <ExtensionButton color="error" variant="outline" icon="i-lucide-trash-2" :disabled="disabled || selectedQuestion.columns.length === 1" @click="selectedQuestion.columns.splice(index, 1)">
                                        {{ tr('Remove column', 'Retirer la colonne') }}
                                      </ExtensionButton>
                                    </div>
                                    <div class="designer-column-fields">
                                    <ExtensionFormField :label="tr('Column in English', 'Colonne en anglais')" :name="`columnEn${index}`" required>
                                      <ExtensionInput v-model="column.label.en" :name="`columnEn${index}`" required :disabled="disabled" />
                                    </ExtensionFormField>
                                    <ExtensionFormField :label="tr('Column in French', 'Colonne en français')" :name="`columnFr${index}`" required>
                                      <ExtensionInput v-model="column.label.fr" :name="`columnFr${index}`" required :disabled="disabled" />
                                    </ExtensionFormField>
                                    <ExtensionFormField :label="tr('Data type', 'Type de données')" :name="`columnType${index}`">
                                      <ExtensionSelect
                                        v-model="column.type" :name="`columnType${index}`" value-key="value" :disabled="disabled"
                                        :items="[{ value: 'text', label: tr('Text', 'Texte') }, { value: 'number', label: tr('Number', 'Nombre') }, { value: 'date', label: tr('Date', 'Date') }]" />
                                    </ExtensionFormField>
                                    <div class="designer-column-required">
                                      <ExtensionCheckbox v-model="column.required" :label="tr('Required cell', 'Cellule obligatoire')" :disabled="disabled" />
                                    </div>
                                    </div>
                                  </div>
                                  </div>
                                  </div>
                                </ExtensionAssessmentSchemaAccordionSection>
                                <ExtensionAssessmentSchemaAccordionSection v-if="selectedQuestion.type === 'computed'" :title="t('formQuestionCalculation')" level="sub">
                                  <FormDesignHelp topic="Computed" />
                                  <p class="text-sm font-medium">
                                    {{ t('designFormatPreview') }}
                                  </p>
                                  <p class="text-sm text-muted" data-computed-format>
                                    {{ computedFormatLabel }}
                                  </p>
                                  <details class="text-sm">
                                    <summary class="text-primary">
                                      {{ t('designAdvancedTemplate') }}
                                    </summary>
                                    <ExtensionFormField :label="t('designTemplateLabel')" name="computedTemplate" required>
                                      <ExtensionInput
                                        v-model="selectedQuestion.template" name="computedTemplate" required :disabled="disabled"
                                        aria-describedby="computed-template-help computed-template-validation"
                                        :aria-invalid="!computedTemplateReady(selectedQuestion.template, selectedQuestion.sourceIds)" />
                                      <p id="computed-template-help" class="text-sm text-muted">
                                        {{ t('designTemplateHelp') }}
                                      </p>
                                      <p id="computed-template-validation" class="text-sm text-warning" aria-live="polite">
                                        {{ computedTemplateReady(selectedQuestion.template, selectedQuestion.sourceIds) ? '' : t('designTemplateInvalid') }}
                                      </p>
                                    </ExtensionFormField>
                                  </details>
                                  <p v-if="!computedTemplateReady(selectedQuestion.template, selectedQuestion.sourceIds)" class="text-sm text-warning">
                                    {{ t('designTemplateInvalid') }}
                                  </p>
                                  <p id="computed-sources-label" class="text-sm font-medium">
                                    {{ t('computedSourcesRequired') }}
                                  </p>
                                  <p id="computed-sources-help" class="text-sm">
                                    {{ t('computedSourcesHelp') }}
                                  </p>
                                  <div role="group" aria-labelledby="computed-sources-label" aria-describedby="computed-sources-help" class="grid gap-2">
                                    <ExtensionCheckbox
                                      v-for="item in computedSourceOptions" :key="item.value"
                                      :label="item.label" :disabled="disabled" :model-value="selectedQuestion.sourceIds.includes(item.value)"
                                      @update:model-value="toggleComputedSource(item.value, Boolean($event))" />
                                  </div>
                                  <p v-if="!computedSourceOptions.length" class="text-sm text-muted">
                                    {{ t('designNoSources') }}
                                  </p>
                                  <div class="flex flex-wrap gap-2">
                                    <ExtensionButton
                                      v-for="item in computedSourceOptions.filter((source) => selectedQuestion?.type === 'computed' && selectedQuestion.sourceIds.includes(source.value))"
                                      :key="item.value" color="neutral" variant="outline" :disabled="disabled" @click="insertComputedReference(item.value)">
                                      {{ t('designInsertReference', { label: item.label }) }}
                                    </ExtensionButton>
                                    <ExtensionButton
                                      color="neutral" variant="ghost" :disabled="disabled || !selectedQuestion.sourceIds.length"
                                      @click="selectedQuestion.template += ' / '">
                                      {{ t('designAddSeparator') }}
                                    </ExtensionButton>
                                  </div>
                                </ExtensionAssessmentSchemaAccordionSection>
                                <ExtensionAssessmentSchemaAccordionSection :title="t('formQuestionVisibility')" level="sub">
                                  <div class="designer-settings-body">
                                    <p class="text-sm font-medium">{{ tr('Show this question when', 'Afficher cette question lorsque') }}</p>
                                    <FormCondition v-model="selectedQuestion.visibleWhen" :questions="questionConditionOptions" :locale="language" :disabled="disabled" />
                                    <FormDesignHelp topic="Visibility" />
                                  </div>
                                </ExtensionAssessmentSchemaAccordionSection>
                                </div>
                                <div class="flex justify-end border-t border-default pt-3"><ExtensionButton color="error" variant="solid" :disabled="disabled" @click="pendingDeleteId = selectedQuestion.id">
                                    {{ t('formDeleteQuestion') }}
                                  </ExtensionButton></div>
                              </div>
                            </ExtensionAssessmentSchemaAccordionSection>
                          </div>

                        </li>
                      </ol>
                      <div class="designer-add">
                        <p class="designer-eyebrow">
                          {{ selected.kind === 'group' && selected.repeatFor ? t('formAddQuestionToSet') : tr('ADD A QUESTION', 'AJOUTER UNE QUESTION') }}
                        </p>
                        <div class="designer-type-grid">
                          <button v-for="type in questionTypes" :key="type.value" type="button" :disabled="disabled" class="designer-type" @click="addQuestion(type.value)">
                            <span aria-hidden="true">{{ type.glyph }}</span>{{ type.label }}
                          </button>
                        </div>
                      </div>
                    </div>
                  </ExtensionAssessmentSchemaPageSection>
                </div>
                <div class="designer-inspector space-y-5">
                  <ExtensionAssessmentSchemaPageSection v-if="selected.kind === 'page'" section-id="form-navigation-rules" :title="tr('Navigation rules', 'Règles de navigation')">
                    <ExtensionAssessmentSchemaAccordionSection v-if="selected.kind === 'page'" :key="`${selected.id}:navigation`" :title="tr('Page navigation', 'Navigation entre les pages')">
                      <div v-if="selected.kind === 'page'" class="space-y-3 border-t border-default pt-4">
                        <p class="text-sm text-muted">
                          {{ tr('Choose where applicants go next. The first matching rule wins; otherwise use the default destination.', 'Choisissez la page suivante. La première règle qui correspond s’applique; sinon, la destination par défaut est utilisée.') }}
                        </p>
                        <FormDesignHelp topic="Branching" />
                        <p v-if="!branchConditionOptions.length" class="text-sm text-muted">
                          {{ tr('Add a question to this or an earlier page before creating a rule.', 'Ajoutez une question à cette page ou à une page précédente avant de créer une règle.') }}
                        </p>
                        <div v-for="(branch, index) in (selected.item as AdvancedSurvey['pages'][number]).branches" :key="index" class="space-y-2 border-l-2 border-primary/50 pl-4">
                          <p class="text-xs font-semibold uppercase tracking-wide text-muted">
                            {{ tr('If rule', 'Si la règle') }} {{ index + 1 }}
                          </p>
                          <FormCondition
                            purpose="branch" :model-value="branch.when" :questions="branchConditionOptions" :locale="language" :disabled="disabled"
                            @update:model-value="setBranchCondition(selected!.item as AdvancedSurvey['pages'][number], index, $event)" />
                          <ExtensionFormField :label="tr('Then go to', 'Aller à')" :name="`branchDestination${index}`">
                            <ExtensionSelect
                              :model-value="branch.destination.kind === 'end' ? 'end' : branch.destination.pageId"
                              :name="`branchDestination${index}`" value-key="value" :disabled="disabled" :items="pageDestinations(selected.item as AdvancedSurvey['pages'][number])"
                              @update:model-value="setDestination(selected!.item as AdvancedSurvey['pages'][number], index, String($event))" />
                          </ExtensionFormField>
                          <div class="flex flex-wrap gap-2">
                            <ExtensionButton
                              color="neutral" variant="outline" :disabled="disabled || index === 0"
                              @click="moveBranch(selected.item as AdvancedSurvey['pages'][number], index, -1)">
                              {{ t('designMoveRouteUp') }}
                            </ExtensionButton>
                            <ExtensionButton
                              color="neutral" variant="outline" :disabled="disabled || index === (selected.item as AdvancedSurvey['pages'][number]).branches.length - 1"
                              @click="moveBranch(selected.item as AdvancedSurvey['pages'][number], index, 1)">
                              {{ t('designMoveRouteDown') }}
                            </ExtensionButton>
                            <ExtensionButton color="neutral" variant="ghost" :disabled="disabled" @click="(selected.item as AdvancedSurvey['pages'][number]).branches.splice(index, 1)">
                              {{ tr('Remove branch', 'Retirer l’embranchement') }}
                            </ExtensionButton>
                          </div>
                        </div>
                        <ExtensionButton color="neutral" variant="outline" :disabled="disabled || !branchConditionOptions.length" @click="addBranch(selected.item as AdvancedSurvey['pages'][number])">
                          {{ tr('Add an if rule', 'Ajouter une règle si') }}
                        </ExtensionButton>
                        <ExtensionFormField :label="tr('Otherwise, go to', 'Sinon, aller à')" name="pageNext">
                          <ExtensionSelect
                            :model-value="destinationValue((selected.item as AdvancedSurvey['pages'][number]).next)"
                            name="pageNext" value-key="value" :disabled="disabled" :items="pageDestinations(selected.item as AdvancedSurvey['pages'][number], true)"
                            @update:model-value="setDestination(selected!.item as AdvancedSurvey['pages'][number], -1, String($event))" />
                        </ExtensionFormField>
                      </div>
                    </ExtensionAssessmentSchemaAccordionSection>
                  </ExtensionAssessmentSchemaPageSection>
                </div>
              </div>
            </template>
            <ExtensionAssessmentSchemaPageSection section-id="form-design-guide" :title="t('designGuideTitle')">
              <ExtensionAssessmentSchemaAccordionSection :title="t('designGuideOpen')">
                <div class="space-y-3 pt-3">
                  <p class="text-sm text-muted">
                    {{ t('designGuideIntro') }}
                  </p>
                  <FormDesignHelp v-for="topic in (['Basics', 'Visibility', 'Dependencies', 'Computed', 'Branching', 'Repeats'] as const)" :key="topic" :topic="topic" />
                  <div class="flex flex-wrap gap-2">
                    <ExtensionButton color="neutral" variant="outline" @click="tab = 'flow'">
                      {{ t('designGuideFlow') }}
                    </ExtensionButton>
                    <ExtensionButton color="neutral" variant="outline" @click="tab = 'test'">
                      {{ t('designGuideTry') }}
                    </ExtensionButton>
                  </div>
                </div>
              </ExtensionAssessmentSchemaAccordionSection>
            </ExtensionAssessmentSchemaPageSection>
          </template>
          <FormFlowMap v-else-if="tab === 'flow'" :definition="definition" :locale="language" :selected-page-id="selected?.pageId" @select-page="openFlowPage" />
          <div v-else-if="tab === 'test'" class="space-y-4">
            <div class="flex items-center justify-end gap-2 text-sm">
              <span class="text-muted">{{ tr('Preview language', 'Langue de l’aperçu') }}</span><button type="button" class="designer-language" :aria-pressed="previewLocale === 'en'" @click="previewLocale = 'en'">
                English
              </button><button type="button" class="designer-language" :aria-pressed="previewLocale === 'fr'" @click="previewLocale = 'fr'">
                Français
              </button>
            </div>
            <FormTest :definition="definition" :locale="previewLocale" />
          </div>
          <div v-else class="space-y-5">
            <section class="designer-form-details space-y-3">
              <h4 class="text-lg font-semibold">
                {{ tr('Ready to publish?', 'Prêt à publier?') }}
              </h4>
              <p class="text-sm text-muted">
                {{ tr('Complete each item, then test the form in both languages before publishing.', 'Complétez chaque élément, puis testez le formulaire dans les deux langues avant de le publier.') }}
              </p>
              <ul class="space-y-2">
                <li v-for="check in publicationChecks" :key="check.label" class="flex items-start gap-2 text-sm">
                  <span :class="check.ok ? 'text-success' : 'text-warning'" aria-hidden="true">{{ check.ok ? '✓' : '○' }}</span>
                  <button type="button" class="text-left hover:underline" :aria-label="`${check.label} — ${check.ok ? tr('complete', 'terminé') : tr('needs attention', 'à compléter')}`" @click="check.target === 'details' ? openDetails() : tab = check.target">
                    {{ check.label }}
                  </button>
                </li>
              </ul>
            </section>
            <p v-if="dirty || !formId" class="text-sm text-muted">
              {{ tr('Save the form before publishing.', 'Enregistrez le formulaire avant de le publier.') }}
            </p>
            <section class="space-y-3 border-t border-default pt-4">
              <h4 class="font-semibold">
                {{ tr('Publish to portal', 'Publier dans le portail') }}
              </h4>
              <p class="text-sm text-muted">
                {{ t('formDestinationsHelp') }}
              </p>
              <ExtensionFormField :label="t('formPublicationScope')" name="formPublicationScope" required>
                <ExtensionSelect
                  v-model="publicationScope" name="formPublicationScope" value-key="value" :disabled="disabled" required
                  :items="[
                    { value: 'agreement', label: t('formScopeAgreement') },
                    { value: 'program', label: t('formScopeProgram') },
                    { value: 'stream', label: t('formScopeStream') },
                    { value: 'organization', label: t('formScopeOrganization') }
                  ]" />
              </ExtensionFormField>
              <ExtensionFormField v-if="publicationScope === 'agreement'" :label="tr('Agreement and organization', 'Accord et organisme')" name="formAgreement" required>
                <ExtensionSelect
                  v-model="agreementId" name="formAgreement" value-key="value" :disabled="disabled" required
                  :items="agreements.map((item) => ({ value: item.id, label: `${item.agreementNumber} · ${item[locale === 'fr' ? 'nameFr' : 'nameEn']} · ${item.organizationId}` }))" />
              </ExtensionFormField>
              <ExtensionFormField v-else-if="publicationScope === 'program'" :label="t('formProgram')" name="formProgram" required>
                <ExtensionSelect
                  v-model="programId" name="formProgram" value-key="value" :disabled="disabled" required
                  :items="programs.map((item) => ({ value: item.id, label: item[locale === 'fr' ? 'nameFr' : 'nameEn'] }))" />
              </ExtensionFormField>
              <ExtensionFormField v-else-if="publicationScope === 'stream'" :label="t('formStream')" name="formBatchStream" required>
                <ExtensionSelect
                  v-model="batchStreamId" name="formBatchStream" value-key="value" :disabled="disabled" required
                  :items="streams.map((item) => ({ value: item.id, label: item[locale === 'fr' ? 'nameFr' : 'nameEn'] }))" />
              </ExtensionFormField>
              <ExtensionFormField v-else :label="t('formVerifiedOrganization')" name="formOrganization" required>
                <ExtensionSelect
                  v-model="organizationId" name="formOrganization" value-key="value" :disabled="disabled" required
                  :items="organizations.map((item) => ({ value: item.id, label: `${item.name} · ${item.id}` }))" />
              </ExtensionFormField>
              <ExtensionButton
                :disabled="disabled || !readyToPublish || (publicationScope === 'agreement' && !agreementId)
                  || (publicationScope === 'program' && !programId) || (publicationScope === 'stream' && !batchStreamId)
                  || (publicationScope === 'organization' && !organizationId)" :loading="busy"
                @click="publish(publicationScope === 'agreement' ? 'publishAgreement' : publicationScope === 'organization' ? 'publishOrganization' : 'publishScope')">
                {{ t('formPublish') }}
              </ExtensionButton>
            </section>
          </div>
        </div>
      </div>
      <p v-if="message" role="status" class="text-sm text-success">
        {{ message }}
      </p>
      <p v-if="error" role="alert" class="text-sm text-error">
        {{ error }}
      </p>
      <ExtensionButton v-if="attachmentPending" :disabled="disabled || busy" :loading="busy" @click="retryAttachment">
        {{ t('intakeAttachRetry') }}
      </ExtensionButton>
    </ExtensionEntityEditorWorkspace>
    <ExtensionModal :open="Boolean(pendingDeleteQuestion)" :title="t('formDeleteQuestionTitle')" @update:open="!$event && (pendingDeleteId = null)">
      <template #body>
        <p>{{ t('formDeleteQuestionConfirm', { question: pendingDeleteQuestion?.label[language] ?? '' }) }}</p>
        <div class="flex justify-end gap-2 pt-4">
          <ExtensionButton type="button" color="neutral" variant="outline" @click="pendingDeleteId = null">{{ t('formDetailsCancel') }}</ExtensionButton>
          <ExtensionButton type="button" color="error" :disabled="disabled" @click="removeQuestion(pendingDeleteId!); pendingDeleteId = null">{{ t('formDeleteQuestion') }}</ExtensionButton>
        </div>
      </template>
    </ExtensionModal>
    <ExtensionModal
      v-model:open="detailsOpen" :dismissible="false"
      :title="editingDetails ? t('formDetailsEditTitle') : t('formDetailsCreateTitle')"
      :description="createsLocalDraft ? t('formDetailsCreateHelp') : t('formDetailsHelp')">
      <template #body>
        <div class="space-y-4">
          <ExtensionFormField :label="t('formTitleEnglish')" name="formTitleEn" required>
            <ExtensionInput v-model="detailsDraft.titleEn" name="formTitleEn" required :maxlength="200" :disabled="disabled" />
          </ExtensionFormField>
          <ExtensionFormField :label="t('formTitleFrench')" name="formTitleFr" required>
            <ExtensionInput v-model="detailsDraft.titleFr" name="formTitleFr" required :maxlength="200" :disabled="disabled" />
          </ExtensionFormField>
          <ExtensionFormField :label="t('formIntroductionEnglish')" name="formDescriptionEn" :required="introductionRequired">
            <ExtensionTextarea
              v-model="detailsDraft.introductionEn" name="formDescriptionEn"
              :required="introductionRequired" :maxlength="2000" :disabled="disabled" />
          </ExtensionFormField>
          <ExtensionFormField :label="t('formIntroductionFrench')" name="formDescriptionFr" :required="introductionRequired">
            <ExtensionTextarea
              v-model="detailsDraft.introductionFr" name="formDescriptionFr"
              :required="introductionRequired" :maxlength="2000" :disabled="disabled" />
          </ExtensionFormField>
          <p v-if="detailsError" role="alert" class="text-sm text-error">
            {{ detailsError }}
          </p>
          <div class="flex justify-end gap-2">
            <ExtensionButton color="neutral" variant="ghost" :disabled="busy" @click="cancelDetails">
              {{ t('formDetailsCancel') }}
            </ExtensionButton>
            <ExtensionButton :disabled="disabled || !detailsValid" :loading="busy" @click="applyDetails">
              {{ createsLocalDraft ? t('formDetailsCreateAction') : editingDetails ? t('formDetailsApply') : t('formDetailsContinue') }}
            </ExtensionButton>
          </div>
        </div>
      </template>
    </ExtensionModal>
  </section>
</template>

<style scoped>
.question-settings-disclosures { padding-inline-start: 1rem; display: grid; grid-template-columns: minmax(0, 1fr); gap: 1rem; min-width: 0; }
@media (max-width: 640px) { .question-settings-disclosures { padding-inline-start: .5rem; } }
.designer { color: var(--ui-text, #e8e8ec); container-type: inline-size; }
.designer-back { display: inline-flex; align-items: center; gap: .4rem; margin-bottom: .7rem; color: var(--ui-text-muted, #a2a3ab); font-size: .875rem; }
.designer-back:hover { color: var(--ui-text, #fff); text-decoration: underline; }
.designer-language { padding: .35rem .6rem; border: 1px solid var(--ui-border, #33343a); border-radius: .35rem; font-weight: 600; }
.designer-language[aria-pressed="true"] { border-color: var(--ui-primary, #008cca); color: var(--ui-primary, #008cca); }
.designer-content { flex: 10 1 50rem; container-type: inline-size; }
.designer-sidebar-outline { margin-top: 1.25rem; padding-top: 1.25rem; border-top: 1px solid var(--ui-border, #33343a); }
.designer-eyebrow { color: var(--ui-text-muted, #a2a3ab); font-size: .68rem; letter-spacing: .11em; font-weight: 750; line-height: 1.4; }
.designer-sidebar-row { display: flex; min-width: 0; align-items: center; border-radius: .4rem; color: var(--ui-text-muted, #a2a3ab); }
.designer-sidebar-row:hover { color: var(--ui-text, #fff); background: var(--ui-bg-elevated, #28282e); }
.designer-sidebar-row--active { color: var(--ui-primary, #008cca); background: color-mix(in srgb, var(--ui-primary, #008cca) 12%, transparent); }
.designer-sidebar-disclosure { display: flex; width: 1.25rem; height: 2.25rem; flex: none; align-items: center; justify-content: center; }
button.designer-sidebar-disclosure:hover { color: var(--ui-primary, #008cca); }
.designer-sidebar-item { display: flex; min-width: 0; min-height: 2.5rem; flex: 1; align-items: center; gap: .45rem; padding-inline: .2rem .5rem; text-align: start; font-weight: 600; }
.designer-outline-add { margin-top: .75rem; }
.designer-settings-body { display: grid; gap: 1.5rem; min-width: 0; }
.designer-settings-toolbar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: .75rem; }
.designer-columns { display: grid; gap: 1rem; min-width: 0; }
.designer-column { display: grid; gap: 1rem; padding-block: 1.25rem; border-top: 1px solid var(--ui-border); min-width: 0; }
.designer-column-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1rem; }
.designer-column-required { display: flex; align-items: center; padding-top: 1.5rem; }
@media (max-width: 640px) {
  .designer-column-fields { grid-template-columns: minmax(0, 1fr); }
  .designer-column-required { padding-top: 0; }
}
.designer-position-actions { display: flex; flex-wrap: wrap; gap: .75rem; margin-block: 1rem; }
.designer-form-details { padding: 1.25rem; border: 1px solid var(--ui-border, #33343a); border-radius: .65rem; }
.designer-workspace { display: grid; grid-template-columns: minmax(0, 1fr); gap: 2rem; align-items: start; }
.designer-canvas, .designer-inspector { min-width: 0; }
.designer-question-stack { display: grid; grid-template-columns: minmax(0, 1fr); gap: 1rem; }
.designer-empty { margin: 1.5rem 0; color: var(--ui-text-muted, #a2a3ab); font-size: .875rem; }
.designer-add { margin-top: 1.25rem; padding-top: 1.25rem; border-top: 1px dashed var(--ui-border, #42434a); }
.designer-type-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .55rem; margin-top: .8rem; }
.designer-type { display: flex; align-items: center; gap: .65rem; min-height: 2.6rem; padding: .55rem .7rem; border: 1px solid color-mix(in srgb, var(--ui-primary, #008cca) 55%, var(--ui-border, #3c3c42)); border-radius: .4rem; color: var(--ui-primary, #008cca); text-align: start; font-size: .78rem; font-weight: 700; letter-spacing: .035em; transition: border-color .16s ease, background .16s ease; }
.designer-type span { display: grid; width: 1.2rem; place-items: center; color: var(--ui-primary, #008cca); font-size: .95rem; font-weight: 700; }
.designer-type:hover:not(:disabled) { border-color: var(--ui-primary, #008cca); background: var(--ui-bg-elevated, #28282d); }
.designer-type:disabled { opacity: .5; cursor: not-allowed; }
@media (max-width: 700px) { .designer-type-grid { grid-template-columns: 1fr; } }
</style>
