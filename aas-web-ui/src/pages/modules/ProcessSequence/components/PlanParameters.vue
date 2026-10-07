<template>
  <v-treeview
    aria-label="Process parameter tree"
    class="parameter-tree"
    density="compact"
    item-value="id"
    :items="items"
    open-all
  >
    <template #prepend="{ item }">
      <v-icon :color="item.color" :icon="item.children ? 'mdi-folder-outline' : 'mdi-tune-variant'" size="small" />
    </template>

    <template #title="{ item }">
      <v-tooltip v-if="item.help" location="top" max-width="320" :text="item.help">
        <template #activator="{ props: activator }"><span v-bind="activator" class="text-body-small text-break" tabindex="0">{{ item.title }}</span></template>
      </v-tooltip>

      <span v-else class="text-body-small text-break" :class="{ 'font-weight-medium': item.children }">{{ item.title }}</span>
      <div v-if="item.value !== undefined" class="text-body-small text-medium-emphasis text-break">{{ item.value }}</div>
    </template>

    <template #append="{ item }">
      <v-chip v-if="item.children" :color="item.color" size="x-small">{{ item.children.length }}</v-chip>
    </template>
  </v-treeview>
</template>

<script setup lang="ts">
  import type { PlanProcess, PlanScope } from '../types/plan'
  import { materialAmount, materialRoles, readMaterialUses } from '../utils/materials'

  type ParameterItem = { id: string, title: string, color?: string, help?: string, value?: string, children?: ParameterItem[] }

  const props = defineProps<{ process: PlanProcess, materialScopes: PlanScope[] }>()
  const groups = [
    { id: 'ProductParameters', title: 'Product parameters', color: 'primary' },
    { id: 'ProcessParameters', title: 'Process parameters', color: 'success' },
    { id: 'ResourceParameters', title: 'Resource parameters', color: 'warning' },
  ]
  const items = computed<ParameterItem[]>(() => [
    ...groups.map(group => ({
      ...group,
      children: props.process.parameters.filter(parameter => parameter.group === group.id).map(parameter => ({
        id: JSON.stringify(parameter.source), title: parameter.name, value: parameter.value ? `${parameter.value}${parameter.unit ? ` ${parameter.unit}` : ''}` : 'Not set',
        help: `${parameter.dataType} - ${parameter.source.path.join(' / ')}`,
      })),
    })),
    { id: 'materials', title: 'Process materials', children: readMaterialUses(props.process, props.materialScopes).map(material => ({ id: `material:${material.id}`, title: material.name, value: `${materialRoles[material.role]} - ${materialAmount(material)}`, help: material.warning ?? material.reference?.path.join(' / ') })) },
  ])
</script>

<style scoped>
.parameter-tree :deep(.v-list-item-title) {
  white-space: normal;
}
</style>
