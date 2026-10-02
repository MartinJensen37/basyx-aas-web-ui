<template>
  <v-empty-state v-if="!product?.id" icon="mdi-package-variant-closed" text="Select a product in the AAS viewer to plan its assembly processes." title="Select a product" />
  <v-progress-linear v-else-if="loading" aria-label="Loading process plan" indeterminate />

  <v-alert v-else-if="error" type="error">
    {{ error }}
    <v-btn class="ml-2" variant="text" @click="reload">Retry</v-btn>
  </v-alert>

  <div v-else-if="plan && scope">
    <v-toolbar class="mb-2" color="cardHeader" density="compact" rounded="lg">
      <v-toolbar-title class="text-body-large">{{ rootName }}</v-toolbar-title>
      <v-chip class="mr-2" size="small">{{ dirty ? 'Unsaved draft' : `Saved revision ${plan?.revision}` }}</v-chip>
      <v-btn prepend-icon="mdi-download" size="small" @click="download()">Download draft</v-btn>
      <v-btn :disabled="saving" prepend-icon="mdi-refresh" size="small" @click="reload">Reload plans</v-btn>

      <v-btn
        :disabled="saving"
        :loading="saving"
        prepend-icon="mdi-content-save-outline"
        size="small"
        variant="tonal"
        @click="save"
      >Save draft</v-btn>
    </v-toolbar>

    <v-alert
      v-if="message"
      class="mb-2"
      closable
      density="compact"
      type="info"
      @click:close="message = ''"
    >{{ message }}</v-alert>

    <p class="text-caption mb-2">Editing the plan owned by {{ ownerName }}. Saved assembly changes appear in every parent that uses it.</p>

    <div :inert="saving">
      <SplitPanes left-label="product structure" right-label="selection details" storage-key="processPlan.splitSizes">
        <template #left>
          <PlanTree :plan="plan" :selected-id="selectedScopeId" @select="selectedScopeId = $event" />
        </template>

        <v-card border class="h-100 overflow-y-auto" rounded="lg">
          <div class="d-flex align-center flex-wrap px-3 pt-2">
            <template v-for="(item, index) in breadcrumb" :key="item.id">
              <v-icon v-if="index" icon="mdi-chevron-right" size="small" />
              <v-btn size="small" variant="text" @click="selectedScopeId = item.id">{{ item.title }}</v-btn>
            </template>

            <v-spacer />
            <v-btn size="small" variant="text" @click="overview = !overview">{{ overview ? 'Edit sequence' : 'Combined steps' }}</v-btn>
            <v-btn prepend-icon="mdi-folder-plus-outline" size="small" variant="text" @click="dialog = true">New subprocess</v-btn>
          </div>

          <v-card-text>
            <v-text-field
              v-model="scope.name"
              density="compact"
              hide-details
              label="Sequence name"
              variant="underlined"
            />

            <p class="text-caption text-medium-emphasis mt-2">Follow the arrows from start to complete. Select a node to view its parameters; open a subprocess to explore its steps.</p>
          </v-card-text>

          <PlanOverview v-if="overview" :plan="plan" :scope-id="selectedScopeId" />

          <PlanGraph
            v-else
            :key="selectedScopeId"
            v-model="scope.nodes"
            :label="`${scope.name} sequence`"
            :selected-id="selectedNodeId"
            :targets="targets"
            @open="selectedScopeId = $event"
            @select="selectedNodeId = $event"
          />

        </v-card>

        <template #right>
          <PlanInspector
            v-model="selectedNode"
            :notes="notes"
            :processes="availableProcesses"
            :resources="resources"
            :targets="targets"
          />
        </template>
      </SplitPanes>
    </div>

    <v-dialog v-model="dialog" max-width="480">
      <v-card title="Create subprocess">
        <v-card-text>
          <p class="text-body-small mb-3">Create a reusable sequence under {{ scope.name }}. Add a call where it should run.</p>
          <v-text-field v-model="subprocessName" autofocus label="Subprocess name" @keydown.enter="createSubprocess" />
        </v-card-text>

        <v-card-actions>
          <v-spacer />
          <v-btn @click="dialog = false">Cancel</v-btn>
          <v-btn color="primary" :disabled="!subprocessName.trim()" @click="createSubprocess">Create</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
  import { usePlanWorkspace } from '../composables/usePlanWorkspace'
  import PlanGraph from './PlanGraph.vue'
  import PlanInspector from './PlanInspector.vue'
  import PlanOverview from './PlanOverview.vue'
  import PlanTree from './PlanTree.vue'
  import SplitPanes from './SplitPanes.vue'

  const dialog = ref(false)
  const subprocessName = ref('')
  const overview = ref(false)
  const {
    plan, product, scope, selectedScopeId, selectedNodeId, selectedNode, loading, saving,
    error, message, dirty, targets, availableProcesses, resources, notes, breadcrumb, ownerName,
    reload, addSubprocess, save, download,
  } = usePlanWorkspace()

  const rootName = computed(() => plan.value?.scopes.find(item => item.id === plan.value?.rootScopeId)?.name)

  function createSubprocess (): void {
    if (!subprocessName.value.trim()) {
      return
    }
    addSubprocess(subprocessName.value)
    subprocessName.value = ''
    dialog.value = false
  }
</script>
