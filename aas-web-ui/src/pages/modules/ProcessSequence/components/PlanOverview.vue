<template>
  <div class="pa-3">
    <p class="text-body-small mb-3">All steps in this sequence, including called subprocesses. Each step waits for all of its listed predecessors.</p>

    <v-table density="compact">
      <thead><tr><th>Step</th><th>Assembly / subprocess</th><th>Waits for</th></tr></thead>

      <tbody>
        <tr v-for="(entry, index) in steps" :key="entry.id">
          <td>{{ index + 1 }}. {{ entry.step.name }}</td>
          <td>{{ plan.scopes.find(scope => scope.id === entry.scopeId)?.name }}</td>
          <td>{{ entry.after.length > 0 ? entry.after.map(id => stepLabels.get(id)).join(', ') : 'Start' }}</td>
        </tr>
      </tbody>
    </v-table>

    <p v-if="steps.length === 0" class="text-body-small mt-3">Add steps or call an assembly sequence to see the combined process.</p>
  </div>
</template>

<script setup lang="ts">
  import type { ProcessPlan } from '../types/plan'
  import { expandPlan } from '../utils/plan'

  const props = defineProps<{ plan: ProcessPlan, scopeId: string }>()
  const steps = computed(() => expandPlan(props.plan, props.scopeId))
  const stepLabels = computed(() => new Map(steps.value.map((entry, index) => [entry.id, `${index + 1}. ${entry.step.name}`])))
</script>
