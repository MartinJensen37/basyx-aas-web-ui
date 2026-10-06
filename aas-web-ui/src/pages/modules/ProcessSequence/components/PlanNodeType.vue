<template>
  <v-select
    class="mb-3"
    density="compact"
    hide-details
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
</template>

<script setup lang="ts">
  import type { PlanNode } from '../types/plan'
  import { isEmptyContainer, isPlaceholder, nodeTypes, typeChangeDescription } from '../utils/planTransforms'

  const props = defineProps<{ node: PlanNode }>()
  const emit = defineEmits<{ change: [kind: PlanNode['kind']] }>()
  const pending = ref<PlanNode['kind']>()
  const items = computed(() => nodeTypes.map(type => ({ ...type, props: { disabled: type.value === 'step' && props.node.kind !== 'step' && !isEmptyContainer(props.node) } })))

  function choose (kind: PlanNode['kind']): void {
    if (kind === props.node.kind) return
    if (isPlaceholder(props.node)) emit('change', kind)
    else pending.value = kind
  }
  function confirm (): void {
    if (pending.value) emit('change', pending.value)
    pending.value = undefined
  }
</script>
