import type { PlanProcess, PlanScope } from '../types/plan'
import { useAASHandling } from '@/composables/AAS/AASHandling'
import { useSMHandling } from '@/composables/AAS/SMHandling'
import { useAASDiscoveryClient } from '@/composables/Client/AASDiscoveryClient'
import { useAASRepositoryClient } from '@/composables/Client/AASRepositoryClient'
import { PROCESS_PARAMETERS_SUBMODEL } from '../constants/contracts'
import { readCapabilities } from '../utils/capabilities'
import { readMaterialScopes, readPlanProcesses, semanticId } from '../utils/planSources'
import { readSkillCatalog } from '../utils/readers'

export function usePlanSources () {
  const { getSubmodelRefsById } = useAASRepositoryClient()
  const { fetchAasList } = useAASHandling()
  const { fetchSmById } = useSMHandling()
  const { getAasId } = useAASDiscoveryClient()

  async function submodels (aasId: string): Promise<Record<string, any>[]> {
    const references = await getSubmodelRefsById(aasId)
    const ids = references.flatMap(reference => reference.keys ?? [])
      .filter(key => key.type === 'Submodel')
      .map(key => String(key.value))
    return Promise.all(ids.map(async id => {
      const model = await fetchSmById(id, { setData: false, aasId })
      if (model?.id !== id) {
        throw new Error(`Submodel ${id} could not be loaded.`)
      }
      return model
    }))
  }

  async function loadScope (aasId: string, scopeId: string): Promise<{ processes: PlanProcess[], scopes: PlanScope[] }> {
    const models = await submodels(aasId)
    return {
      processes: models.filter(sm => sm && semanticId(sm) === PROCESS_PARAMETERS_SUBMODEL.semanticId)
        .flatMap(sm => readPlanProcesses(sm, aasId)),
      scopes: models.filter(sm => sm && semanticId(sm).includes('/HierarchicalStructures/'))
        .flatMap(sm => readMaterialScopes(sm, aasId, scopeId)),
    }
  }

  async function loadSkills (aasId: string) {
    const models = await submodels(aasId)
    return models.filter(sm => sm && semanticId(sm).includes('/Skills/')).flatMap(sm => readSkillCatalog(sm).skills)
  }

  async function loadCapabilities (aasId: string) {
    return (await submodels(aasId)).filter(Boolean).flatMap(sm => readCapabilities(sm, aasId))
  }

  async function loadProducts () {
    const shells = await fetchAasList()
    const results = await Promise.allSettled(shells.map(async shell => ({
      shell,
      eligible: (await submodels(String(shell.id))).some(sm => sm && semanticId(sm) === PROCESS_PARAMETERS_SUBMODEL.semanticId),
    })))
    return {
      products: results.flatMap(result => result.status === 'fulfilled' && result.value.eligible ? [result.value.shell] : []),
      incomplete: results.some(result => result.status === 'rejected'),
    }
  }

  async function loadResources () {
    const shells = await fetchAasList()
    const results = await Promise.allSettled(shells.map(async shell => ({
      shell,
      eligible: (await submodels(String(shell.id))).some(model => semanticId(model) === 'https://smartproductionlab.aau.dk/SubmodelTemplate/Skills/1/0'
        || readCapabilities(model, String(shell.id)).some(capability => capability.role === 'Offered')),
    })))
    return results.flatMap(result => result.status === 'fulfilled' && result.value.eligible ? [result.value.shell] : [])
  }

  return { loadScope, loadSkills, loadCapabilities, loadProducts, loadResources, getAasId, fetchAasList }
}
