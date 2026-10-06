<template>
  <InspectorSection
    v-if="inputs.length > 0"
    collapsible
    color="secondary"
    help="These are simulated operation results for this preview. They do not change the recipe or contact equipment. Leaving a required result unresolved stops that path."
    title="Simulated outputs"
  >
    <div v-for="input in inputs" :key="input.key" class="mb-3">
      <v-select
        v-if="input.type === 'boolean'"
        density="compact"
        hide-details
        :items="[{ title: 'Unresolved', value: 'unset' }, { title: 'True', value: true }, { title: 'False', value: false }]"
        :label="input.name"
        :model-value="values[input.key] ?? 'unset'"
        @update:model-value="setBoolean(input.key, $event)"
      />

      <v-text-field
        v-else
        clearable
        density="compact"
        :error-messages="errors[input.key] ?? ''"
        hide-details="auto"
        :label="input.name"
        :model-value="values[input.key] ?? null"
        placeholder="Unresolved"
        :suffix="input.unit"
        :type="input.type === 'number' ? 'number' : 'text'"
        @update:model-value="setText(input.key, input.type, $event)"
      />
    </div>
  </InspectorSection>
</template>

<script setup lang="ts">
  import type { PreviewValue } from '../utils/planPreview'
  import { parseScalar } from '../utils/conditions'
  import InspectorSection from './InspectorSection.vue'

  defineProps<{ inputs: { key: string, name: string, type: 'boolean' | 'number' | 'string', unit: string }[] }>()
  const values = defineModel<Record<string, PreviewValue>>({ required: true })
  const errors = ref<Record<string, string>>({})

  function setBoolean (key: string, value: PreviewValue): void {
    if (typeof value === 'boolean') values.value[key] = value
    else delete values.value[key]
  }
  function setText (key: string, type: 'number' | 'string', text: string | null): void {
    const value = text === null ? undefined : parseScalar(type, text)
    if (value === undefined) delete values.value[key]
    else values.value[key] = value
    errors.value[key] = text && value === undefined ? 'Enter a finite number.' : ''
  }
</script>
