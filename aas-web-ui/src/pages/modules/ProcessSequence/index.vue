<template>
  <v-container class="pa-md-4" fluid>
    <PlanProductPicker v-model="eligible" />

    <PlanEditor v-if="eligible" />
    <v-empty-state v-else icon="mdi-package-variant-closed" text="Choose a product above to open or create its process sequence." title="Select a product" />
  </v-container>
</template>

<script setup lang="ts">
  import PlanEditor from './components/PlanEditor.vue'
  import PlanProductPicker from './components/PlanProductPicker.vue'

  defineOptions({
    inheritAttrs: false,
    moduleTitle: 'Process Sequence',
    isDesktopModule: true,
    isOnlyVisibleWithSelectedAas: false,
    preserveRouteQuery: true,
  })

  const eligible = ref(false)
</script>
