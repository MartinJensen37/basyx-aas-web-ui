<template>
  <v-card>
    <v-card-title class="d-flex flex-wrap align-center ga-2">
      <span class="text-body-large">Skills as flows</span>
      <v-spacer />

      <v-select
        density="compact"
        hide-details
        item-title="title"
        item-value="value"
        :items="choices"
        label="Skill"
        :model-value="current"
        style="max-width: 280px"
        @update:model-value="open($event, 'Start')"
      />

      <v-btn-toggle
        v-if="owner && owner.kind === 'Composite'"
        density="compact"
        mandatory
        :model-value="command"
        variant="outlined"
        @update:model-value="open(current, $event)"
      >
        <v-btn size="small" value="Start">Start runs</v-btn>
        <v-btn size="small" value="Stop">Stop runs</v-btn>
      </v-btn-toggle>

      <v-btn
        :disabled="!owner || owner.kind !== 'Composite'"
        prepend-icon="mdi-content-copy"
        size="small"
        variant="tonal"
        @click="naming = true"
      >New skill from this</v-btn>

      <v-btn
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

      <v-row v-if="owner" no-gutters>
        <v-col cols="12" md="8">
          <SkillFlowGraph v-model="nodes" :label="`What ${command} of ${current} runs`" :selected-id="selectedId" @select="selectedId = $event" />
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
            <div class="text-subtitle-2 mb-1">{{ current }}</div>
            <p class="text-body-2 mb-3">{{ owner.description }}</p>

            <div v-for="input in owner.inputs" :key="input.idShort" class="d-flex ga-2 mb-2">
              <v-text-field
                v-for="item in limits"
                :key="item.key"
                density="compact"
                hide-details
                :label="`${input.idShort} ${item.label}${input.unit ? ` (${input.unit})` : ''}`"
                :model-value="input[item.key] ?? ''"
                @change="parameter(input.idShort, item.change, ($event.target as HTMLInputElement).value)"
              />
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
          <v-btn color="primary" :disabled="!name" @click="create">Create</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-card>
</template>

<script setup lang="ts">
  import type { PlanNode, StepNode } from '../types/plan'
  import type { AasElement } from '../utils/sequenceModel'
  import type { ResourceSkill, SkillCommand } from './skillFlow'
  import { flattenNodes } from '../utils/plan'
  import { flowIssues, readFlow, readSkills, withFlow, withNewSkill, withParameter } from './skillFlow'
  import SkillFlowGraph from './SkillFlowGraph.vue'
  import SkillStepInspector from './SkillStepInspector.vue'
  import { useSkillRepository } from './useSkillRepository'

  const props = defineProps<{ submodelId: string, aasId: string }>()

  const { loadSkills, loadComponentSkills, save } = useSkillRepository()
  const limits = [
    { key: 'defaultValue', label: 'default', change: 'defaultValue' }, { key: 'minValue', label: 'from', change: 'minValue' },
    { key: 'maxValue', label: 'to', change: 'maxValue' },
  ] as const

  const model = ref<AasElement | null>(null)
  /** The steps as they were shown, and whether the working copy differs from what is saved. */
  const shown = ref('[]')
  const touched = ref(false)
  const components = ref<ResourceSkill[]>([])
  const current = ref('')
  const command = ref<SkillCommand>('Start')
  const nodes = ref<PlanNode[]>([])
  const selectedId = ref('')
  const naming = ref(false)
  const name = ref('')
  const busy = ref(false)
  const failure = ref('')

  const own = computed(() => (model.value ? readSkills(model.value, props.aasId) : []))
  const catalog = computed(() => [...own.value, ...components.value])
  const owner = computed(() => own.value.find(skill => skill.idShort === current.value))
  const choices = computed(() => own.value.filter(skill => skill.kind === 'Composite' || skill.flows.length > 0).map(skill => ({
    value: skill.idShort, title: skill.kind === 'ModuleControl' ? `${skill.idShort} (the module itself)` : skill.idShort,
  })))
  const step = computed(() => flattenNodes(nodes.value).find(node => node.id === selectedId.value && node.kind === 'step') as StepNode | undefined)
  const taken = computed(() => flattenNodes(nodes.value).map(node => node.id))
  const issues = computed(() => flowIssues(nodes.value, owner.value, catalog.value, command.value))
  const edited = computed(() => JSON.stringify(nodes.value) !== shown.value)
  /** The submodel with the steps on screen in it. Steps that were not edited are left as they are. */
  const applied = computed(() => {
    if (!model.value || !owner.value || !edited.value || issues.value.length > 0) return model.value
    return withFlow(model.value, current.value, command.value, nodes.value, catalog.value)
  })
  const pending = computed(() => touched.value || edited.value)
  const note = computed(() => {
    if (owner.value?.kind === 'ModuleControl') return 'What the module runs itself. A change here needs a restart of its control program.'
    return owner.value && own.value.length > 0 ? 'Saved skills are brought to the running module by modsync reconfigure: a new skill and changed values online, a changed order of steps by a restart.' : ''
  })

  watch(() => [props.submodelId, props.aasId], load, { immediate: true })

  async function load (): Promise<void> {
    failure.value = ''
    try {
      model.value = await loadSkills(props.submodelId, props.aasId)
      touched.value = false
      components.value = await loadComponentSkills(props.aasId)
      show(choices.value.find(choice => choice.value === current.value)?.value ?? choices.value[0]?.value ?? '', 'Start')
    } catch (error) {
      failure.value = error instanceof Error ? error.message : String(error)
    }
  }

  function show (skill: string, which: SkillCommand): void {
    current.value = skill
    command.value = which
    selectedId.value = ''
    try {
      nodes.value = model.value && skill ? readFlow(model.value, skill, which) : []
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

  /** Keep what is on screen in the working copy before something else is shown. */
  function open (skill: string, which: SkillCommand): void {
    if (issues.value.length > 0) return
    keep()
    show(skill, which)
  }

  function parameter (parameterName: string, key: 'defaultValue' | 'minValue' | 'maxValue', text: string): void {
    if (!model.value || issues.value.length > 0) return
    keep()
    model.value = withParameter(model.value, current.value, parameterName, { [key]: text.trim() })
    touched.value = true
  }

  function create (): void {
    failure.value = ''
    try {
      if (!model.value || issues.value.length > 0) return
      keep()
      model.value = withNewSkill(model.value, current.value, name.value.trim())
      touched.value = true
      show(name.value.trim(), 'Start')
      naming.value = false
      name.value = ''
    } catch (error) {
      failure.value = error instanceof Error ? error.message : String(error)
    }
  }

  async function store (): Promise<void> {
    if (!model.value || issues.value.length > 0) return
    busy.value = true
    failure.value = ''
    try {
      keep()
      // eslint-disable-next-line unicorn/prefer-structured-clone -- plain JSON: nested reactive proxies cannot be cloned
      await save(JSON.parse(JSON.stringify(model.value)), props.aasId)
      touched.value = false
    } catch (error) {
      failure.value = error instanceof Error ? error.message : String(error)
    } finally {
      busy.value = false
    }
  }
</script>
