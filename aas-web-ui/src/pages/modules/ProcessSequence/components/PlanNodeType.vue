<template>
  <div>
    <PlanChoice
      :color="typeColor"
      :compact="compact"
      :context="node.name"
      :items="items"
      label="Step type"
      :model-value="node.kind"
      @update:model-value="choose"
    />

    <v-dialog max-width="480" :model-value="!!pending" @update:model-value="pending = undefined">
      <v-card title="Change step type">
        <v-card-text>{{ pending ? typeChangeDescription(node, pending) : '' }}</v-card-text>

        <v-card-actions>
          <v-spacer />
          <v-btn @click="pending = undefined">Cancel</v-btn>
          <v-btn color="primary" @click="confirm">Change type</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
  import type { PlanNode } from '../types/plan'
  import { isEmptyContainer, isPlaceholder, nodeTypes, typeChangeDescription } from '../utils/planTransforms'
  import PlanChoice from './PlanChoice.vue'

  const props = withDefaults(defineProps<{ node: PlanNode, compact?: boolean }>(), { compact: false })
  const emit = defineEmits<{ change: [kind: PlanNode['kind']] }>()
  const pending = ref<PlanNode['kind']>()
  const typeColor = computed(() => ({ step: 'primary', call: 'teal', parallel: 'amber-darken-3', decision: 'deep-purple', conditional: 'deep-purple' })[props.node.kind])
  const items = computed(() => nodeTypes.map(type => ({ ...type, disabled: type.value === 'step' && props.node.kind !== 'step' && !isEmptyContainer(props.node) })))

  function choose (value: string): void {
    const kind = value as PlanNode['kind']
    if (kind === props.node.kind) return
    if (isPlaceholder(props.node)) emit('change', kind)
    else pending.value = kind
  }
  function confirm (): void {
    if (pending.value) emit('change', pending.value)
    pending.value = undefined
  }
</script>
