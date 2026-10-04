import type { PlanNode, PlanProcess, ProcessPlan } from '../types/plan'
import { v4 } from 'uuid'
import { useAASStore } from '@/store/AASDataStore'
import { useInfrastructureStore } from '@/store/InfrastructureStore'
import { canCall, flattenNodes, parsePlan, planningNotes } from '../utils/plan'
import { createPlanHierarchy } from '../utils/planHierarchy'
import { usePlanRepository } from './usePlanRepository'
import { usePlanSources } from './usePlanSources'

export function usePlanWorkspace () {
  const aasStore = useAASStore()
  const infrastructure = useInfrastructureStore()
  const sources = usePlanSources()
  let hierarchy = createPlanHierarchy(usePlanRepository(), sources)
  const plan = ref<ProcessPlan>()
  const selectedScopeId = ref('product')
  const selectedNodeId = ref('')
  const loading = ref(false)
  const saving = ref(false)
  const error = ref('')
  const message = ref('')
  const savedContent = ref('')
  const resources = ref<{ id: string, name: string }[]>([])
  const availableProcesses = ref<PlanProcess[]>([])
  let generation = 0
  let storageKey = ''

  const product = computed(() => aasStore.getSelectedAAS)
  const scope = computed(() => plan.value?.scopes.find(item => item.id === selectedScopeId.value))
  const dirty = computed(() => !!plan.value && (hierarchy.hasUnsavedDefinitions() || JSON.stringify(plan.value) !== savedContent.value))
  const selectedNode = computed({
    get: () => flattenNodes(scope.value?.nodes ?? []).find(node => node.id === selectedNodeId.value),
    set: (next: PlanNode | undefined) => {
      const existing = flattenNodes(scope.value?.nodes ?? []).find(node => node.id === next?.id)
      if (existing && next) {
        Object.assign(existing, next)
      }
    },
  })
  const targets = computed(() => plan.value?.scopes.filter(item => hierarchy.canTarget(selectedScopeId.value, item.id)
    && canCall(plan.value!, selectedScopeId.value, item.id)) ?? [])
  const notes = computed(() => plan.value ? planningNotes(plan.value) : [])
  const ownerName = computed(() => {
    if (!scope.value) {
      return ''
    }
    const id = hierarchy.owner(scope.value.id)
    return resources.value.find(item => item.id === id)?.name ?? plan.value?.scopes.find(scope => scope.planAasId === id)?.name ?? String(product.value?.idShort || id)
  })
  const breadcrumb = computed(() => {
    const items: { title: string, id: string }[] = []
    let current = scope.value
    while (current) {
      items.unshift({ title: current.name, id: current.id })
      current = plan.value?.scopes.find(item => item.id === current?.parentId)
    }
    return items
  })

  watch(() => [product.value?.id, infrastructure.getSelectedInfrastructure?.id, infrastructure.getSubmodelRepoURL], initialize, { immediate: true })
  watch(plan, () => {
    if (!plan.value || loading.value || !storageKey) {
      return
    }
    try {
      const synchronized = hierarchy.synchronize(parsePlan(JSON.stringify(plan.value), plan.value.productAasId))
      if (JSON.stringify(synchronized) !== JSON.stringify(plan.value)) {
        const selected = hierarchy.remappedIds.get(selectedScopeId.value) ?? selectedScopeId.value
        plan.value = synchronized
        selectedScopeId.value = selected
      }
      sessionStorage.setItem(storageKey, JSON.stringify(plan.value))
    } catch (error_) {
      message.value = error_ instanceof Error ? error_.message : 'Browser storage is unavailable; use Save draft to keep changes.'
    }
  }, { deep: true })
  watch(selectedScopeId, () => {
    selectedNodeId.value = ''
  })

  onMounted(() => window.addEventListener('beforeunload', protectDraft))
  onBeforeUnmount(() => {
    generation++
    window.removeEventListener('beforeunload', protectDraft)
  })

  function protectDraft (event: BeforeUnloadEvent): void {
    if (dirty.value) {
      event.preventDefault()
    }
  }

  async function reload (): Promise<void> {
    if (storageKey) {
      try {
        if (plan.value) {
          sessionStorage.setItem(`${storageKey}:recovery`, JSON.stringify(plan.value))
        }
        sessionStorage.removeItem(storageKey)
      } catch { /* Reload does not depend on browser storage. */ }
    }
    await initialize()
  }

  async function initialize (): Promise<void> {
    const ticket = ++generation
    const session = createPlanHierarchy(usePlanRepository(), sources)
    saving.value = false
    plan.value = undefined
    error.value = ''
    message.value = ''
    availableProcesses.value = []
    resources.value = []
    selectedScopeId.value = 'product'
    selectedNodeId.value = ''
    const aasId = String(product.value?.id ?? '')
    if (!aasId) {
      loading.value = false
      return
    }
    storageKey = `process-plan:${infrastructure.getSelectedInfrastructure?.id}:${infrastructure.getSubmodelRepoURL}:${aasId}`
    loading.value = true
    try {
      const [next, shells] = await Promise.all([session.load(aasId, String(product.value?.idShort || 'Product')), sources.loadResources()])
      if (ticket !== generation) {
        return
      }
      hierarchy = session
      availableProcesses.value = Object.values(session.processes).flat()
      resources.value = shells.filter(shell => shell.id !== aasId).map(shell => ({ id: String(shell.id), name: String(shell.displayName?.find((label: { language: string }) => label.language === 'en')?.text || shell.idShort || shell.id) }))
      savedContent.value = JSON.stringify(next)
      let recovered: ProcessPlan | undefined
      try {
        const local = sessionStorage.getItem(storageKey)
        if (local) {
          const parsed = parsePlan(local, aasId)
          if (parsed.revision === next.revision && JSON.stringify(parsed.linkedRevisions) === JSON.stringify(next.linkedRevisions)) {
            if (JSON.stringify(parsed) !== savedContent.value) {
              recovered = session.synchronize(parsed)
            }
          } else {
            sessionStorage.setItem(`${storageKey}:recovery`, local)
          }
        }
      } catch {
        // Invalid or stale recovery data must not interrupt opening the current server plan.
      }
      plan.value = recovered ?? next
      selectedScopeId.value = next.rootScopeId
      for (const scope of plan.value.scopes) {
        for (const node of flattenNodes(scope.nodes)) {
          if (node.kind === 'step' && node.process && node.process.requiredCapabilities === undefined) {
            const input = availableProcesses.value.find(input => JSON.stringify(input.source) === JSON.stringify(node.process?.source))
            if (input?.requiredCapabilities) {
              node.process.requiredCapabilities = structuredClone(toRaw(input.requiredCapabilities))
            }
          }
        }
      }
    } catch (error_) {
      if (ticket === generation) {
        error.value = error_ instanceof Error ? error_.message : 'The workspace could not be loaded.'
      }
    } finally {
      if (ticket === generation) {
        loading.value = false
      }
    }
  }

  function addSubprocess (name: string): void {
    if (!plan.value || !scope.value || !name.trim()) {
      return
    }
    const id = v4()
    plan.value.scopes.push({ id, name: name.trim(), parentId: scope.value.id, material: null, nodes: [] })
    selectedScopeId.value = id
  }

  async function save (): Promise<void> {
    if (!plan.value || saving.value) {
      return
    }
    const session = hierarchy
    const ticket = generation
    saving.value = true
    message.value = ''
    try {
      // JSON snapshots also detach reactive references nested inside skill bindings.
      const snapshot = parsePlan(JSON.stringify(plan.value), plan.value.productAasId)
      const saved = await session.save(snapshot)
      if (ticket === generation) {
        plan.value = saved
        savedContent.value = JSON.stringify(saved)
        message.value = 'Process plan saved with the product.'
      }
    } catch (error_) {
      if (ticket === generation) {
        message.value = error_ instanceof Error ? error_.message : 'Save failed; your draft is still open.'
      }
    } finally {
      if (ticket === generation) {
        saving.value = false
      }
    }
  }

  function download (content?: string): void {
    if (!content && !plan.value) {
      return
    }
    const url = URL.createObjectURL(new Blob([content ?? JSON.stringify(plan.value, null, 2)], { type: 'application/json' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'process-plan-draft.json'
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return {
    plan, product, scope, selectedScopeId, selectedNodeId, selectedNode, loading, saving,
    error, message, dirty, targets, availableProcesses, resources, notes, breadcrumb, ownerName,
    initialize, reload, addSubprocess, save, download,
  }
}
