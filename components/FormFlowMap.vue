<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import type { AdvancedSurvey, SurveyCondition } from '@gcs-ssc/survey'
import { ExtensionAssessmentSchemaPageSection, ExtensionIcon, useExtensionI18n } from '@gcs-ssc/extensions/ui'
import { messages } from '../i18n/messages'

const props = defineProps<{
  definition: AdvancedSurvey
  locale: 'en' | 'fr'
  selectedPageId?: string
}>()
const emit = defineEmits<{ 'select-page': [pageId: string] }>()
const { t } = useExtensionI18n(messages)
const pages = computed(() => props.definition.pages)
const ruleCount = computed(() => pages.value.reduce((count, page) => count + page.branches.length, 0))
const questionById = computed(() => new Map(props.definition.questions.map((question) => [question.id, question])))
const pageName = (pageId: string) => {
  const page = pages.value.find((item) => item.id === pageId)
  return page?.title[props.locale] || page?.title.en || pageId
}
const destinationName = (destination: AdvancedSurvey['pages'][number]['next']) => destination?.kind === 'page'
  ? pageName(destination.pageId) : t('formFlowEnd')
const defaultDestination = (index: number) => pages.value[index]?.next
  ?? (pages.value[index + 1] ? { kind: 'page' as const, pageId: pages.value[index + 1]!.id } : { kind: 'end' as const })
const defaultDestinationId = (index: number) => {
  const destination = defaultDestination(index)
  return destination.kind === 'page' ? destination.pageId : 'end'
}
const conditionPart = (row: SurveyCondition['conditions'][number]) => {
  const question = questionById.value.get(row.questionId)
  const label = question?.label[props.locale] || question?.label.en || row.questionId
  const operators: Record<SurveyCondition['conditions'][number]['operator'], string> = {
    equals: t('formFlowEquals'), notEquals: t('formFlowNotEquals'),
    contains: t('formFlowContains'), greaterThan: t('formFlowGreaterThan'),
    lessThan: t('formFlowLessThan'), answered: t('formFlowAnswered'),
    notAnswered: t('formFlowNotAnswered')
  }
  if (!('value' in row)) return `${label} ${operators[row.operator]}`
  const value = question?.type === 'select'
    ? question.options.find((option) => option.value === row.value)?.label[props.locale]
      || question.options.find((option) => option.value === row.value)?.label.en || row.value
    : row.value
  return `${label} ${operators[row.operator]} “${value}”`
}
const conditionLabel = (condition: SurveyCondition) => condition.conditions.length
  ? condition.conditions.map(conditionPart).join(condition.match === 'all' ? t('formFlowAnd') : t('formFlowOr'))
  : t('formFlowConditionUnset')
const canvas = ref<HTMLElement | null>(null)
const flowSize = ref({ width: 0, height: 0 })
type FlowEdgeKind = 'direct' | 'conditional' | 'default'
const flowEdges = ref<Array<{ path: string; kind: FlowEdgeKind }>>([])
const markerId = `form-flow-arrow-${useId()}`
let resizeObserver: ResizeObserver | undefined
let frame = 0
const updateEdges = () => {
  const root = canvas.value
  if (!root) return
  const bounds = root.getBoundingClientRect()
  if (!bounds.width || !bounds.height) { flowEdges.value = []; return }
  const vertical = (root.parentElement?.clientWidth ?? root.clientWidth) < 704
  const destinations = new Map<string, HTMLElement>(Array.from(root.querySelectorAll<HTMLElement>('[data-flow-node]'))
    .map(node => [node.dataset.flowNode!, node] as const))
  const edges: Array<{ path: string; kind: FlowEdgeKind }> = []
  for (const route of root.querySelectorAll<HTMLElement>('[data-flow-destination]')) {
    const target = destinations.get(route.dataset.flowDestination ?? '')
    if (!target) continue
    const from = route.getBoundingClientRect()
    const to = target.getBoundingClientRect()
    const startX = vertical ? from.left + from.width / 2 - bounds.left : from.right - bounds.left + 2
    const startY = vertical ? from.bottom - bounds.top + 2 : from.top + from.height / 2 - bounds.top
    const endX = vertical ? to.left + to.width / 2 - bounds.left : to.left - bounds.left - 8
    const endY = vertical ? to.top - bounds.top - 8 : to.top + to.height / 2 - bounds.top
    const span = Math.max(28, Math.abs(vertical ? endY - startY : endX - startX) * .35)
    const direction = (vertical ? endY >= startY : endX >= startX) ? 1 : -1
    const path = vertical
      ? `M ${startX} ${startY} C ${startX} ${startY + direction * span}, ${endX} ${endY - direction * span}, ${endX} ${endY}`
      : `M ${startX} ${startY} C ${startX + direction * span} ${startY}, ${endX - direction * span} ${endY}, ${endX} ${endY}`
    const kind = route.dataset.flowKind
    edges.push({ path, kind: kind === 'conditional' || kind === 'default' ? kind : 'direct' })
  }
  flowSize.value = { width: root.scrollWidth, height: root.scrollHeight }
  flowEdges.value = edges
}
const scheduleEdges = () => {
  if (typeof requestAnimationFrame !== 'function') { updateEdges(); return }
  if (frame) cancelAnimationFrame(frame)
  frame = requestAnimationFrame(() => { frame = 0; updateEdges() })
}
onMounted(async () => {
  await nextTick()
  scheduleEdges()
  if (typeof ResizeObserver !== 'undefined' && canvas.value) {
    resizeObserver = new ResizeObserver(scheduleEdges)
    resizeObserver.observe(canvas.value)
  }
})
onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  if (frame && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame)
})
watch(() => [props.definition.pages, props.definition.questions, props.locale], async () => {
  await nextTick()
  scheduleEdges()
}, { deep: true })
</script>

<template>
  <ExtensionAssessmentSchemaPageSection section-id="form-flow-diagram" :title="t('formFlowTitle')">
  <section class="flow-map" :aria-label="t('formFlowAria')">
    <div class="flow-heading">
      <p class="flow-description">{{ t('formFlowDescription') }}</p>
      <div class="flow-stats">
        <span><strong>{{ pages.length }}</strong> {{ t(pages.length === 1 ? 'formFlowPageSingular' : 'formFlowPagePlural') }}</span>
        <span><strong>{{ ruleCount }}</strong> {{ t(ruleCount === 1 ? 'formFlowRuleSingular' : 'formFlowRulePlural') }}</span>
      </div>
    </div>
    <div class="flow-legend" :aria-label="t('formFlowLegend')">
      <span><i class="flow-legend-line flow-legend-line--direct" aria-hidden="true" />{{ t('formFlowDirect') }}</span>
      <span v-if="ruleCount"><i class="flow-legend-line flow-legend-line--condition" aria-hidden="true" />{{ t('formFlowConditional') }}</span>
      <span v-if="ruleCount"><i class="flow-legend-line flow-legend-line--default" aria-hidden="true" />{{ t('formFlowDefault') }}</span>
    </div>
    <p class="flow-order-label">{{ t('formFlowPagesInOrder') }}</p>
    <div class="flow-scroll" tabindex="0"
      :aria-label="t('formFlowOverview')">
      <div ref="canvas" class="flow-canvas">
      <svg v-if="flowEdges.length" class="flow-connections" :viewBox="`0 0 ${flowSize.width} ${flowSize.height}`" aria-hidden="true">
        <defs>
          <marker :id="markerId" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
            <path d="M 0 0 L 6 3 L 0 6 z" class="flow-marker--conditional" />
          </marker>
          <marker :id="`${markerId}-default`" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
            <path d="M 0 0 L 6 3 L 0 6 z" class="flow-marker--default" />
          </marker>
        </defs>
        <path v-for="(edge, index) in flowEdges" :key="index" :d="edge.path"
          class="flow-connection" :class="`flow-connection--${edge.kind}`"
          :marker-end="`url(#${markerId}${edge.kind === 'default' ? '-default' : ''})`" />
      </svg>
      <ol class="flow-track" :aria-label="t('formFlowPagesInOrder')">
        <li class="flow-step flow-terminal">
          <div class="flow-terminal-node flow-terminal-node--start" :data-flow-destination="pages[0]?.id" data-flow-kind="direct"><ExtensionIcon name="i-lucide-play" class="size-4" aria-hidden="true" />{{ t('formFlowStart') }}</div>
        </li>
        <li v-for="(page, index) in pages" :key="page.id" class="flow-step flow-page">
          <button type="button" class="flow-page-node" :data-flow-node="page.id"
            :data-flow-destination="page.branches.length ? undefined : defaultDestinationId(index)"
            :data-flow-kind="page.branches.length ? undefined : 'direct'"
            :aria-current="selectedPageId === page.id ? 'step' : undefined"
            :aria-label="t('formFlowEditPage', { number: index + 1, name: page.title[locale] || page.title.en || page.id })"
            @click="emit('select-page', page.id)">
            <span class="flow-page-index">{{ t('formFlowPageSingular') }} {{ index + 1 }}</span>
            <strong class="flow-page-title">{{ page.title[locale] || page.title.en || page.id }}</strong>
            <ExtensionIcon name="i-lucide-arrow-up-right" class="flow-page-edit size-4" aria-hidden="true" />
          </button>
          <div v-if="page.branches.length" class="flow-routes">
            <div v-for="(branch, branchIndex) in page.branches" :key="branchIndex" class="flow-route flow-route--conditional"
              :data-flow-destination="branch.destination.kind === 'page' ? branch.destination.pageId : 'end'" data-flow-kind="conditional">
              <span class="flow-route-label">{{ t('formFlowIf') }} {{ branchIndex + 1 }}</span>
              <span class="flow-route-condition">{{ conditionLabel(branch.when) }}</span>
              <span class="flow-route-target"><ExtensionIcon name="i-lucide-corner-down-right" class="size-4 shrink-0" aria-hidden="true" />{{ destinationName(branch.destination) }}</span>
            </div>
            <div class="flow-route flow-route--default" :data-flow-destination="defaultDestinationId(index)" data-flow-kind="default">
              <span class="flow-route-label">{{ t('formFlowOtherwise') }}</span>
              <span class="flow-route-target"><ExtensionIcon name="i-lucide-corner-down-right" class="size-4 shrink-0" aria-hidden="true" />{{ destinationName(defaultDestination(index)) }}</span>
            </div>
          </div>
        </li>
        <li class="flow-step flow-terminal">
          <div class="flow-terminal-node flow-terminal-node--end" data-flow-node="end"><ExtensionIcon name="i-lucide-flag" class="size-4" aria-hidden="true" />{{ t('formFlowEnd') }}</div>
        </li>
      </ol>
      </div>
    </div>
    <p class="flow-hint"><ExtensionIcon name="i-lucide-mouse-pointer-2" class="size-4" aria-hidden="true" />{{ t('formFlowSelectHint') }}</p>
  </section>
  </ExtensionAssessmentSchemaPageSection>
</template>

<style scoped>
.flow-map { min-width: 0; container-type: inline-size; }
.flow-heading { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 1rem; }
.flow-description { max-width: 42rem; color: var(--ui-text-muted, #a2a3ab); font-size: .875rem; line-height: 1.5; }
.flow-stats { display: flex; gap: .5rem; color: var(--ui-text-muted, #a2a3ab); font-size: .75rem; }
.flow-stats span { padding: .45rem .7rem; border: 1px solid var(--ui-border, #33343a); border-radius: 999px; white-space: nowrap; }
.flow-stats strong { color: var(--ui-primary, #008cca); font-size: .875rem; }
.flow-legend { display: flex; flex-wrap: wrap; gap: .5rem 1rem; margin-top: 1rem; color: var(--ui-text-muted, #a2a3ab); font-size: .72rem; }
.flow-legend span { display: inline-flex; align-items: center; gap: .4rem; }
.flow-legend-line { width: 1.25rem; border-top: 2px solid var(--ui-primary, #008cca); }
.flow-legend-line--direct { border-width: 2px; }
.flow-legend-line--default { border-color: var(--ui-text-muted, #a2a3ab); border-top-style: dashed; }
.flow-order-label { margin-top: 1.5rem; color: var(--ui-text-muted, #a2a3ab); font-size: .65rem; font-weight: 800; text-transform: uppercase; letter-spacing: .12em; }
.flow-scroll { overflow-x: auto; padding: 1rem 0 1.5rem; }
.flow-scroll:focus-visible { outline: 2px solid var(--ui-primary, #008cca); outline-offset: 2px; }
.flow-canvas { position: relative; width: max-content; min-width: 100%; }
.flow-connections { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; color: var(--ui-primary, #008cca); }
.flow-marker--conditional { fill: var(--ui-primary, #008cca); }
.flow-marker--default { fill: var(--ui-text-muted, #a2a3ab); }
.flow-connection { fill: none; stroke-width: 1.5; stroke-linecap: round; }
.flow-connection--direct { stroke: var(--ui-primary, #008cca); stroke-width: 2; opacity: .85; }
.flow-connection--conditional { stroke: var(--ui-primary, #008cca); opacity: .65; }
.flow-connection--default { stroke: var(--ui-text-muted, #a2a3ab); stroke-dasharray: 4 4; opacity: .55; }
.flow-track { display: flex; width: max-content; min-width: 100%; align-items: flex-start; gap: 3rem; margin: 0; padding: .5rem 0; list-style: none; }
.flow-step { position: relative; flex: none; }
.flow-page { width: 16.5rem; }
.flow-terminal { width: 6.5rem; }
.flow-terminal-node { display: flex; min-height: 5.5rem; flex-direction: column; align-items: center; justify-content: center; gap: .3rem; border: 1px solid var(--ui-primary, #008cca); border-radius: 1rem; background: color-mix(in srgb, var(--ui-primary, #008cca) 10%, var(--ui-bg, #1e1e22)); color: var(--ui-primary, #008cca); font-size: .75rem; font-weight: 800; text-transform: uppercase; letter-spacing: .07em; }
.flow-terminal-node--end { border-color: var(--ui-border, #33343a); background: var(--ui-bg-elevated, #28282d); color: var(--ui-text, #e8e8ec); }
.flow-page-node { position: relative; display: flex; width: 100%; min-height: 5.5rem; flex-direction: column; align-items: flex-start; justify-content: center; gap: .35rem; padding: .85rem 2.25rem .85rem 1rem; border: 1px solid var(--ui-border, #33343a); border-inline-start: .25rem solid var(--ui-primary, #008cca); border-radius: .5rem; background: var(--ui-bg-elevated, #28282d); text-align: start; transition: border-color .15s ease, background .15s ease, transform .15s ease; }
.flow-page-node:hover, .flow-page-node:focus-visible { border-color: var(--ui-primary, #008cca); background: color-mix(in srgb, var(--ui-primary, #008cca) 12%, var(--ui-bg-elevated, #28282d)); }
.flow-page-node:focus-visible { outline: 2px solid var(--ui-primary, #008cca); outline-offset: 2px; }
.flow-page-node[aria-current="step"] { background: color-mix(in srgb, var(--ui-primary, #008cca) 15%, var(--ui-bg-elevated, #28282d)); }
.flow-page-index { color: var(--ui-primary, #008cca); font-size: .65rem; font-weight: 800; text-transform: uppercase; letter-spacing: .12em; }
.flow-page-title { max-width: 100%; color: var(--ui-text, #e8e8ec); font-size: .9rem; line-height: 1.35; }
.flow-page-edit { position: absolute; inset-inline-end: .8rem; top: .8rem; color: var(--ui-primary, #008cca); }
.flow-routes { display: grid; gap: .65rem; margin: 1.25rem 0 0 .75rem; padding-inline-start: 1rem; border-inline-start: 2px solid var(--ui-border, #33343a); }
.flow-route { position: relative; display: grid; gap: .4rem; min-width: 0; padding: .75rem .85rem; border: 1px solid var(--ui-border, #33343a); border-radius: .4rem; background: var(--ui-bg, #1e1e22); font-size: .75rem; line-height: 1.4; }
.flow-route::before { position: absolute; top: 1rem; inset-inline-start: -1.35rem; width: .55rem; height: .55rem; border-radius: 999px; background: var(--ui-text-muted, #a2a3ab); content: ''; }
.flow-route--conditional { border-color: color-mix(in srgb, var(--ui-primary, #008cca) 55%, var(--ui-border, #33343a)); }
.flow-route--conditional::before { background: var(--ui-primary, #008cca); }
.flow-route-label { color: var(--ui-text-muted, #a2a3ab); font-size: .65rem; font-weight: 800; text-transform: uppercase; letter-spacing: .1em; }
.flow-route--conditional .flow-route-label { color: var(--ui-primary, #008cca); }
.flow-route-condition { overflow-wrap: anywhere; color: var(--ui-text, #e8e8ec); }
.flow-route-target { display: flex; min-width: 0; align-items: flex-start; gap: .35rem; overflow-wrap: anywhere; color: var(--ui-primary, #008cca); font-weight: 700; }
.flow-route--default .flow-route-target { color: var(--ui-text, #e8e8ec); }
.flow-hint { display: flex; align-items: center; gap: .4rem; margin-top: .5rem; color: var(--ui-text-muted, #a2a3ab); font-size: .75rem; }
@container (max-width: 44rem) {
  .flow-scroll { overflow-x: visible; }
  .flow-track { width: 100%; min-width: 0; flex-direction: column; gap: 3rem; }
  .flow-step { width: 100%; }
  .flow-terminal-node { width: 6.5rem; }
}
</style>
