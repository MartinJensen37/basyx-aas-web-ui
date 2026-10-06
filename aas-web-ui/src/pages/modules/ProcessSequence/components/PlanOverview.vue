<template>
  <div class="pa-3">
    <p class="text-body-small mb-3">Preview the selected product number and simulated outputs. Each operation waits for its listed predecessors. No equipment is contacted.</p>

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

    <v-alert v-if="error" class="mb-3" density="compact" type="warning">{{ error }}</v-alert>
    <PlanPreviewInputs v-if="preview" v-model="values" :inputs="preview.inputs" />

    <v-list v-if="preview?.choices.length" aria-label="Flow choices" class="mb-3" density="compact">
      <v-list-item v-for="choice in preview.choices" :key="choice.id" :subtitle="choice.reason || choice.condition" :title="choice.name">
        <template #append>
          <v-chip :color="choice.reason ? 'warning' : 'primary'" size="small">{{ choice.path }}</v-chip>
        </template>
      </v-list-item>
    </v-list>

    <v-alert v-if="preview?.blocked" class="mb-3" density="compact" type="warning">Preview paused at an unresolved condition. Following operations are not included.</v-alert>

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

    <p v-if="preview && !preview.blocked && steps.length === 0" class="text-body-small mt-3">No operations are scheduled for this product number in this sequence.</p>
  </div>
</template>

<script setup lang="ts">
  import type { ProcessPlan } from '../types/plan'
  import type { PreviewValue } from '../utils/planPreview'
  import { previewPlan } from '../utils/planPreview'
  import PlanPreviewInputs from './PlanPreviewInputs.vue'

  const props = defineProps<{ plan: ProcessPlan, scopeId: string }>()
  const productNumber = ref<number | string>(1)
  const values = ref<Record<string, PreviewValue>>({})
  const valid = computed(() => Number.isSafeInteger(Number(productNumber.value)) && Number(productNumber.value) > 0)
  const result = computed(() => {
    if (!valid.value) return {}
    try {
      return { preview: previewPlan(props.plan, props.scopeId, Number(productNumber.value), values.value) }
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'The plan cannot be previewed.' }
    }
  })
  const preview = computed(() => result.value.preview)
  const error = computed(() => result.value.error)
  const steps = computed(() => preview.value?.steps ?? [])
  const stepLabels = computed(() => new Map(steps.value.map((entry, index) => [entry.id, `${index + 1}. ${entry.step.name}`])))
</script>
