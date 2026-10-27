<template>
  <div class="pa-3">
    <div class="text-subtitle-2 mb-2">{{ kindTitle[node.kind] ?? node.kind }}</div>

    <v-text-field
      density="compact"
      hint="The name of its block in the control program"
      label="Name"
      :model-value="node.name"
      persistent-hint
      @change="rename(($event.target as HTMLInputElement).value)"
    />

    <template v-if="node.kind === 'parallel'">
      <p class="text-body-2 mt-3 mb-2">
        {{ node.branches.length }} branches run at once; the next step starts when all are done. Branches use different components.
      </p>

      <div class="d-flex ga-2">
        <v-btn :disabled="node.branches.length >= 4" size="small" variant="tonal" @click="addBranch">Add a branch</v-btn>

        <v-btn :disabled="node.branches.length <= 2 || (node.branches.at(-1)?.nodes.length ?? 0) > 0" size="small" variant="text" @click="node.branches.pop()">
          Remove the last, empty branch
        </v-btn>
      </div>
    </template>

    <template v-else-if="condition">
      <p class="text-body-2 mt-3 mb-2">
        {{ node.kind === 'decision' ? 'When the condition holds, Yes runs, else No.' : 'Its steps run only when the condition holds.' }}
        It is evaluated when the steps before it are done.
      </p>

      <v-btn-toggle
        density="compact"
        mandatory
        :model-value="grouping"
        variant="outlined"
        @update:model-value="group($event)"
      >
        <v-btn size="small" value="comparison">One comparison</v-btn>
        <v-btn size="small" value="all">All hold</v-btn>
        <v-btn size="small" value="any">One holds</v-btn>
      </v-btn-toggle>

      <div v-for="(rule, index) in rules" :key="index" class="mt-3">
        <v-select
          density="compact"
          hide-details
          item-title="title"
          item-value="key"
          :items="options"
          label="Compare"
          :model-value="operandKey(rule.operand)"
          @update:model-value="choose(rule, $event)"
        />

        <div class="d-flex ga-2 mt-2">
          <v-select
            density="compact"
            hide-details
            item-title="title"
            item-value="value"
            :items="operators(rule)"
            label="is"
            :model-value="rule.operator"
            style="max-width: 45%"
            @update:model-value="rule.operator = $event"
          />

          <v-switch
            v-if="rule.expected.type === 'boolean'"
            density="compact"
            hide-details
            :label="String(rule.expected.value)"
            :model-value="rule.expected.value"
            @update:model-value="rule.expected = { type: 'boolean', value: Boolean($event) }"
          />

          <v-text-field
            v-else
            density="compact"
            hide-details
            :label="rule.unit || 'Value'"
            :model-value="String(rule.expected.value)"
            type="number"
            @update:model-value="rule.expected = { type: 'number', value: Number($event) }"
          />

          <v-btn
            v-if="rules.length > 1"
            aria-label="Remove this comparison"
            icon="mdi-close"
            size="small"
            variant="text"
            @click="remove(index)"
          />
        </div>
      </div>

      <v-btn
        v-if="grouping !== 'comparison'"
        class="mt-2"
        size="small"
        variant="tonal"
        @click="add"
      >Add a comparison</v-btn>
    </template>
  </div>
</template>

<script setup lang="ts">
  import type { PlanCondition, PlanNode, SimpleCondition } from '../types/plan'
  import type { Operand } from './skillConditions'
  import type { ResourceSkill } from './skillFlow'
  import { newComparison } from '../utils/conditions'
  import { newBranch } from '../utils/plan'
  import { operandKey, operandOptions } from './skillConditions'
  import { instanceName } from './skillFlow'

  type Comparison = Extract<SimpleCondition, { kind: 'comparison' }>

  const props = defineProps<{ nodes: PlanNode[], owner: ResourceSkill, catalog: ResourceSkill[], taken: string[] }>()
  const node = defineModel<Exclude<PlanNode, { kind: 'step' | 'call' }>>('node', { required: true })

  const kindTitle: Record<string, string> = { parallel: 'Parallel block', decision: 'Decision', conditional: 'Conditional steps' }
  const operatorTitles = { eq: 'equal to', ne: 'not equal to', gt: 'greater than', gte: 'at least', lt: 'less than', lte: 'at most' } as const

  const condition = computed(() => (node.value.kind === 'decision' || node.value.kind === 'conditional' ? node.value.condition : undefined))
  const grouping = computed(() => (condition.value && 'conditions' in condition.value ? condition.value.kind : 'comparison'))
  const rules = computed<Comparison[]>(() => {
    const found = condition.value
    if (!found) return []
    const leaves = 'conditions' in found ? found.conditions : [found]
    return leaves.filter((rule): rule is Comparison => rule.kind === 'comparison')
  })
  const options = computed<Operand[]>(() => operandOptions(props.nodes, node.value.id, props.owner, props.catalog))

  function setCondition (next: PlanCondition): void {
    if (node.value.kind === 'decision' || node.value.kind === 'conditional') {
      node.value.condition = next
    }
  }

  function group (kind: string): void {
    const current = rules.value.length > 0 ? rules.value : [newComparison() as Comparison]
    setCondition(kind === 'all' || kind === 'any' ? { kind, conditions: current } : current[0]!)
  }

  function add (): void {
    if (condition.value && 'conditions' in condition.value) {
      condition.value.conditions.push(newComparison())
    }
  }

  function remove (index: number): void {
    if (condition.value && 'conditions' in condition.value) {
      condition.value.conditions.splice(index, 1)
    }
  }

  function choose (rule: Comparison, key: string): void {
    const option = options.value.find(item => item.key === key)
    if (!option) return
    rule.operand = option.operand
    rule.unit = option.unit
    if (rule.expected.type !== option.type) {
      rule.expected = option.type === 'boolean' ? { type: 'boolean', value: true } : { type: 'number', value: 0 }
      rule.operator = option.type === 'boolean' ? 'eq' : 'lt'
    }
  }

  function operators (rule: Comparison) {
    const allowed = rule.expected.type === 'boolean' ? (['eq', 'ne'] as const) : (['lt', 'lte', 'gt', 'gte', 'eq', 'ne'] as const)
    return allowed.map(value => ({ value, title: operatorTitles[value] }))
  }

  function rename (wanted: string): void {
    const name = instanceName(wanted, props.taken.filter(id => id !== node.value.id))
    node.value.id = name
    node.value.name = name
  }

  function addBranch (): void {
    if (node.value.kind === 'parallel') {
      node.value.branches.push(newBranch(`Branch ${node.value.branches.length + 1}`))
    }
  }
</script>
