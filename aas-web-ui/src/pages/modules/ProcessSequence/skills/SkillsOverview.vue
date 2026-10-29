<template>
  <v-card>
    <v-card-title class="d-flex flex-wrap align-center ga-2">
      <span class="text-body-large">Skills of {{ shellName(aasId) }}</span>

      <v-chip v-if="view?.ruleSet" prepend-icon="mdi-file-certificate-outline" size="small" variant="tonal">
        {{ view.ruleSet.split('/').slice(-2).join(' ') }}
      </v-chip>

      <v-spacer />

      <v-btn
        :disabled="!view || view.composites.length === 0"
        prepend-icon="mdi-plus"
        size="small"
        variant="tonal"
        @click="naming = true"
      >New skill</v-btn>

      <v-btn
        :disabled="!view || capabilities.length === 0"
        prepend-icon="mdi-auto-fix"
        size="small"
        variant="tonal"
        @click="openPlanning"
      >Plan a skill</v-btn>

      <v-menu :close-on-content-click="false">
        <template #activator="{ props: activator }">
          <v-btn
            v-bind="activator"
            aria-label="Settings"
            icon="mdi-cog-outline"
            size="small"
            variant="text"
          />
        </template>

        <v-card class="pa-3" min-width="360">
          <v-text-field
            v-model="service"
            density="compact"
            hint="modreg serve: derives what the module offers after a skill is saved"
            label="Skill service"
            persistent-hint
            @change="setSkillServiceUrl(service)"
          />
        </v-card>
      </v-menu>
    </v-card-title>

    <v-card-text>
      <v-alert
        v-if="failure"
        class="mb-3"
        density="compact"
        :text="failure"
        type="error"
      />

      <v-alert
        v-if="note"
        class="mb-3"
        density="compact"
        :text="note"
        type="info"
        variant="tonal"
      />

      <v-progress-linear v-if="!view && !failure" indeterminate />

      <template v-if="view">
        <div class="text-subtitle-2 mb-1">The module's skills</div>

        <p class="text-body-small text-medium-emphasis mb-2">
          Made of its components' skills; select one in the tree, or here, to edit it.
        </p>

        <v-table class="mb-4" density="compact">
          <thead>
            <tr>
              <th>Skill</th>
              <th>Runs</th>
              <th>Takes</th>
              <th>Gives</th>
              <th>Offers</th>
              <th />
            </tr>
          </thead>

          <tbody>
            <tr v-for="skill in view.composites" :key="skill.idShort">
              <td>
                <a class="skill-link" href="#" @click.prevent="open(skill.idShort)">{{ skill.idShort }}</a>
                <div class="text-caption text-medium-emphasis">{{ skill.description }}</div>
              </td>

              <td class="text-caption">
                <div v-for="(steps, command) in skill.runs" :key="command">{{ command }}: {{ (steps ?? []).join(' → ') }}</div>
              </td>

              <td class="text-caption">
                <div v-for="item in skill.inputs" :key="item.idShort">{{ parameterLine(item) }}</div>
              </td>

              <td class="text-caption">
                <div v-for="item in skill.outputs" :key="item.idShort">{{ item.idShort }}{{ item.unit ? ` (${item.unit})` : '' }}</div>
              </td>

              <td class="text-caption">
                <div v-for="offer in skill.offers" :key="offer.name">
                  {{ offer.name }}{{ offer.properties.length > 0 ? `: ${offer.properties.join(', ')}` : '' }}
                  <span v-if="offer.availability === 'AfterReconfiguration'" class="text-info">(after a reconfiguration)</span>
                </div>

                <span v-if="skill.offers.length === 0" class="text-medium-emphasis">–</span>
              </td>

              <td>
                <v-chip
                  :color="skill.deployment === 'Built' ? 'success' : 'info'"
                  :prepend-icon="skill.deployment === 'Built' ? 'mdi-check-circle-outline' : 'mdi-wrench-clock'"
                  size="small"
                  variant="tonal"
                >{{ skill.deployment === 'Built' ? 'Built' : 'Described' }}</v-chip>
              </td>
            </tr>
          </tbody>
        </v-table>

        <div class="text-subtitle-2 mb-1">Building blocks: the components' skills</div>

        <p class="text-body-small text-medium-emphasis mb-2">
          Block types of the module's program. A new one is a new FORTE build, not a change of the AAS.
        </p>

        <v-expansion-panels class="mb-4" multiple variant="accordion">
          <v-expansion-panel v-for="component in view.components" :key="component.aasId">
            <v-expansion-panel-title>
              {{ component.name }}
              <span class="text-caption text-medium-emphasis ms-2">{{ component.skills.map(skill => skill.idShort).join(', ') }}</span>
            </v-expansion-panel-title>

            <v-expansion-panel-text>
              <v-table density="compact">
                <tbody>
                  <tr v-for="skill in component.skills" :key="skill.idShort">
                    <td class="font-weight-medium">{{ skill.idShort }}</td>
                    <td class="text-caption">{{ skill.inputs.map(parameterLine).join('; ') || 'no parameters' }}</td>
                    <td class="text-caption">{{ skill.outputs.map(item => item.idShort).join(', ') }}</td>
                    <td class="text-caption">{{ skill.usedBy.length > 0 ? `used by ${skill.usedBy.join(', ')}` : 'not used by a skill of the module' }}</td>
                  </tr>
                </tbody>
              </v-table>
            </v-expansion-panel-text>
          </v-expansion-panel>
        </v-expansion-panels>

        <div class="text-subtitle-2 mb-1">The module itself</div>

        <p class="text-body-small">
          <span v-for="(skill, index) in view.control" :key="skill.idShort">
            <a v-if="skill.flows.length > 0" class="skill-link" href="#" @click.prevent="open(skill.idShort)">{{ skill.idShort }}</a>
            <span v-else>{{ skill.idShort }}</span>
            <span v-if="skill.runs.Start" class="text-caption text-medium-emphasis"> ({{ skill.runs.Start.join(' → ') }})</span>{{ index < view.control.length - 1 ? ', ' : '' }}
          </span>
        </p>
      </template>
    </v-card-text>

    <v-dialog v-model="naming" max-width="440">
      <v-card title="New skill">
        <v-card-text>
          <v-select
            v-model="from"
            density="compact"
            item-title="idShort"
            item-value="idShort"
            :items="view?.composites ?? []"
            label="Made like"
          />

          <v-text-field
            v-model="name"
            autofocus
            hint="Letters, digits and _; it becomes the name in the control program. Described, not built: modsync reconfigure builds it."
            label="Name"
            persistent-hint
          />
        </v-card-text>

        <v-card-actions>
          <v-spacer />
          <v-btn @click="naming = false">Cancel</v-btn>
          <v-btn color="primary" :disabled="!name || !from || busy" :loading="busy" @click="create">Create</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="planning" max-width="520">
      <v-card title="Plan a skill">
        <v-card-text>
          <p class="text-body-small text-medium-emphasis mb-3">
            The planner (modreg serve) composes a module level skill of the components' skills that gives the capability with these values.
          </p>

          <v-select
            v-model="capability"
            density="compact"
            :items="capabilityNames"
            label="Capability"
          />

          <v-text-field
            v-for="property in ranges"
            :key="property.name"
            v-model="values[property.name]"
            density="compact"
            :hint="`${property.min} to ${property.max}${property.unit ? ` ${property.unit}` : ''}`"
            :label="property.name"
            persistent-hint
            type="number"
          />

          <v-combobox
            v-model="results"
            chips
            class="mt-2"
            density="compact"
            hint="What the skill reports when it is done, e.g. FillWeight"
            :items="resultNames"
            label="Results"
            multiple
            persistent-hint
          />

          <v-text-field
            v-model="plannedName"
            class="mt-2"
            density="compact"
            hint="Letters, digits and _; empty: the planner names it"
            label="Name"
            persistent-hint
          />

          <v-alert
            v-if="planFailure"
            class="mt-3"
            density="compact"
            :text="planFailure"
            type="error"
          />

          <div v-if="planned" class="mt-3">
            <div class="text-subtitle-2">Steps</div>

            <ol class="text-body-2 ms-5">
              <li v-for="(step, index) in planned.steps" :key="index">{{ stepLine(step) }}</li>
            </ol>
          </div>
        </v-card-text>

        <v-card-actions>
          <v-spacer />
          <v-btn @click="planning = false">Cancel</v-btn>
          <v-btn :disabled="!capability || busy" :loading="busy" @click="plan(false)">Plan</v-btn>
          <v-btn color="primary" :disabled="!capability || busy" :loading="busy" @click="plan(true)">Plan and describe</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-card>
</template>

<script setup lang="ts">
  import type { CapabilityDescription } from '../utils/capabilities'
  import type { AasElement } from '../utils/sequenceModel'
  import type { SkillsOverview } from './skillOverview'
  import type { Planned, PlannedStep } from './skillService'
  import { useRoute, useRouter } from 'vue-router'
  import { skillPath, withNewSkill } from './skillFlow'
  import { overview, parameterLine, shellName } from './skillOverview'
  import { deriveCapabilities, derivedLines, planSkill, setSkillServiceUrl, skillServiceUrl } from './skillService'
  import { useSkillRepository } from './useSkillRepository'

  const props = defineProps<{ submodelId: string, aasId: string, path?: string }>()

  const route = useRoute()
  const router = useRouter()
  const { loadSkills, loadComponentSkills, loadCapabilities, saveSkill } = useSkillRepository()

  const model = ref<AasElement | null>(null)
  const view = ref<SkillsOverview | null>(null)
  const failure = ref('')
  const note = ref('')
  const naming = ref(false)
  const from = ref('')
  const name = ref('')
  const busy = ref(false)
  const service = ref(skillServiceUrl())
  /** The capabilities the module offers: what a skill can be planned for. */
  const capabilities = ref<CapabilityDescription[]>([])
  const planning = ref(false)
  const capability = ref('')
  const values = ref<Record<string, string>>({})
  const results = ref<string[]>([])
  const plannedName = ref('')
  const planned = ref<Planned | null>(null)
  const planFailure = ref('')
  const capabilityNames = computed(() => [...new Set(capabilities.value.map(item => item.name))])
  const chosen = computed(() => capabilities.value.find(item => item.name === capability.value))
  /** The values the capability is given (its ranges), and what it may report (its other properties). */
  const ranges = computed(() => (chosen.value?.properties ?? []).filter(property => property.kind === 'range'))
  const resultNames = computed(() => (chosen.value?.properties ?? []).filter(property => property.kind !== 'range').map(property => property.name))

  watch(() => [props.submodelId, props.aasId], load, { immediate: true })

  async function load (): Promise<void> {
    failure.value = ''
    try {
      model.value = await loadSkills(props.submodelId, props.aasId)
      const [components, found] = await Promise.all([loadComponentSkills(props.aasId), loadCapabilities(props.aasId)])
      view.value = overview(model.value, props.aasId, components, found)
      capabilities.value = found
      from.value = view.value.composites[0]?.idShort ?? ''
    } catch (error) {
      failure.value = error instanceof Error ? error.message : String(error)
    }
  }

  /** Select the skill in the tree: its element opens the skill editor. */
  function open (skill: string): void {
    if (!model.value || !props.path) return
    router.push({ query: { ...route.query, path: `${props.path}/submodel-elements/${skillPath(model.value, skill)}` } })
  }

  function openPlanning (): void {
    capability.value = capability.value || capabilityNames.value[0] || ''
    planned.value = null
    planFailure.value = ''
    planning.value = true
  }

  function stepLine (step: PlannedStep): string {
    const args = Object.entries(step.args).map(([key, value]) => `${key} = ${value}`).join(', ')
    return `${step.skill} (${step.component})${args ? `: ${args}` : ''}`
  }

  /** Have the planner compose a skill for the capability; with ``write`` it is described on the AAS server and opened. */
  async function plan (write: boolean): Promise<void> {
    busy.value = true
    planFailure.value = ''
    planned.value = null
    try {
      const given = Object.fromEntries(Object.entries(values.value)
        .filter(([, text]) => String(text).trim() !== '')
        .map(([key, text]) => [key, Number(text)]))
      planned.value = await planSkill(props.aasId, {
        capability: capability.value, values: given, results: results.value, name: plannedName.value.trim() || undefined, write,
      })
      if (write && planned.value.name) {
        const made = planned.value.name
        planning.value = false
        await load()
        note.value = `${made} is planned and described; modsync reconfigure builds it.`
        open(made)
      }
    } catch (error) {
      planFailure.value = error instanceof Error ? error.message : String(error)
    } finally {
      busy.value = false
    }
  }

  async function create (): Promise<void> {
    if (!model.value) return
    busy.value = true
    failure.value = ''
    try {
      const made = withNewSkill(model.value, from.value, name.value.trim())
      await saveSkill(made, name.value.trim(), props.aasId, true)
      model.value = made
      naming.value = false
      note.value = `${name.value.trim()} is described like ${from.value}; edit it, then modsync reconfigure builds it.`
      try {
        note.value += ` The module offers: ${derivedLines(await deriveCapabilities(props.aasId)).join('; ')}.`
      } catch (error) {
        note.value += ` ${error instanceof Error ? error.message : String(error)}`
      }
      open(name.value.trim())
      name.value = ''
    } catch (error) {
      failure.value = error instanceof Error ? error.message : String(error)
    } finally {
      busy.value = false
    }
  }
</script>

<style scoped>
  .skill-link {
    font-weight: 500;
    text-decoration: none;
  }
</style>
