<template>
  <div>
    <v-expansion-panels multiple variant="accordion">
      <v-expansion-panel v-for="group in groups" :key="group.id" class="parameter-group" :style="{ '--group-color': `var(--v-theme-${group.color})` }">
        <v-expansion-panel-title>
          <span class="text-body-small font-weight-medium">{{ group.title }}</span>
          <v-chip class="ml-2" :color="group.color" size="x-small">{{ process.parameters.filter(item => item.group === group.id).length }}</v-chip>
        </v-expansion-panel-title>

        <v-expansion-panel-text>
          <div v-for="parameter in process.parameters.filter(item => item.group === group.id)" :key="JSON.stringify(parameter.source)" class="d-flex justify-space-between ga-3 py-1">
            <v-tooltip location="top" :text="`${parameter.dataType} · ${parameter.source.path.join(' / ')}`">
              <template #activator="{ props: activator }"><span v-bind="activator" class="text-body-small" tabindex="0">{{ parameter.name }}</span></template>
            </v-tooltip>

            <span class="text-body-small font-weight-medium text-break">{{ parameter.value || 'Not set' }}</span>
          </div>

          <span v-if="!process.parameters.some(item => item.group === group.id)" class="text-caption text-medium-emphasis">No parameters</span>
        </v-expansion-panel-text>
      </v-expansion-panel>

      <v-expansion-panel title="Process materials">
        <v-expansion-panel-text>
          <span v-if="process.material.length === 0" class="text-caption text-medium-emphasis">No materials</span>
          <div v-for="(material, index) in materialLabels(process.material)" :key="index" class="text-body-small mb-2">{{ material }}</div>
        </v-expansion-panel-text>
      </v-expansion-panel>
    </v-expansion-panels>
  </div>
</template>

<script setup lang="ts">
  import type { PlanProcess } from '../types/plan'
  import { materialLabels } from '../utils/planSources'

  defineProps<{ process: PlanProcess }>()
  const groups = [
    { id: 'ProductParameters', title: 'Product parameters', color: 'primary' },
    { id: 'ProcessParameters', title: 'Process parameters', color: 'success' },
    { id: 'ResourceParameters', title: 'Resource parameters', color: 'warning' },
  ]
</script>

<style scoped>
.parameter-group {
  border-left: 3px solid rgb(var(--group-color));
}
.parameter-group :deep(.v-expansion-panel-title) {
  background: rgba(var(--group-color), 0.08);
}
</style>
