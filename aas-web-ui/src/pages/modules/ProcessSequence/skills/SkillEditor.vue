<template>
  <v-card>
    <v-card-title class="d-flex flex-wrap align-center ga-2">
      <span class="text-body-large">{{ skill }}</span>
      <v-chip v-if="owner" size="small" variant="outlined">{{ kindTitle[owner.kind] }}</v-chip>

      <v-chip
        v-if="owner && owner.kind === 'Composite'"
        :color="owner.deployment === 'Built' ? 'success' : 'info'"
        :prepend-icon="owner.deployment === 'Built' ? 'mdi-check-circle-outline' : 'mdi-wrench-clock'"
        size="small"
        variant="tonal"
      >{{ owner.deployment === 'Built' ? 'Built' : 'Described, not built' }}</v-chip>

      <v-spacer />

      <v-btn-toggle
        v-if="owner && owner.kind === 'Composite'"
        density="compact"
        mandatory
        :model-value="command"
        variant="outlined"
        @update:model-value="open($event)"
      >
        <v-btn size="small" value="Start">Start runs</v-btn>
        <v-btn size="small" value="Stop">Stop runs</v-btn>
      </v-btn-toggle>

      <v-btn
        v-if="owner && owner.kind === 'Composite'"
        prepend-icon="mdi-content-copy"
        size="small"
        variant="tonal"
        @click="naming = true"
      >New skill from this</v-btn>

      <v-btn
        v-if="owner && owner.kind !== 'Primitive'"
        color="primary"
        :disabled="!pending || issues.length > 0 || busy"
        :loading="busy"
        prepend-icon="mdi-content-save"
        size="small"
        @click="store"
      >Save</v-btn>
    </v-card-title>

    <v-card-text class="pa-0">
      <v-alert
        v-if="failure"
        class="ma-3"
        density="compact"
        :text="failure"
        type="error"
      />

      <v-alert
        v-for="issue in issues"
        :key="issue"
        class="mx-3 mb-2"
        density="compact"
        :text="issue"
        type="warning"
        variant="tonal"
      />

      <v-alert
        v-if="note"
        class="mx-3 mb-2"
        density="compact"
        :text="note"
        type="info"
        variant="tonal"
      />

      <v-alert
        v-if="offered"
        class="mx-3 mb-2"
        density="compact"
        :text="offered"
        type="success"
        variant="tonal"
      />

      <div v-if="owner && owner.kind === 'Primitive'" class="pa-3">
        <p class="text-body-2 mb-2">{{ owner.description }}</p>
        <p class="text-body-2 mb-1">Takes: {{ owner.inputs.map(parameterLine).join('; ') || 'nothing' }}</p>
        <p class="text-body-2 mb-1">Gives: {{ owner.outputs.map(item => item.idShort).join(', ') || 'nothing' }}</p>

        <p class="text-caption text-medium-emphasis">
          A building block: a block type of the module's program, run as a step of the module's skills. Changing it is a
          new FORTE build, not a change of the AAS.
        </p>
      </div>

      <v-row v-else-if="owner" no-gutters>
        <v-col cols="12" md="8">
          <SkillFlowGraph v-model="nodes" :label="`What ${command} of ${skill} runs`" :selected-id="selectedId" @select="selectedId = $event" />
        </v-col>

        <v-col class="border-s" cols="12" md="4">
          <SkillStepInspector
            v-if="step"
            :catalog="catalog"
            :command="command"
            :node="step"
            :owner="owner"
            :taken="taken"
          />

          <div v-else class="pa-3">
            <p class="text-body-2 mb-3">{{ owner.description }}</p>

            <div v-for="input in owner.inputs" :key="input.idShort" class="mb-3">
              <div class="text-body-2 mb-1">{{ input.idShort }}{{ input.unit ? ` (${input.unit})` : '' }}</div>

              <div class="d-flex ga-2">
                <v-text-field
                  v-for="item in limits"
                  :key="item.key"
                  density="compact"
                  hide-details
                  :label="item.label"
                  :model-value="input[item.key] ?? ''"
                  @change="parameter(input.idShort, item.change, ($event.target as HTMLInputElement).value)"
                />
              </div>
            </div>

            <p class="text-caption text-medium-emphasis">Select a step to say which skill of a component it runs and what it is handed.</p>
          </div>
        </v-col>
      </v-row>
    </v-card-text>

    <v-dialog v-model="naming" max-width="420">
      <v-card title="New skill">
        <v-card-text>
          <v-text-field
            v-model="name"
            autofocus
            hint="Letters, digits and _; it becomes the name in the control program"
            label="Name"
            persistent-hint
          />
        </v-card-text>

        <v-card-actions>
          <v-spacer />
          <v-btn @click="naming = false">Cancel</v-btn>
          <v-btn color="primary" :disabled="!name || busy" :loading="busy" @click="create">Create</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-card>
</template>

<script setup lang="ts">
  import type { PlanNode, StepNode } from '../types/plan'
  import type { AasElement } from '../utils/sequenceModel'
  import type { ResourceSkill, SkillCommand } from './skillFlow'
  import { useRoute, useRouter } from 'vue-router'
  import { flattenNodes } from '../utils/plan'
  import { flowIssues, readFlow, readSkills, withFlow, withNewSkill, withParameter } from './skillFlow'
  import SkillFlowGraph from './SkillFlowGraph.vue'
  import { parameterLine } from './skillOverview'
  import { deriveCapabilities, derivedLines } from './skillService'
  import SkillStepInspector from './SkillStepInspector.vue'
  import { useSkillRepository } from './useSkillRepository'

  /** One skill of a module's Skills submodel: ``skill`` in the submodel ``submodelId``; ``path``: its element's endpoint. */
  const props = defineProps<{ submodelId: string, aasId: string, skill: string, path?: string }>()

  const route = useRoute()
  const router = useRouter()
  const { loadSkills, loadComponentSkills, saveSkill } = useSkillRepository()
  const limits = [
    { key: 'defaultValue', label: 'default', change: 'defaultValue' }, { key: 'minValue', label: 'from', change: 'minValue' },
    { key: 'maxValue', label: 'to', change: 'maxValue' },
  ] as const
  const kindTitle = { Composite: 'Module level skill', Primitive: 'Building block', ModuleControl: 'The module itself' }

  const model = ref<AasElement | null>(null)
  /** The steps as they were shown, and whether the working copy differs from what is saved. */
  const shown = ref('[]')
  const touched = ref(false)
  const components = ref<ResourceSkill[]>([])
  const command = ref<SkillCommand>('Start')
  const nodes = ref<PlanNode[]>([])
  const selectedId = ref('')
  const naming = ref(false)
  const name = ref('')
  const busy = ref(false)
  const failure = ref('')
  const offered = ref('')
  const loaded = ref(false)

  const own = computed(() => (model.value ? readSkills(model.value, props.aasId) : []))
  const catalog = computed(() => [...own.value, ...components.value])
  const owner = computed(() => own.value.find(item => item.idShort === props.skill))
  const step = computed(() => flattenNodes(nodes.value).find(node => node.id === selectedId.value && node.kind === 'step') as StepNode | undefined)
  const taken = computed(() => flattenNodes(nodes.value).map(node => node.id))
  // Only once the components' skills are known: before, every step would run an unknown skill.
  const issues = computed(() => (loaded.value && owner.value?.kind !== 'Primitive' ? flowIssues(nodes.value, owner.value, catalog.value, command.value) : []))
  const edited = computed(() => JSON.stringify(nodes.value) !== shown.value)
  /** The submodel with the steps on screen in it. Steps that were not edited are left as they are. */
  const applied = computed(() => {
    if (!model.value || !owner.value || !edited.value || issues.value.length > 0) return model.value
    return withFlow(model.value, props.skill, command.value, nodes.value, catalog.value)
  })
  const pending = computed(() => touched.value || edited.value)
  const note = computed(() => {
    if (owner.value?.kind === 'ModuleControl') return 'What the module runs itself. A change here needs a restart of its control program.'
    if (owner.value?.kind === 'Composite') {
      return owner.value.deployment === 'Built'
        ? 'Saved changes reach the running module by modsync reconfigure: changed values online, a changed order of steps by a restart.'
        : 'Described, not built: modsync reconfigure builds it online. Until then the module offers it after a reconfiguration.'
    }
    return ''
  })

  watch(() => [props.submodelId, props.aasId, props.skill], load, { immediate: true })

  async function load (): Promise<void> {
    failure.value = ''
    offered.value = ''
    loaded.value = false
    try {
      model.value = await loadSkills(props.submodelId, props.aasId)
      touched.value = false
      show('Start')
      components.value = await loadComponentSkills(props.aasId)
      loaded.value = true
    } catch (error) {
      failure.value = error instanceof Error ? error.message : String(error)
    }
  }

  function show (which: SkillCommand): void {
    command.value = which
    selectedId.value = ''
    try {
      nodes.value = model.value && owner.value && owner.value.flows.includes(which) ? readFlow(model.value, props.skill, which) : []
    } catch (error) {
      nodes.value = []
      failure.value = error instanceof Error ? error.message : String(error)
    }
    shown.value = JSON.stringify(nodes.value)
  }

  /** Take the steps on screen into the working copy. */
  function keep (): void {
    if (edited.value) {
      model.value = applied.value
      touched.value = true
      shown.value = JSON.stringify(nodes.value)
    }
  }

  /** Keep what is on screen in the working copy before the other command is shown. */
  function open (which: SkillCommand): void {
    if (issues.value.length > 0) return
    keep()
    show(which)
  }

  function parameter (parameterName: string, key: 'defaultValue' | 'minValue' | 'maxValue', text: string): void {
    if (!model.value || issues.value.length > 0) return
    keep()
    model.value = withParameter(model.value, props.skill, parameterName, { [key]: text.trim() })
    touched.value = true
  }

  /** Ask the skill service what the module offers now; a failure to reach it is said, not raised. */
  async function derive (): Promise<void> {
    try {
      offered.value = `The module offers: ${derivedLines(await deriveCapabilities(props.aasId)).join('; ')}.`
    } catch (error) {
      offered.value = ''
      failure.value = `Saved, but the capabilities were not derived anew. ${error instanceof Error ? error.message : String(error)}`
    }
  }

  async function create (): Promise<void> {
    if (!model.value || issues.value.length > 0) return
    busy.value = true
    failure.value = ''
    try {
      keep()
      const made = withNewSkill(model.value, props.skill, name.value.trim())
      await saveSkill(made, name.value.trim(), props.aasId, true)
      naming.value = false
      await derive()
      if (props.path) {
        // The new skill's element: a sibling of this one.
        const at = `${props.path.slice(0, props.path.lastIndexOf('/'))}/${name.value.trim()}`
        router.push({ query: { ...route.query, path: at } })
      }
      name.value = ''
    } catch (error) {
      failure.value = error instanceof Error ? error.message : String(error)
    } finally {
      busy.value = false
    }
  }

  async function store (): Promise<void> {
    if (!model.value || issues.value.length > 0) return
    busy.value = true
    failure.value = ''
    try {
      keep()
      // eslint-disable-next-line unicorn/prefer-structured-clone -- plain JSON: nested reactive proxies cannot be cloned
      await saveSkill(JSON.parse(JSON.stringify(model.value)), props.skill, props.aasId)
      touched.value = false
      await derive()
    } catch (error) {
      failure.value = error instanceof Error ? error.message : String(error)
    } finally {
      busy.value = false
    }
  }
</script>
