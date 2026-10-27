<template>
  <v-container class="pa-0" fluid>
    <SkillEditor
      v-if="submodelId && aasId && submodelElementData?.idShort"
      :aas-id="aasId"
      :path="submodelElementData.path"
      :skill="submodelElementData.idShort"
      :submodel-id="submodelId"
    />
  </v-container>
</template>

<script lang="ts" setup>
  import SkillEditor from '@/pages/modules/ProcessSequence/skills/SkillEditor.vue'
  import { useAASStore } from '@/store/AASDataStore'
  import { base64Decode } from '@/utils/EncodeDecodeUtils'

  // One skill of a resource's Skills submodel (ARSO): the skill editor. Every skill element has
  // this semantic ID; what kind of skill it is, is a supplemental semantic ID.
  defineOptions({
    name: 'ArsoSkill',
    semanticId: 'https://smartproductionlab.aau.dk/skill',
  })

  const props = defineProps({
    submodelElementData: {
      type: Object as any,
      default: {} as any,
    },
  })

  const aasStore = useAASStore()

  const aasId = computed(() => aasStore.getSelectedAAS?.id ?? '')
  // The element's endpoint names its submodel: .../submodels/<base64url id>/submodel-elements/<path>.
  const submodelId = computed(() => {
    const encoded = String(props.submodelElementData?.path ?? '').split('/submodel-elements/', 1)[0]?.split('/submodels/', 2)[1]
    return encoded ? base64Decode(encoded) : ''
  })
</script>
