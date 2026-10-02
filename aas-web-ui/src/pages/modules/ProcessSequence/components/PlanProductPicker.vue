<template>
  <div class="mb-3">
    <div class="d-flex align-start ga-2">
      <v-autocomplete
        density="compact"
        :disabled="loading || selecting"
        hint="Products and assemblies with an IDTA Process Parameters Type submodel."
        item-title="name"
        item-value="id"
        :items="products"
        label="Product to plan"
        :loading="loading || selecting"
        :model-value="eligible ? selectedId : null"
        persistent-hint
        @update:model-value="selectProduct"
      />

      <v-btn
        aria-label="Refresh products"
        :disabled="loading || selecting"
        icon="mdi-refresh"
        variant="text"
        @click="refresh"
      />
    </div>

    <v-alert v-if="error" class="mt-2" density="compact" type="warning">{{ error }}</v-alert>
    <p v-if="!loading && products.length === 0" class="text-body-small mt-2">No products with the supported Process Parameters semantic ID were found.</p>
  </div>
</template>

<script setup lang="ts">
  import { useRoute, useRouter } from 'vue-router'
  import { useAASHandling } from '@/composables/AAS/AASHandling'
  import { useAASStore } from '@/store/AASDataStore'
  import { useInfrastructureStore } from '@/store/InfrastructureStore'
  import { usePlanSources } from '../composables/usePlanSources'

  const eligible = defineModel<boolean>({ default: false })
  const aasStore = useAASStore()
  const infrastructure = useInfrastructureStore()
  const router = useRouter()
  const route = useRoute()
  const { loadProducts } = usePlanSources()
  const { getAasEndpointById } = useAASHandling()
  const products = ref<{ id: string, name: string }[]>([])
  const loading = ref(false)
  const selecting = ref(false)
  const error = ref('')
  let generation = 0
  const selectedId = computed(() => String(aasStore.getSelectedAAS?.id ?? ''))

  watch([selectedId, products], () => {
    eligible.value = products.value.some(product => product.id === selectedId.value)
  }, { immediate: true })
  watch(() => [infrastructure.getSelectedInfrastructure?.id, infrastructure.getAASRepoURL, infrastructure.getSubmodelRepoURL], () => {
    products.value = []
    void refresh()
  }, { immediate: true })
  onBeforeUnmount(() => generation++)

  async function refresh (): Promise<void> {
    const ticket = ++generation
    loading.value = true
    error.value = ''
    try {
      const result = await loadProducts()
      if (ticket !== generation) {
        return
      }
      products.value = result.products.map(shell => ({ id: String(shell.id), name: String(shell.displayName?.find((label: { language: string }) => label.language === 'en')?.text || shell.idShort || shell.id) }))
      if (result.incomplete) {
        error.value = 'Some products could not be checked. Refresh to retry.'
      }
    } catch {
      if (ticket === generation) {
        error.value = 'Products could not be loaded. Check the infrastructure connection and refresh.'
      }
    } finally {
      if (ticket === generation) {
        loading.value = false
      }
    }
  }

  async function selectProduct (id: string): Promise<void> {
    if (!products.value.some(product => product.id === id)) {
      return
    }
    const ticket = generation
    selecting.value = true
    error.value = ''
    try {
      const endpoint = await getAasEndpointById(id)
      if (ticket === generation) {
        if (!endpoint) {
          throw new Error('Missing endpoint')
        }
        await router.push({ query: { ...route.query, aas: endpoint, path: undefined } })
      }
    } catch {
      if (ticket === generation) {
        error.value = 'The selected product could not be opened.'
      }
    } finally {
      selecting.value = false
    }
  }
</script>
