<template>
  <v-container class="pa-0" fluid>
    <SkillFlowEditor v-if="submodelElementData?.id && aasId" :aas-id="aasId" :submodel-id="submodelElementData.id" />
  </v-container>
</template>

<script lang="ts" setup>
  import SkillFlowEditor from '@/pages/modules/ProcessSequence/skills/SkillFlowEditor.vue'
  import { useAASStore } from '@/store/AASDataStore'

  // The Skills submodel of a resource (ARSO): its skills shown and edited as flows of steps, in the
  // style of the production sequence of a product.
  defineOptions({
    name: 'ArsoSkills',
    semanticId: 'https://smartproductionlab.aau.dk/ARSO/Skills/1/0/Submodel',
  })

  defineProps({
    submodelElementData: {
      type: Object as any,
      default: {} as any,
    },
  })

  const aasStore = useAASStore()

  const aasId = computed(() => aasStore.getSelectedAAS?.id ?? '')
</script>
