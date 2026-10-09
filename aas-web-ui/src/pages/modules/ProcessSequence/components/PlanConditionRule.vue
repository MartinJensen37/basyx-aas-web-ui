<template>
  <div>
    <div class="d-flex align-center ga-2 mb-3">
      <PlanConditionKind v-model="condition" />
      <v-spacer />

      <v-btn
        v-if="removable"
        aria-label="Remove condition"
        density="compact"
        icon="mdi-close"
        variant="text"
        @click="emit('remove')"
      />
    </div>

    <template v-if="'conditions' in condition">
      <div v-for="(_, index) in condition.conditions" :key="index" class="border rounded pa-3 mb-3">
        <PlanConditionRule v-model="condition.conditions[index]" :options="options" :removable="condition.conditions.length > 1" @remove="remove(index)" />
      </div>

      <v-btn
        color="primary"
        prepend-icon="mdi-plus"
        size="small"
        variant="tonal"
        @click="condition.conditions.push(newComparison())"
      >Add condition</v-btn>
    </template>

    <v-text-field
      v-else-if="condition.kind === 'everyNthProduct'"
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

    <template v-else-if="condition.kind === 'comparison'">
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
  </div>
</template>

<script setup lang="ts">
  import type { PlanCondition } from '../types/plan'
  import type { ConditionOption } from '../utils/conditions'
  import { newComparison, operators, parseScalar } from '../utils/conditions'
  import PlanConditionKind from './PlanConditionKind.vue'

  const props = defineProps<{ options: ConditionOption[], removable?: boolean }>()
  const emit = defineEmits<{ remove: [] }>()
  const condition = defineModel<PlanCondition>({ required: true })
  const numberError = ref('')
  const selected = computed(() => {
    const rule = condition.value
    return rule.kind === 'comparison' ? props.options.find(option => option.key === JSON.stringify(rule.operand)) : undefined
  })
  const comparisonOperators = computed(() => selected.value?.type === 'number' ? operators : operators.slice(0, 2))

  watch(() => condition.value, () => {
    numberError.value = ''
  })

  function remove (index: number): void {
    if ('conditions' in condition.value && condition.value.conditions.length > 1) condition.value.conditions.splice(index, 1)
  }
  function setInterval (value: string): void {
    const every = Number(value)
    numberError.value = Number.isSafeInteger(every) && every > 0 ? '' : 'Enter a positive whole number of products.'
    if (!numberError.value) condition.value = { kind: 'everyNthProduct', every }
  }
  function selectOperand (key: string | null): void {
    const option = props.options.find(option => option.key === key)
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
