<template>
  <div>
    <v-autocomplete
      v-model="node.resourceAasId"
      class="mb-3"
      clearable
      density="compact"
      hide-details="auto"
      item-title="name"
      item-value="id"
      :items="[{ id: '', name: 'No resource' }, ...resources]"
      label="Resource (optional)"
      @update:model-value="resetResource"
    />

    <v-select
      v-if="node.resourceAasId"
      class="mb-3"
      density="compact"
      :disabled="!node.resourceAasId || loading"
      hide-details="auto"
      item-title="name"
      item-value="idShort"
      :items="skills"
      label="Resource skill"
      :loading="loading"
      :model-value="node.skillId"
      @update:model-value="bindSkill"
    />

    <v-alert v-if="error" class="mb-3" density="compact" type="warning">{{ error }}</v-alert>
    <v-alert v-else-if="node.resourceAasId && !loading && skills.length === 0" class="mb-3" density="compact" type="info">This resource has no available skills.</v-alert>

    <div v-for="binding in node.bindings" :key="binding.name" class="mb-3">
      <div class="text-body-small font-weight-medium mb-1">{{ binding.name }}</div>

      <v-select
        density="compact"
        hide-details
        :items="parameterOptions"
        label="Value source"
        :model-value="binding.source ? JSON.stringify(binding.source) : ''"
        @update:model-value="setSource(binding, $event)"
      />

      <v-text-field
        v-if="!binding.source"
        v-model="binding.value"
        class="mt-2"
        density="compact"
        hide-details
        label="Constant value"
      />

    </div>
  </div>
</template>

<script setup lang="ts">
  import type { SkillDefinition } from '../types'
  import type { PlanBinding, StepNode } from '../types/plan'
  import { usePlanSources } from '../composables/usePlanSources'

  defineProps<{ resources: { id: string, name: string }[] }>()
  const node = defineModel<StepNode>({ required: true })
  const skills = ref<SkillDefinition[]>([])
  const loading = ref(false)
  const error = ref('')
  const { loadSkills } = usePlanSources()
  let request = 0
  const parameterOptions = computed(() => [
    { title: 'Constant', value: '' },
    ...(node.value.process?.parameters ?? []).map(parameter => ({
      title: `${parameter.group} / ${parameter.name}`, value: JSON.stringify(parameter.source),
    })),
  ])

  watch(() => node.value.resourceAasId, async aasId => {
    const ticket = ++request
    skills.value = []
    error.value = ''
    loading.value = !!aasId
    try {
      const result = aasId ? await loadSkills(aasId) : []
      if (ticket === request) {
        skills.value = result
      }
    } catch {
      if (ticket === request) {
        error.value = 'The skill catalog could not be loaded.'
      }
    } finally {
      if (ticket === request) {
        loading.value = false
      }
    }
  }, { immediate: true })

  function resetResource (): void {
    node.value.resourceAasId ||= ''
    node.value.skillId = ''
    delete node.value.skillReference
    node.value.bindings = []
  }

  function bindSkill (id: string): void {
    node.value.skillId = id
    node.value.skillReference = skills.value.find(skill => skill.idShort === id)?.reference
    node.value.bindings = (skills.value.find(skill => skill.idShort === id)?.parameters ?? []).map(parameter => ({
      name: parameter.idShort, source: null, value: String(parameter.defaultValue ?? ''),
    }))
  }

  function setSource (binding: PlanBinding, value: string): void {
    binding.source = value ? JSON.parse(value) : null
    binding.value = ''
  }
</script>
