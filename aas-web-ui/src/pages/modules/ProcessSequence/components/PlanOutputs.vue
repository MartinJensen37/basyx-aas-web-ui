<template>
  <InspectorSection collapsible color="secondary" help="Declare values this operation produces, then use them in later decisions. Preview values are entered in Combined steps. Units must match exactly; no conversion is implied." title="Operation outputs">
    <div v-for="output in node.outputs ?? []" :key="output.id" class="mb-4">
      <div class="d-flex ga-1 mb-2">
        <v-text-field v-model="output.name" density="compact" hide-details label="Output name" />

        <v-btn
          :aria-label="`Remove output ${output.name || 'Unnamed'}`"
          icon="mdi-close"
          size="small"
          variant="text"
          @click="node.outputs = node.outputs?.filter(item => item.id !== output.id)"
        />
      </div>

      <v-select
        v-model="output.type"
        class="mb-2"
        density="compact"
        hide-details
        :items="['boolean', 'number', 'string']"
        label="Output type"
      />

      <v-text-field
        v-if="output.type === 'number'"
        v-model="output.unit"
        density="compact"
        hide-details
        label="Output unit (optional)"
      />
    </div>

    <v-btn prepend-icon="mdi-plus" size="small" variant="tonal" @click="add">Add output</v-btn>
  </InspectorSection>
</template>

<script setup lang="ts">
  import type { StepNode } from '../types/plan'
  import { v4 } from 'uuid'
  import InspectorSection from './InspectorSection.vue'

  const node = defineModel<StepNode>({ required: true })

  function add (): void {
    node.value.outputs = [...node.value.outputs ?? [], { id: v4(), name: 'Result', type: 'boolean', unit: '' }]
  }
</script>
