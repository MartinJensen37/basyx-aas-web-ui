<template>
  <div class="material-node">
    <Handle v-if="data.material?.role === 'output'" id="material-target" :position="Position.Left" type="target" />
    <Handle v-else id="material-source" :position="Position.Right" type="source" />
    <button :aria-label="`Material ${data.title} at ${data.operationName}`" class="material-button nodrag nopan" :class="{ 'material-workpiece': data.material?.role === 'workpiece' || data.material?.role === 'linked' }" @click="showDetails">
      <span class="d-flex align-center ga-1 text-caption"><v-icon icon="mdi-package-variant-closed" size="14" />{{ data.subtitle }}</span>
      <span class="d-block text-body-small font-weight-medium text-truncate" :title="data.title">{{ data.title }}</span>
      <span class="d-block text-caption">{{ data.material ? materialAmount(data.material) : '' }}</span>
    </button>
    <v-dialog v-model="open" max-width="520">
      <v-card :title="data.title">
        <v-card-text v-if="data.material">
          <p class="mb-2">{{ data.subtitle }} at {{ data.operationName }}: {{ materialAmount(data.material) }}</p>
          <p v-if="data.material.role === 'workpiece'" class="text-body-small mb-3">This is the item being processed. It is not an additional component consumed at every step.</p>
          <v-alert v-if="data.material.warning" class="mb-3" density="compact" type="info">{{ data.material.warning }}</v-alert>
          <div v-if="data.material.reference" class="text-body-small text-break">
            <div class="font-weight-medium">BoM occurrence</div>
            <div>{{ data.material.reference.path.join(' / ') }}</div>
            <div class="text-medium-emphasis">{{ data.material.reference.submodelId }}</div>
          </div>
        </v-card-text>
        <v-card-actions>
          <v-btn v-if="data.material?.scopeId" color="primary" @click="openPart">Open part sequence</v-btn>
          <v-spacer />
          <v-btn @click="open = false">Close</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
  import type { PlanGraphData } from '../utils/planGraph'
  import { Handle, Position } from '@vue-flow/core'
  import { materialAmount } from '../utils/materials'

  const props = defineProps<{ data: PlanGraphData }>()
  const emit = defineEmits<{ select: [], open: [id: string] }>()
  const open = ref(false)

  function showDetails (): void {
    emit('select')
    open.value = true
  }

  function openPart (): void {
    open.value = false
    if (props.data.material?.scopeId) emit('open', props.data.material.scopeId)
  }
</script>

<style scoped>
.material-node {
  width: 200px;
  height: 72px;
}
.material-button {
  width: 100%;
  height: 100%;
  padding: 6px 10px;
  border: 1px solid rgb(var(--v-theme-success));
  border-radius: 10px;
  background: rgb(var(--v-theme-surface));
  color: rgb(var(--v-theme-on-surface));
  text-align: left;
  cursor: pointer;
}
.material-workpiece {
  border-color: rgba(var(--v-theme-on-surface), 0.4);
  border-style: dashed;
}
.material-button:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: 3px;
}
</style>
