import type { PlanNode, PlanProcess, PlanScope, ProcessPlan } from '../types/plan'
import { flattenNodes, newPlan, parsePlan } from './plan'
import { extractAssembly } from './planTree'

type Repository = {
  load: (id: string) => Promise<ProcessPlan | null>
  save: (plan: ProcessPlan) => Promise<ProcessPlan>
  check: (id: string) => Promise<void>
}
type Sources = {
  loadScope: (id: string, root: string) => Promise<{ processes: PlanProcess[], scopes: PlanScope[] }>
  getAasId: (asset: string) => Promise<string>
}
type Mount = { aasId: string, viewRoot: string, ids: Map<string, string>, nested: boolean }
const copy = <T>(value: T): T => structuredClone(value)
function content (plan: ProcessPlan): string {
  const normalized = parsePlan(JSON.stringify(plan), plan.productAasId)
  normalized.scopes.sort((a, b) => a.id.localeCompare(b.id))
  return JSON.stringify({ ...normalized, revision: 0, linkedRevisions: undefined })
}

/** Match material occurrences within their parent, preserving authored scope identities during migration. */
function mergeMaterials (plan: ProcessPlan, incoming: PlanScope[]): void {
  const ids = new Map<string, string>([[plan.rootScopeId, plan.rootScopeId]])
  for (const scope of incoming) {
    const parentId = ids.get(scope.parentId!) ?? scope.parentId
    const existing = plan.scopes.find(item => item.parentId === parentId && item.material
      && item.material.path.at(-1) === scope.material?.path.at(-1))
    if (existing) {
      ids.set(scope.id, existing.id)
      existing.material = scope.material
    } else {
      plan.scopes.push({ ...scope, parentId })
      ids.set(scope.id, scope.id)
    }
  }
}

/** One definition per AAS, projected into as many material occurrences as the selected tree needs. */
export function createPlanHierarchy (repository: Repository, sources: Sources) {
  const definitions = new Map<string, ProcessPlan>()
  const stored = new Map<string, string | null>()
  const processes: Record<string, PlanProcess[]> = {}
  let mounts: Mount[] = []
  let rootOwner = ''
  const remappedIds = new Map<string, string>()

  async function load (aasId: string, name: string): Promise<ProcessPlan> {
    rootOwner = aasId
    await visit(aasId, name, new Set())
    return compose()
  }

  async function visit (aasId: string, name: string, ancestors: Set<string>, fallback?: ProcessPlan, linked = false): Promise<void> {
    if (ancestors.has(aasId)) {
      throw new Error(`Cyclic assembly plan reference at ${name}.`)
    }
    if (definitions.has(aasId)) {
      if (fallback?.scopes.some(scope => scope.nodes.length > 0) && content(definitions.get(aasId)!) !== content(fallback)) {
        throw new Error(`Repeated inline occurrences of ${name} have different definitions. Reconcile them before sharing this assembly.`)
      }
      return
    }
    const saved = await repository.load(aasId)
    if (linked && !saved) {
      throw new Error(`The shared plan for ${name} is missing. Restore it before editing this hierarchy.`)
    }
    const hasWork = (plan: ProcessPlan | undefined | null) => plan?.scopes.some(scope => scope.nodes.length > 0)
    if (hasWork(saved) && hasWork(fallback) && content(saved!) !== content(fallback!)) {
      throw new Error(`There are different inline and shared plans for ${name}. Preserve and reconcile them before linking this assembly.`)
    }
    const plan = copy(hasWork(fallback) && !hasWork(saved) ? { ...fallback!, revision: saved?.revision ?? 0 } : saved ?? fallback ?? newPlan(aasId, name))
    stored.set(aasId, saved ? content(saved) : null)
    if (plan.schema !== 'process-sequence-plan/4.0') {
      plan.schema = 'process-sequence-plan/3.0'
    }
    definitions.set(aasId, plan)
    const inputs = await sources.loadScope(aasId, plan.rootScopeId)
    processes[aasId] = inputs.processes
    mergeMaterials(plan, inputs.scopes)
    const next = new Set([...ancestors, aasId])
    // Only direct ownership boundaries are processed here; their descendants belong to the child.
    const pending = [...plan.scopes]
    for (const scope of pending) {
      if (!plan.scopes.includes(scope) || scope.id === plan.rootScopeId) {
        continue
      }
      const owner = scope.planAasId || (scope.material?.globalAssetId ? await sources.getAasId(scope.material.globalAssetId) : '')
      if (!owner) {
        continue
      }
      const subtree = extractAssembly(plan, scope.id, owner)
      await visit(owner, scope.name, next, subtree, !!scope.planAasId)
      const descendants = new Set(subtree.scopes.filter(item => item.id !== scope.id).map(item => item.id))
      plan.scopes = plan.scopes.filter(item => !descendants.has(item.id))
      scope.nodes = []
      scope.planAasId = owner
    }
  }

  function mapNodes (nodes: PlanNode[], ids: Map<string, string>): PlanNode[] {
    const result = copy(nodes)
    for (const node of flattenNodes(result)) {
      if (node.kind === 'call') {
        const target = ids.get(node.scopeId)
        if (!target) {
          throw new Error('A shared assembly can only call definitions inside its own subtree.')
        }
        node.scopeId = target
      }
    }
    return result
  }

  function compose (): ProcessPlan {
    mounts = []
    const root = definitions.get(rootOwner)!
    const view: ProcessPlan = { ...copy(root), scopes: [], linkedRevisions: Object.fromEntries([...definitions].map(([id, plan]) => [id, plan.revision] as const).toSorted(([a], [b]) => a.localeCompare(b))) }
    function mount (aasId: string, occurrence?: PlanScope): void {
      const plan = definitions.get(aasId)!
      const viewRoot = occurrence?.id ?? plan.rootScopeId
      const ids = new Map(plan.scopes.map(scope => [scope.id, scope.id === plan.rootScopeId ? viewRoot : (occurrence ? JSON.stringify(['scope', viewRoot, scope.id]) : scope.id)]))
      mounts.push({ aasId, viewRoot, ids, nested: !!occurrence })
      for (const local of plan.scopes) {
        const scope: PlanScope = {
          ...copy(local), id: ids.get(local.id)!, parentId: local.parentId ? ids.get(local.parentId)! : occurrence?.parentId ?? null,
          nodes: mapNodes(local.nodes, ids),
        }
        if (local.id === plan.rootScopeId && occurrence) {
          scope.material = occurrence.material
          scope.planAasId = aasId
        }
        if (local.planAasId && local.id !== plan.rootScopeId) {
          mount(local.planAasId, scope)
        } else {
          view.scopes.push(scope)
        }
      }
    }
    mount(rootOwner)
    return parsePlan(JSON.stringify(view), rootOwner)
  }

  function collect (view: ProcessPlan): Map<string, ProcessPlan> {
    const proposals = new Map<string, ProcessPlan>()
    const scopeById = new Map(view.scopes.map(scope => [scope.id, scope]))
    const ownership = new Map<string, Mount>()
    for (const mount of mounts) {
      for (const id of mount.ids.values()) {
        ownership.set(id, mount)
      }
    }
    function ownerOf (scope: PlanScope): Mount | undefined {
      return ownership.get(scope.id) ?? (scope.parentId ? ownerOf(scopeById.get(scope.parentId)!) : undefined)
    }
    for (const mount of mounts) {
      const definition = definitions.get(mount.aasId)!
      const inverse = new Map([...mount.ids].map(([local, id]) => [id, local]))
      const owned = view.scopes.filter(scope => ownerOf(scope) === mount)
      for (const scope of owned) {
        if (!inverse.has(scope.id)) {
          inverse.set(scope.id, scope.id)
          remappedIds.set(scope.id, mount.nested ? JSON.stringify(['scope', mount.viewRoot, scope.id]) : scope.id)
        }
      }
      const scopes = owned.map(scope => ({
        ...copy(scope), id: inverse.get(scope.id)!, parentId: scope.id === mount.viewRoot ? null : inverse.get(scope.parentId!)!,
        material: scope.id === mount.viewRoot ? null : scope.material,
        nodes: mapNodes(scope.nodes, inverse),
      }))
      const root = scopes.find(scope => scope.id === definition.rootScopeId)!
      delete root.planAasId
      for (const placeholder of definition.scopes.filter(scope => scope.planAasId)) {
        scopes.push(copy(placeholder))
      }
      const proposed = parsePlan(JSON.stringify({ ...definition, scopes }), mount.aasId)
      if (content(proposed) !== content(definition)) {
        const other = proposals.get(mount.aasId)
        if (other && content(other) !== content(proposed)) {
          throw new Error('Two occurrences of a shared assembly have conflicting edits. Reload the latest version before saving.')
        }
        proposals.set(mount.aasId, proposed)
      }
    }
    return proposals
  }

  function synchronize (view: ProcessPlan): ProcessPlan {
    remappedIds.clear()
    for (const [id, proposal] of collect(view)) {
      definitions.set(id, proposal)
    }
    return compose()
  }

  async function save (view: ProcessPlan): Promise<ProcessPlan> {
    synchronize(view)
    const ordered: ProcessPlan[] = []
    const visited = new Set<string>()
    function visit (id: string): void {
      if (visited.has(id)) {
        return
      }
      visited.add(id)
      const definition = definitions.get(id)!
      for (const scope of definition.scopes) {
        if (scope.planAasId) {
          visit(scope.planAasId)
        }
      }
      ordered.push(definition)
    }
    visit(rootOwner)
    const changed = ordered.filter(plan => stored.get(plan.productAasId) !== content(plan))
    await Promise.all(changed.map(plan => repository.check(plan.productAasId)))
    let completed = 0
    try {
      for (const plan of changed) {
        const saved = await repository.save(copy(plan))
        definitions.set(plan.productAasId, saved)
        stored.set(plan.productAasId, content(saved))
        completed++
      }
    } catch (error) {
      throw new Error(`${completed} of ${changed.length} changed plans saved. ${error instanceof Error ? error.message : 'Save failed.'} Your remaining edits are retained; retry saving.`, { cause: error })
    }
    return compose()
  }

  function owner (scopeId: string): string {
    return mounts.findLast(mount => [...mount.ids.values()].includes(scopeId))?.aasId ?? rootOwner
  }

  function canTarget (from: string, target: string): boolean {
    const mount = mounts.findLast(mount => [...mount.ids.values()].includes(from))
    return !!mount && [...mount.ids.values()].includes(target)
  }

  function hasUnsavedDefinitions (): boolean {
    return [...stored.values()].includes(null)
  }

  return { load, save, synchronize, processes, owner, canTarget, remappedIds, hasUnsavedDefinitions }
}
