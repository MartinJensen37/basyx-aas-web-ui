import type { CapabilityDescription } from '../utils/capabilities'
import type { AasElement } from '../utils/sequenceModel'
import type { ResourceSkill } from './skillFlow'
import { jsonization } from '@aas-core-works/aas-core3.1-typescript'
import { useAASHandling } from '@/composables/AAS/AASHandling'
import { useAASRepositoryClient } from '@/composables/Client/AASRepositoryClient'
import { useSMRepositoryClient } from '@/composables/Client/SMRepositoryClient'
import { useRequestHandling } from '@/composables/RequestHandling'
import { CAPABILITY_SUBMODEL } from '../constants/capabilities'
import { ARSO_SKILLS_SUBMODEL, HIERARCHICAL_STRUCTURES_SUBMODEL, isHierarchicalStructures } from '../constants/contracts'
import { readCapabilities } from '../utils/capabilities'
import { members } from '../utils/sequenceModel'
import { readSkills, skillOf, skillPath } from './skillFlow'

const meaning = (element: AasElement | null | undefined): string => element?.semanticId?.keys?.[0]?.value ?? ''

/** Loads a module's Skills submodel with the skills of its components and its offered capabilities; saves a skill. */
export function useSkillRepository () {
  const { getSmEndpointById, putSubmodel, putSubmodelElement, postSubmodelElement } = useSMRepositoryClient()
  const { getSubmodelRefsById } = useAASRepositoryClient()
  const { fetchAasList } = useAASHandling()
  const { getRequest } = useRequestHandling()

  async function fetchModel (id: string, aasId: string): Promise<AasElement | null> {
    const endpoint = getSmEndpointById(id, aasId)
    if (!endpoint) {
      throw new Error('No submodel repository is configured.')
    }
    const response = await getRequest(endpoint, 'loading the skills', true)
    return response.success ? response.data : null
  }

  async function submodels (aasId: string): Promise<AasElement[]> {
    const ids = (await getSubmodelRefsById(aasId)).map((reference: AasElement) => reference?.keys?.[0]?.value).filter(Boolean)
    const found = await Promise.all(ids.map((id: string) => fetchModel(id, aasId)))
    return found.filter((model): model is AasElement => model !== null)
  }

  /** The Skills submodel as the repository has it (the viewer's copy carries display fields). */
  async function loadSkills (id: string, aasId: string): Promise<AasElement> {
    const model = await fetchModel(id, aasId)
    if (!model) {
      throw new Error('The Skills submodel could not be read.')
    }
    return model
  }

  /** The skills of the module's components: the shells its Hierarchical Structures name as parts. */
  async function loadComponentSkills (aasId: string): Promise<ResourceSkill[]> {
    const structure = (await submodels(aasId)).find(model => isHierarchicalStructures(meaning(model)))
    const entry = members(structure ?? {}).find(element => meaning(element) === HIERARCHICAL_STRUCTURES_SUBMODEL.entryNodeSemanticId)
    const parts = new Set((entry?.statements ?? []).map((node: AasElement) => node.globalAssetId).filter(Boolean))
    const shells = (await fetchAasList()).filter((shell: AasElement) => parts.has(shell.assetInformation?.globalAssetId))
    const skills = await Promise.all(shells.map(async (shell: AasElement) =>
      (await submodels(shell.id)).filter(model => meaning(model) === ARSO_SKILLS_SUBMODEL).flatMap(model => readSkills(model, shell.id))))
    return skills.flat()
  }

  /** What the module offers (IDTA 02020, role Offered), each capability with the skill realizing it. */
  async function loadCapabilities (aasId: string): Promise<CapabilityDescription[]> {
    return (await submodels(aasId)).filter(model => meaning(model) === CAPABILITY_SUBMODEL).flatMap(model => readCapabilities(model, aasId)).filter(item => item.role === 'Offered')
  }

  function element (submodel: AasElement, skill: string) {
    const found = skillOf(submodel, skill)
    const parsed = jsonization.submodelElementFromJsonable(found as never)
    if (!found || parsed.error) {
      throw new Error(`${skill} is no valid skill element${parsed.error ? `: ${parsed.error.message}` : ''}`)
    }
    return parsed.mustValue()
  }

  /**
   * Save one skill of the Skills submodel: replace its element, or (``created``) add it. The other
   * skills are not written, so a skill edited elsewhere at the same time is not overwritten.
   */
  async function saveSkill (submodel: AasElement, skill: string, aasId: string, created = false): Promise<void> {
    const where = skillPath(submodel, skill)
    if (created) {
      const holder = where.includes('.') ? where.slice(0, where.lastIndexOf('.')) : undefined
      if (!await postSubmodelElement(element(submodel, skill), submodel.id, holder, false, aasId)) {
        throw new Error(`The repository did not take the new skill ${skill}.`)
      }
      return
    }
    const endpoint = getSmEndpointById(submodel.id, aasId)
    if (!endpoint || !await putSubmodelElement(element(submodel, skill), `${endpoint}/submodel-elements/${where}`)) {
      throw new Error(`The repository did not take ${skill}.`)
    }
  }

  /** Save the whole Skills submodel. */
  async function save (model: AasElement, aasId: string): Promise<void> {
    const parsed = jsonization.submodelFromJsonable(model as never)
    if (parsed.error) {
      throw new Error(`The skills are no valid submodel: ${parsed.error.message}`)
    }
    if (!await putSubmodel(parsed.mustValue(), true, aasId)) {
      throw new Error('The repository did not take the Skills submodel.')
    }
  }

  return { loadSkills, loadComponentSkills, loadCapabilities, saveSkill, save }
}
