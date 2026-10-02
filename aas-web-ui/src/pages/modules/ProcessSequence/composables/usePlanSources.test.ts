import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PROCESS_PARAMETERS_SUBMODEL } from '../constants/contracts'
import { usePlanSources } from './usePlanSources'

const mocks = vi.hoisted(() => ({ fetchAasList: vi.fn(), getSubmodelRefsById: vi.fn(), fetchSmById: vi.fn(), getAasId: vi.fn() }))
vi.mock('@/composables/AAS/AASHandling', () => ({ useAASHandling: () => mocks }))
vi.mock('@/composables/AAS/SMHandling', () => ({ useSMHandling: () => mocks }))
vi.mock('@/composables/Client/AASDiscoveryClient', () => ({ useAASDiscoveryClient: () => mocks }))
vi.mock('@/composables/Client/AASRepositoryClient', () => ({ useAASRepositoryClient: () => mocks }))

describe('product discovery', () => {
  beforeEach(() => vi.resetAllMocks())

  it('accepts the exact template identity with any name and excludes lookalikes and unavailable models', async () => {
    mocks.fetchAasList.mockResolvedValue(['product', 'file', 'instance', 'offline'].map(id => ({ id })))
    mocks.getSubmodelRefsById.mockImplementation(async id => [{ keys: [{ type: 'Submodel', value: id }] }])
    mocks.fetchSmById.mockImplementation(async id => ({
      ...(id === 'offline' ? {} : { id }), idShort: id === 'product' ? 'RenamedInputs' : 'ProcessParameters',
      semanticId: { keys: [{ value: id === 'product' ? PROCESS_PARAMETERS_SUBMODEL.semanticId : `urn:${id}` }] },
    }))
    expect(await usePlanSources().loadProducts()).toEqual({ products: [{ id: 'product' }], incomplete: true })
  })
})
