<template>
  <v-dialog v-model="open" max-width="720" :persistent="binding" scrollable>
    <v-card aria-label="Matching resources">
      <v-card-title class="d-flex align-center">
        Matching resources
        <v-spacer />

        <v-btn
          aria-label="Close matching resources"
          :disabled="binding"
          icon="mdi-close"
          size="small"
          variant="text"
          @click="open = false"
        />
      </v-card-title>

      <v-card-text>
        <p class="text-body-small mb-3">Choose one resource for this step. {{ suitable }} within declared limits.</p>
        <v-alert v-if="error" class="mb-3" density="compact" type="warning">{{ error }}</v-alert>
        <p v-if="visible.length === 0" class="text-body-small">No resources offer these capabilities.</p>

        <v-card
          v-for="match in visible"
          :key="match.aasId"
          :aria-label="resourceName(match.aasId)"
          border
          class="mb-3"
          rounded="lg"
          variant="flat"
        >
          <div class="d-flex align-center flex-wrap ga-2 pa-3">
            <span class="text-body-small font-weight-bold">{{ resourceName(match.aasId) }}</span>
            <v-chip :color="status[match.status].color" size="small">{{ status[match.status].title }}</v-chip>
            <v-spacer />

            <v-btn
              v-if="match.status === 'match'"
              :aria-label="`Use ${resourceName(match.aasId)}`"
              color="blue-darken-2"
              :disabled="binding"
              size="small"
              variant="flat"
              @click="emit('assign', match)"
            >Use resource</v-btn>
          </div>

          <v-expansion-panels v-if="match.reasons.length > 0" variant="accordion">
            <v-expansion-panel title="Comparison details">
              <v-expansion-panel-text>
                <p v-for="reason in match.reasons" :key="reason" class="text-body-small mb-1">{{ reason }}</p>
              </v-expansion-panel-text>
            </v-expansion-panel>
          </v-expansion-panels>
        </v-card>
      </v-card-text>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
  import type { CapabilityMatch } from '../utils/capabilityMatching'

  const props = defineProps<{ matches: CapabilityMatch[], resources: { id: string, name: string }[], binding: boolean, error: string }>()
  const emit = defineEmits<{ assign: [match: CapabilityMatch] }>()
  const open = defineModel<boolean>({ required: true })
  const status = {
    match: { title: 'Within declared limits', color: 'success' },
    unknown: { title: 'Needs verification', color: 'warning' },
    mismatch: { title: 'Outside requirements', color: 'error' },
  }
  const visible = computed(() => props.matches.filter(match => match.capabilities.length > 0).toSorted((a, b) => Number(b.status === 'match') - Number(a.status === 'match')))
  const suitable = computed(() => visible.value.filter(match => match.status === 'match').length)

  function resourceName (id: string): string {
    return props.resources.find(item => item.id === id)?.name ?? id
  }
</script>
