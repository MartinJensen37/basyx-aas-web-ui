<template>
  <v-card border class="h-100 overflow-y-auto" rounded="lg">
    <v-card-title class="text-body-large">{{ node ? 'Selection details' : 'Sequence details' }}</v-card-title>

    <v-card-text v-if="node">
      <PlanNodeType :key="node.id" class="mb-3" :node="node" @change="emit('change-type', $event)" />

      <v-btn
        v-if="canUndo"
        class="mb-3"
        prepend-icon="mdi-undo"
        size="small"
        variant="text"
        @click="emit('undo-type')"
      >Undo type change</v-btn>

      <v-text-field
        v-model="node.name"
        class="mb-3"
        density="compact"
        hide-details="auto"
        label="Name"
      />

      <PlanOperationType v-if="node.kind === 'step'" class="mb-3" :node="node" :processes="processes" />

      <InspectorSection v-if="node.kind === 'call'" help="The next step waits for this entire subprocess to complete." title="Subprocess">
        <v-select
          v-model="node.scopeId"
          density="compact"
          item-title="name"
          item-value="id"
          :items="targets"
          label="Subprocess definition"
        />

      </InspectorSection>

      <template v-else-if="node.kind === 'conditional' || node.kind === 'decision'">
        <PlanConditionKind v-model="node.condition" class="mb-3" />
        <PlanCondition :key="node.id" v-model="node.condition" :nodes="nodes" />
      </template>

      <InspectorSection v-else-if="node.kind === 'parallel'" color="warning" help="All branches start together and join before the next step. Select a branch on the graph to insert operations. Only empty extra branches can be removed." title="Parallel branches">

        <div v-for="(branch, index) in node.branches" :key="branch.id" class="d-flex align-center ga-1 mt-3">
          <v-text-field v-model="branch.name" density="compact" hide-details :label="`Branch ${index + 1} name`" />

          <v-btn
            :aria-label="`Remove ${branch.name}`"
            :disabled="node.branches.length <= 2 || branch.nodes.length > 0"
            icon="mdi-close"
            size="x-small"
            variant="text"
            @click="node.branches.splice(index, 1)"
          />
        </div>

        <v-btn class="mt-3" size="small" variant="tonal" @click="node.branches.push(newBranch(`Branch ${node.branches.length + 1}`))">Add branch</v-btn>
      </InspectorSection>

      <template v-else>
        <InspectorSection
          collapsible
          help="Recipe inputs inherit the selected Process Parameters definition. Edited values are saved as overrides. Hover over a value for its source and datatype."
          :initially-open="false"
          :summary="`${node.process?.parameters.length ?? 0} parameters`"
          title="Process inputs"
        >
          <PlanParameters v-if="node.process" :process="node.process" />
        </InspectorSection>

        <PlanCapabilities v-model="node" :inherited="inheritedRequirements" :resources="resources" />
        <PlanOutputs v-model="node" />

        <InspectorSection
          collapsible
          color="info"
          help="Assign one station skill, choose a manual operation, or leave the resource unassigned until later. Capability matching compares all available resources."
          :initially-open="false"
          :summary="resourceSummary"
          title="Resource assignment"
        >
          <v-select
            class="mb-3"
            density="compact"
            hide-details="auto"
            :items="[{ title: 'Station skill', value: 'station' }, { title: 'Manual operation', value: 'manual' }]"
            label="Execution"
            :model-value="node.executionMode ?? 'station'"
            @update:model-value="setExecution"
          />

          <PlanBindings v-if="node.executionMode !== 'manual'" :key="node.id" v-model="node" :resources="resources" />
        </InspectorSection>
      </template>

      <v-btn v-if="node.kind === 'conditional'" size="small" variant="text" @click="emit('unwrap')">Remove condition</v-btn>
    </v-card-text>

    <v-card-text v-else>
      <p class="text-body-small text-medium-emphasis">Select a node to view its details.</p>
    </v-card-text>

  </v-card>
</template>

<script setup lang="ts">
  import type { PlanNode, PlanProcess } from '../types/plan'
  import { newBranch } from '../utils/plan'
  import InspectorSection from './InspectorSection.vue'
  import PlanBindings from './PlanBindings.vue'
  import PlanCapabilities from './PlanCapabilities.vue'
  import PlanCondition from './PlanCondition.vue'
  import PlanConditionKind from './PlanConditionKind.vue'
  import PlanNodeType from './PlanNodeType.vue'
  import PlanOperationType from './PlanOperationType.vue'
  import PlanOutputs from './PlanOutputs.vue'
  import PlanParameters from './PlanParameters.vue'

  const props = defineProps<{
    processes: PlanProcess[]
    targets: { id: string, name: string }[]
    resources: { id: string, name: string }[]
    nodes: PlanNode[]
    canUndo: boolean
  }>()
  const emit = defineEmits<{ 'change-type': [kind: PlanNode['kind']], 'undo-type': [], 'unwrap': [] }>()
  const node = defineModel<PlanNode | undefined>()
  const resourceSummary = computed(() => {
    const step = node.value
    return step?.kind === 'step' ? (step.executionMode === 'manual' ? 'Manual' : props.resources.find(resource => resource.id === step.resourceAasId)?.name || 'Unassigned') : ''
  })
  const inheritedRequirements = computed(() => {
    const process = node.value?.kind === 'step' ? node.value.process : null
    return process?.requiredCapabilities ?? props.processes.find(item => JSON.stringify(item.source) === JSON.stringify(process?.source))?.requiredCapabilities ?? []
  })
  function setExecution (mode: 'manual' | 'station'): void {
    if (node.value?.kind !== 'step') return
    node.value.executionMode = mode
    if (mode === 'manual') {
      node.value.resourceAasId = ''
      node.value.skillId = ''
      delete node.value.skillReference
      node.value.bindings = []
    }
  }
</script>
