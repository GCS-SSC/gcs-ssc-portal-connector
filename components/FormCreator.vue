<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { surveyV3Schema, upgradeToAdvancedSurvey, type AdvancedGroup, type AdvancedQuestion,
  type AdvancedSurvey, type SurveyCondition } from '@gcs-ssc/survey'
import { ExtensionButton, ExtensionCheckbox, ExtensionFormField, ExtensionInput,
  ExtensionSaveButton, ExtensionSelect, useExtensionApi, useExtensionI18n } from '@gcs-ssc/extensions/ui'
import { messages } from '../i18n/messages'
import { computedTemplateReady } from '../shared/form-localization'
import FormCondition from './FormCondition.vue'
import FormFlowMap from './FormFlowMap.vue'
import FormTest from './FormTest.vue'
import { clearFormDraft, readFormDraft, writeFormDraft, writeFormSelection } from './form-draft-session'

const props = defineProps<{ agencyId: string; disabled?: boolean; selectedFormId?: string; intakeId?: string }>()
const emit = defineEmits<{ close: []; saved: [id: string] }>()
const { locale, t } = useExtensionI18n(messages)
const language = computed<'en' | 'fr'>(() => locale.value === 'fr' ? 'fr' : 'en')
const previewLocale = ref<'en' | 'fr'>(language.value)
const tr = (en: string, fr: string) => language.value === 'fr' ? fr : en
const api = useExtensionApi('gcs-ssc-portal-connector')
const draftOwner = computed(() => props.intakeId ? `${props.agencyId}:intake:${props.intakeId}` : props.agencyId)
type Summary = { id: string; revision: number; title: { en: string; fr: string }; updatedAt: string }
type Stream = { id: string; nameEn: string; nameFr: string }
type Program = { id: string; nameEn: string; nameFr: string }
type Agreement = { id: string; organizationId: string; streamId: string; nameEn: string; nameFr: string; agreementNumber: string }
type Organization = { id: string; proponentId: string; name: string }
const surveys = ref<Summary[]>([]), programs = ref<Program[]>([]), streams = ref<Stream[]>([])
const formsLoaded = ref(false)
const agreements = ref<Agreement[]>([]), organizations = ref<Organization[]>([])
const formId = ref(''), revision = ref(0), selectedContainerId = ref('page_1'), selectedQuestionId = ref('')
const tab = ref<'edit' | 'test' | 'settings' | 'publish'>('settings')
const showFlowMap = ref(false)
const busy = ref(false), loading = ref(false), error = ref(''), message = ref('')
const attachmentPending = ref(false)
const agreementId = ref('')
const publicationScope = ref<'agreement' | 'program' | 'stream' | 'organization'>('agreement')
const programId = ref(''), batchStreamId = ref(''), organizationId = ref('')
const newDefinition = (): AdvancedSurvey => ({ schemaVersion: 3,
  title: { en: '', fr: '' }, description: { en: '', fr: '' }, questions: [], pages: [{ id: 'page_1', title: { en: 'Page 1', fr: 'Page 1' }, description: { en: '', fr: '' },
    questionIds: [], groups: [], branches: [] }] })
const ensureEditableText = (survey: AdvancedSurvey) => {
  survey.description ??= { en: '', fr: '' }
  const visit = (groups: AdvancedGroup[]) => { for (const group of groups) { group.description ??= { en: '', fr: '' }; visit(group.groups) } }
  for (const page of survey.pages) { page.description ??= { en: '', fr: '' }; visit(page.groups) }
  for (const question of survey.questions) question.hint ??= { en: '', fr: '' }
  return survey
}
const forSaving = (survey: AdvancedSurvey) => {
  const copy = JSON.parse(JSON.stringify(survey)) as AdvancedSurvey
  if (!copy.description?.en.trim() && !copy.description?.fr.trim()) delete copy.description
  const visit = (groups: AdvancedGroup[]) => { for (const group of groups) {
    if (!group.description?.en.trim() && !group.description?.fr.trim()) delete group.description
    visit(group.groups)
  } }
  for (const page of copy.pages) {
    if (!page.description?.en.trim() && !page.description?.fr.trim()) delete page.description
    visit(page.groups)
  }
  for (const question of copy.questions) if (!question.hint?.en.trim() && !question.hint?.fr.trim()) delete question.hint
  return copy
}
const definition = ref<AdvancedSurvey>(newDefinition())
const branchCount = computed(() => definition.value.pages.reduce((count, page) => count + page.branches.length, 0))
const saved = ref(JSON.stringify(definition.value))
const dirty = computed(() => JSON.stringify(definition.value) !== saved.value)
const disabled = computed(() => props.disabled || busy.value)
const invalidLimit = (value: number, max: number) => !Number.isInteger(value) || value < 1 || value > max
const endpoint = computed(() => `/agencies/${props.agencyId}/forms`)
const uid = (prefix: string) => `${prefix}_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`
type Container = AdvancedSurvey['pages'][number] | AdvancedGroup
type Node = { id: string; kind: 'page' | 'group'; title: string; depth: number; pageId: string; item: Container }
const nodes = computed<Node[]>(() => {
  const result: Node[] = []
  const visit = (groups: AdvancedGroup[], depth: number, pageId: string) => {
    for (const group of groups) {
      result.push({ id: group.id, kind: 'group', title: group.title[language.value], depth, pageId, item: group })
      visit(group.groups, depth + 1, pageId)
    }
  }
  for (const page of definition.value.pages) {
    result.push({ id: page.id, kind: 'page', title: page.title[language.value], depth: 0, pageId: page.id, item: page })
    visit(page.groups, 1, page.id)
  }
  return result
})
const selected = computed(() => nodes.value.find((node) => node.id === selectedContainerId.value) ?? nodes.value[0])
const selectedQuestion = computed(() => definition.value.questions.find((question) => question.id === selectedQuestionId.value))
const areaQuestions = computed(() => selected.value?.item.questionIds
  .map((id) => definition.value.questions.find((question) => question.id === id))
  .filter((question): question is AdvancedQuestion => Boolean(question)) ?? [])
const questionTypes = computed(() => [
  { value: 'text', label: tr('Short answer', 'Réponse courte'), glyph: 'T' },
  { value: 'email', label: tr('Email', 'Courriel'), glyph: '@' },
  { value: 'number', label: tr('Number', 'Nombre'), glyph: '#' },
  { value: 'date', label: tr('Date', 'Date'), glyph: '▦' },
  { value: 'select', label: tr('Choice', 'Choix'), glyph: '◉' },
  { value: 'list', label: tr('Repeating list', 'Liste répétable'), glyph: '☷' },
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
    { label: tr('Form title in English and French', 'Titre du formulaire en anglais et en français'), ok: bilingual(definition.value.title), target: 'settings' as const },
    { label: tr('Page and section headings in both languages', 'Titres des pages et des sections dans les deux langues'), ok: allContainers.every((item) => bilingual(item.title)), target: 'edit' as const },
    { label: tr('Form introduction translated when provided', 'Introduction du formulaire traduite, si elle est fournie'), ok: contentPair(definition.value.description), target: 'settings' as const },
    { label: tr('Page and section instructions translated when provided', 'Instructions des pages et des sections traduites, si elles sont fournies'), ok: allContainers.every((item) => contentPair(item.description)), target: 'edit' as const },
    { label: tr('At least one question', 'Au moins une question'), ok: definition.value.questions.length > 0, target: 'edit' as const },
    { label: tr('Questions and help text translated', 'Questions et textes d’aide traduits'), ok: definition.value.questions.every((item) => bilingual(item.label) && contentPair(item.hint)), target: 'edit' as const },
    { label: tr('Choices and table columns translated', 'Choix et colonnes de tableau traduits'), ok: definition.value.questions.every((item) => item.type === 'select'
      ? item.options.every((option) => bilingual(option.label)) : item.type === 'table'
        ? item.columns.every((column) => bilingual(column.label)) : true), target: 'edit' as const },
    { label: tr('Calculated values use selected fields without fixed text', 'Les valeurs calculées utilisent les champs sélectionnés sans texte fixe'),
      ok: definition.value.questions.every((item) => item.type !== 'computed' || computedTemplateReady(item.template, item.sourceIds)), target: 'edit' as const },
    { label: tr('Latest revision saved', 'Dernière version enregistrée'), ok: Boolean(formId.value) && !dirty.value, target: 'edit' as const }
  ]
})
const readyToPublish = computed(() => publicationChecks.value.every((check) => check.ok))
const questionOptions = computed(() => definition.value.questions.map((question) => ({
  value: question.id, label: `${question.label[language.value] || question.id} (${question.id})`
})))
const listOptions = computed(() => definition.value.questions.filter((question) => question.type === 'list')
  .map((question) => ({ value: question.id, label: question.label[language.value] || question.id })))
type ConditionQuestion = { id: string; label: string; type: AdvancedQuestion['type']; options?: { value: string; label: string }[] }
const conditionChoicesFor = (kind: 'question' | 'group' | 'page', targetId: string, survey = definition.value): ConditionQuestion[] => {
  const seen: { question: AdvancedQuestion; scope: string[] }[] = []
  let eligible: typeof seen = []
  const capture = (scope: string[]) => {
    eligible = seen.filter((item) => item.scope.every((part, index) => scope[index] === part))
  }
  const place = (ids: string[], scope: string[]) => {
    for (const id of ids) {
      if (kind === 'question' && id === targetId) capture(scope)
      const question = survey.questions.find((item) => item.id === id)
      if (question) seen.push({ question, scope })
    }
  }
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
    ...(question.type === 'select' ? { options: question.options.map((option) => ({
      value: option.value, label: option.label[language.value] || option.value
    })) } : {})
  }))
}
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
  ? conditionChoicesFor('question', selectedQuestion.value.id) : [])
const groupConditionOptions = computed(() => selected.value?.kind === 'group'
  ? conditionChoicesFor('group', selected.value.id) : [])
const branchConditionOptions = computed(() => selected.value?.kind === 'page'
  ? conditionChoicesFor('page', selected.value.id) : [])
const selectOptions = computed(() => questionConditionOptions.value.filter((question) => question.type === 'select')
  .map((question) => ({ value: question.id, label: question.label })))
const selectedDependency = computed(() => {
  const question = selectedQuestion.value
  return question?.type === 'select' && question.dependsOn
    ? definition.value.questions.find((item) => item.id === question.dependsOn!.questionId && item.type === 'select') : undefined
})
const sourceChoices = computed(() => selectedDependency.value?.type === 'select' ? selectedDependency.value.options : [])
const pageDestinations = (page: AdvancedSurvey['pages'][number], includeNext = false) => [
  ...(includeNext ? [{ value: 'next', label: tr('Next page in order', 'Page suivante dans l’ordre') }] : []),
  ...definition.value.pages.slice(definition.value.pages.findIndex((item) => item.id === page.id) + 1)
    .map((item) => ({ value: item.id, label: item.title[language.value] || item.id })),
  { value: 'end', label: tr('End form', 'Terminer le formulaire') }
]

const load = async () => {
  loading.value = true; error.value = ''; formsLoaded.value = false
  try {
    const result = await api.get<{ surveys: Summary[]; programs: Program[]; streams: Stream[];
      agreements: Agreement[]; organizations: Organization[] }>(endpoint.value)
    surveys.value = result.surveys; programs.value = result.programs; streams.value = result.streams
    agreements.value = result.agreements; organizations.value = result.organizations
    formsLoaded.value = true
  } catch { error.value = tr('Forms could not be loaded. Check the portal connection.', 'Impossible de charger les formulaires. Vérifiez la connexion au portail.') }
  finally { loading.value = false }
}
const resetForm = () => {
  formId.value = ''; revision.value = 0; definition.value = newDefinition()
  selectedContainerId.value = 'page_1'; selectedQuestionId.value = ''; tab.value = 'settings'
  saved.value = JSON.stringify(definition.value)
}
const selectForm = async (id: string) => {
  if (dirty.value && !confirm(tr('Discard unsaved form changes?', 'Abandonner les modifications non enregistrées?'))) return
  error.value = ''; message.value = ''
  if (!id) {
    resetForm()
    return
  }
  loading.value = true
  try {
    const result = await api.get<{ survey: { id: string; revision: number; definition: AdvancedSurvey } }>(`${endpoint.value}/${id}`)
    formId.value = result.survey.id; revision.value = result.survey.revision
    definition.value = ensureEditableText(upgradeToAdvancedSurvey(result.survey.definition))
    selectedContainerId.value = definition.value.pages[0]!.id; selectedQuestionId.value = ''; tab.value = 'edit'
    saved.value = JSON.stringify(definition.value)
  } catch { error.value = tr('The form could not be opened.', 'Impossible d’ouvrir le formulaire.') }
  finally { loading.value = false }
}
const closeDesigner = () => {
  if (dirty.value && !confirm(tr('Discard unsaved form changes?', 'Abandonner les modifications non enregistrées?'))) return
  if (dirty.value && attachmentPending.value) definition.value = JSON.parse(saved.value) as AdvancedSurvey
  if (attachmentPending.value) persistDraft()
  else clearFormDraft(draftOwner.value)
  emit('close')
}
const save = async () => {
  if (disabled.value) return
  const parsed = surveyV3Schema.safeParse(forSaving(definition.value))
  if (!parsed.success) {
    error.value = parsed.error.issues.map((issue) => issue.message).slice(0, 4).join(' · ')
    tab.value = parsed.error.issues.some((issue) => issue.path[0] === 'title' || issue.path[0] === 'description')
      ? 'settings' : 'edit'
    return
  }
  busy.value = true; error.value = ''; message.value = ''
  try {
    const result = await api.post<{ survey: { id: string; revision: number }; attached?: boolean }>(endpoint.value, {
      action: 'save', ...(formId.value ? { surveyId: formId.value, expectedRevision: revision.value } : {}),
      ...(props.intakeId ? { intakeId: props.intakeId } : {}),
      definition: parsed.data
    })
    formId.value = result.survey.id; revision.value = result.survey.revision
    definition.value = ensureEditableText(parsed.data); saved.value = JSON.stringify(definition.value)
    attachmentPending.value = Boolean(props.intakeId && result.attached === false)
    if (!props.intakeId) writeFormSelection(props.agencyId, formId.value)
    if (attachmentPending.value) persistDraft()
    else clearFormDraft(draftOwner.value)
    message.value = attachmentPending.value ? '' : tr('Form revision saved.', 'Version du formulaire enregistrée.')
    emit('saved', formId.value)
    await load()
    if (attachmentPending.value) error.value = t('intakeAttachFailed')
  } catch { error.value = tr('Save failed. Reload if another editor saved a newer revision.', 'Échec de l’enregistrement. Rechargez si une autre version a été enregistrée.') }
  finally { busy.value = false }
}
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
  } catch { error.value = t('intakeAttachFailed') }
  finally { busy.value = false }
}
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
  } catch { error.value = tr('Publication failed. Check the selected target, dates, and saved revision.', 'Échec de la publication. Vérifiez la cible, les dates et la version enregistrée.') }
  finally { busy.value = false }
}
const addPage = () => {
  const id = uid('page')
  definition.value.pages.push({ id, title: { en: `Page ${definition.value.pages.length + 1}`, fr: `Page ${definition.value.pages.length + 1}` }, description: { en: '', fr: '' },
    questionIds: [], groups: [], branches: [] })
  selectedContainerId.value = id; selectedQuestionId.value = ''
}
const addGroup = () => {
  const target = selected.value?.item
  if (!target) return
  const id = uid('group')
  target.groups.push({ id, title: { en: 'New section', fr: 'Nouvelle section' }, description: { en: '', fr: '' }, questionIds: [], groups: [] })
  selectedContainerId.value = id; selectedQuestionId.value = ''
}
const addQuestion = (type: AdvancedQuestion['type']) => {
  const target = selected.value?.item
  if (!target) return
  const id = uid('field')
  const base = { id, label: { en: 'New question', fr: 'Nouvelle question' }, hint: { en: '', fr: '' }, required: false }
  const question: AdvancedQuestion = type === 'text' ? { ...base, type, maxLength: 500 }
    : type === 'select' ? { ...base, type, options: [{ value: 'option_1', label: { en: 'Option 1', fr: 'Option 1' } }] }
      : type === 'list' ? { ...base, type, maxItems: 10 }
        : type === 'table' ? { ...base, type, maxRows: 20,
            columns: [{ id: 'column_1', label: { en: 'Column 1', fr: 'Colonne 1' }, type: 'text', required: true }] }
          : type === 'computed' ? { ...base, type, template: '{{source}}', sourceIds: [] }
            : { ...base, type }
  definition.value.questions.push(question)
  target.questionIds.push(id)
  selectedQuestionId.value = id
}
const removeQuestion = () => {
  const id = selectedQuestionId.value
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
  const cleanGroups = (groups: AdvancedGroup[]) => { for (const group of groups) {
    group.visibleWhen = cleanCondition(group.visibleWhen)
    if (group.repeatFor === id) group.repeatFor = undefined
    cleanGroups(group.groups)
  } }
  for (const page of definition.value.pages) {
    page.branches = page.branches.flatMap((branch) => {
      const when = cleanCondition(branch.when)
      return when ? [{ ...branch, when }] : []
    })
    cleanGroups(page.groups)
  }
  selectedQuestionId.value = ''
  message.value = tr('Question removed. Rules and dependencies using it were updated; check any calculated values.',
    'Question retirée. Les règles et dépendances qui l’utilisaient ont été mises à jour; vérifiez les valeurs calculées.')
}
const containerIn = (survey: AdvancedSurvey, id: string): Container | undefined => {
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
const canMoveQuestion = (direction: -1 | 1) => {
  const trial = JSON.parse(JSON.stringify(definition.value)) as AdvancedSurvey
  const ids = containerIn(trial, selectedContainerId.value)?.questionIds
  if (!ids) return false
  const index = ids.indexOf(selectedQuestionId.value), destination = index + direction
  if (index < 0 || destination < 0 || destination >= ids.length) return false
  ;[ids[index], ids[destination]] = [ids[destination]!, ids[index]!]
  return referencesValid(trial)
}
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
const placeQuestion = (targetId: string) => {
  const questionId = selectedQuestionId.value
  const trial = JSON.parse(JSON.stringify(definition.value)) as AdvancedSurvey
  const removeFrom = (groups: AdvancedGroup[]) => { for (const group of groups) {
    group.questionIds = group.questionIds.filter((id) => id !== questionId)
    removeFrom(group.groups)
  } }
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
const removeContainer = () => {
  const node = selected.value
  if (!node || node.item.questionIds.length || node.item.groups.length) {
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
  } else for (const parent of nodes.value) parent.item.groups = parent.item.groups.filter((item) => item.id !== node.id)
  selectedContainerId.value = definition.value.pages[0]!.id; selectedQuestionId.value = ''
}
const addChoice = () => {
  const question = selectedQuestion.value
  if (question?.type !== 'select') return
  const id = uid('option')
  question.options.push({ value: id, label: { en: 'New option', fr: 'Nouvelle option' } })
}
const addColumn = () => {
  const question = selectedQuestion.value
  if (question?.type !== 'table') return
  question.columns.push({ id: uid('column'), label: { en: 'New column', fr: 'Nouvelle colonne' }, type: 'text', required: false })
}
const toggleComputedSource = (id: string, checked: boolean) => {
  const question = selectedQuestion.value
  if (question?.type !== 'computed') return
  const previous = question.sourceIds[0]
  question.sourceIds = checked ? [...new Set([...question.sourceIds, id])] : question.sourceIds.filter((source) => source !== id)
  if (question.template === '{{source}}' || (previous && question.template === `{{${previous}}}`)) {
    question.template = question.sourceIds[0] ? `{{${question.sourceIds[0]}}}` : '{{source}}'
  }
}
const setDependency = (sourceId: string) => {
  const question = selectedQuestion.value
  if (question?.type !== 'select') return
  question.dependsOn = sourceId === 'none' ? undefined : { questionId: sourceId, optionsByValue: {} }
}
const toggleDependentOption = (parentValue: string, optionValue: string, checked: boolean) => {
  const question = selectedQuestion.value
  if (question?.type !== 'select' || !question.dependsOn) return
  const current = question.dependsOn.optionsByValue[parentValue] ?? []
  question.dependsOn.optionsByValue[parentValue] = checked
    ? [...current, ...question.options.filter((option) => option.value === optionValue)]
    : current.filter((option) => option.value !== optionValue)
}
const addBranch = (page: AdvancedSurvey['pages'][number]) => {
  const source = branchConditionOptions.value[0]
  if (!source) return
  page.branches.push({ when: { match: 'all', conditions: [{ questionId: source.id, operator: 'answered' }] },
    destination: { kind: 'end' } })
}
const setBranchCondition = (page: AdvancedSurvey['pages'][number], index: number, value: SurveyCondition | undefined) => {
  if (value) page.branches[index]!.when = value
}
const setDestination = (page: AdvancedSurvey['pages'][number], index: number, value: string) => {
  if (!pageDestinations(page, index < 0).some((item) => item.value === value)) return
  const target = value === 'end' ? { kind: 'end' as const } : { kind: 'page' as const, pageId: value }
  if (index < 0) page.next = value === 'next' ? undefined : target
  else page.branches[index]!.destination = target
}
const destinationValue = (destination: AdvancedSurvey['pages'][number]['next']) =>
  destination?.kind === 'page' ? destination.pageId : destination?.kind === 'end' ? 'end' : 'next'
const restoreDraft = () => {
  const draft = readFormDraft(draftOwner.value)
  if (!draft || (draft.formId !== (props.selectedFormId ?? '')
    && !(props.intakeId && draft.attachmentPending && !props.selectedFormId))) return false
  if (draft.formId && formsLoaded.value && surveys.value.find((item) => item.id === draft.formId)?.revision !== draft.revision) {
    clearFormDraft(draftOwner.value)
    return false
  }
  formId.value = draft.formId; revision.value = draft.revision
  attachmentPending.value = Boolean(draft.attachmentPending)
  definition.value = ensureEditableText(draft.definition); saved.value = draft.saved
  selectedContainerId.value = draft.selectedContainerId || definition.value.pages[0]?.id || 'page_1'
  selectedQuestionId.value = draft.selectedQuestionId || ''
  tab.value = draft.tab || 'edit'
  publicationScope.value = draft.publicationScope || 'agreement'
  agreementId.value = draft.agreementId || ''; organizationId.value = draft.organizationId || ''
  programId.value = draft.programId || ''; batchStreamId.value = draft.batchStreamId || ''
  return true
}
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
onMounted(async () => { await load(); if (!restoreDraft() && props.selectedFormId) await selectForm(props.selectedFormId) })
watch([definition, formId, revision, saved, selectedContainerId, selectedQuestionId, tab,
  publicationScope, agreementId, organizationId, programId, batchStreamId, attachmentPending],
persistDraft, { deep: true })
watch(language, (value) => { previewLocale.value = value })
watch(() => props.agencyId, () => { resetForm(); surveys.value = []; programs.value = []; streams.value = [];
  agreements.value = []; organizations.value = []; void load() })
</script>

<template>
  <section class="designer space-y-5" :aria-label="tr('Form designer', 'Concepteur de formulaires')">
    <div class="designer-header">
      <div>
        <button type="button" class="designer-back" @click="closeDesigner">← {{ props.intakeId ? tr('Back to intake', 'Retour à l’appel') : tr('All forms', 'Tous les formulaires') }}</button>
        <h3 class="designer-heading">{{ definition.title[language] || tr('Untitled form', 'Formulaire sans titre') }}</h3>
        <p class="designer-subtitle">{{ formId ? `${tr('Revision', 'Version')} ${revision}` : tr('New form', 'Nouveau formulaire') }}<span v-if="dirty"> · {{ tr('Unsaved changes', 'Modifications non enregistrées') }}</span></p>
      </div>
      <ExtensionSaveButton :label="tr('Save revision', 'Enregistrer la version')" :disabled="disabled" :loading="busy" @click="save" />
    </div>
    <p v-if="loading" role="status">{{ tr('Loading forms…', 'Chargement des formulaires…') }}</p>
    <div class="designer-tabs" role="tablist" :aria-label="tr('Form workflow', 'Étapes du formulaire')">
      <button v-for="item in (props.intakeId ? ['edit', 'test', 'settings'] : ['edit', 'test', 'settings', 'publish']) as Array<'edit' | 'test' | 'settings' | 'publish'>" :key="item" type="button" role="tab" class="designer-tab"
        :aria-selected="tab === item" :disabled="item === 'test' && !definition.questions.length"
        @click="tab = item">{{ item === 'edit' ? tr('Edit', 'Modifier') : item === 'test' ? tr('Test', 'Tester') : item === 'settings' ? tr('Settings', 'Paramètres') : tr('Publish', 'Publier') }}</button>
    </div>
    <section v-if="tab === 'edit'" class="designer-flow-overview">
      <button type="button" class="designer-flow-toggle" :aria-expanded="showFlowMap" @click="showFlowMap = !showFlowMap">
        <span><strong>{{ tr('Page flow', 'Parcours des pages') }}</strong><span class="ml-2 text-muted">{{ definition.pages.length }} {{ definition.pages.length === 1 ? tr('page', 'page') : tr('pages', 'pages') }} · {{ branchCount }} {{ branchCount === 1 ? tr('rule', 'règle') : tr('rules', 'règles') }}</span></span>
        <span class="text-primary">{{ showFlowMap ? tr('Hide map', 'Masquer la carte') : tr('Show map', 'Afficher la carte') }} <span aria-hidden="true">{{ showFlowMap ? '⌃' : '⌄' }}</span></span>
      </button>
      <FormFlowMap v-if="showFlowMap" :definition="definition" :locale="language" :selected-page-id="selected?.pageId"
        @select-page="selectedContainerId = $event; selectedQuestionId = ''" />
    </section>
    <div :class="tab === 'edit' ? 'grid gap-6 lg:grid-cols-[12rem_minmax(0,1fr)]' : ''">
      <nav v-if="tab === 'edit'" class="designer-outline" :aria-label="tr('Form pages', 'Pages du formulaire')">
          <h4 class="designer-eyebrow">{{ tr('PAGES & SECTIONS', 'PAGES ET SECTIONS') }}</h4>
          <ul class="space-y-1 text-sm">
            <li v-for="node in nodes" :key="node.id">
              <button type="button" class="designer-outline-item"
                :style="{ paddingInlineStart: `${8 + node.depth * 14}px` }"
                :aria-current="selectedContainerId === node.id ? 'location' : undefined"
                @click="selectedContainerId = node.id; selectedQuestionId = ''">
                <span aria-hidden="true">{{ node.kind === 'page' ? '▤' : '⌞' }}</span> {{ node.title || node.id }}
              </button>
            </li>
          </ul>
          <button type="button" class="designer-outline-add" :disabled="disabled" @click="addPage">+ {{ tr('Add page', 'Ajouter une page') }}</button>
      </nav>
      <div class="min-w-0 space-y-5">
        <template v-if="tab === 'edit'">
          <template v-if="selected">
            <div class="designer-workspace">
            <div class="designer-canvas space-y-6">
            <div class="space-y-3">
              <p class="designer-eyebrow">{{ selected.kind === 'page' ? tr('PAGE CONTENT', 'CONTENU DE LA PAGE') : tr('SECTION CONTENT', 'CONTENU DE LA SECTION') }}</p>
              <div class="grid gap-3 sm:grid-cols-2">
                <ExtensionFormField :label="tr('Heading · English', 'Titre · anglais')" name="groupTitleEn" required>
                  <ExtensionInput v-model="selected.item.title.en" name="groupTitleEn" required :disabled="disabled" />
                </ExtensionFormField>
                <ExtensionFormField :label="tr('Heading · French', 'Titre · français')" name="groupTitleFr" required>
                  <ExtensionInput v-model="selected.item.title.fr" name="groupTitleFr" required :disabled="disabled" />
                </ExtensionFormField>
                <ExtensionFormField :label="tr('Instructions · English', 'Instructions · anglais')" name="groupDescriptionEn">
                  <textarea v-model="selected.item.description!.en" name="groupDescriptionEn" class="designer-textarea" :disabled="disabled" />
                </ExtensionFormField>
                <ExtensionFormField :label="tr('Instructions · French', 'Instructions · français')" name="groupDescriptionFr">
                  <textarea v-model="selected.item.description!.fr" name="groupDescriptionFr" class="designer-textarea" :disabled="disabled" />
                </ExtensionFormField>
              </div>
              <ExtensionFormField v-if="selected.kind === 'group'" :label="tr('Repeat this group for each item in', 'Répéter ce groupe pour chaque élément de')" name="repeatFor">
                <ExtensionSelect :model-value="(selected.item as AdvancedGroup).repeatFor ?? 'none'" name="repeatFor" value-key="value" :disabled="disabled"
                  :items="[{ value: 'none', label: tr('Do not repeat', 'Ne pas répéter') }, ...listOptions]"
                  @update:model-value="(selected.item as AdvancedGroup).repeatFor = String($event) === 'none' ? undefined : String($event)" />
              </ExtensionFormField>
              <div v-if="selected.kind === 'group'">
                <p class="text-sm font-medium">{{ tr('Show this group when', 'Afficher ce groupe lorsque') }}</p>
                <FormCondition v-model="(selected.item as AdvancedGroup).visibleWhen" :questions="groupConditionOptions" :locale="language" :disabled="disabled" />
              </div>
              <div class="flex flex-wrap gap-2 pt-2">
                <ExtensionButton color="neutral" variant="outline" size="sm" :disabled="disabled" @click="addGroup">{{ tr('Add nested section', 'Ajouter une section imbriquée') }}</ExtensionButton>
                <ExtensionButton color="neutral" variant="ghost" size="sm" :disabled="disabled || (selected.kind === 'page' && definition.pages.length === 1)" @click="removeContainer">
                  {{ tr('Remove empty group or page', 'Retirer le groupe ou la page vide') }}
                </ExtensionButton>
              </div>
            </div>
            <div class="designer-question-stack">
              <p class="designer-eyebrow">{{ tr('QUESTIONS', 'QUESTIONS') }} · {{ areaQuestions.length }}</p>
              <p v-if="!areaQuestions.length" class="designer-empty">{{ tr('Start with a question. Select a type below to add it to this page.', 'Commencez par une question. Sélectionnez un type ci-dessous pour l’ajouter à cette page.') }}</p>
              <ol class="space-y-3">
                <li v-for="(question, index) in areaQuestions" :key="question.id">
                  <button type="button" class="designer-question" :aria-current="selectedQuestionId === question.id ? 'true' : undefined" @click="selectedQuestionId = question.id">
                    <span class="designer-question-number">{{ index + 1 }}</span>
                    <span class="designer-question-body">
                      <span class="designer-question-title">{{ question.label[language] || tr('Untitled question', 'Question sans titre') }} <span v-if="question.required" class="text-error">*</span></span>
                      <span v-if="question.type === 'select' && question.dependsOn" class="designer-dependency-badge">{{ tr('Depends on', 'Selon') }} {{ definition.questions.find((item) => item.id === question.dependsOn?.questionId)?.label[language] || tr('earlier answer', 'une réponse précédente') }}</span>
                      <span v-if="question.hint?.[language]" class="designer-question-hint">{{ question.hint[language] }}</span>
                      <span v-if="question.type === 'select'" class="designer-answer-options"><span v-for="option in question.options.slice(0, 3)" :key="option.value">○ {{ option.label[language] }}</span></span>
                      <span v-else-if="question.type === 'computed'" class="designer-answer-line">{{ tr('Calculated from earlier answers', 'Calculée à partir des réponses précédentes') }}</span>
                      <span v-else-if="question.type === 'table'" class="designer-answer-line">{{ question.columns.map((column) => column.label[language]).join(' · ') }}</span>
                      <span v-else class="designer-answer-line">{{ question.type === 'list' ? tr('Add an item', 'Ajouter un élément') : tr('Your answer', 'Votre réponse') }}</span>
                    </span>
                    <span class="designer-question-type">{{ typeName(question.type) }}</span>
                  </button>
                </li>
              </ol>
              <div class="designer-add">
                <p class="designer-eyebrow">{{ tr('ADD A QUESTION', 'AJOUTER UNE QUESTION') }}</p>
                <div class="designer-type-grid">
                  <button v-for="type in questionTypes" :key="type.value" type="button" :disabled="disabled" class="designer-type" @click="addQuestion(type.value)"><span aria-hidden="true">{{ type.glyph }}</span>{{ type.label }}</button>
                </div>
              </div>
            </div>
            </div>
            <div class="designer-inspector space-y-5">
            <div v-if="selectedQuestion" class="space-y-4">
              <div><p class="designer-eyebrow">{{ tr('QUESTION SETTINGS', 'PARAMÈTRES DE LA QUESTION') }}</p><h4 class="font-semibold">{{ typeName(selectedQuestion.type) }}</h4></div>
              <div class="grid gap-3">
                <ExtensionFormField :label="tr('Question in English', 'Question en anglais')" name="questionEn" required>
                  <ExtensionInput v-model="selectedQuestion.label.en" name="questionEn" required :disabled="disabled" />
                </ExtensionFormField>
                <ExtensionFormField :label="tr('Question in French', 'Question en français')" name="questionFr" required>
                  <ExtensionInput v-model="selectedQuestion.label.fr" name="questionFr" required :disabled="disabled" />
                </ExtensionFormField>
              </div>
              <div class="grid gap-3">
                <ExtensionFormField :label="tr('Help text · English', 'Texte d’aide · anglais')" name="questionHintEn">
                  <textarea v-model="selectedQuestion.hint!.en" name="questionHintEn" class="designer-textarea" :disabled="disabled" />
                </ExtensionFormField>
                <ExtensionFormField :label="tr('Help text · French', 'Texte d’aide · français')" name="questionHintFr">
                  <textarea v-model="selectedQuestion.hint!.fr" name="questionHintFr" class="designer-textarea" :disabled="disabled" />
                </ExtensionFormField>
              </div>
              <ExtensionCheckbox v-if="selectedQuestion.type !== 'computed'" v-model="selectedQuestion.required" :label="tr('Required response', 'Réponse obligatoire')" :disabled="disabled" />
              <ExtensionFormField :label="tr('Place in', 'Placer dans')" name="questionPlacement">
                <ExtensionSelect :model-value="selected.id" name="questionPlacement" value-key="value" :disabled="disabled"
                  :items="nodes.map((node) => ({ value: node.id, label: `${'· '.repeat(node.depth)}${node.title}` }))"
                  @update:model-value="placeQuestion(String($event))" />
              </ExtensionFormField>
              <div class="flex flex-wrap gap-2">
                <ExtensionButton color="neutral" variant="outline" size="sm" :disabled="disabled || !canMoveQuestion(-1)" @click="moveQuestion(-1)">{{ tr('Move up', 'Monter') }}</ExtensionButton>
                <ExtensionButton color="neutral" variant="outline" size="sm" :disabled="disabled || !canMoveQuestion(1)" @click="moveQuestion(1)">{{ tr('Move down', 'Descendre') }}</ExtensionButton>
                <ExtensionButton color="neutral" variant="ghost" size="sm" :disabled="disabled" @click="removeQuestion">{{ tr('Remove question', 'Retirer la question') }}</ExtensionButton>
              </div>
              <ExtensionFormField v-if="selectedQuestion.type === 'text'" :label="tr('Maximum characters', 'Nombre maximal de caractères')" name="maxLength" required>
                <ExtensionInput :model-value="selectedQuestion.maxLength || ''" name="maxLength" type="number" min="1" max="5000" required :disabled="disabled"
                  :aria-invalid="invalidLimit(selectedQuestion.maxLength, 5000)" :aria-describedby="invalidLimit(selectedQuestion.maxLength, 5000) ? 'maxLength-error' : undefined"
                  @update:model-value="selectedQuestion.maxLength = Number($event)" />
                <p v-if="invalidLimit(selectedQuestion.maxLength, 5000)" id="maxLength-error" role="alert" class="text-sm text-error">{{ t('maxLengthInvalid') }}</p>
              </ExtensionFormField>
              <ExtensionFormField v-if="selectedQuestion.type === 'list'" :label="tr('Maximum items', 'Nombre maximal d’éléments')" name="maxItems" required>
                <ExtensionInput :model-value="selectedQuestion.maxItems || ''" name="maxItems" type="number" min="1" max="50" required :disabled="disabled"
                  :aria-invalid="invalidLimit(selectedQuestion.maxItems, 50)" :aria-describedby="invalidLimit(selectedQuestion.maxItems, 50) ? 'maxItems-error' : undefined"
                  @update:model-value="selectedQuestion.maxItems = Number($event)" />
                <p v-if="invalidLimit(selectedQuestion.maxItems, 50)" id="maxItems-error" role="alert" class="text-sm text-error">{{ t('maxItemsInvalid') }}</p>
              </ExtensionFormField>
              <template v-if="selectedQuestion.type === 'select'">
                <h5 class="font-medium">{{ tr('Choices', 'Choix') }}</h5>
                <div v-for="(option, index) in selectedQuestion.options" :key="option.value" class="grid gap-2 border-b border-default pb-3">
                  <ExtensionFormField :label="tr('English', 'Anglais')" :name="`choiceEn${index}`" required>
                    <ExtensionInput v-model="option.label.en" :name="`choiceEn${index}`" required :disabled="disabled" />
                  </ExtensionFormField>
                  <ExtensionFormField :label="tr('French', 'Français')" :name="`choiceFr${index}`" required>
                    <ExtensionInput v-model="option.label.fr" :name="`choiceFr${index}`" required :disabled="disabled" />
                  </ExtensionFormField>
                  <ExtensionButton color="neutral" variant="ghost" size="sm" :disabled="disabled || selectedQuestion.options.length === 1" @click="selectedQuestion.options.splice(index, 1)">
                    {{ tr('Remove choice', 'Retirer le choix') }}
                  </ExtensionButton>
                </div>
                <ExtensionButton color="neutral" variant="outline" size="sm" :disabled="disabled || selectedQuestion.options.length >= 50" @click="addChoice">{{ tr('Add choice', 'Ajouter un choix') }}</ExtensionButton>
                <ExtensionFormField :label="tr('Choices depend on', 'Choix selon la réponse à')" name="choiceDependency">
                  <ExtensionSelect :model-value="selectedQuestion.dependsOn?.questionId ?? 'none'" name="choiceDependency" value-key="value" :disabled="disabled"
                    :items="[{ value: 'none', label: tr('No dependency', 'Aucune dépendance') }, ...selectOptions.filter((item) => item.value !== selectedQuestion!.id)]"
                    @update:model-value="setDependency(String($event))" />
                </ExtensionFormField>
                <div v-if="selectedQuestion.dependsOn" class="space-y-3">
                  <p class="text-sm text-muted">{{ tr('Choose which answers applicants can select for each answer to the earlier question.', 'Choisissez les réponses que les demandeurs pourront sélectionner pour chaque réponse à la question précédente.') }}</p>
                  <div v-for="source in sourceChoices" :key="source.value" class="rounded-md border border-default p-3">
                    <p class="mb-2 text-sm font-semibold">{{ tr('If the earlier answer is', 'Si la réponse précédente est') }} “{{ source.label[language] }}”</p>
                    <div class="grid gap-2">
                      <ExtensionCheckbox v-for="choice in selectedQuestion.options" :key="choice.value"
                        :label="choice.label[language]" :disabled="disabled"
                        :model-value="selectedQuestion.dependsOn.optionsByValue[source.value]?.some((item) => item.value === choice.value) ?? false"
                        @update:model-value="toggleDependentOption(source.value, choice.value, Boolean($event))" />
                    </div>
                  </div>
                </div>
              </template>
              <template v-if="selectedQuestion.type === 'table'">
                <ExtensionFormField :label="tr('Maximum rows', 'Nombre maximal de lignes')" name="maxRows" required>
                  <ExtensionInput :model-value="selectedQuestion.maxRows || ''" name="maxRows" type="number" min="1" max="100" required :disabled="disabled"
                    :aria-invalid="invalidLimit(selectedQuestion.maxRows, 100)" :aria-describedby="invalidLimit(selectedQuestion.maxRows, 100) ? 'maxRows-error' : undefined"
                    @update:model-value="selectedQuestion.maxRows = Number($event)" />
                  <p v-if="invalidLimit(selectedQuestion.maxRows, 100)" id="maxRows-error" role="alert" class="text-sm text-error">{{ t('maxRowsInvalid') }}</p>
                </ExtensionFormField>
                <h5 class="font-medium">{{ tr('Table columns', 'Colonnes du tableau') }}</h5>
                <div v-for="(column, index) in selectedQuestion.columns" :key="index" class="grid gap-2 border-b border-default pb-3">
                  <ExtensionFormField :label="tr('Column in English', 'Colonne en anglais')" :name="`columnEn${index}`" required>
                    <ExtensionInput v-model="column.label.en" :name="`columnEn${index}`" required :disabled="disabled" />
                  </ExtensionFormField>
                  <ExtensionFormField :label="tr('Column in French', 'Colonne en français')" :name="`columnFr${index}`" required>
                    <ExtensionInput v-model="column.label.fr" :name="`columnFr${index}`" required :disabled="disabled" />
                  </ExtensionFormField>
                  <ExtensionFormField :label="tr('Data type', 'Type de données')" :name="`columnType${index}`">
                    <ExtensionSelect v-model="column.type" :name="`columnType${index}`" value-key="value" :disabled="disabled"
                      :items="[{ value: 'text', label: tr('Text', 'Texte') }, { value: 'number', label: tr('Number', 'Nombre') }, { value: 'date', label: tr('Date', 'Date') }]" />
                  </ExtensionFormField>
                  <ExtensionCheckbox v-model="column.required" :label="tr('Required cell', 'Cellule obligatoire')" :disabled="disabled" />
                  <ExtensionButton color="neutral" variant="ghost" size="sm" :disabled="disabled || selectedQuestion.columns.length === 1" @click="selectedQuestion.columns.splice(index, 1)">
                    {{ tr('Remove column', 'Retirer la colonne') }}
                  </ExtensionButton>
                </div>
                <ExtensionButton color="neutral" variant="outline" size="sm" :disabled="disabled || selectedQuestion.columns.length >= 20" @click="addColumn">{{ tr('Add column', 'Ajouter une colonne') }}</ExtensionButton>
              </template>
              <template v-if="selectedQuestion.type === 'computed'">
                <ExtensionFormField :label="tr('Template — use {{field_id}} for values', 'Modèle — utilisez {{field_id}} pour les valeurs')" name="computedTemplate" required>
                  <ExtensionInput v-model="selectedQuestion.template" name="computedTemplate" required :disabled="disabled" />
                </ExtensionFormField>
                <p id="computed-sources-label" class="text-sm font-medium">{{ t('computedSourcesRequired') }}</p>
                <p id="computed-sources-help" class="text-sm">{{ t('computedSourcesHelp') }}</p>
                <div role="group" aria-labelledby="computed-sources-label" aria-describedby="computed-sources-help" class="grid gap-2">
                  <ExtensionCheckbox v-for="item in questionOptions.filter((item) => item.value !== selectedQuestion!.id)" :key="item.value"
                    :label="item.label" :disabled="disabled" :model-value="selectedQuestion.sourceIds.includes(item.value)"
                    @update:model-value="toggleComputedSource(item.value, Boolean($event))" />
                </div>
              </template>
              <div>
                <p class="text-sm font-medium">{{ tr('Show this question when', 'Afficher cette question lorsque') }}</p>
                <FormCondition v-model="selectedQuestion.visibleWhen" :questions="questionConditionOptions" :locale="language" :disabled="disabled" />
              </div>
            </div>
            <div v-if="selected.kind === 'page'" class="space-y-3 border-t border-default pt-4">
              <h4 class="font-semibold">{{ tr('Page navigation', 'Navigation entre les pages') }}</h4>
              <p class="text-sm text-muted">{{ tr('Choose where applicants go next. The first matching rule wins; otherwise use the default destination.', 'Choisissez la page suivante. La première règle qui correspond s’applique; sinon, la destination par défaut est utilisée.') }}</p>
              <p v-if="!branchConditionOptions.length" class="text-sm text-muted">{{ tr('Add a question to this or an earlier page before creating a rule.', 'Ajoutez une question à cette page ou à une page précédente avant de créer une règle.') }}</p>
              <div v-for="(branch, index) in (selected.item as AdvancedSurvey['pages'][number]).branches" :key="index" class="space-y-2 border-l-2 border-primary/50 pl-4">
                <p class="text-xs font-semibold uppercase tracking-wide text-muted">{{ tr('If rule', 'Si la règle') }} {{ index + 1 }}</p>
                <FormCondition :model-value="branch.when" :questions="branchConditionOptions" :locale="language" :disabled="disabled"
                  @update:model-value="setBranchCondition(selected!.item as AdvancedSurvey['pages'][number], index, $event)" />
                <ExtensionFormField :label="tr('Then go to', 'Aller à')" :name="`branchDestination${index}`">
                  <ExtensionSelect :model-value="branch.destination.kind === 'end' ? 'end' : branch.destination.pageId"
                    :name="`branchDestination${index}`" value-key="value" :disabled="disabled" :items="pageDestinations(selected.item as AdvancedSurvey['pages'][number])"
                    @update:model-value="setDestination(selected!.item as AdvancedSurvey['pages'][number], index, String($event))" />
                </ExtensionFormField>
                <ExtensionButton color="neutral" variant="ghost" size="sm" :disabled="disabled" @click="(selected.item as AdvancedSurvey['pages'][number]).branches.splice(index, 1)">
                  {{ tr('Remove branch', 'Retirer l’embranchement') }}
                </ExtensionButton>
              </div>
              <ExtensionButton color="neutral" variant="outline" size="sm" :disabled="disabled || !branchConditionOptions.length" @click="addBranch(selected.item as AdvancedSurvey['pages'][number])">
                {{ tr('Add an if rule', 'Ajouter une règle si') }}
              </ExtensionButton>
              <ExtensionFormField :label="tr('Otherwise, go to', 'Sinon, aller à')" name="pageNext">
                <ExtensionSelect :model-value="destinationValue((selected.item as AdvancedSurvey['pages'][number]).next)"
                  name="pageNext" value-key="value" :disabled="disabled" :items="pageDestinations(selected.item as AdvancedSurvey['pages'][number], true)"
                  @update:model-value="setDestination(selected!.item as AdvancedSurvey['pages'][number], -1, String($event))" />
              </ExtensionFormField>
            </div>
            </div>
            </div>
          </template>
        </template>
        <div v-else-if="tab === 'test'" class="space-y-4">
          <div class="flex items-center justify-end gap-2 text-sm"><span class="text-muted">{{ tr('Preview language', 'Langue de l’aperçu') }}</span><button type="button" class="designer-language" :aria-pressed="previewLocale === 'en'" @click="previewLocale = 'en'">English</button><button type="button" class="designer-language" :aria-pressed="previewLocale === 'fr'" @click="previewLocale = 'fr'">Français</button></div>
          <FormTest :definition="definition" :locale="previewLocale" />
        </div>
        <div v-else-if="tab === 'settings'" class="designer-form-details grid gap-4 sm:grid-cols-2">
          <div class="sm:col-span-2"><h4 class="text-lg font-semibold">{{ tr('Form settings', 'Paramètres du formulaire') }}</h4><p class="text-sm text-muted">{{ tr('Set the title and introduction applicants will see in each language.', 'Définissez le titre et l’introduction que les demandeurs verront dans chaque langue.') }}</p></div>
          <ExtensionFormField :label="tr('Form title · English', 'Titre du formulaire · anglais')" name="formTitleEn" required>
            <ExtensionInput v-model="definition.title.en" name="formTitleEn" required :disabled="disabled" />
          </ExtensionFormField>
          <ExtensionFormField :label="tr('Form title · French', 'Titre du formulaire · français')" name="formTitleFr" required>
            <ExtensionInput v-model="definition.title.fr" name="formTitleFr" required :disabled="disabled" />
          </ExtensionFormField>
          <ExtensionFormField :label="tr('Introduction · English', 'Introduction · anglais')" name="formDescriptionEn">
            <textarea v-model="definition.description!.en" name="formDescriptionEn" class="designer-textarea" :disabled="disabled" />
          </ExtensionFormField>
          <ExtensionFormField :label="tr('Introduction · French', 'Introduction · français')" name="formDescriptionFr">
            <textarea v-model="definition.description!.fr" name="formDescriptionFr" class="designer-textarea" :disabled="disabled" />
          </ExtensionFormField>
          <p class="text-sm text-muted sm:col-span-2">{{ tr('Pages, sections, questions, and their translations are edited in Edit.', 'Les pages, les sections, les questions et leurs traductions se modifient dans Modifier.') }}</p>
        </div>
        <div v-else class="space-y-5">
          <section class="designer-form-details space-y-3">
            <h4 class="text-lg font-semibold">{{ tr('Ready to publish?', 'Prêt à publier?') }}</h4>
            <p class="text-sm text-muted">{{ tr('Complete each item, then test the form in both languages before publishing.', 'Complétez chaque élément, puis testez le formulaire dans les deux langues avant de le publier.') }}</p>
            <ul class="space-y-2">
              <li v-for="check in publicationChecks" :key="check.label" class="flex items-start gap-2 text-sm">
                <span :class="check.ok ? 'text-success' : 'text-warning'" aria-hidden="true">{{ check.ok ? '✓' : '○' }}</span>
                <button type="button" class="text-left hover:underline" :aria-label="`${check.label} — ${check.ok ? tr('complete', 'terminé') : tr('needs attention', 'à compléter')}`" @click="tab = check.target">{{ check.label }}</button>
              </li>
            </ul>
          </section>
          <p v-if="dirty || !formId" class="text-sm text-muted">{{ tr('Save the form before publishing.', 'Enregistrez le formulaire avant de le publier.') }}</p>
          <section class="space-y-3 border-t border-default pt-4">
            <h4 class="font-semibold">{{ tr('Publish to portal', 'Publier dans le portail') }}</h4>
            <p class="text-sm text-muted">{{ t('formDestinationsHelp') }}</p>
            <ExtensionFormField :label="t('formPublicationScope')" name="formPublicationScope" required>
              <ExtensionSelect v-model="publicationScope" name="formPublicationScope" value-key="value" :disabled="disabled" required
                :items="[
                  { value: 'agreement', label: t('formScopeAgreement') },
                  { value: 'program', label: t('formScopeProgram') },
                  { value: 'stream', label: t('formScopeStream') },
                  { value: 'organization', label: t('formScopeOrganization') }
                ]" />
            </ExtensionFormField>
            <ExtensionFormField v-if="publicationScope === 'agreement'" :label="tr('Agreement and organization', 'Accord et organisme')" name="formAgreement" required>
              <ExtensionSelect v-model="agreementId" name="formAgreement" value-key="value" :disabled="disabled" required
                :items="agreements.map((item) => ({ value: item.id, label: `${item.agreementNumber} · ${item[locale === 'fr' ? 'nameFr' : 'nameEn']} · ${item.organizationId}` }))" />
            </ExtensionFormField>
            <ExtensionFormField v-else-if="publicationScope === 'program'" :label="t('formProgram')" name="formProgram" required>
              <ExtensionSelect v-model="programId" name="formProgram" value-key="value" :disabled="disabled" required
                :items="programs.map((item) => ({ value: item.id, label: item[locale === 'fr' ? 'nameFr' : 'nameEn'] }))" />
            </ExtensionFormField>
            <ExtensionFormField v-else-if="publicationScope === 'stream'" :label="t('formStream')" name="formBatchStream" required>
              <ExtensionSelect v-model="batchStreamId" name="formBatchStream" value-key="value" :disabled="disabled" required
                :items="streams.map((item) => ({ value: item.id, label: item[locale === 'fr' ? 'nameFr' : 'nameEn'] }))" />
            </ExtensionFormField>
            <ExtensionFormField v-else :label="t('formVerifiedOrganization')" name="formOrganization" required>
              <ExtensionSelect v-model="organizationId" name="formOrganization" value-key="value" :disabled="disabled" required
                :items="organizations.map((item) => ({ value: item.id, label: `${item.name} · ${item.id}` }))" />
            </ExtensionFormField>
            <ExtensionButton :disabled="disabled || !readyToPublish || (publicationScope === 'agreement' && !agreementId)
              || (publicationScope === 'program' && !programId) || (publicationScope === 'stream' && !batchStreamId)
              || (publicationScope === 'organization' && !organizationId)" :loading="busy"
              @click="publish(publicationScope === 'agreement' ? 'publishAgreement' : publicationScope === 'organization' ? 'publishOrganization' : 'publishScope')">
              {{ t('formPublish') }}
            </ExtensionButton>
          </section>
        </div>
      </div>
    </div>
    <p v-if="message" role="status" class="text-sm text-success">{{ message }}</p>
    <p v-if="error" role="alert" class="text-sm text-error">{{ error }}</p>
    <ExtensionButton v-if="attachmentPending" :disabled="disabled || busy" :loading="busy" @click="retryAttachment">
      {{ t('intakeAttachRetry') }}
    </ExtensionButton>
  </section>
</template>

<style scoped>
.designer { color: var(--ui-text, #e8e8ec); container-type: inline-size; }
.designer-header { display: flex; align-items: end; justify-content: space-between; gap: 1.25rem; padding-bottom: 1rem; border-bottom: 1px solid var(--ui-border, #33343a); }
.designer-back { display: inline-flex; align-items: center; gap: .4rem; margin-bottom: .7rem; color: var(--ui-text-muted, #a2a3ab); font-size: .875rem; }
.designer-back:hover { color: var(--ui-text, #fff); text-decoration: underline; }
.designer-heading { font-size: clamp(1.5rem, 2vw, 2rem); font-weight: 700; line-height: 1.2; letter-spacing: -.025em; }
.designer-subtitle { margin-top: .35rem; color: var(--ui-text-muted, #a2a3ab); font-size: .875rem; }
.designer-tabs { display: flex; gap: 1.5rem; border-bottom: 1px solid var(--ui-border, #33343a); }
.designer-tab { position: relative; padding: .7rem .1rem .8rem; font-size: .875rem; font-weight: 600; color: var(--ui-text-muted, #a2a3ab); }
.designer-tab[aria-selected="true"] { color: var(--ui-text, #fff); }
.designer-tab[aria-selected="true"]::after { position: absolute; content: ''; height: 2px; bottom: -1px; inset-inline: 0; background: var(--ui-primary, #008cca); }
.designer-tab:disabled { opacity: .45; cursor: not-allowed; }
.designer-language { padding: .35rem .6rem; border: 1px solid var(--ui-border, #33343a); border-radius: .35rem; font-weight: 600; }
.designer-language[aria-pressed="true"] { border-color: var(--ui-primary, #008cca); color: var(--ui-primary, #008cca); }
.designer-flow-overview { padding: .75rem 1rem; border: 1px solid var(--ui-border, #33343a); border-radius: .55rem; }
.designer-flow-toggle { display: flex; width: 100%; align-items: center; justify-content: space-between; gap: 1rem; text-align: start; font-size: .82rem; }
.designer-flow-toggle:hover strong { text-decoration: underline; }
.designer-flow-overview :deep(.flow-map) { padding-top: 1rem; }
.designer-outline { border-inline-end: 1px solid var(--ui-border, #33343a); padding: .5rem 1rem .5rem 0; }
.designer-eyebrow { color: var(--ui-text-muted, #a2a3ab); font-size: .68rem; letter-spacing: .11em; font-weight: 750; line-height: 1.4; }
.designer-outline-item { display: block; width: 100%; padding-block: .6rem; border-radius: .4rem; color: var(--ui-text-muted, #a2a3ab); text-align: start; line-height: 1.35; }
.designer-outline-item:hover { color: var(--ui-text, #fff); background: var(--ui-bg-elevated, #28282e); }
.designer-outline-item[aria-current="location"] { color: var(--ui-text, #fff); background: var(--ui-bg-elevated, #28282e); font-weight: 650; }
.designer-outline-add { margin-top: .75rem; padding: .45rem .5rem; color: var(--ui-primary, #008cca); font-size: .85rem; font-weight: 650; text-align: start; }
.designer-outline-add:hover { text-decoration: underline; }
.designer-form-details { padding: 1.25rem; border: 1px solid var(--ui-border, #33343a); border-radius: .65rem; }
.designer-workspace { display: grid; grid-template-columns: minmax(0, 1fr) minmax(16rem, 19rem); gap: 1.25rem; align-items: start; }
.designer-canvas { min-width: 0; padding: 1.4rem; border: 1px solid var(--ui-border, #33343a); border-radius: .65rem; background: var(--ui-bg, #1e1e22); }
.designer-inspector { min-width: 0; padding: 1.25rem; border: 1px solid var(--ui-border, #33343a); border-radius: .65rem; background: var(--ui-bg-elevated, #242429); }
.designer-textarea { width: 100%; min-height: 5rem; resize: vertical; border: 1px solid var(--ui-border, #42434a); border-radius: .4rem; background: var(--ui-bg, #1e1e22); color: var(--ui-text, #fff); padding: .6rem .7rem; font: inherit; font-size: .875rem; }
.designer-textarea:focus { outline: 2px solid var(--ui-primary, #008cca); outline-offset: 1px; }
.designer-question-stack { padding-top: 1.25rem; border-top: 1px solid var(--ui-border, #33343a); }
.designer-empty { margin: 1.5rem 0; color: var(--ui-text-muted, #a2a3ab); font-size: .875rem; }
.designer-question { display: flex; width: 100%; min-height: 6rem; gap: .85rem; padding: 1.15rem; border: 1px solid var(--ui-border, #3c3c42); border-radius: .55rem; background: var(--ui-bg-elevated, #28282d); text-align: start; transition: border-color .16s ease, transform .16s ease; }
.designer-question:hover { border-color: var(--ui-primary, #008cca); transform: translateY(-1px); }
.designer-question[aria-current="true"] { border-color: var(--ui-primary, #008cca); box-shadow: inset 3px 0 0 var(--ui-primary, #008cca); }
.designer-question-number { flex: none; color: var(--ui-text-muted, #a2a3ab); font-size: .8rem; }
.designer-question-body { display: flex; flex: 1; min-width: 0; flex-direction: column; gap: .35rem; }
.designer-question-title { font-size: .95rem; font-weight: 650; line-height: 1.3; }
.designer-dependency-badge { align-self: start; margin-top: .15rem; padding: .2rem .45rem; border-radius: .3rem; background: var(--ui-bg, #1e1e22); color: var(--ui-primary, #008cca); font-size: .7rem; font-weight: 650; }
.designer-question-hint { color: var(--ui-text-muted, #a2a3ab); font-size: .8rem; }
.designer-question-type { align-self: start; color: var(--ui-text-muted, #a2a3ab); font-size: .7rem; white-space: nowrap; }
.designer-answer-line { display: block; max-width: 19rem; margin-top: .5rem; padding-bottom: .4rem; border-bottom: 1px solid var(--ui-border, #505158); color: var(--ui-text-muted, #a2a3ab); font-size: .75rem; }
.designer-answer-options { display: flex; flex-direction: column; gap: .25rem; margin-top: .35rem; color: var(--ui-text-muted, #a2a3ab); font-size: .78rem; }
.designer-add { margin-top: 1.25rem; padding-top: 1.25rem; border-top: 1px dashed var(--ui-border, #42434a); }
.designer-type-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .55rem; margin-top: .8rem; }
.designer-type { display: flex; align-items: center; gap: .65rem; min-height: 2.6rem; padding: .55rem .7rem; border: 1px solid var(--ui-border, #3c3c42); border-radius: .4rem; text-align: start; font-size: .8rem; transition: border-color .16s ease, background .16s ease; }
.designer-type span { display: grid; width: 1.2rem; place-items: center; color: var(--ui-primary, #008cca); font-size: .95rem; font-weight: 700; }
.designer-type:hover:not(:disabled) { border-color: var(--ui-primary, #008cca); background: var(--ui-bg-elevated, #28282d); }
.designer-type:disabled { opacity: .5; cursor: not-allowed; }
@container (max-width: 48rem) { .designer-workspace { grid-template-columns: 1fr; } }
@media (max-width: 700px) { .designer-header { align-items: start; flex-direction: column; } .designer-outline { border-inline-end: 0; border-bottom: 1px solid var(--ui-border, #33343a); padding: 0 0 1rem; } .designer-canvas, .designer-inspector { padding: 1rem; } .designer-type-grid { grid-template-columns: 1fr; } }
</style>
