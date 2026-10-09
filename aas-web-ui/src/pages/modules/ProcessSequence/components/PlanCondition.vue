<template>
  <InspectorSection collapsible color="secondary" help="Combine checks with All (AND) or Any (OR). Every check must have a valid value before the decision resolves. Supply operation outputs in Combined steps for preview." title="Condition">
    <PlanConditionRule v-model="condition" :options="options" />
  </InspectorSection>
</template>

<script setup lang="ts">
  import type { PlanCondition, PlanNode } from '../types/plan'
  import { conditionOptions } from '../utils/conditions'
  import { flattenNodes } from '../utils/plan'
  import InspectorSection from './InspectorSection.vue'
  import PlanConditionRule from './PlanConditionRule.vue'

  const props = defineProps<{ nodes: PlanNode[] }>()
  const condition = defineModel<PlanCondition>({ required: true })
  const options = computed(() => conditionOptions(flattenNodes(props.nodes)))
</script>
