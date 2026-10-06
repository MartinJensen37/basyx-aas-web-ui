<template>
  <div class="plan-graph-node" :class="[`plan-graph-node--${data.kind}`, { 'plan-graph-node--selected': active }]" :style="{ height: `${graphNodeHeight[data.kind]}px` }">
    <Handle v-if="data.kind !== 'start'" :position="Position.Top" type="target" />

    <button :aria-label="data.title" :aria-pressed="active" class="node-button nodrag" @click="emit('select')">
      <span v-if="!compact" class="node-category text-uppercase d-flex align-center ga-2">
        <v-icon :icon="icon" size="16" />{{ category }}
      </span>

      <span class="node-title font-weight-medium"><v-icon v-if="compact" class="mr-1" :icon="icon" size="16" />{{ data.title }}</span>
      <span v-if="data.kind === 'conditional' || data.kind === 'decision'" class="text-caption d-block mt-1 text-truncate" :title="data.details || data.subtitle">{{ data.subtitle }}</span>
    </button>

    <button v-if="data.scopeId" :aria-label="`Open ${data.title}`" class="open-button nodrag" @click="emit('open', data.scopeId)">
      Open subprocess <v-icon icon="mdi-arrow-right" size="14" />
    </button>

    <Handle v-if="data.kind !== 'end'" :position="Position.Bottom" type="source" />
  </div>
</template>

<script setup lang="ts">
  import type { PlanGraphData } from '../utils/planGraph'
  import { Handle, Position } from '@vue-flow/core'
  import { graphNodeHeight } from '../utils/planGraph'

  const props = defineProps<{ data: PlanGraphData, active: boolean }>()
  const emit = defineEmits<{ select: [], open: [id: string] }>()
  const compact = computed(() => ['start', 'end', 'branch', 'join', 'skip', 'merge'].includes(props.data.kind))
  const category = computed(() => ({ step: 'Process', call: 'Subprocess', parallel: 'Parallel split', decision: 'Decision', conditional: 'Optional flow', merge: 'Selected path', skip: 'Skip', join: 'Parallel join', branch: 'Branch', start: 'Sequence', end: 'Sequence' })[props.data.kind])
  const icon = computed(() => ({ step: 'mdi-cog-outline', call: 'mdi-file-tree-outline', parallel: 'mdi-call-split', decision: 'mdi-help-rhombus-outline', conditional: 'mdi-directions-fork', merge: 'mdi-call-merge', skip: 'mdi-debug-step-over', join: 'mdi-call-merge', branch: 'mdi-source-branch', start: 'mdi-play-outline', end: 'mdi-check' })[props.data.kind])
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
.node-button:focus-visible, .open-button:focus-visible {
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
