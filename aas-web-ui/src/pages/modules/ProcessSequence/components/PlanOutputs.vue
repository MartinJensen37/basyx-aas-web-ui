<template>
  <InspectorSection
    collapsible
    color="secondary"
    help="Declare values this operation produces, then use them in later decisions. Preview values are entered in Combined steps. Units must match exactly; no conversion is implied."
    :initially-open="false"
    :summary="`${node.outputs?.length ?? 0} results`"
    title="Operation outputs"
  >
    <p class="text-caption mb-3">Results become available after this operation. Use a result on the diagram to add a decision; results are not automatically passed into the next operation.</p>

    <v-alert v-if="error" class="mb-3" density="compact" type="warning">{{ error }}</v-alert>

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
        v-if="node.skillReference || output.source"
        class="mb-2"
        density="compact"
        hide-details
        :items="[{ title: 'Manual output', value: '' }, ...resultOptions]"
        label="Skill result"
        :loading="loading"
        :model-value="referenceKey(output.source)"
        @update:model-value="bindResult(output, $event)"
      />

      <v-select
        v-model="output.type"
        class="mb-2"
        density="compact"
        :disabled="!!output.source"
        hide-details
        :items="['boolean', 'number', 'string']"
        label="Output type"
      />

      <v-text-field
        v-if="output.type === 'number'"
        v-model="output.unit"
        density="compact"
        :disabled="!!output.source"
        hide-details
        label="Output unit (optional)"
      />
    </div>

    <v-btn
      v-if="node.skillReference"
      class="mr-2"
      color="primary"
      :disabled="!skill?.outputs?.length"
      :loading="loading"
      size="small"
      variant="tonal"
      @click="addResults"
    >Add skill results</v-btn>

    <v-btn prepend-icon="mdi-plus" size="small" variant="tonal" @click="add">Add output</v-btn>
  </InspectorSection>
</template>

<script setup lang="ts">
  import type { SkillDefinition } from '../types'
  import type { CapabilityReference, PlanOutput, StepNode } from '../types/plan'
  import { v4 } from 'uuid'
  import { usePlanSources } from '../composables/usePlanSources'
  import { addSkillResults, resultType } from '../utils/skillAssignment'
  import InspectorSection from './InspectorSection.vue'

  const node = defineModel<StepNode>({ required: true })
  const skill = ref<SkillDefinition>()
  const loading = ref(false)
  const error = ref('')
  const { loadSkills } = usePlanSources()
  let generation = 0
  const referenceKey = (reference?: CapabilityReference) => reference ? JSON.stringify(reference.keys.map(key => key.value)) : ''
  const resultOptions = computed(() => (skill.value?.outputs ?? []).filter(result => resultType(result)).map(result => ({ title: result.name, value: referenceKey(result.reference) })))

  watch(() => [node.value.resourceAasId, referenceKey(node.value.skillReference)], async () => {
    const ticket = ++generation
    skill.value = undefined
    error.value = ''
    loading.value = !!node.value.resourceAasId && !!node.value.skillReference
    if (!loading.value) return
    try {
      const skills = await loadSkills(node.value.resourceAasId)
      if (ticket !== generation) return
      skill.value = skills.find(skill => referenceKey(skill.reference) === referenceKey(node.value.skillReference))
      if (!skill.value) error.value = 'The assigned skill could not be resolved; existing result references are retained.'
    } catch {
      if (ticket === generation) error.value = 'Skill results could not be loaded.'
    } finally {
      if (ticket === generation) loading.value = false
    }
  }, { immediate: true })
  onBeforeUnmount(() => generation++)

  function addResults (): void {
    if (skill.value) addSkillResults(node.value, skill.value)
  }

  function bindResult (output: PlanOutput, key: string): void {
    const result = skill.value?.outputs?.find(result => referenceKey(result.reference) === key)
    const type = result && resultType(result)
    if (!result || !type) {
      delete output.source
      return
    }
    output.source = result.reference
    output.type = type
    output.unit = result.unit
  }

  function add (): void {
    node.value.outputs = [...node.value.outputs ?? [], { id: v4(), name: 'Result', type: 'boolean', unit: '' }]
  }
</script>
