<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { surveyV3Schema, upgradeToAdvancedSurvey, type AdvancedGroup, type AdvancedQuestion,
  type AdvancedSurvey, type SurveyCondition } from '@gcs-ssc/survey'
import { ExtensionButton, ExtensionCheckbox, ExtensionFormField, ExtensionInput,
  ExtensionSaveButton, ExtensionSelect, useExtensionApi, useExtensionI18n } from '@gcs-ssc/extensions/ui'
import { messages } from '../i18n/messages'
import FormCondition from './FormCondition.vue'
import FormTest from './FormTest.vue'

const props = defineProps<{ agencyId: string; disabled?: boolean }>()
const { locale, t } = useExtensionI18n(messages)
const language = computed<'en' | 'fr'>(() => locale.value === 'fr' ? 'fr' : 'en')
const tr = (en: string, fr: string) => language.value === 'fr' ? fr : en
const api = useExtensionApi('gcs-ssc-portal-connector')
type Summary = { id: string; revision: number; title: { en: string; fr: string }; updatedAt: string }
type Stream = { id: string; nameEn: string; nameFr: string }
type Agreement = { id: string; organizationId: string; nameEn: string; nameFr: string; agreementNumber: string }
type Call = { id: string; surveyId: string | null; surveyRevision: number | null; published: boolean }
const surveys = ref<Summary[]>([]), streams = ref<Stream[]>([]), agreements = ref<Agreement[]>([]), calls = ref<Call[]>([])
const formId = ref(''), revision = ref(0), selectedContainerId = ref('page_1'), selectedQuestionId = ref('')
const tab = ref<'edit' | 'test' | 'publish'>('edit')
const busy = ref(false), loading = ref(false), error = ref(''), message = ref('')
const streamId = ref(''), agreementId = ref(''), startDate = ref(''), endDate = ref('')
const newDefinition = (): AdvancedSurvey => ({ schemaVersion: 3,
  title: { en: '', fr: '' }, questions: [], pages: [{ id: 'page_1', title: { en: 'Page 1', fr: 'Page 1' },
    questionIds: [], groups: [], branches: [] }] })
const definition = ref<AdvancedSurvey>(newDefinition())
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
const questionOptions = computed(() => definition.value.questions.map((question) => ({
  value: question.id, label: `${question.label[language.value] || question.id} (${question.id})`
})))
const listOptions = computed(() => definition.value.questions.filter((question) => question.type === 'list')
  .map((question) => ({ value: question.id, label: question.label[language.value] || question.id })))
const selectOptions = computed(() => definition.value.questions.filter((question) => question.type === 'select')
  .map((question) => ({ value: question.id, label: question.label[language.value] || question.id })))
const selectedDependency = computed(() => {
  const question = selectedQuestion.value
  return question?.type === 'select' && question.dependsOn
    ? definition.value.questions.find((item) => item.id === question.dependsOn!.questionId && item.type === 'select') : undefined
})
const sourceChoices = computed(() => selectedDependency.value?.type === 'select' ? selectedDependency.value.options : [])
const conditionQuestions = computed(() => definition.value.questions.map((question) => ({
  id: question.id, label: question.label[language.value] || question.id
})))
const destinationOptions = computed(() => [
  { value: 'next', label: tr('Next page in order', 'Page suivante dans l’ordre') },
  ...definition.value.pages.map((page) => ({ value: page.id, label: page.title[language.value] || page.id })),
  { value: 'end', label: tr('End form', 'Terminer le formulaire') }
])

const load = async () => {
  loading.value = true; error.value = ''
  try {
    const result = await api.get<{ surveys: Summary[]; streams: Stream[]; agreements: Agreement[]; calls: Call[] }>(endpoint.value)
    surveys.value = result.surveys; streams.value = result.streams
    agreements.value = result.agreements; calls.value = result.calls
  } catch { error.value = tr('Forms could not be loaded. Check the portal connection.', 'Impossible de charger les formulaires. Vérifiez la connexion au portail.') }
  finally { loading.value = false }
}
const resetForm = () => {
  formId.value = ''; revision.value = 0; definition.value = newDefinition()
  selectedContainerId.value = 'page_1'; selectedQuestionId.value = ''; tab.value = 'edit'
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
    definition.value = upgradeToAdvancedSurvey(result.survey.definition)
    selectedContainerId.value = definition.value.pages[0]!.id; selectedQuestionId.value = ''; tab.value = 'edit'
    saved.value = JSON.stringify(definition.value)
  } catch { error.value = tr('The form could not be opened.', 'Impossible d’ouvrir le formulaire.') }
  finally { loading.value = false }
}
const save = async () => {
  if (disabled.value) return
  const parsed = surveyV3Schema.safeParse(definition.value)
  if (!parsed.success) {
    error.value = parsed.error.issues.map((issue) => issue.message).slice(0, 4).join(' · ')
    tab.value = 'edit'; return
  }
  busy.value = true; error.value = ''; message.value = ''
  try {
    const result = await api.post<{ survey: { id: string; revision: number } }>(endpoint.value, {
      action: 'save', ...(formId.value ? { surveyId: formId.value, expectedRevision: revision.value } : {}),
      definition: parsed.data
    })
    formId.value = result.survey.id; revision.value = result.survey.revision
    definition.value = parsed.data; saved.value = JSON.stringify(parsed.data)
    message.value = tr('Form revision saved.', 'Version du formulaire enregistrée.')
    await load()
  } catch { error.value = tr('Save failed. Reload if another editor saved a newer revision.', 'Échec de l’enregistrement. Rechargez si une autre version a été enregistrée.') }
  finally { busy.value = false }
}
const publish = async (action: 'publishCall' | 'publishAgreement') => {
  if (disabled.value || !formId.value || dirty.value) return
  busy.value = true; error.value = ''; message.value = ''
  try {
    const body = action === 'publishCall'
      ? { action, surveyId: formId.value, revision: revision.value, streamId: streamId.value, startDate: startDate.value, endDate: endDate.value }
      : { action, surveyId: formId.value, revision: revision.value, agreementId: agreementId.value,
          organizationId: agreements.value.find((item) => item.id === agreementId.value)?.organizationId }
    await api.post(endpoint.value, body)
    message.value = action === 'publishCall'
      ? tr('The funding opportunity and form are published in the portal.', 'L’occasion de financement et le formulaire sont publiés dans le portail.')
      : tr('The form is published for the Agreement organization.', 'Le formulaire est publié pour l’organisme de l’accord.')
    await load()
  } catch { error.value = tr('Publication failed. Check the selected target, dates, and saved revision.', 'Échec de la publication. Vérifiez la cible, les dates et la version enregistrée.') }
  finally { busy.value = false }
}
const addPage = () => {
  const id = uid('page')
  definition.value.pages.push({ id, title: { en: `Page ${definition.value.pages.length + 1}`, fr: `Page ${definition.value.pages.length + 1}` },
    questionIds: [], groups: [], branches: [] })
  selectedContainerId.value = id; selectedQuestionId.value = ''
}
const addGroup = () => {
  const target = selected.value?.item
  if (!target) return
  const id = uid('group')
  target.groups.push({ id, title: { en: 'New section', fr: 'Nouvelle section' }, questionIds: [], groups: [] })
  selectedContainerId.value = id; selectedQuestionId.value = ''
}
const addQuestion = (type: AdvancedQuestion['type']) => {
  const target = selected.value?.item
  if (!target) return
  const id = uid('field')
  const base = { id, label: { en: 'New question', fr: 'Nouvelle question' }, required: false }
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
  selectedQuestionId.value = ''
}
const moveQuestion = (direction: -1 | 1) => {
  const ids = selected.value?.item.questionIds
  if (!ids) return
  const index = ids.indexOf(selectedQuestionId.value), destination = index + direction
  if (index < 0 || destination < 0 || destination >= ids.length) return
  ;[ids[index], ids[destination]] = [ids[destination]!, ids[index]!]
}
const placeQuestion = (targetId: string) => {
  const questionId = selectedQuestionId.value
  for (const node of nodes.value) node.item.questionIds = node.item.questionIds.filter((id) => id !== questionId)
  const target = nodes.value.find((node) => node.id === targetId)
  target?.item.questionIds.push(questionId)
  selectedContainerId.value = targetId
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
  if (!conditionQuestions.value.length) return
  page.branches.push({ when: { match: 'all', conditions: [{ questionId: conditionQuestions.value[0]!.id, operator: 'answered' }] },
    destination: { kind: 'end' } })
}
const setBranchCondition = (page: AdvancedSurvey['pages'][number], index: number, value: SurveyCondition | undefined) => {
  if (value) page.branches[index]!.when = value
}
const setDestination = (page: AdvancedSurvey['pages'][number], index: number, value: string) => {
  const target = value === 'end' ? { kind: 'end' as const } : { kind: 'page' as const, pageId: value }
  if (index < 0) page.next = value === 'next' ? undefined : target
  else page.branches[index]!.destination = target
}
const destinationValue = (destination: AdvancedSurvey['pages'][number]['next']) =>
  destination?.kind === 'page' ? destination.pageId : destination?.kind === 'end' ? 'end' : 'next'
onMounted(load)
watch(() => props.agencyId, () => { resetForm(); surveys.value = []; streams.value = []; agreements.value = []; calls.value = []; load() })
</script>

<template>
  <section class="space-y-5 border-t border-default pt-6" aria-label="Form creator">
    <div>
      <h3 class="text-base font-semibold text-highlighted">{{ tr('Form creator', 'Créateur de formulaires') }}</h3>
      <p class="mt-1 text-sm text-muted">{{ tr('Design, test, and publish revisioned forms for opportunities or verified Agreements.', 'Concevez, testez et publiez des versions de formulaires pour les occasions ou les accords vérifiés.') }}</p>
    </div>
    <p v-if="loading" role="status">{{ tr('Loading forms…', 'Chargement des formulaires…') }}</p>
    <div class="flex flex-wrap gap-2" role="tablist" :aria-label="tr('Form workflow', 'Étapes du formulaire')">
      <ExtensionButton v-for="item in ['edit', 'test', 'publish'] as const" :key="item" role="tab"
        :aria-selected="tab === item" :disabled="item !== 'edit' && !definition.questions.length"
        @click="tab = item">{{ item === 'edit' ? tr('Edit', 'Modifier') : item === 'test' ? tr('Test', 'Tester') : tr('Publish', 'Publier') }}</ExtensionButton>
    </div>
    <div class="grid gap-6 lg:grid-cols-[15rem_minmax(0,1fr)]">
      <nav class="space-y-3 border-r border-default pr-4" :aria-label="tr('Forms and pages', 'Formulaires et pages')">
        <ExtensionButton :disabled="disabled" @click="selectForm('')">{{ tr('New form', 'Nouveau formulaire') }}</ExtensionButton>
        <ul class="space-y-1 text-sm">
          <li v-for="item in surveys" :key="item.id">
            <button type="button" class="w-full rounded px-2 py-2 text-left hover:bg-elevated"
              :aria-current="formId === item.id ? 'page' : undefined" @click="selectForm(item.id)">
              {{ item.title[language] }} <span class="text-muted">· v{{ item.revision }}</span>
            </button>
          </li>
        </ul>
        <template v-if="tab === 'edit'">
          <h4 class="text-sm font-semibold">{{ tr('Pages and groups', 'Pages et groupes') }}</h4>
          <ul class="space-y-1 text-sm">
            <li v-for="node in nodes" :key="node.id">
              <button type="button" class="w-full rounded px-2 py-2 text-left hover:bg-elevated"
                :style="{ paddingInlineStart: `${8 + node.depth * 14}px` }"
                :aria-current="selectedContainerId === node.id ? 'location' : undefined"
                @click="selectedContainerId = node.id; selectedQuestionId = ''">
                {{ node.kind === 'page' ? '▣' : '▸' }} {{ node.title || node.id }}
              </button>
            </li>
          </ul>
          <ExtensionButton :disabled="disabled" @click="addPage">{{ tr('Add page', 'Ajouter une page') }}</ExtensionButton>
        </template>
      </nav>
      <div class="min-w-0 space-y-5">
        <template v-if="tab === 'edit'">
          <div class="grid gap-3 sm:grid-cols-2">
            <ExtensionFormField :label="tr('Form title in English', 'Titre du formulaire en anglais')" name="formTitleEn" required>
              <ExtensionInput v-model="definition.title.en" name="formTitleEn" required :disabled="disabled" />
            </ExtensionFormField>
            <ExtensionFormField :label="tr('Form title in French', 'Titre du formulaire en français')" name="formTitleFr" required>
              <ExtensionInput v-model="definition.title.fr" name="formTitleFr" required :disabled="disabled" />
            </ExtensionFormField>
          </div>
          <template v-if="selected">
            <div class="space-y-3 border-t border-default pt-4">
              <h4 class="font-semibold">{{ selected.kind === 'page' ? tr('Page', 'Page') : tr('Section or subsection', 'Section ou sous-section') }}</h4>
              <div class="grid gap-3 sm:grid-cols-2">
                <ExtensionFormField :label="tr('Heading in English', 'Titre en anglais')" name="groupTitleEn" required>
                  <ExtensionInput v-model="selected.item.title.en" name="groupTitleEn" required :disabled="disabled" />
                </ExtensionFormField>
                <ExtensionFormField :label="tr('Heading in French', 'Titre en français')" name="groupTitleFr" required>
                  <ExtensionInput v-model="selected.item.title.fr" name="groupTitleFr" required :disabled="disabled" />
                </ExtensionFormField>
              </div>
              <ExtensionFormField v-if="selected.kind === 'group'" :label="tr('Repeat this group for each item in', 'Répéter ce groupe pour chaque élément de')" name="repeatFor">
                <ExtensionSelect :model-value="(selected.item as AdvancedGroup).repeatFor ?? 'none'" name="repeatFor" value-key="value" :disabled="disabled"
                  :items="[{ value: 'none', label: tr('Do not repeat', 'Ne pas répéter') }, ...listOptions]"
                  @update:model-value="(selected.item as AdvancedGroup).repeatFor = String($event) === 'none' ? undefined : String($event)" />
              </ExtensionFormField>
              <div v-if="selected.kind === 'group'">
                <p class="text-sm font-medium">{{ tr('Show this group when', 'Afficher ce groupe lorsque') }}</p>
                <FormCondition v-model="(selected.item as AdvancedGroup).visibleWhen" :questions="conditionQuestions" :locale="language" :disabled="disabled" />
              </div>
              <div class="flex flex-wrap gap-2">
                <ExtensionButton :disabled="disabled" @click="addGroup">{{ tr('Add nested section', 'Ajouter une section imbriquée') }}</ExtensionButton>
                <ExtensionButton :disabled="disabled || (selected.kind === 'page' && definition.pages.length === 1)" @click="removeContainer">
                  {{ tr('Remove empty group or page', 'Retirer le groupe ou la page vide') }}
                </ExtensionButton>
              </div>
            </div>
            <div class="space-y-3 border-t border-default pt-4">
              <h4 class="font-semibold">{{ tr('Questions in this area', 'Questions dans cette zone') }}</h4>
              <ol class="space-y-1">
                <li v-for="id in selected.item.questionIds" :key="id">
                  <button type="button" class="w-full rounded border border-default px-3 py-2 text-left hover:bg-elevated"
                    :aria-current="selectedQuestionId === id ? 'true' : undefined" @click="selectedQuestionId = id">
                    {{ definition.questions.find((question) => question.id === id)?.label[language] ?? id }}
                    <span class="text-xs text-muted">· {{ definition.questions.find((question) => question.id === id)?.type }}</span>
                  </button>
                </li>
              </ol>
              <ExtensionFormField :label="tr('Add question type', 'Type de question à ajouter')" name="newQuestionType">
                <ExtensionSelect name="newQuestionType" value-key="value" :disabled="disabled" :model-value="''"
                  :items="(['text','email','number','date','select','list','table','computed'] as const).map((value) => ({ value, label: value }))"
                  :placeholder="tr('Choose a type', 'Choisir un type')"
                  @update:model-value="($event) && addQuestion($event as AdvancedQuestion['type'])" />
              </ExtensionFormField>
            </div>
            <div v-if="selectedQuestion" class="space-y-4 border-t border-default pt-4">
              <h4 class="font-semibold">{{ tr('Question settings', 'Paramètres de la question') }} · {{ selectedQuestion.id }}</h4>
              <div class="grid gap-3 sm:grid-cols-2">
                <ExtensionFormField :label="tr('Question in English', 'Question en anglais')" name="questionEn" required>
                  <ExtensionInput v-model="selectedQuestion.label.en" name="questionEn" required :disabled="disabled" />
                </ExtensionFormField>
                <ExtensionFormField :label="tr('Question in French', 'Question en français')" name="questionFr" required>
                  <ExtensionInput v-model="selectedQuestion.label.fr" name="questionFr" required :disabled="disabled" />
                </ExtensionFormField>
              </div>
              <ExtensionCheckbox v-if="selectedQuestion.type !== 'computed'" v-model="selectedQuestion.required" :label="tr('Required response', 'Réponse obligatoire')" :disabled="disabled" />
              <ExtensionFormField :label="tr('Place in', 'Placer dans')" name="questionPlacement">
                <ExtensionSelect :model-value="selected.id" name="questionPlacement" value-key="value" :disabled="disabled"
                  :items="nodes.map((node) => ({ value: node.id, label: `${'· '.repeat(node.depth)}${node.title}` }))"
                  @update:model-value="placeQuestion(String($event))" />
              </ExtensionFormField>
              <div class="flex flex-wrap gap-2">
                <ExtensionButton :disabled="disabled" @click="moveQuestion(-1)">{{ tr('Move up', 'Monter') }}</ExtensionButton>
                <ExtensionButton :disabled="disabled" @click="moveQuestion(1)">{{ tr('Move down', 'Descendre') }}</ExtensionButton>
                <ExtensionButton :disabled="disabled" @click="removeQuestion">{{ tr('Remove question', 'Retirer la question') }}</ExtensionButton>
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
                <div v-for="(option, index) in selectedQuestion.options" :key="index" class="grid gap-2 border-b border-default pb-3 sm:grid-cols-3">
                  <ExtensionFormField :label="tr('Value', 'Valeur')" :name="`choiceValue${index}`" required>
                    <ExtensionInput v-model="option.value" :name="`choiceValue${index}`" required :disabled="disabled" />
                  </ExtensionFormField>
                  <ExtensionFormField :label="tr('English', 'Anglais')" :name="`choiceEn${index}`" required>
                    <ExtensionInput v-model="option.label.en" :name="`choiceEn${index}`" required :disabled="disabled" />
                  </ExtensionFormField>
                  <ExtensionFormField :label="tr('French', 'Français')" :name="`choiceFr${index}`" required>
                    <ExtensionInput v-model="option.label.fr" :name="`choiceFr${index}`" required :disabled="disabled" />
                  </ExtensionFormField>
                  <ExtensionButton :disabled="disabled || selectedQuestion.options.length === 1" @click="selectedQuestion.options.splice(index, 1)">
                    {{ tr('Remove choice', 'Retirer le choix') }}
                  </ExtensionButton>
                </div>
                <ExtensionButton :disabled="disabled || selectedQuestion.options.length >= 50" @click="addChoice">{{ tr('Add choice', 'Ajouter un choix') }}</ExtensionButton>
                <ExtensionFormField :label="tr('Choices depend on', 'Choix selon la réponse à')" name="choiceDependency">
                  <ExtensionSelect :model-value="selectedQuestion.dependsOn?.questionId ?? 'none'" name="choiceDependency" value-key="value" :disabled="disabled"
                    :items="[{ value: 'none', label: tr('No dependency', 'Aucune dépendance') }, ...selectOptions.filter((item) => item.value !== selectedQuestion!.id)]"
                    @update:model-value="setDependency(String($event))" />
                </ExtensionFormField>
                <div v-if="selectedQuestion.dependsOn" class="space-y-3 border-l border-default pl-4">
                  <div v-for="source in sourceChoices" :key="source.value">
                    <p class="font-medium">{{ tr('When', 'Lorsque') }} {{ source.label[language] }}</p>
                    <div class="grid gap-2 sm:grid-cols-2">
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
                <div v-for="(column, index) in selectedQuestion.columns" :key="index" class="grid gap-2 border-b border-default pb-3 sm:grid-cols-2">
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
                  <ExtensionButton :disabled="disabled || selectedQuestion.columns.length === 1" @click="selectedQuestion.columns.splice(index, 1)">
                    {{ tr('Remove column', 'Retirer la colonne') }}
                  </ExtensionButton>
                </div>
                <ExtensionButton :disabled="disabled || selectedQuestion.columns.length >= 20" @click="addColumn">{{ tr('Add column', 'Ajouter une colonne') }}</ExtensionButton>
              </template>
              <template v-if="selectedQuestion.type === 'computed'">
                <ExtensionFormField :label="tr('Template — use {{field_id}} for values', 'Modèle — utilisez {{field_id}} pour les valeurs')" name="computedTemplate" required>
                  <ExtensionInput v-model="selectedQuestion.template" name="computedTemplate" required :disabled="disabled" />
                </ExtensionFormField>
                <p id="computed-sources-label" class="text-sm font-medium">{{ t('computedSourcesRequired') }}</p>
                <p id="computed-sources-help" class="text-sm">{{ t('computedSourcesHelp') }}</p>
                <div role="group" aria-labelledby="computed-sources-label" aria-describedby="computed-sources-help" class="grid gap-2 sm:grid-cols-2">
                  <ExtensionCheckbox v-for="item in questionOptions.filter((item) => item.value !== selectedQuestion!.id)" :key="item.value"
                    :label="item.label" :disabled="disabled" :model-value="selectedQuestion.sourceIds.includes(item.value)"
                    @update:model-value="selectedQuestion!.type === 'computed' && (selectedQuestion.sourceIds = $event
                      ? [...new Set([...selectedQuestion.sourceIds, item.value])]
                      : selectedQuestion.sourceIds.filter((id) => id !== item.value))" />
                </div>
              </template>
              <div>
                <p class="text-sm font-medium">{{ tr('Show this question when', 'Afficher cette question lorsque') }}</p>
                <FormCondition v-model="selectedQuestion.visibleWhen" :questions="conditionQuestions" :locale="language" :disabled="disabled" />
              </div>
            </div>
            <div v-if="selected.kind === 'page'" class="space-y-3 border-t border-default pt-4">
              <h4 class="font-semibold">{{ tr('Page branching', 'Embranchements de la page') }}</h4>
              <p class="text-sm text-muted">{{ tr('The first matching rule chooses the next page. Destinations must be later pages.', 'La première règle correspondante choisit la page suivante. Les destinations doivent être des pages suivantes.') }}</p>
              <div v-for="(branch, index) in (selected.item as AdvancedSurvey['pages'][number]).branches" :key="index" class="space-y-2 border-l border-default pl-4">
                <FormCondition :model-value="branch.when" :questions="conditionQuestions" :locale="language" :disabled="disabled"
                  @update:model-value="setBranchCondition(selected!.item as AdvancedSurvey['pages'][number], index, $event)" />
                <ExtensionFormField :label="tr('Then go to', 'Aller à')" :name="`branchDestination${index}`">
                  <ExtensionSelect :model-value="branch.destination.kind === 'end' ? 'end' : branch.destination.pageId"
                    :name="`branchDestination${index}`" value-key="value" :disabled="disabled" :items="destinationOptions.filter((item) => item.value !== 'next')"
                    @update:model-value="setDestination(selected!.item as AdvancedSurvey['pages'][number], index, String($event))" />
                </ExtensionFormField>
                <ExtensionButton :disabled="disabled" @click="(selected.item as AdvancedSurvey['pages'][number]).branches.splice(index, 1)">
                  {{ tr('Remove branch', 'Retirer l’embranchement') }}
                </ExtensionButton>
              </div>
              <ExtensionButton :disabled="disabled || !conditionQuestions.length" @click="addBranch(selected.item as AdvancedSurvey['pages'][number])">
                {{ tr('Add branch', 'Ajouter un embranchement') }}
              </ExtensionButton>
              <ExtensionFormField :label="tr('Otherwise', 'Sinon')" name="pageNext">
                <ExtensionSelect :model-value="destinationValue((selected.item as AdvancedSurvey['pages'][number]).next)"
                  name="pageNext" value-key="value" :disabled="disabled" :items="destinationOptions"
                  @update:model-value="setDestination(selected!.item as AdvancedSurvey['pages'][number], -1, String($event))" />
              </ExtensionFormField>
            </div>
          </template>
          <ExtensionSaveButton :label="tr('Save form revision', 'Enregistrer la version du formulaire')" :disabled="disabled" :loading="busy" @click="save" />
        </template>
        <FormTest v-else-if="tab === 'test'" :definition="definition" :locale="language" />
        <div v-else class="space-y-5">
          <p v-if="dirty || !formId" class="text-sm text-muted">{{ tr('Save the form before publishing.', 'Enregistrez le formulaire avant de le publier.') }}</p>
          <section class="space-y-3">
            <h4 class="font-semibold">{{ tr('Funding opportunity (estimated GCS shim)', 'Occasion de financement (modèle GCS provisoire)') }}</h4>
            <ExtensionFormField :label="tr('GCS stream', 'Volet GCS')" name="formStream" required>
              <ExtensionSelect v-model="streamId" name="formStream" value-key="value" :disabled="disabled"
                :items="streams.map((item) => ({ value: item.id, label: item[locale === 'fr' ? 'nameFr' : 'nameEn'] }))" />
            </ExtensionFormField>
            <div class="grid gap-3 sm:grid-cols-2">
              <ExtensionFormField :label="tr('Opens (YYYY-MM-DD)', 'Ouverture (AAAA-MM-JJ)')" name="formStart" required>
                <ExtensionInput v-model="startDate" name="formStart" required :disabled="disabled" />
              </ExtensionFormField>
              <ExtensionFormField :label="tr('Closes (YYYY-MM-DD)', 'Fermeture (AAAA-MM-JJ)')" name="formEnd" required>
                <ExtensionInput v-model="endDate" name="formEnd" required :disabled="disabled" />
              </ExtensionFormField>
            </div>
            <ExtensionButton :disabled="disabled || dirty || !formId || !streamId || !startDate || !endDate" :loading="busy" @click="publish('publishCall')">
              {{ tr('Publish opportunity and form', 'Publier l’occasion et le formulaire') }}
            </ExtensionButton>
          </section>
          <section class="space-y-3 border-t border-default pt-4">
            <h4 class="font-semibold">{{ tr('Existing Agreement', 'Accord existant') }}</h4>
            <p class="text-sm text-muted">{{ tr('Only verified, synced Agreement organizations appear here.', 'Seuls les organismes vérifiés et les accords synchronisés figurent ici.') }}</p>
            <ExtensionFormField :label="tr('Agreement and organization', 'Accord et organisme')" name="formAgreement" required>
              <ExtensionSelect v-model="agreementId" name="formAgreement" value-key="value" :disabled="disabled"
                :items="agreements.map((item) => ({ value: item.id, label: `${item.agreementNumber} · ${item[locale === 'fr' ? 'nameFr' : 'nameEn']} · ${item.organizationId}` }))" />
            </ExtensionFormField>
            <ExtensionButton :disabled="disabled || dirty || !formId || !agreementId" :loading="busy" @click="publish('publishAgreement')">
              {{ tr('Publish form to Agreement', 'Publier le formulaire pour l’accord') }}
            </ExtensionButton>
          </section>
          <p v-if="calls.some((call) => call.surveyId === formId && call.published)" class="text-sm text-success">
            {{ tr('This form has a published funding opportunity.', 'Ce formulaire est associé à une occasion de financement publiée.') }}
          </p>
        </div>
      </div>
    </div>
    <p v-if="message" role="status" class="text-sm text-success">{{ message }}</p>
    <p v-if="error" role="alert" class="text-sm text-error">{{ error }}</p>
  </section>
</template>
