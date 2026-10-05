<template>
  <InspectorSection help="Products are counted from 1 within the production run, including subprocesses. Other products skip this flow. Select Run this flow on the graph to add operations." title="Optional flow condition">
    <v-text-field
      v-model="interval"
      density="compact"
      :error-messages="valid ? [] : ['Enter a positive whole number of products.']"
      label="Run every N products"
      min="1"
      step="1"
      type="number"
    />

    <p class="text-caption">Runs on products {{ examples }}, …</p>
  </InspectorSection>
</template>

<script setup lang="ts">
  import type { ConditionalNode } from '../types/plan'
  import InspectorSection from './InspectorSection.vue'

  const node = defineModel<ConditionalNode>({ required: true })
  const interval = ref(String(node.value.condition.every))
  const valid = computed(() => Number.isSafeInteger(Number(interval.value)) && Number(interval.value) > 0)
  const examples = computed(() => [1, 2, 3].map(index => BigInt(node.value.condition.every) * BigInt(index)).join(', '))

  watch(() => [node.value.id, node.value.condition.every], () => {
    interval.value = String(node.value.condition.every)
  })
  watch(interval, value => {
    if (valid.value) node.value.condition.every = Number(value)
  })
</script>
