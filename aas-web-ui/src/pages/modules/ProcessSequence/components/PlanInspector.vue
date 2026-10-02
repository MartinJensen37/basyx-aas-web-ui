<template>
  <v-card border class="h-100 overflow-y-auto" rounded="lg">
    <v-card-title class="text-body-large">{{ node ? 'Selection details' : 'Sequence details' }}</v-card-title>

    <v-card-text v-if="node">
      <v-text-field v-model="node.name" density="compact" label="Name" />

      <template v-if="node.kind === 'call'">
        <v-select
          v-model="node.scopeId"
          density="compact"
          item-title="name"
          item-value="id"
          :items="targets"
          label="Subprocess definition"
        />

        <p class="text-body-small">The next step waits for this entire subprocess to complete.</p>
      </template>

      <template v-else-if="node.kind === 'parallel'">
        <p class="text-body-small">All branches may run concurrently. The sequence continues when every branch completes. Resources may limit actual overlap.</p>

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
        <p class="text-caption mt-2">Select a branch on the graph to insert its first step. Empty extra branches can be removed.</p>
      </template>

      <template v-else>
        <v-select
          clearable
          density="compact"
          item-title="name"
          item-value="key"
          :items="processOptions"
          label="Process Parameters entry"
          :model-value="node.process ? JSON.stringify(node.process.source) : null"
          @update:model-value="linkProcess"
        />

        <div v-if="node.process" class="mb-4">
          <div class="text-caption mb-2">Process ID: {{ node.process.processId }}</div>

          <v-expansion-panels variant="accordion">
            <v-expansion-panel v-for="group in groups" :key="group" :title="group.replace(/([a-z])([A-Z])/g, '$1 $2')">
              <v-expansion-panel-text>
                <div v-for="parameter in node.process.parameters.filter(item => item.group === group)" :key="JSON.stringify(parameter.source)" class="mb-2">
                  <div class="text-body-small">{{ parameter.name }}: {{ parameter.value || 'Not set' }}</div>
                  <div class="text-caption text-medium-emphasis">{{ parameter.dataType }}</div>
                </div>

                <div v-if="!node.process.parameters.some(item => item.group === group)" class="text-caption">No parameters provided.</div>
              </v-expansion-panel-text>
            </v-expansion-panel>

            <v-expansion-panel title="Process materials">
              <v-expansion-panel-text>
                <p v-if="node.process.material.length === 0" class="text-caption">No materials specified for this process.</p>
                <div v-for="(material, index) in materialLabels(node.process.material)" :key="index" class="text-body-small mb-2">{{ material }}</div>
              </v-expansion-panel-text>
            </v-expansion-panel>
          </v-expansion-panels>
        </div>

        <PlanCapabilities v-model="node" :inherited="inheritedRequirements" :resources="resources" />

        <v-select
          density="compact"
          :items="[{ title: 'Station skill', value: 'station' }, { title: 'Manual operation', value: 'manual' }]"
          label="Execution"
          :model-value="node.executionMode ?? 'station'"
          @update:model-value="setExecution"
        />

        <PlanBindings v-if="node.executionMode !== 'manual'" :key="node.id" v-model="node" :resources="resources" />
      </template>
    </v-card-text>

    <v-card-text v-else>
      <p class="text-body-small">Select a step to link its process inputs and resource skill. Add subprocess calls to compose assembly sequences.</p>
      <p class="text-body-small mt-3">Processes are available as inputs; their source order does not determine the sequence.</p>
    </v-card-text>

    <v-divider />
    <v-card-subtitle class="pt-3">Planning checks</v-card-subtitle>

    <v-card-text>
      <div v-for="note in notes" :key="note" class="text-body-small mb-2">{{ note }}</div>
      <p v-if="notes.length === 0" class="text-body-small">No missing assignments found.</p>
      <p class="text-caption text-medium-emphasis mt-3">Saving keeps your draft. Readiness for execution has not been verified.</p>
    </v-card-text>
  </v-card>
</template>

<script setup lang="ts">
  import type { PlanNode, PlanProcess } from '../types/plan'
  import { newBranch } from '../utils/plan'
  import { materialLabels } from '../utils/planSources'
  import PlanBindings from './PlanBindings.vue'
  import PlanCapabilities from './PlanCapabilities.vue'

  const props = defineProps<{
    processes: PlanProcess[]
    targets: { id: string, name: string }[]
    resources: { id: string, name: string }[]
    notes: string[]
  }>()
  const node = defineModel<PlanNode | undefined>()
  const groups = ['ProductParameters', 'ProcessParameters', 'ResourceParameters']
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
