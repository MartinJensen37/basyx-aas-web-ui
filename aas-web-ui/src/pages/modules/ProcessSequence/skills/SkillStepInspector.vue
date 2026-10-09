<template>
  <div class="pa-3">
    <div class="text-subtitle-2 mb-2">Step</div>

    <v-select
      density="compact"
      :disabled="readonly"
      hide-details
      item-title="title"
      item-value="value"
      :items="primitives"
      label="Runs the skill"
      :model-value="node.skillId"
      @update:model-value="choose"
    />

    <v-text-field
      class="mt-3"
      density="compact"
      :disabled="readonly"
      hint="The name of the step's block in the control program"
      label="Name"
      :model-value="node.name"
      persistent-hint
      @change="rename(($event.target as HTMLInputElement).value)"
    />

    <template v-if="skill">
      <div v-if="skill.inputs.length > 0" class="text-subtitle-2 mt-4 mb-1">What it is handed</div>

      <div v-for="input in skill.inputs" :key="input.idShort" class="d-flex ga-2 mb-2">
        <v-select
          density="compact"
          :disabled="readonly"
          hide-details
          :items="sources(input.idShort)"
          :label="input.idShort"
          :model-value="source(input.idShort)"
          style="max-width: 55%"
          @update:model-value="hand(input.idShort, $event)"
        />

        <v-text-field
          v-if="!source(input.idShort)"
          density="compact"
          :disabled="readonly"
          :hint="range(input)"
          :label="input.unit || 'Value'"
          :model-value="binding(input.idShort)?.value ?? ''"
          persistent-hint
          @update:model-value="set(input.idShort, String($event ?? ''))"
        />
      </div>

      <div v-if="skill.outputs.length > 0 && owner.outputs.length > 0" class="text-subtitle-2 mt-4 mb-1">What it gives</div>

      <v-select
        v-for="output in owner.outputs.length > 0 ? skill.outputs : []"
        :key="output.idShort"
        class="mb-2"
        clearable
        density="compact"
        :disabled="readonly"
        hide-details
        :items="owner.outputs.map(item => item.idShort)"
        :label="`${output.idShort} becomes the skill's result`"
        :model-value="given(output.idShort)"
        @update:model-value="give(output, $event)"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
  import type { SkillParameter } from '../types'
  import type { StepNode } from '../types/plan'
  import type { ResourceSkill, SkillCommand } from './skillFlow'
  import { assignSkill, handedParameter, instanceName, variableReference } from './skillFlow'

  const props = defineProps<{ owner: ResourceSkill, command: SkillCommand, catalog: ResourceSkill[], taken: string[], readonly?: boolean }>()
  /** The step that is edited, in place: it is one of the nodes of the flow the editor holds. */
  const node = defineModel<StepNode>('node', { required: true })

  const primitives = computed(() => props.catalog.filter(item => item.kind === 'Primitive').map(item => ({
    value: item.idShort, title: `${item.idShort} (${item.aasId.split('/').at(-1)?.replace(/AAS$/, '') ?? ''})`,
  })))
  const skill = computed(() => props.catalog.find(item => item.kind === 'Primitive' && item.idShort === node.value.skillId))
  const others = computed(() => props.taken.filter(name => name !== node.value.id))

  const binding = (name: string) => node.value.bindings.find(item => item.name === name)
  function source (name: string): string {
    const found = binding(name)
    return found ? handedParameter(found) : ''
  }
  const given = (result: string) => node.value.outputs?.find(output => output.source?.keys.at(-1)?.value === result)?.id ?? null
  const range = (input: SkillParameter) => `${input.minValue ?? '-'} to ${input.maxValue ?? '-'}${input.unit ? ` ${input.unit}` : ''}`

  /** A constant, or one of the parameters of the skill this is a step of (Start hands them down; Stop has none). */
  function sources (_input: string) {
    const parameters = props.command === 'Start' ? props.owner.inputs : []
    return [{ title: 'A constant', value: '' }, ...parameters.map(item => ({ title: `The skill's ${item.idShort}`, value: item.idShort }))]
  }

  function choose (name: string): void {
    const chosen = props.catalog.find(item => item.kind === 'Primitive' && item.idShort === name)
    if (chosen) assignSkill(node.value, chosen, others.value)
  }

  function rename (text: string): void {
    node.value.name = instanceName(text, others.value)
    node.value.id = node.value.name
  }

  function hand (name: string, parameter: string): void {
    const input = skill.value?.inputs.find(item => item.idShort === name)
    let found = binding(name)
    if (!found) {
      found = { name, value: String(input?.defaultValue ?? ''), source: null, target: input?.reference }
      node.value.bindings.push(found)
    }
    if (parameter) {
      const reference = variableReference(props.owner.submodelId, props.owner.idShort, props.command, parameter)
      found.source = { aasId: '', submodelId: props.owner.submodelId, path: reference.keys.slice(1).map(key => key.value) }
      found.value = ''
    } else {
      found.source = null
      found.value = String(input?.defaultValue ?? '')
    }
  }

  function set (name: string, text: string): void {
    const found = binding(name)
    if (found) found.value = text
    else node.value.bindings.push({ name, value: text, source: null, target: skill.value?.inputs.find(item => item.idShort === name)?.reference })
  }

  function give (output: SkillParameter, result: string | null): void {
    const kept = (node.value.outputs ?? []).filter(item => item.source?.keys.at(-1)?.value !== output.idShort)
    const target = props.owner.outputs.find(item => item.idShort === result)
    node.value.outputs = target
      ? [...kept, { id: target.idShort, name: target.idShort, type: output.dataType === 'xs:boolean' ? 'boolean' : 'number', unit: output.unit, source: output.reference }]
      : kept
  }
</script>
