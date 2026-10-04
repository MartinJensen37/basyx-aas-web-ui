import type { ProcessPlan } from '../types/plan'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { newNode, newPlan } from '../utils/plan'
import { usePlanWorkspace } from './usePlanWorkspace'

const mocks = vi.hoisted(() => ({ save: vi.fn(), load: vi.fn() }))
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
  })

  it('reports invalid snapshots without rejecting the save or leaving it busy', async () => {
    workspace.plan.value!.rootScopeId = 'missing'
    await expect(workspace.save()).resolves.toBeUndefined()
    expect(mocks.save).not.toHaveBeenCalled()
    expect(workspace.message.value).toContain('include the product root')
    expect(workspace.saving.value).toBe(false)
  })
})
