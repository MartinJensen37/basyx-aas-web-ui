import type { ProcessPlan } from '../types/plan'
import { describe, expect, it, vi } from 'vitest'
import { buildDemo, splitDemoPlan } from '../demo/seed'
import { expandPlan, newNode, newPlan } from './plan'
import { createPlanHierarchy } from './planHierarchy'

function fixture () {
  const root = newPlan('robot', 'Robot')
  const child = newPlan('drive', 'Drive')
  const leaf = newPlan('motor', 'Motor')
  root.scopes.push({ id: 'drive-mount', name: 'Drive', parentId: 'product', material: null, nodes: [], planAasId: 'drive' })
  root.scopes[0].nodes.push(newNode('call', 'drive-mount'))
  child.scopes.push({ id: 'motor-mount', name: 'Motor', parentId: 'product', material: null, nodes: [], planAasId: 'motor' })
  child.scopes[0].nodes.push(newNode('step'), newNode('call', 'motor-mount'))
  leaf.scopes[0].nodes.push(newNode('step'))
  for (const plan of [root, child, leaf]) {
    plan.revision = 1
    plan.schema = 'process-sequence-plan/3.0'
  }
  const database = new Map([root, child, leaf].map(plan => [plan.productAasId, structuredClone(plan)]))
  const sources = { loadScope: vi.fn(async () => ({ processes: [], scopes: [] })), getAasId: vi.fn(async () => '') }
  function session () {
    const baselines = new Map<string, string>()
    const repository = {
      load: vi.fn(async (id: string) => {
        baselines.set(id, JSON.stringify(database.get(id)))
        return structuredClone(database.get(id) ?? null)
      }),
      check: vi.fn(async (id: string) => {
        if (baselines.get(id) !== JSON.stringify(database.get(id))) {
          throw new Error('Changed since load')
        }
      }),
      save: vi.fn(async (plan: ProcessPlan) => {
        await repository.check(plan.productAasId)
        const next = structuredClone({ ...plan, revision: plan.revision + 1 })
        database.set(plan.productAasId, next)
        baselines.set(plan.productAasId, JSON.stringify(next))
        return next
      }),
    }
    return { hierarchy: createPlanHierarchy(repository, sources), repository }
  }
  return { database, sources, session }
}

describe('shared recursive assembly plans', () => {
  it('retains an optional subprocess call when editing a shared assembly through its parent', async () => {
    const { session, database } = fixture()
    const parent = session().hierarchy
    const view = await parent.load('robot', 'Robot')
    const drive = view.scopes.find(scope => scope.name === 'Drive')!
    const motor = view.scopes.find(scope => scope.name === 'Motor')!
    const flow = newNode('conditional')
    if (flow.kind !== 'conditional') {
      throw new Error('Expected optional flow')
    }
    flow.nodes = [newNode('call', motor.id)]
    drive.nodes = [flow, newNode('step')]
    await parent.save(view)
    expect(database.get('drive')!.schema).toBe('process-sequence-plan/4.0')
    expect(database.get('robot')!.revision).toBe(1)
    const direct = await session().hierarchy.load('drive', 'Drive')
    expect(expandPlan(direct, direct.rootScopeId, 1)).toHaveLength(1)
    expect(expandPlan(direct, direct.rootScopeId, 5)).toHaveLength(2)
    const reopened = await session().hierarchy.load('robot', 'Robot')
    expect(expandPlan(reopened, reopened.rootScopeId, 1)).toHaveLength(1)
    expect(expandPlan(reopened, reopened.rootScopeId, 5)).toHaveLength(2)
  })

  it('distinguishes a stored empty revision-zero plan from a missing definition', async () => {
    const { session, database } = fixture()
    const empty = newPlan('empty', 'Empty component')
    empty.schema = 'process-sequence-plan/3.0'
    database.set('empty', empty)
    const { hierarchy, repository } = session()
    const loaded = await hierarchy.load('empty', 'Empty component')
    expect(hierarchy.hasUnsavedDefinitions()).toBe(false)
    await hierarchy.save(loaded)
    expect(repository.save).not.toHaveBeenCalled()
    const missing = session().hierarchy
    const created = await missing.load('missing', 'New component')
    expect(missing.hasUnsavedDefinitions()).toBe(true)
    await missing.save(created)
    expect(missing.hasUnsavedDefinitions()).toBe(false)
  })

  it('opens a child subtree alone and reflects its saved edits in every parent', async () => {
    const { session, database } = fixture()
    const child = session().hierarchy
    const view = await child.load('drive', 'Drive')
    expect(view.scopes.map(scope => scope.name)).toEqual(['Drive', 'Motor'])
    view.scopes[0].nodes[0].name = 'Changed from drive'
    await child.save(view)
    const robot = await session().hierarchy.load('robot', 'Robot')
    expect(expandPlan(robot)[0].step.name).toBe('Changed from drive')
    expect(database.get('robot')!.revision).toBe(1)
    expect(database.get('drive')!.revision).toBe(2)
  })

  it('saves edits and new subprocesses from a parent view to the child owner', async () => {
    const { session, database } = fixture()
    const parent = session().hierarchy
    let view = await parent.load('robot', 'Robot')
    const drive = view.scopes.find(scope => scope.name === 'Drive')!
    view.scopes.push({ id: 'new-subprocess', name: 'Inspection', parentId: drive.id, material: null, nodes: [newNode('step')] })
    drive.nodes.push(newNode('call', 'new-subprocess'))
    view = parent.synchronize(view)
    expect(view.scopes.some(scope => scope.name === 'Inspection')).toBe(true)
    await parent.save(view)
    const direct = await session().hierarchy.load('drive', 'Drive')
    expect(direct.scopes.some(scope => scope.name === 'Inspection')).toBe(true)
    expect(expandPlan(direct)).toHaveLength(3)
    expect(database.get('robot')!.scopes).toHaveLength(2)
    expect(database.get('robot')!.scopes[1].nodes).toEqual([])
  })

  it('updates repeated occurrences together and saves their definition once', async () => {
    const { session, database } = fixture()
    const root = database.get('robot')!
    root.scopes.push({ ...structuredClone(root.scopes[1]), id: 'other-drive' })
    root.scopes[0].nodes.push(newNode('call', 'other-drive'))
    const { hierarchy, repository } = session()
    let view = await hierarchy.load('robot', 'Robot')
    view.scopes.find(scope => scope.id === 'drive-mount')!.nodes[0].name = 'Shared edit'
    view = hierarchy.synchronize(view)
    expect(view.scopes.find(scope => scope.id === 'other-drive')!.nodes[0].name).toBe('Shared edit')
    expect(expandPlan(view)).toHaveLength(4)
    await hierarchy.save(view)
    expect(repository.save.mock.calls.filter(([plan]) => plan.productAasId === 'drive')).toHaveLength(1)
  })

  it('refuses stale child writes before saving any changed owner', async () => {
    const { session, database } = fixture()
    const { hierarchy, repository } = session()
    const view = await hierarchy.load('robot', 'Robot')
    view.scopes[0].name = 'Edited robot'
    view.scopes.find(scope => scope.name === 'Drive')!.nodes[0].name = 'Stale edit'
    database.get('drive')!.revision++
    await expect(hierarchy.save(view)).rejects.toThrow('Changed since load')
    expect(repository.save).not.toHaveBeenCalled()
  })

  it('writes a shared descendant before every changed parent in a diamond hierarchy', async () => {
    const { session, database } = fixture()
    const second = structuredClone(database.get('drive')!)
    second.productAasId = 'second-drive'
    second.scopes[0].name = 'Second drive'
    database.set('second-drive', second)
    database.get('robot')!.scopes.push({ id: 'second', name: 'Second drive', parentId: 'product', material: null, nodes: [], planAasId: 'second-drive' })
    const { hierarchy, repository } = session()
    let view = await hierarchy.load('robot', 'Robot')
    view.scopes.find(scope => scope.name === 'Motor')!.name = 'Shared motor edit'
    view = hierarchy.synchronize(view)
    view.scopes.find(scope => scope.name === 'Second drive')!.name = 'Other parent edit'
    await hierarchy.save(view)
    expect(repository.save.mock.calls.map(([plan]) => plan.productAasId)).toEqual(['motor', 'second-drive'])
  })

  it('preserves differing legacy occurrences by refusing an ambiguous automatic split', async () => {
    const { session, database, sources } = fixture()
    database.delete('drive')
    const root = database.get('robot')!
    const first = root.scopes[1]
    delete first.planAasId
    first.material = { aasId: 'robot', submodelId: 'bom', path: ['First'], globalAssetId: 'asset-drive' }
    first.nodes = [newNode('step')]
    root.scopes.push({ ...structuredClone(first), id: 'second', nodes: [newNode('step')] })
    sources.getAasId.mockResolvedValue('drive')
    await expect(session().hierarchy.load('robot', 'Robot')).rejects.toThrow('Repeated inline occurrences')
    expect(root.scopes[1].nodes).toHaveLength(1)
  })

  it('rejects cycles and unavailable referenced plans without fabricating successful empty loads', async () => {
    const { session, database, sources } = fixture()
    database.get('motor')!.scopes.push({ id: 'cycle', name: 'Cycle', parentId: 'product', nodes: [], material: null, planAasId: 'robot' })
    await expect(session().hierarchy.load('robot', 'Robot')).rejects.toThrow('Cyclic')
    sources.loadScope.mockRejectedValue(new Error('Resource unavailable'))
    await expect(session().hierarchy.load('drive', 'Drive')).rejects.toThrow('Resource unavailable')
  })

  it('keeps a missing linked definition from becoming an empty editable replacement', async () => {
    const { session, database } = fixture()
    database.delete('motor')
    await expect(session().hierarchy.load('robot', 'Robot')).rejects.toThrow('shared plan for Motor is missing')
  })

  it('retries remaining writes after a partial save without rewriting successful child revisions', async () => {
    const { session, database } = fixture()
    const { hierarchy, repository } = session()
    const view = await hierarchy.load('robot', 'Robot')
    view.scopes.find(scope => scope.name === 'Drive')!.name = 'Changed drive'
    view.scopes.find(scope => scope.name === 'Motor')!.name = 'Changed motor'
    const save = repository.save.getMockImplementation()!
    repository.save.mockImplementation(async plan => {
      if (plan.productAasId === 'drive') {
        throw new Error('Network error')
      }
      return save(plan)
    })
    await expect(hierarchy.save(view)).rejects.toThrow('1 of 2 changed plans saved')
    expect(database.get('motor')!.revision).toBe(2)
    repository.save.mockImplementation(save)
    await hierarchy.save(view)
    expect(database.get('motor')!.revision).toBe(2)
    expect(database.get('drive')!.scopes[0].name).toBe('Changed drive')
  })

  it('splits existing demo steps, nested subprocesses and bindings without losing the combined order', async () => {
    const { plan } = buildDemo()
    const steps = expandPlan(plan)
    steps[0].step.name = 'User edited preparation'
    const plans = splitDemoPlan(plan)
    expect(plans).toHaveLength(3)
    const database = new Map(plans.map(plan => [plan.productAasId, plan]))
    const hierarchy = createPlanHierarchy({
      load: async id => database.get(id) ?? null, check: async () => {}, save: async plan => plan,
    }, { loadScope: async () => ({ processes: [], scopes: [] }), getAasId: async () => '' })
    const view = await hierarchy.load(plan.productAasId, 'Robot')
    expect(expandPlan(view).map(item => item.step)).toEqual(steps.map(item => item.step))
    expect(splitDemoPlan(plans.at(-1)!)).toHaveLength(1)
    const drive = plans.find(plan => plan.productAasId.endsWith('/drive'))!
    expect(drive.scopes.some(scope => scope.name === 'Drive inspection')).toBe(true)
    expect(drive.scopes.some(scope => scope.name === 'Control assembly')).toBe(false)
  })
})
