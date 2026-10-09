<template>
  <PlanChoice
    color="deep-purple"
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
  import { changeConditionKind } from '../utils/conditions'
  import PlanChoice from './PlanChoice.vue'

  withDefaults(defineProps<{ compact?: boolean, context?: string }>(), { compact: false, context: '' })
  const condition = defineModel<PlanCondition>({ required: true })
  const items: { title: string, value: PlanCondition['kind'] }[] = [{ title: 'Compare a value', value: 'comparison' }, { title: 'Every N products', value: 'everyNthProduct' }, { title: 'All conditions (AND)', value: 'all' }, { title: 'Any condition (OR)', value: 'any' }]

  function change (kind: string): void {
    const choice = items.find(item => item.value === kind)
    if (choice) condition.value = changeConditionKind(condition.value, choice.value)
  }
</script>
