import type { ProcessPlan } from '../types/plan'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { newNode, newPlan } from '../utils/plan'
import { usePlanWorkspace } from './usePlanWorkspace'

const mocks = vi.hoisted(() => ({ save: vi.fn(), load: vi.fn(), writeProcess: vi.fn() }))
vi.mock('../skills/skillService', async original => ({ ...await original(), writeProcess: mocks.writeProcess }))
vi.mock('@/store/AASDataStore', () => ({ useAASStore: () => ({ getSelectedAAS: { id: 'urn:product' } }) }))
vi.mock('@/store/InfrastructureStore', () => ({ useInfrastructureStore: () => ({ getSelectedInfrastructure: { id: 'test' }, getSubmodelRepoURL: 'urn:repository' }) }))
vi.mock('./usePlanRepository', () => ({ usePlanRepository: () => ({}) }))
vi.mock('./usePlanSources', () => ({ usePlanSources: () => ({ loadResources: async () => [] }) }))
vi.mock('../utils/planHierarchy', () => ({ createPlanHierarchy: () => ({
  ...mocks, processes: {}, remappedIds: new Map(), hasUnsavedDefinitions: () => false,
  synchronize: (plan: ProcessPlan) => plan, owner: () => 'urn:product', canTarget: () => true,
}) }))

describe('workspace save boundary', () => {
  let workspace: ReturnType<typeof usePlanWorkspace>
  let wrapper: ReturnType<typeof mount>

  beforeEach(async () => {
    vi.resetAllMocks()
    sessionStorage.clear()
    mocks.load.mockResolvedValue(newPlan('urn:product', 'Product'))
    mocks.save.mockImplementation(async plan => structuredClone(plan))
    wrapper = mount(defineComponent({
      setup () {
        workspace = usePlanWorkspace()
        return () => null
      },
    }))
    await flushPromises()
  })
  afterEach(() => wrapper.unmount())

  it('saves skill bindings containing nested reactive source references', async () => {
    const step = newNode('step')
    if (step.kind !== 'step') {
      throw new Error('Expected step')
    }
    step.bindings = [{ name: 'Volume', value: '', source: reactive({ aasId: 'urn:product', submodelId: 'urn:parameters', path: ['Volume'] }) }]
    workspace.plan.value!.scopes[0].nodes.push(step)
    await flushPromises()
    await workspace.save()
    expect(mocks.save).toHaveBeenCalledOnce()
    expect(workspace.message.value).toBe('Process plan saved with the product.')
    expect(workspace.plan.value!.scopes[0].nodes[0]).toEqual(step)
    // Bound to no module yet: no process AAS asked for.
    expect(mocks.writeProcess).not.toHaveBeenCalled()
  })

  it('has the process AAS written once a step is bound to a module, and says whether the recipe fits', async () => {
    const step = newNode('step')
    if (step.kind !== 'step') {
      throw new Error('Expected step')
    }
    step.resourceAasId = 'urn:filling'
    workspace.plan.value!.scopes[0].nodes.push(step)
    mocks.writeProcess.mockResolvedValue({ product: 'urn:product', process: 'urn:process', idShort: 'ProductOnLineAAS', result: 'DoesNotFit',
      findings: ['Filling: not bound'] })
    await workspace.save()
    expect(mocks.writeProcess).toHaveBeenCalledWith('urn:product')
    expect(workspace.message.value).toBe('Process plan saved with the product. Its process AAS ProductOnLineAAS is written, '
      + 'but the recipe does not fit the line: Filling: not bound.')

    // A service that is not reached leaves the save done, and says so.
    mocks.writeProcess.mockRejectedValue(new Error('The skill service at http://localhost:8090 was not reached.'))
    workspace.plan.value!.scopes[0].nodes[0]!.name = 'Changed'
    await workspace.save()
    expect(mocks.save).toHaveBeenCalledTimes(2)
    expect(workspace.message.value).toBe('Process plan saved with the product. The process AAS was not written: '
      + 'The skill service at http://localhost:8090 was not reached.')
    expect(workspace.saving.value).toBe(false)
  })

  it('reports invalid snapshots without rejecting the save or leaving it busy', async () => {
    workspace.plan.value!.rootScopeId = 'missing'
    await expect(workspace.save()).resolves.toBeUndefined()
    expect(mocks.save).not.toHaveBeenCalled()
    expect(workspace.message.value).toContain('include the product root')
    expect(workspace.saving.value).toBe(false)
  })

  it('undoes a type change and protects subsequent edits from being overwritten', async () => {
    const step = newNode('step')
    step.name = 'Inspection'
    workspace.plan.value!.scopes[0].nodes.push(step)
    workspace.selectedNodeId.value = step.id
    await flushPromises()
    workspace.changeType('decision')
    await flushPromises()
    expect(workspace.selectedNode.value?.kind).toBe('decision')
    expect(workspace.canUndoType.value).toBe(true)
    workspace.undoTypeChange()
    await flushPromises()
    expect(workspace.selectedNode.value).toEqual(step)
    workspace.changeType('conditional')
    await flushPromises()
    workspace.selectedNode.value!.name = 'Changed after conversion'
    expect(workspace.canUndoType.value).toBe(false)
    workspace.undoTypeChange()
    expect(workspace.selectedNode.value!.name).toBe('Changed after conversion')
  })
})
