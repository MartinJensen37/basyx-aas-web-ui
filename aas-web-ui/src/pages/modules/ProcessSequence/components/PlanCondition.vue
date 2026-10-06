<template>
  <InspectorSection collapsible color="secondary" help="A decision checks a value once. Missing values remain unresolved. Output values are supplied in Combined steps for preview; this does not monitor a station." title="Condition">
    <v-select
      class="mb-3"
      density="compact"
      hide-details
      :items="[{ title: 'Compare a value', value: 'comparison' }, { title: 'Every N products', value: 'everyNthProduct' }]"
      label="Condition rule"
      :model-value="condition.kind"
      @update:model-value="changeRule"
    />

    <v-text-field
      v-if="condition.kind === 'everyNthProduct'"
      density="compact"
      :error-messages="numberError"
      hint="Product count starts at 1 and is shared with subprocesses. Retries keep the same number."
      label="Run every N products"
      min="1"
      :model-value="condition.every"
      step="1"
      type="number"
      @update:model-value="setInterval"
    />

    <template v-else>
      <v-select
        class="mb-3"
        clearable
        density="compact"
        :error-messages="condition.operand && !selected ? ['The source no longer exists. Choose a value.'] : []"
        hide-details="auto"
        item-title="name"
        item-value="key"
        :items="options"
        label="Condition value"
        :model-value="condition.operand ? JSON.stringify(condition.operand) : null"
        @update:model-value="selectOperand"
      />

      <v-select
        v-model="condition.operator"
        class="mb-3"
        density="compact"
        hide-details
        :items="comparisonOperators"
        label="Comparison"
      />

      <v-select
        v-if="condition.expected.type === 'boolean'"
        v-model="condition.expected.value"
        density="compact"
        hide-details
        :items="[{ title: 'True', value: true }, { title: 'False', value: false }]"
        label="Expected value"
      />

      <v-text-field
        v-else
        density="compact"
        :error-messages="numberError"
        hide-details="auto"
        label="Expected value"
        :model-value="condition.expected.value"
        :suffix="condition.unit"
        :type="condition.expected.type === 'number' ? 'number' : 'text'"
        @update:model-value="setExpected"
      />
    </template>
  </InspectorSection>
</template>

<script setup lang="ts">
  import type { PlanCondition, PlanNode } from '../types/plan'
  import { conditionOptions, newComparison, operators, parseScalar } from '../utils/conditions'
  import { flattenNodes } from '../utils/plan'
  import InspectorSection from './InspectorSection.vue'

  const props = defineProps<{ nodes: PlanNode[] }>()
  const condition = defineModel<PlanCondition>({ required: true })
  const numberError = ref('')
  const options = computed(() => conditionOptions(flattenNodes(props.nodes)))
  const selected = computed(() => {
    const rule = condition.value
    return rule.kind === 'comparison' ? options.value.find(option => option.key === JSON.stringify(rule.operand)) : undefined
  })
  const comparisonOperators = computed(() => selected.value?.type === 'number' ? operators : operators.slice(0, 2))

  function changeRule (kind: PlanCondition['kind']): void {
    numberError.value = ''
    condition.value = kind === 'everyNthProduct' ? { kind, every: 5 } : newComparison()
  }
  function setInterval (value: string): void {
    const every = Number(value)
    numberError.value = Number.isSafeInteger(every) && every > 0 ? '' : 'Enter a positive whole number of products.'
    if (!numberError.value) condition.value = { kind: 'everyNthProduct', every }
  }
  function selectOperand (key: string | null): void {
    const option = options.value.find(option => option.key === key)
    const next = newComparison()
    if (option) {
      next.operand = option.operand
      next.unit = option.unit
      next.expected = option.type === 'boolean' ? { type: 'boolean', value: true } : (option.type === 'number' ? { type: 'number', value: 0 } : { type: 'string', value: '' })
    }
    numberError.value = ''
    condition.value = next
  }
  function setExpected (text: string): void {
    if (condition.value.kind !== 'comparison') return
    if (condition.value.expected.type === 'number') {
      const value = parseScalar('number', text)
      numberError.value = typeof value === 'number' ? '' : 'Enter a finite number.'
      if (typeof value === 'number') condition.value.expected.value = value
    } else if (condition.value.expected.type === 'string') condition.value.expected.value = text
  }
</script>
