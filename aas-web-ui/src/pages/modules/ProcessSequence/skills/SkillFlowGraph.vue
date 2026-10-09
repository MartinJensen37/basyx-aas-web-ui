<template>
  <div>
    <div class="d-flex flex-wrap align-center ga-1 px-3 pb-2">
      <v-btn
        :disabled="readonly"
        prepend-icon="mdi-plus"
        size="small"
        variant="tonal"
        @click="add"
      >Add step</v-btn>

      <span class="text-caption text-medium-emphasis flex-grow-1 px-2">{{ insertionLabel }}</span>

      <template v-if="selected && !readonly">
        <v-btn
          aria-label="Move step earlier"
          :disabled="!location || location.index <= 0"
          icon="mdi-arrow-up"
          size="x-small"
          variant="text"
          @click="move(-1)"
        />

        <v-btn
          aria-label="Move step later"
          :disabled="!location || location.index >= location.nodes.length - 1"
          icon="mdi-arrow-down"
          size="x-small"
          variant="text"
          @click="move(1)"
        />

        <v-btn color="error" size="small" variant="text" @click="remove">Remove selected</v-btn>
      </template>

      <v-btn
        aria-label="Fit graph"
        icon="mdi-fit-to-screen-outline"
        size="small"
        variant="text"
        @click="fit"
      />
    </div>

    <div :aria-label="label" class="skill-canvas" role="region">
      <VueFlow
        :id="flowId"
        :delete-key-code="null"
        :edges="graph.edges"
        :edges-updatable="false"
        :max-zoom="1.5"
        :min-zoom="0.2"
        :nodes="graph.nodes"
        :nodes-connectable="false"
        :nodes-draggable="false"
        :nodes-focusable="false"
        @nodes-initialized="fit"
      >
        <Background :gap="20" pattern-color="#aebbc5" />
        <Controls :show-interactive="false" />

        <template #node-plan="{ data, id }">
          <div
            class="skill-node"
            :class="{ 'skill-node--selected': data.planId ? data.planId === selectedId : !selectedId && id === insertionId, 'skill-node--marker': !data.planId }"
            :style="{ height: `${data.height ?? graphNodeHeight[data.kind as PlanGraphData['kind']]}px` }"
          >
            <Handle v-if="data.kind !== 'start'" id="flow-in" :position="Position.Top" type="target" />

            <button :aria-label="data.title" :aria-pressed="data.planId === selectedId" class="skill-node__button nodrag" @click="select(id, data)">
              <span class="font-weight-medium text-truncate">{{ data.title }}</span>
              <span v-if="data.planId" class="text-caption text-medium-emphasis text-truncate">{{ runs(data.planId) }}</span>
              <span v-if="data.planId" class="text-caption text-truncate">{{ handed(data.planId) }}</span>
            </button>

            <Handle v-if="data.kind !== 'end'" id="flow-out" :position="Position.Bottom" type="source" />
          </div>
        </template>
      </VueFlow>
    </div>
  </div>
</template>

<script setup lang="ts">
  import type { PlanNode, StepNode } from '../types/plan'
  import type { PlanGraphData } from '../utils/planGraph'
  import { Background } from '@vue-flow/background'
  import { Controls } from '@vue-flow/controls'
  import { Handle, Position, useVueFlow, VueFlow } from '@vue-flow/core'
  import { flattenNodes, newNode } from '../utils/plan'
  import { buildPlanGraph, findLane, graphNodeHeight } from '../utils/planGraph'
  import { handedParameter } from './skillFlow'
  import '@vue-flow/core/dist/style.css'
  import '@vue-flow/core/dist/theme-default.css'
  import '@vue-flow/controls/dist/style.css'

  const props = defineProps<{ label: string, selectedId: string, readonly?: boolean }>()
  const emit = defineEmits<{ select: [id: string] }>()
  const nodes = defineModel<PlanNode[]>({ required: true })
  const flowId = `skill-flow-${useId()}`
  const { fitView } = useVueFlow({ id: flowId })
  const insertionId = ref('end')

  const graph = computed(() => buildPlanGraph(nodes.value, [], props.selectedId, [], false))
  const steps = computed(() => new Map(flattenNodes(nodes.value).map(node => [node.id, node])))
  const selected = computed(() => steps.value.get(props.selectedId))
  const location = computed(() => findLane(nodes.value, props.selectedId))
  const insertionLabel = computed(() => (selected.value ? `Insert after ${selected.value.name}` : 'Append to the end: select a step to insert after it'))

  function runs (id: string): string {
    const node = steps.value.get(id)
    if (node?.kind !== 'step') return node?.kind ?? ''
    return node.skillId ? `${node.skillId} (${node.resourceAasId.split('/').at(-1)?.replace(/AAS$/, '') ?? ''})` : 'No skill chosen'
  }

  function handed (id: string): string {
    const node = steps.value.get(id) as StepNode | undefined
    if (node?.kind !== 'step') return ''
    const bound = node.bindings.map(binding => `${binding.name} ${handedParameter(binding) ? `← ${handedParameter(binding)}` : `= ${binding.value}`}`)
    return [...bound, ...(node.outputs ?? []).map(output => `→ ${output.id}`)].join(', ')
  }

  function fit (): void {
    void nextTick(() => fitView({ padding: 0.15, maxZoom: 1 }))
  }

  function select (id: string, data: PlanGraphData): void {
    insertionId.value = id
    emit('select', data.planId ?? '')
  }

  function add (): void {
    const node = newNode('step')
    const lane = location.value
    if (lane) lane.nodes.splice(lane.index + 1, 0, node)
    else nodes.value.push(node)
    emit('select', node.id)
  }

  function move (delta: number): void {
    const lane = location.value
    if (!lane || lane.index < 0 || lane.index + delta < 0 || lane.index + delta >= lane.nodes.length) return
    const node = lane.nodes.splice(lane.index, 1)[0]!
    lane.nodes.splice(lane.index + delta, 0, node)
  }

  function remove (): void {
    const lane = location.value
    if (!lane || lane.index < 0) return
    lane.nodes.splice(lane.index, 1)
    insertionId.value = 'end'
    emit('select', '')
  }
</script>

<style scoped>
.skill-canvas {
  height: max(420px, calc(100vh - 520px));
  min-width: 0;
  background: rgba(var(--v-theme-on-surface), 0.025);
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.12);
}

.skill-node {
  width: 240px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.3);
  border-radius: 12px;
  background: rgb(var(--v-theme-surface));
  overflow: hidden;
}

.skill-node--selected {
  border: 2px solid rgb(var(--v-theme-primary));
}

.skill-node--marker {
  border-style: dashed;
}

.skill-node__button {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 2px;
  width: 100%;
  height: 100%;
  padding: 8px 12px;
  text-align: left;
}
</style>
