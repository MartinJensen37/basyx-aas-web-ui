<template>
  <div class="pa-3">
    <p class="text-body-small mb-3">Steps for the selected product number, including called subprocesses. Optional flows are skipped when their interval does not match. Each step waits for its listed predecessors.</p>

    <v-text-field
      v-model="productNumber"
      class="mb-3"
      density="compact"
      :error-messages="valid ? [] : ['Enter a positive whole product number.']"
      hint="Count starts at 1 for each production run and is shared with called subprocesses."
      label="Product number in run"
      min="1"
      persistent-hint
      step="1"
      type="number"
    />

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

    <p v-if="valid && steps.length === 0" class="text-body-small mt-3">No operations are scheduled for this product number in this sequence.</p>
  </div>
</template>

<script setup lang="ts">
  import type { ProcessPlan } from '../types/plan'
  import { expandPlan } from '../utils/plan'

  const props = defineProps<{ plan: ProcessPlan, scopeId: string }>()
  const productNumber = ref<number | string>(1)
  const valid = computed(() => Number.isSafeInteger(Number(productNumber.value)) && Number(productNumber.value) > 0)
  const steps = computed(() => valid.value ? expandPlan(props.plan, props.scopeId, Number(productNumber.value)) : [])
  const stepLabels = computed(() => new Map(steps.value.map((entry, index) => [entry.id, `${index + 1}. ${entry.step.name}`])))
</script>
