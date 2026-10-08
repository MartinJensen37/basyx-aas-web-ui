import type { AasElement } from '../utils/sequenceModel'
import { jsonization } from '@aas-core-works/aas-core3.1-typescript'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildDemo } from '../demo/seed'
import { newPlan } from '../utils/plan'
import { defaultSequenceId } from '../utils/sequenceDocuments'
import { buildSequenceDocuments as buildV2 } from '../utils/sequenceDocumentsV2'
import { buildSequenceSubmodel, field } from '../utils/sequenceModel'
import { buildPlanSubmodel, planSubmodelId, usePlanRepository } from './usePlanRepository'

const mocks = vi.hoisted(() => ({
  getRequest: vi.fn(), postRequest: vi.fn(), deleteRequest: vi.fn(), postSubmodel: vi.fn(),
  fetchAttachmentFile: vi.fn(), putSubmodel: vi.fn(), getSubmodelRefsById: vi.fn(),
}))
vi.mock('@/composables/RequestHandling', () => ({ useRequestHandling: () => mocks }))
vi.mock('@/composables/Client/SMRepositoryClient', () => ({
  useSMRepositoryClient: () => ({ ...mocks, getSmEndpointById: (id: string) => `https://example.test/submodels/${id}` }),
}))
vi.mock('@/composables/Client/AASRepositoryClient', () => ({
  useAASRepositoryClient: () => ({ ...mocks, getAasEndpointById: () => 'https://example.test/shells/product' }),
}))

describe('plan persistence', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.getRequest.mockResolvedValue({ success: false, status: 404 })
    mocks.postRequest.mockResolvedValue({ success: true })
    mocks.deleteRequest.mockResolvedValue({ success: true })
    mocks.postSubmodel.mockResolvedValue(true)
    mocks.putSubmodel.mockResolvedValue(true)
    mocks.getSubmodelRefsById.mockResolvedValue([])
  })

  it('serializes a valid AAS submodel with an explicit product reference', () => {
    const parsed = jsonization.submodelFromJsonable(buildPlanSubmodel('urn:product') as never)
    expect(parsed.error).toBeNull()
    expect(jsonization.toJsonable(parsed.mustValue())).toMatchObject(buildPlanSubmodel('urn:product'))
  })

  it('saves a new draft and reloads exactly the saved revision and graph', async () => {
    const repository = usePlanRepository()
    expect(await repository.load('urn:product')).toBeNull()
    const saved = await repository.save(newPlan('urn:product', 'Product'))
    expect(saved.revision).toBe(1)
    expect(mocks.postSubmodel).toHaveBeenCalledOnce()
    expect(mocks.postRequest.mock.calls[0][1]).toContain(planSubmodelId('urn:product'))
    mocks.getRequest.mockResolvedValue({ success: true, data: { submodelElements: [{ modelType: 'File', idShort: 'Definition', value: '/attachment.json' }] } })
    mocks.fetchAttachmentFile.mockResolvedValue({ text: async () => JSON.stringify(saved) })
    expect(await repository.load('urn:product')).toEqual(saved)
  })

  it('resolves embedded subprocesses and detects changed process sources before saving', async () => {
    const demo = buildDemo()
    const models = new Map<string, AasElement>(demo.submodels.map(model => [model.id, structuredClone(model)]))
    const owner = demo.plans[0]!.productAasId
    mocks.getSubmodelRefsById.mockImplementation(async id => demo.shells.find(shell => shell.id === id)!.submodels)
    mocks.getRequest.mockImplementation(async endpoint => {
      const model = models.get(endpoint.replace('https://example.test/submodels/', ''))
      return model ? { success: true, data: structuredClone(model) } : { success: false, status: 404 }
    })
    mocks.putSubmodel.mockImplementation(async model => {
      models.set(model.id, jsonization.toJsonable(model) as AasElement)
      return true
    })
    const repository = usePlanRepository()
    const plan = (await repository.load(owner))!
    expect(plan.scopes.some(scope => scope.name === 'Drive inspection')).toBe(true)
    plan.scopes[0]!.nodes[0]!.name = 'Edited preparation'
    await repository.save(plan)
    expect((await repository.load(owner))!.scopes[0]!.nodes[0]!.name).toBe('Edited preparation')
    expect(field(models.get(defaultSequenceId(owner))!, 'Scopes')).toBeUndefined()
    const processSource = models.get(`${owner.replace('/aas/', '/sm/')}/ProcessParameters`)!
    processSource.submodelElements[0].value[0].value.find((element: AasElement) => element.idShort === 'ProcessName').value = 'Changed externally'
    mocks.putSubmodel.mockClear()
    await expect(repository.save(plan)).rejects.toThrow('changed in another view')
    expect(mocks.putSubmodel).not.toHaveBeenCalled()
  })

  it('embeds old local definitions before detaching their links and supports a cleanup retry', async () => {
    const plan = newPlan('urn:product', 'P')
    plan.scopes.push({ id: 'draft', name: 'Keep this draft', parentId: 'product', material: null, nodes: [] })
    plan.scopes[0]!.nodes = [{ id: 'invoke', kind: 'call', name: 'Call draft', scopeId: 'draft' }]
    const documents = buildV2(plan, planSubmodelId(plan.productAasId), [])
    const models = new Map(documents.map(model => [model.id, model]))
    let references = documents.map(model => ({ type: 'ModelReference', keys: [{ type: 'Submodel', value: model.id }] }))
    mocks.getSubmodelRefsById.mockImplementation(async () => references)
    mocks.getRequest.mockImplementation(async endpoint => ({ success: true, data: structuredClone(models.get(endpoint.replace('https://example.test/submodels/', ''))) }))
    mocks.putSubmodel.mockImplementation(async model => {
      models.set(model.id, jsonization.toJsonable(model) as AasElement)
      return true
    })
    const repository = usePlanRepository()
    const loaded = (await repository.load(plan.productAasId))!
    expect(repository.needsMigration(plan.productAasId)).toBe(true)
    mocks.deleteRequest.mockResolvedValueOnce({ success: false, status: 503 }).mockImplementation(async () => {
      references = references.slice(0, 1)
      return { success: true }
    })
    await expect(repository.save(loaded)).rejects.toThrow('legacy subprocess link')
    expect(field(models.get(documents[0]!.id)!, 'LocalSubprocesses')).toBeDefined()
    await repository.save(loaded)
    expect(models.has(documents[1]!.id)).toBe(true)
    expect(mocks.deleteRequest).toHaveBeenCalledTimes(2)
    const reloaded = (await repository.load(plan.productAasId))!
    expect(reloaded.scopes.map(scope => [scope.id, scope.name, scope.nodes])).toEqual(plan.scopes.map(scope => [scope.id, scope.name, scope.nodes]))
    expect(repository.needsMigration(plan.productAasId)).toBe(false)
  })

  it('does not turn an authorization or network failure into an empty editable plan', async () => {
    mocks.getRequest.mockResolvedValue({ success: false, status: 403 })
    await expect(usePlanRepository().load('urn:product')).rejects.toThrow('could not be read')
    expect(mocks.postSubmodel).not.toHaveBeenCalled()
  })

  it('retains a draft and reports failed uploads instead of claiming it was saved', async () => {
    const repository = usePlanRepository()
    await repository.load('urn:product')
    mocks.getRequest.mockResolvedValue({ success: true, data: buildSequenceSubmodel(newPlan('urn:product', 'Product'), planSubmodelId('urn:product')) })
    await repository.load('urn:product')
    mocks.putSubmodel.mockResolvedValue(false)
    const plan = newPlan('urn:product', 'Product')
    await expect(repository.save(plan)).rejects.toThrow('could not be saved')
    expect(plan.revision).toBe(0)
  })

  it('refuses to overwrite a revision changed since load', async () => {
    const repository = usePlanRepository()
    await repository.load('urn:product')
    mocks.getRequest.mockResolvedValue({ success: true, data: { submodelElements: [{ modelType: 'File', idShort: 'Definition', value: '/attachment.json' }] } })
    mocks.fetchAttachmentFile.mockResolvedValue({ text: async () => JSON.stringify(newPlan('urn:product', 'Another editor')) })
    await expect(repository.save(newPlan('urn:product', 'Product'))).rejects.toThrow('changed in another view')
    expect(mocks.putSubmodel).not.toHaveBeenCalled()
  })
  it('migrates a legacy attachment, then permits a second structured save', async () => {
    const plan = newPlan('urn:product', 'Legacy')
    const legacy = { submodelElements: [{ modelType: 'File', idShort: 'Definition', value: '/old.json' }] }
    mocks.getRequest.mockResolvedValue({ success: true, data: legacy })
    mocks.fetchAttachmentFile.mockResolvedValue({ text: async () => JSON.stringify(plan) })
    mocks.putSubmodel.mockImplementation(async model => {
      mocks.getRequest.mockResolvedValue({ success: true, data: jsonization.toJsonable(model) })
      return true
    })
    const repository = usePlanRepository()
    await repository.load(plan.productAasId)
    const saved = await repository.save(plan)
    await repository.check(plan.productAasId)
    expect((await repository.save(saved)).revision).toBe(2)
    expect(await repository.load(plan.productAasId)).toMatchObject({ revision: 2 })
  })

  it('allows retry after creating the model but failing to attach it', async () => {
    mocks.postSubmodel.mockImplementation(async model => {
      mocks.getRequest.mockResolvedValue({ success: true, data: jsonization.toJsonable(model) })
      return true
    })
    mocks.postRequest.mockResolvedValueOnce({ success: false }).mockResolvedValue({ success: true })
    const repository = usePlanRepository()
    await repository.load('urn:product')
    const plan = newPlan('urn:product', 'Product')
    await expect(repository.save(plan)).rejects.toThrow('could not be linked')
    expect((await repository.save(plan)).revision).toBe(2)
    expect(mocks.postSubmodel).toHaveBeenCalledOnce()
  })
})
