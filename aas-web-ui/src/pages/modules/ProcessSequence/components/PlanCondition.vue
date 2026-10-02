<template>
  <section aria-label="Optional flow condition">
    <v-text-field
      v-model="interval"
      density="compact"
      :error-messages="valid ? [] : ['Enter a positive whole number of products.']"
      label="Run every N products"
      min="1"
      step="1"
      type="number"
    />

    <p class="text-body-small">Current rule: run on products {{ examples }} in each production run. All other products follow the skip path.</p>
    <p class="text-caption mt-2">Select Run this flow on the graph to add operations or a subprocess call. The next operation continues after the selected path completes.</p>
  </section>
</template>

<script setup lang="ts">
  import type { ConditionalNode } from '../types/plan'

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
