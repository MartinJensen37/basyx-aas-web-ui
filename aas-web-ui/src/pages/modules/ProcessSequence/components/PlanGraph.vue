<template>
  <div>
    <div class="d-flex flex-wrap align-center ga-1 px-3 pb-2">
      <v-btn prepend-icon="mdi-plus" size="small" variant="tonal" @click="add">Add step</v-btn>
      <v-spacer />
      <v-btn :aria-pressed="showMaterials" prepend-icon="mdi-package-variant-closed" size="small" variant="text" @click="showMaterials = !showMaterials; fit()">{{ showMaterials ? 'Hide materials' : 'Show materials' }}</v-btn>

      <v-btn
        aria-label="Fit graph"
        icon="mdi-fit-to-screen-outline"
        size="small"
        variant="text"
        @click="fit"
      />
    </div>

    <div class="d-flex align-center flex-wrap ga-1 px-3 pb-2">
      <span class="text-caption text-medium-emphasis flex-grow-1">{{ insertionLabel }}</span>

      <template v-if="selected">

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
    </div>

    <p v-if="graph.edges.some(edge => edge.data?.kind === 'material' || edge.data?.kind === 'result')" class="text-caption px-3 pb-2">Solid: execution order ? Dotted green: materials added or produced ? Dotted gray: workpiece or linked material ? Dashed purple: results</p>

    <div :aria-label="label" class="plan-canvas" role="region">
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

        <template #node-material="{ data }">
          <PlanMaterialNode :data="data" @open="emit('open', $event)" @select="emit('select', data.planId!)" />
        </template>

        <template #node-plan="{ data, id }">
          <PlanGraphNode
            :active="data.planId ? data.planId === selectedId : !selectedId && id === insertionId"
            :data="data"
            :node="id.startsWith('node:') ? nodeMap.get(data.planId) : undefined"
            :processes="processes"
            :targets="targets"
            @change-type="emit('change-type', data.planId!, $event)"
            @open="emit('open', $event)"
            @select="select(id, data)"
            @use-output="useOutput(data.planId!, $event)"
          />
        </template>
      </VueFlow>
    </div>
  </div>
</template>

<script setup lang="ts">
  import type { PlanNode, PlanProcess, PlanScope } from '../types/plan'
  import type { PlanGraphData } from '../utils/planGraph'
  import { Background } from '@vue-flow/background'
  import { Controls } from '@vue-flow/controls'
  import { useVueFlow, VueFlow } from '@vue-flow/core'
  import { decisionForOutput } from '../utils/outputDecision'
  import { flattenNodes, newNode } from '../utils/plan'
  import { buildPlanGraph, findLane } from '../utils/planGraph'
  import PlanMaterialNode from './PlanMaterialNode.vue'
  import PlanGraphNode from './PlanGraphNode.vue'
  import '@vue-flow/core/dist/style.css'
  import '@vue-flow/core/dist/theme-default.css'
  import '@vue-flow/controls/dist/style.css'

  const props = defineProps<{ label: string, selectedId: string, materialScopes: PlanScope[], processes: PlanProcess[], targets: { id: string, name: string }[] }>()
  const emit = defineEmits<{ 'select': [id: string], 'open': [id: string], 'change-type': [id: string, kind: PlanNode['kind']] }>()
  const nodes = defineModel<PlanNode[]>({ required: true })
  const flowId = `process-plan-${useId()}`
  const { fitView } = useVueFlow({ id: flowId })
  const insertionId = ref('end')
  const branchId = ref('')
  const showMaterials = ref(true)
  const graph = computed(() => buildPlanGraph(nodes.value, props.targets, props.selectedId, props.materialScopes, showMaterials.value))
  const nodeMap = computed(() => new Map(flattenNodes(nodes.value).map(node => [node.id, node])))
  const selected = computed(() => flattenNodes(nodes.value).find(node => node.id === props.selectedId))
  const location = computed(() => findLane(nodes.value, props.selectedId || branchId.value))
  const insertionLabel = computed(() => {
    if (selected.value) return `Insert after ${selected.value.name}`
    if (branchId.value) return `Insert at start of ${graph.value.nodes.find(node => node.data?.branchId === branchId.value)?.data?.title ?? 'branch'}`
    return insertionId.value === 'start' ? 'Insert at sequence start' : 'Append to sequence Â· select a node or branch to insert there'
  })

  function fit (): void {
    void nextTick(() => fitView({ padding: 0.15, maxZoom: 1 }))
  }

  function select (id: string, data: PlanGraphData): void {
    insertionId.value = id
    branchId.value = data.branchId ?? ''
    emit('select', data.planId ?? '')
  }

  function add (): void {
    const node = newNode('step')
    const lane = location.value
    if (lane) lane.nodes.splice(lane.index + 1, 0, node)
    else nodes.value.splice(insertionId.value === 'start' ? 0 : nodes.value.length, 0, node)
    branchId.value = ''
    emit('select', node.id)
  }

  function useOutput (id: string, outputId: string): void {
    const producer = nodeMap.value.get(id)
    const lane = findLane(nodes.value, id)
    const output = producer?.kind === 'step' ? producer.outputs?.find(item => item.id === outputId) : undefined
    if (producer?.kind !== 'step' || !output || !lane) return
    const decision = decisionForOutput(producer, output)
    lane.nodes.splice(lane.index + 1, 0, decision)
    branchId.value = ''
    emit('select', decision.id)
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
    branchId.value = ''
    insertionId.value = 'end'
    emit('select', '')
  }
</script>

<style scoped>
.plan-canvas {
  height: max(420px, calc(100vh - 460px));
  min-width: 0;
  background: rgba(var(--v-theme-on-surface), 0.025);
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.12);
}
</style>
