<template>
  <v-container class="pa-0" fluid>
    <SkillsOverview
      v-if="submodelElementData?.id && aasId"
      :aas-id="aasId"
      :path="submodelElementData.path"
      :submodel-id="submodelElementData.id"
    />
  </v-container>
</template>

<script lang="ts" setup>
  import SkillsOverview from '@/pages/modules/ProcessSequence/skills/SkillsOverview.vue'
  import { useAASStore } from '@/store/AASDataStore'

  // The Skills submodel of a resource (ARSO): an overview of its skills. A single skill, selected in
  // the tree, opens in the skill editor (SubmodelElements/ArsoSkill_v1_0.vue).
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
