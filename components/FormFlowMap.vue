<script setup lang="ts">
import { computed } from 'vue'
import type { AdvancedSurvey, SurveyCondition } from '@gcs-ssc/survey'

const props = defineProps<{
  definition: AdvancedSurvey
  locale: 'en' | 'fr'
  selectedPageId?: string
}>()
const emit = defineEmits<{ 'select-page': [pageId: string] }>()
const tr = (en: string, fr: string) => props.locale === 'fr' ? fr : en
const pages = computed(() => props.definition.pages)
const questionById = computed(() => new Map(props.definition.questions.map((question) => [question.id, question])))
const pageName = (pageId: string) => {
  const page = pages.value.find((item) => item.id === pageId)
  return page?.title[props.locale] || page?.title.en || pageId
}
const destinationName = (destination: AdvancedSurvey['pages'][number]['next']) => destination?.kind === 'page'
  ? pageName(destination.pageId) : tr('End', 'Fin')
const defaultDestination = (index: number) => pages.value[index]?.next
  ?? (pages.value[index + 1] ? { kind: 'page' as const, pageId: pages.value[index + 1]!.id } : { kind: 'end' as const })
const conditionPart = (row: SurveyCondition['conditions'][number]) => {
  const question = questionById.value.get(row.questionId)
  const label = question?.label[props.locale] || question?.label.en || row.questionId
  const operators: Record<SurveyCondition['conditions'][number]['operator'], string> = {
    equals: tr('is', 'est égal à'), notEquals: tr('is not', 'n’est pas égal à'),
    contains: tr('contains', 'contient'), greaterThan: tr('is greater than', 'est supérieur à'),
    lessThan: tr('is less than', 'est inférieur à'), answered: tr('is answered', 'a une réponse'),
    notAnswered: tr('is unanswered', 'n’a pas de réponse')
  }
  if (!('value' in row)) return `${label} ${operators[row.operator]}`
  const value = question?.type === 'select'
    ? question.options.find((option) => option.value === row.value)?.label[props.locale]
      || question.options.find((option) => option.value === row.value)?.label.en || row.value
    : row.value
  return `${label} ${operators[row.operator]} “${value}”`
}
const conditionLabel = (condition: SurveyCondition) => condition.conditions.length
  ? condition.conditions.map(conditionPart).join(condition.match === 'all' ? tr(' and ', ' et ') : tr(' or ', ' ou '))
  : tr('Condition not set', 'Condition non définie')
</script>

<template>
  <section class="flow-map" :aria-label="tr('Form page flow', 'Parcours des pages du formulaire')">
    <div class="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <div>
        <h4 class="text-sm font-semibold text-highlighted">{{ tr('Page flow', 'Parcours des pages') }}</h4>
        <p class="mt-0.5 text-xs text-muted">{{ tr('Pages appear in order; routes show where each answer goes. Select a page to edit its routes.',
          'Les pages suivent leur ordre; les parcours montrent où mène chaque réponse. Sélectionnez une page pour modifier ses parcours.') }}</p>
      </div>
      <div class="flex items-center gap-4 text-xs text-muted" :aria-label="tr('Route legend', 'Légende des parcours')">
        <span class="flex items-center gap-1.5"><span class="h-0.5 w-4 bg-primary" aria-hidden="true" />{{ tr('If', 'Si') }}</span>
        <span class="flex items-center gap-1.5"><span class="h-0.5 w-4 bg-gray-400" aria-hidden="true" />{{ tr('Otherwise', 'Sinon') }}</span>
      </div>
    </div>

    <div class="flow-scroll overflow-x-auto pb-3" tabindex="0"
      :aria-label="tr('Page route overview', 'Aperçu des parcours des pages')">
      <ol class="flow-track flex min-w-max items-start gap-4 py-2" :aria-label="tr('Pages in order', 'Pages dans l’ordre')">
        <li class="flow-step flow-terminal">
          <div class="flow-terminal-node">{{ tr('Start', 'Début') }}</div>
        </li>
        <li v-for="(page, index) in pages" :key="page.id" class="flow-step flow-page">
          <button type="button" class="flow-page-node w-full rounded-lg border px-3 py-3 text-left transition-colors hover:border-primary hover:bg-elevated focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
            :class="selectedPageId === page.id ? 'border-primary bg-primary/10' : 'border-default bg-default'"
            :aria-current="selectedPageId === page.id ? 'step' : undefined"
            :aria-label="`${tr('Edit page', 'Modifier la page')} ${index + 1}: ${page.title[locale] || page.title.en || page.id}`"
            @click="emit('select-page', page.id)">
            <span class="block text-[0.65rem] font-semibold uppercase tracking-wide text-muted">{{ tr('Page', 'Page') }} {{ index + 1 }}</span>
            <span class="mt-1 block break-words text-sm font-semibold text-highlighted">{{ page.title[locale] || page.title.en || page.id }}</span>
          </button>
          <div class="flow-routes mt-3 border-l-2 border-default pl-3">
            <div v-for="(branch, branchIndex) in page.branches" :key="branchIndex" class="flow-route flow-route-condition rounded-md border border-primary/35 bg-primary/5 p-2.5">
              <span class="block text-[0.65rem] font-semibold uppercase tracking-wide text-primary">{{ tr('If', 'Si') }} {{ branchIndex + 1 }}</span>
              <span class="mt-1 block break-words text-xs leading-5 text-highlighted">{{ conditionLabel(branch.when) }}</span>
              <span class="mt-1 block break-words text-xs font-semibold text-primary">
                <span aria-hidden="true">↳ </span>{{ destinationName(branch.destination) }}
              </span>
            </div>
            <div class="flow-route rounded-md border border-default bg-elevated p-2.5">
              <span class="block text-[0.65rem] font-semibold uppercase tracking-wide text-muted">{{ tr('Otherwise', 'Sinon') }}</span>
              <span class="mt-1 block break-words text-xs font-semibold text-highlighted">
                <span aria-hidden="true">↳ </span>{{ destinationName(defaultDestination(index)) }}
              </span>
            </div>
          </div>
        </li>
        <li class="flow-step flow-terminal">
          <div class="flow-terminal-node">{{ tr('End', 'Fin') }}</div>
        </li>
      </ol>
    </div>
  </section>
</template>

<style scoped>
.flow-map { container-type: inline-size; }
.flow-step { position: relative; flex: none; }
.flow-page { width: 14rem; }
.flow-terminal { width: 5.5rem; }
.flow-routes { display: grid; gap: 0.5rem; }
.flow-terminal-node {
  display: flex;
  min-height: 3.75rem;
  align-items: center;
  justify-content: center;
  border: 1px solid #64748b;
  border-radius: 999px;
  color: inherit;
  font-size: 0.75rem;
  font-weight: 700;
}
@container (max-width: 44rem) {
  .flow-scroll { overflow-x: visible; }
  .flow-track {
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 1.25rem;
  }
  .flow-step { width: 100%; }
  .flow-step:not(:last-child)::after {
    position: absolute;
    top: calc(100% + 0.1rem);
    left: 2.7rem;
    height: 1rem;
    border-left: 2px solid #94a3b8;
    content: '';
  }
  .flow-terminal-node { width: 5.5rem; }
  .flow-routes { grid-template-columns: repeat(auto-fit, minmax(min(100%, 13rem), 1fr)); }
}
</style>
