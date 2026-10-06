<template>
  <PlanChoice
    :compact="compact"
    :context="context"
    :items="items"
    label="Condition rule"
    :model-value="condition.kind"
    @update:model-value="change"
  />
</template>

<script setup lang="ts">
  import type { PlanCondition } from '../types/plan'
  import { newComparison } from '../utils/conditions'
  import PlanChoice from './PlanChoice.vue'

  withDefaults(defineProps<{ compact?: boolean, context?: string }>(), { compact: false, context: '' })
  const condition = defineModel<PlanCondition>({ required: true })
  const items = [{ title: 'Compare a value', value: 'comparison' }, { title: 'Every N products', value: 'everyNthProduct' }]

  function change (kind: string): void {
    if (condition.value.kind !== kind) condition.value = kind === 'everyNthProduct' ? { kind, every: 5 } : newComparison()
  }
</script>
