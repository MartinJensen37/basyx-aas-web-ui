<template>
  <PlanChoice
    color="teal"
    :compact="compact"
    :context="node.name"
    :items="items"
    label="Operation type"
    :model-value="node.process ? JSON.stringify(node.process.source) : ''"
    @update:model-value="choose"
  />
</template>

<script setup lang="ts">
  import type { PlanProcess, StepNode } from '../types/plan'
  import { setOperation } from '../utils/operation'
  import PlanChoice from './PlanChoice.vue'

  const props = withDefaults(defineProps<{ node: StepNode, processes: PlanProcess[], compact?: boolean }>(), { compact: false })
  const options = computed(() => {
    const processes = [...props.processes]
    if (props.node.process && !processes.some(process => JSON.stringify(process.source) === JSON.stringify(props.node.process!.source))) processes.push(props.node.process)
    return processes.map(process => ({ title: process.name, value: JSON.stringify(process.source), process }))
  })
  const items = computed(() => [{ title: 'No operation selected', value: '' }, ...options.value])

  function choose (key: string): void {
    setOperation(props.node, options.value.find(option => option.value === key)?.process ?? null)
  }
</script>
