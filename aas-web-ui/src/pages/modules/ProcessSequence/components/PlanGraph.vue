<template>
  <div>
    <div class="d-flex flex-wrap align-center ga-1 px-3 pb-2">
      <v-btn prepend-icon="mdi-plus" size="small" variant="tonal" @click="add('step')">Add step</v-btn>
      <v-btn :disabled="targets.length === 0" size="small" variant="text" @click="add('call')">Call subprocess</v-btn>
      <v-btn size="small" variant="text" @click="add('parallel')">Run in parallel</v-btn>
      <v-btn size="small" variant="text" @click="add('conditional')">Optional flow</v-btn>
      <v-spacer />

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
        <v-btn v-if="selected.kind !== 'conditional'" size="small" variant="text" @click="makeOptional">Make optional</v-btn>
        <v-btn v-else size="small" variant="text" @click="makeUnconditional">Run every product</v-btn>

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

        <template #node-plan="{ data, id }">
          <PlanGraphNode
            :active="data.planId ? data.planId === selectedId : id === insertionId"
            :data="data"
            @open="emit('open', $event)"
            @select="select(id, data)"
          />
        </template>
      </VueFlow>
    </div>
  </div>
</template>

<script setup lang="ts">
  import type { PlanNode } from '../types/plan'
  import type { PlanGraphData } from '../utils/planGraph'
  import { Background } from '@vue-flow/background'
  import { Controls } from '@vue-flow/controls'
  import { useVueFlow, VueFlow } from '@vue-flow/core'
  import { flattenNodes, newNode } from '../utils/plan'
  import { buildPlanGraph, findLane } from '../utils/planGraph'
  import PlanGraphNode from './PlanGraphNode.vue'
  import '@vue-flow/core/dist/style.css'
  import '@vue-flow/core/dist/theme-default.css'
  import '@vue-flow/controls/dist/style.css'

  const props = defineProps<{ label: string, selectedId: string, targets: { id: string, name: string }[] }>()
  const emit = defineEmits<{ select: [id: string], open: [id: string] }>()
  const nodes = defineModel<PlanNode[]>({ required: true })
  const flowId = `process-plan-${useId()}`
  const { fitView } = useVueFlow({ id: flowId })
  const insertionId = ref('end')
  const branchId = ref('')
  const graph = computed(() => buildPlanGraph(nodes.value, props.targets))
  const selected = computed(() => flattenNodes(nodes.value).find(node => node.id === props.selectedId))
  const location = computed(() => findLane(nodes.value, props.selectedId || branchId.value))
  const insertionLabel = computed(() => {
    if (selected.value) return `Insert after ${selected.value.name}`
    if (branchId.value) return `Insert at start of ${graph.value.nodes.find(node => node.data?.branchId === branchId.value)?.data?.title ?? 'branch'}`
    return insertionId.value === 'start' ? 'Insert at sequence start' : 'Append to sequence · select a node or branch to insert there'
  })

  function fit (): void {
    void nextTick(() => fitView({ padding: 0.15, maxZoom: 1 }))
  }

  function select (id: string, data: PlanGraphData): void {
    insertionId.value = id
    branchId.value = data.branchId ?? ''
    emit('select', data.planId ?? '')
  }

  function add (kind: PlanNode['kind']): void {
    const node = newNode(kind, props.targets[0]?.id ?? '')
    if (kind === 'call') node.name = props.targets[0]?.name ?? node.name
    const lane = location.value
    if (lane) lane.nodes.splice(lane.index + 1, 0, node)
    else nodes.value.splice(insertionId.value === 'start' ? 0 : nodes.value.length, 0, node)
    branchId.value = ''
    emit('select', node.id)
  }

  function move (delta: number): void {
    const lane = location.value
    if (!lane || lane.index < 0 || lane.index + delta < 0 || lane.index + delta >= lane.nodes.length) return
    const node = lane.nodes.splice(lane.index, 1)[0]!
    lane.nodes.splice(lane.index + delta, 0, node)
  }

  function makeOptional (): void {
    const lane = location.value
    if (!lane || lane.index < 0) return
    const flow = newNode('conditional')
    if (flow.kind !== 'conditional') return
    const child = lane.nodes[lane.index]
    flow.name = `Optional ${child.name}`
    flow.nodes.push(toRaw(child))
    lane.nodes[lane.index] = flow
    emit('select', flow.id)
  }

  function makeUnconditional (): void {
    const lane = location.value
    const flow = selected.value
    if (!lane || lane.index < 0 || flow?.kind !== 'conditional') return
    lane.nodes.splice(lane.index, 1, ...flow.nodes)
    emit('select', flow.nodes[0]?.id ?? '')
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
