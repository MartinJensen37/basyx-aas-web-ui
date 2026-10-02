<template>
  <section aria-label="Capability requirements" class="mb-4">
    <v-select
      chips
      closable-chips
      density="compact"
      item-title="title"
      item-value="key"
      :items="options"
      label="Required capabilities"
      :loading="loading"
      :model-value="requirements.map(item => referenceKey(item.reference))"
      multiple
      @update:model-value="setRequirements"
    />

    <p class="text-caption">{{ node.requiredCapabilities === undefined ? 'Inherited from the linked process.' : 'Requirements for this step in the plan.' }}</p>

    <v-btn
      v-if="node.requiredCapabilities !== undefined"
      class="mt-1"
      size="small"
      variant="text"
      @click="delete node.requiredCapabilities"
    >Use process requirements</v-btn>

    <v-alert v-if="error" class="mt-2" density="compact" type="warning">{{ error }}</v-alert>
    <v-btn v-if="error" size="small" variant="text" @click="refresh">Retry capability catalog</v-btn>

    <div v-for="requirement in requirements" :key="referenceKey(requirement.reference)" class="text-caption mt-2 text-break">
      <strong>{{ requirement.name }}</strong>
      <div>{{ requirement.reference.keys.map(key => key.value).join(' / ') }}</div>
      <div v-if="!resolved(requirement)">Reference unresolved in the current catalog; kept in the draft.</div>
    </div>

    <div v-if="requirements.length > 0 && !loading" class="mt-3">
      <div class="text-body-small">Semantic resource candidates: {{ candidates.map(id => resources.find(resource => resource.id === id)?.name ?? id).join(', ') || 'None found' }}</div>
      <p class="text-caption text-medium-emphasis mt-1">Checks declared meanings, values, ranges and units. Additional constraints and station availability are separate checks.</p>
      <p v-if="node.resourceAasId && !candidates.includes(node.resourceAasId)" class="text-caption mt-1">The assigned resource is not a semantic candidate for all requirements.</p>

      <v-expansion-panels class="mt-2" variant="accordion">
        <v-expansion-panel v-for="match in matches.filter(item => item.capabilities.length > 0)" :key="match.aasId" :title="`${resourceName(match.aasId)} — ${match.status === 'match' ? 'Within declared limits' : match.status === 'mismatch' ? 'Outside requirements' : 'Needs verification'}`">
          <v-expansion-panel-text>
            <p v-for="reason in match.reasons" :key="reason" class="text-caption mb-1">{{ reason }}</p>

            <v-btn
              v-if="match.status === 'match'"
              :loading="binding"
              size="small"
              variant="tonal"
              @click="assign(match)"
            >Use matching station skill</v-btn>
          </v-expansion-panel-text>
        </v-expansion-panel>
      </v-expansion-panels>
    </div>
  </section>
</template>

<script setup lang="ts">
  import type { CapabilityRequirement, StepNode } from '../types/plan'
  import type { CapabilityDescription } from '../utils/capabilities'
  import type { CapabilityMatch } from '../utils/capabilityMatching'
  import { useAASStore } from '@/store/AASDataStore'
  import { usePlanSources } from '../composables/usePlanSources'
  import { referenceKey } from '../utils/capabilities'
  import { matchCapabilities } from '../utils/capabilityMatching'

  const props = defineProps<{ resources: { id: string, name: string }[], inherited: CapabilityRequirement[] }>()
  const node = defineModel<StepNode>({ required: true })
  const aasStore = useAASStore()
  const { loadCapabilities, loadSkills } = usePlanSources()
  const catalog = ref<CapabilityDescription[]>([])
  const loading = ref(false)
  const error = ref('')
  const binding = ref(false)
  let generation = 0
  const requirements = computed(() => node.value.requiredCapabilities ?? props.inherited)
  const matches = computed(() => matchCapabilities(requirements.value, catalog.value))
  const candidates = computed(() => matches.value.filter(item => item.status === 'match').map(item => item.aasId))
  const owners = computed(() => [...new Set([String(aasStore.getSelectedAAS?.id ?? ''), node.value.process?.source.aasId ?? '', ...props.resources.map(resource => resource.id)])].filter(Boolean))
  const options = computed(() => {
    const selected = new Map(requirements.value.map(item => [referenceKey(item.reference), item]))
    const requiredOwners = new Set([String(aasStore.getSelectedAAS?.id ?? ''), node.value.process?.source.aasId])
    for (const item of catalog.value.filter(item => item.role === 'Required' && requiredOwners.has(item.aasId))) {
      selected.set(referenceKey(item.reference), item)
    }
    return [...selected].map(([key, item]) => ({ ...item, key, title: `${item.name} (${item.reference.keys[0].value.split('/').slice(-2).join('/')})` }))
  })

  watch(owners, refresh, { immediate: true })
  onBeforeUnmount(() => generation++)

  function resolved (requirement: CapabilityRequirement): boolean {
    return requirement.reference.type === 'ExternalReference'
      || catalog.value.some(item => referenceKey(item.reference) === referenceKey(requirement.reference))
  }

  function resourceName (id: string): string {
    return props.resources.find(item => item.id === id)?.name ?? id
  }

  async function assign (match: CapabilityMatch): Promise<void> {
    const selectedNode = node.value
    binding.value = true
    error.value = ''
    try {
      const skills = await loadSkills(match.aasId)
      if (node.value !== selectedNode) return
      const skill = skills.find(skill => skill.reference && match.capabilities.every(capability => capability.realizedBy.some(reference => referenceKey(reference) === referenceKey(skill.reference!))))
      if (!skill) {
        error.value = 'No single skill is linked to all matching capabilities. Select and verify a skill explicitly.'
        return
      }
      node.value.resourceAasId = match.aasId
      node.value.skillId = skill.idShort
      node.value.skillReference = skill.reference
      node.value.executionMode = 'station'
      node.value.bindings = skill.parameters.map(parameter => {
        const source = node.value.process?.parameters.find(item => item.name === parameter.name || item.name === parameter.idShort)
        return { name: parameter.idShort, value: source ? '' : String(parameter.defaultValue ?? ''), source: source?.source ?? null }
      })
    } catch {
      error.value = 'The station skill could not be loaded.'
    } finally {
      binding.value = false
    }
  }

  function setRequirements (keys: string[]): void {
    node.value.requiredCapabilities = keys.flatMap(key => {
      const item = options.value.find(item => item.key === key)
      return item ? [{ name: item.name, reference: structuredClone(toRaw(item.reference)) }] : []
    })
  }

  async function refresh (): Promise<void> {
    const ticket = ++generation
    loading.value = true
    error.value = ''
    const results = await Promise.allSettled(owners.value.map(id => loadCapabilities(id)))
    if (ticket !== generation) {
      return
    }
    catalog.value = results.flatMap(result => result.status === 'fulfilled' ? result.value : [])
    if (results.some(result => result.status === 'rejected')) {
      error.value = 'Some capability descriptions could not be loaded. Candidate results may be incomplete.'
    }
    loading.value = false
  }
</script>
