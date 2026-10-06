<template>
  <v-card border class="h-100 overflow-y-auto" rounded="lg">
    <v-card-title class="text-body-large">{{ node ? 'Selection details' : 'Sequence details' }}</v-card-title>

    <v-card-text v-if="node">
      <v-text-field
        v-model="node.name"
        class="mb-3"
        density="compact"
        hide-details="auto"
        label="Name"
      />

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

      <PlanCondition v-else-if="node.kind === 'conditional'" v-model="node" />

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
        <InspectorSection collapsible help="Select process inputs from the Process Parameters submodel. Values are snapshots; source references and datatypes are available on hover." title="Process inputs">
          <v-select
            class="mb-3"
            clearable
            density="compact"
            hide-details="auto"
            item-title="name"
            item-value="key"
            :items="processOptions"
            label="Process Parameters entry"
            :model-value="node.process ? JSON.stringify(node.process.source) : null"
            @update:model-value="linkProcess"
          />

          <PlanParameters v-if="node.process" :process="node.process" />
        </InspectorSection>

        <PlanCapabilities v-model="node" :inherited="inheritedRequirements" :resources="resources" />

        <InspectorSection collapsible color="info" help="Assign one station skill, choose a manual operation, or leave the resource unassigned until later. Capability matching compares all available resources." title="Resource assignment">
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
  import PlanParameters from './PlanParameters.vue'

  const props = defineProps<{
    processes: PlanProcess[]
    targets: { id: string, name: string }[]
    resources: { id: string, name: string }[]
  }>()
  const node = defineModel<PlanNode | undefined>()
  const inheritedRequirements = computed(() => {
    const process = node.value?.kind === 'step' ? node.value.process : null
    return process?.requiredCapabilities ?? props.processes.find(item => JSON.stringify(item.source) === JSON.stringify(process?.source))?.requiredCapabilities ?? []
  })
  const processOptions = computed(() => {
    const processes = [...props.processes]
    const selected = node.value?.kind === 'step' ? node.value.process : null
    if (selected && !processes.some(item => JSON.stringify(item.source) === JSON.stringify(selected.source))) {
      processes.push(selected)
    }
    return processes.map(process => ({ name: process.name, process, key: JSON.stringify(process.source) }))
  })

  function linkProcess (key: string | null): void {
    if (node.value?.kind !== 'step') {
      return
    }
    const process = processOptions.value.find(item => item.key === key)?.process
    node.value.process = process ? structuredClone(toRaw(process)) : null
    delete node.value.requiredCapabilities
    node.value.bindings = node.value.bindings.filter(binding => !binding.source)
    if (process && node.value.name === 'New step') {
      node.value.name = process.name
    }
  }
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
