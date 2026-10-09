<template>
  <div class="plan-graph-node" :class="[`plan-graph-node--${data.kind}`, { 'plan-graph-node--selected': active }]" :style="{ height: `${data.height ?? graphNodeHeight[data.kind]}px` }" @click.capture="node && emit('select')">
    <Handle v-if="data.hasMaterials" id="material-in" :position="Position.Left" type="target" />
    <Handle v-if="data.hasMaterials" id="material-out" :position="Position.Right" type="source" />
    <Handle v-if="data.kind !== 'start'" id="flow-in" :position="Position.Top" type="target" />

    <div v-if="node" class="node-choices d-flex flex-wrap align-center ga-1 px-2 pt-2 nodrag nopan nowheel">
      <PlanNodeType compact :node="node" @change="emit('change-type', $event)" />
      <PlanOperationType v-if="node.kind === 'step'" compact :node="node" :processes="processes" />

      <PlanChoice
        v-else-if="node.kind === 'call'"
        v-model="node.scopeId"
        color="teal"
        compact
        :context="node.name"
        :items="targets.map(target => ({ title: target.name, value: target.id }))"
        label="Subprocess definition"
      />

      <PlanConditionKind v-else-if="node.kind === 'decision' || node.kind === 'conditional'" v-model="node.condition" compact :context="node.name" />
    </div>

    <button :aria-label="data.title" :aria-pressed="active" class="node-button nodrag" @click="emit('select')">
      <span v-if="!compact && !node" class="node-category text-uppercase d-flex align-center ga-2">
        <v-icon :icon="icon" size="16" />{{ category }}
      </span>

      <span class="node-title font-weight-medium"><v-icon v-if="compact" class="mr-1" :icon="icon" size="16" />{{ data.title }}</span>
    </button>

    <template v-if="node?.kind === 'decision' || node?.kind === 'conditional'">
      <div class="text-caption text-truncate px-3 pb-2" :title="data.details || data.subtitle">{{ data.subtitle }}</div>
      <Handle v-if="conditionLeaves(node.condition).some(rule => rule.kind === 'comparison' && rule.operand?.kind === 'output')" id="condition-input" :position="Position.Right" type="target" />
    </template>

    <div v-if="node?.kind === 'step' && node.outputs?.length" class="border-t pb-1">
      <div class="text-caption text-medium-emphasis px-3" style="line-height: 20px">Results</div>

      <div v-for="output in node.outputs" :key="output.id" class="position-relative">
        <button :aria-label="`Use ${output.name} in decision`" class="result-button nodrag nopan nowheel text-truncate" :title="`${output.type}${output.unit ? ` (${output.unit})` : ''} - Add a decision using this result`" @click="emit('use-output', output.id)">
          <v-icon icon="mdi-export" size="14" /> {{ output.name }} <span class="text-medium-emphasis">{{ output.unit || output.type }}</span>
        </button>

        <Handle :id="`output:${output.id}`" :position="Position.Right" type="source" />
      </div>
    </div>

    <button v-if="data.scopeId" :aria-label="`Open ${data.title}`" class="open-button nodrag" @click="emit('open', data.scopeId)">
      Open subprocess <v-icon icon="mdi-arrow-right" size="14" />
    </button>

    <Handle v-if="data.kind !== 'end'" id="flow-out" :position="Position.Bottom" type="source" />
  </div>
</template>

<script setup lang="ts">
  import type { PlanNode, PlanProcess } from '../types/plan'
  import type { PlanGraphData } from '../utils/planGraph'
  import { Handle, Position } from '@vue-flow/core'
  import { conditionLeaves } from '../utils/conditions'
  import { graphNodeHeight } from '../utils/planGraph'
  import PlanChoice from './PlanChoice.vue'
  import PlanConditionKind from './PlanConditionKind.vue'
  import PlanNodeType from './PlanNodeType.vue'
  import PlanOperationType from './PlanOperationType.vue'

  const props = defineProps<{ data: PlanGraphData, active: boolean, processes: PlanProcess[], targets: { id: string, name: string }[] }>()
  const emit = defineEmits<{ 'select': [], 'open': [id: string], 'change-type': [kind: PlanNode['kind']], 'use-output': [outputId: string] }>()
  const node = defineModel<PlanNode>('node')
  const compact = computed(() => ['start', 'end', 'branch', 'join', 'skip', 'merge'].includes(props.data.kind))
  const category = computed(() => ({ material: 'Material', step: 'Process', call: 'Subprocess', parallel: 'Parallel split', decision: 'Decision', conditional: 'Optional flow', merge: 'Selected path', skip: 'Skip', join: 'Parallel join', branch: 'Branch', start: 'Sequence', end: 'Sequence' })[props.data.kind])
  const icon = computed(() => ({ material: 'mdi-package-variant-closed', step: 'mdi-cog-outline', call: 'mdi-file-tree-outline', parallel: 'mdi-call-split', decision: 'mdi-help-rhombus-outline', conditional: 'mdi-directions-fork', merge: 'mdi-call-merge', skip: 'mdi-debug-step-over', join: 'mdi-call-merge', branch: 'mdi-source-branch', start: 'mdi-play-outline', end: 'mdi-check' })[props.data.kind])
</script>

<style scoped>
.plan-graph-node {
  width: 240px;
  display: flex;
  flex-direction: column;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.25);
  border-top: 4px solid rgb(var(--v-theme-primary));
  border-radius: 12px;
  background: rgb(var(--v-theme-surface));
  box-shadow: 0 3px 10px rgba(0, 0, 0, 0.06);
  overflow-wrap: anywhere;
}
.node-choices > :deep(*) {
  max-width: 100%;
}
.node-button {
  display: block;
  width: 100%;
  flex: 1;
  min-height: 0;
  padding: 8px 14px;
  background: transparent;
  border: 0;
  border-radius: inherit;
  text-align: left;
  color: rgb(var(--v-theme-on-surface));
  cursor: pointer;
}
.result-button {
  display: block;
  width: 100%;
  height: 28px;
  padding: 0 12px;
  background: transparent;
  border: 0;
  text-align: left;
  font-size: 12px;
  color: rgb(var(--v-theme-secondary));
  cursor: pointer;
}
.node-category {
  font-size: 10px;
  line-height: 18px;
  color: rgb(var(--v-theme-primary));
  margin-bottom: 3px;
}
.node-title {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  font-size: 16px;
  line-height: 20px;
}
.node-button:focus-visible, .open-button:focus-visible, .result-button:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: 3px;
}
.plan-graph-node--selected {
  outline: 3px solid rgb(var(--v-theme-primary));
  outline-offset: 3px;
}
.plan-graph-node--parallel, .plan-graph-node--join {
  border-top-color: #b07812;
}
.plan-graph-node--decision, .plan-graph-node--conditional, .plan-graph-node--merge, .plan-graph-node--skip {
  border-top-color: #7e57c2;
}
.plan-graph-node--branch {
  border-style: dashed;
  border-top-width: 1px;
}
.plan-graph-node--start, .plan-graph-node--end {
  border-top-color: #388e3c;
}
.open-button {
  width: 100%;
  padding: 6px 16px;
  flex-shrink: 0;
  background: transparent;
  border: 0;
  border-radius: 0 0 12px 12px;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  color: rgb(var(--v-theme-primary));
  text-align: left;
  font-size: 12px;
  cursor: pointer;
}
</style>
