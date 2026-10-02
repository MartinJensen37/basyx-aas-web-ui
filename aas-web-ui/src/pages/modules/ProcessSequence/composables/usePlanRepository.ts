import type { ProcessPlan } from '../types/plan'
import { jsonization } from '@aas-core-works/aas-core3.1-typescript'
import { useAASRepositoryClient } from '@/composables/Client/AASRepositoryClient'
import { useSMRepositoryClient } from '@/composables/Client/SMRepositoryClient'
import { useRequestHandling } from '@/composables/RequestHandling'
import { base64Encode } from '@/utils/EncodeDecodeUtils'
import { newPlan, parsePlan } from '../utils/plan'
import { buildSequenceSubmodel, readSequenceSubmodel, SEQUENCE_SEMANTIC_ID } from '../utils/sequenceModel'

export const PLAN_SEMANTIC_ID = 'https://smartproductionlab.aau.dk/SubmodelTemplate/ProcessSequence/2/0'

export function planSubmodelId (productAasId: string): string {
  return `https://smartproductionlab.aau.dk/sm/process-plan/${base64Encode(productAasId)}`
}

export function buildPlanSubmodel (productAasId: string) {
  return buildSequenceSubmodel(newPlan(productAasId, 'Product'), planSubmodelId(productAasId))
}

/** Structured AAS elements are authoritative; legacy JSON attachments are read for migration only. */
export function usePlanRepository () {
  const { getSmEndpointById, postSubmodel, putSubmodel, fetchAttachmentFile } = useSMRepositoryClient()
  const { getAasEndpointById, getSubmodelRefsById } = useAASRepositoryClient()
  const { getRequest, postRequest } = useRequestHandling()
  const baselines = new Map<string, string | null>()
  const models = new Map<string, Record<string, any>>()

  async function read (productAasId: string): Promise<string | null> {
    const endpoint = getSmEndpointById(planSubmodelId(productAasId), productAasId)
    if (!endpoint) {
      throw new Error('No submodel repository is configured.')
    }
    const response = await getRequest(endpoint, 'loading the process plan', true)
    if (response.status === 404) {
      return null
    }
    if (!response.success) {
      throw new Error('The saved plan could not be read. Editing is paused to protect the saved version.')
    }
    models.set(productAasId, response.data)
    if (response.data?.semanticId?.keys?.[0]?.value === SEQUENCE_SEMANTIC_ID) {
      return JSON.stringify(parsePlan(JSON.stringify(readSequenceSubmodel(response.data)), productAasId))
    }
    const definition = response.data?.submodelElements?.find((element: { idShort: string }) => element.idShort === 'Definition')
    if (!definition || definition.modelType !== 'File') {
      throw new Error('The saved plan has no Definition file.')
    }
    if (!definition.value) {
      return null
    }
    const blob = await fetchAttachmentFile(`${endpoint}/submodel-elements/Definition`, 'blob')
    if (!blob) {
      throw new Error('The plan attachment could not be read.')
    }
    return blob.text()
  }

  async function load (productAasId: string): Promise<ProcessPlan | null> {
    const content = await read(productAasId)
    const plan = content === null ? null : parsePlan(content, productAasId)
    baselines.set(productAasId, content)
    return plan
  }

  async function save (plan: ProcessPlan): Promise<ProcessPlan> {
    const productAasId = plan.productAasId
    const previous = await read(productAasId)
    if (!baselines.has(productAasId) || previous !== baselines.get(productAasId)) {
      throw new Error('The server plan changed in another view. Reload the latest version before saving.')
    }
    const next = parsePlan(JSON.stringify({ ...plan, revision: Math.max(plan.revision, previous ? parsePlan(previous, productAasId).revision : 0) + 1 }), productAasId)
    const submodelId = planSubmodelId(productAasId)
    const endpoint = getSmEndpointById(submodelId, productAasId)
    const structured = buildSequenceSubmodel(next, submodelId)
    // Keep legacy attachments/backup elements available without making them authoritative again.
    const original = models.get(productAasId)
    const owned = new Set(structured.submodelElements.map((element: { idShort: string }) => element.idShort))
    structured.submodelElements.push(...(original?.submodelElements ?? []).filter((element: { idShort: string }) => !owned.has(element.idShort)))
    const parsedModel = jsonization.submodelFromJsonable(structured as never)
    if (parsedModel.error) {
      throw new Error('The sequence could not be represented as valid AAS elements.')
    }
    let created = false
    if (previous === null) {
      const response = await getRequest(endpoint, 'checking the plan container', true)
      if (response.status === 404) {
        if (!await postSubmodel(parsedModel.mustValue(), true, productAasId)) {
          throw new Error('The process plan container could not be created.')
        }
        created = true
        baselines.set(productAasId, JSON.stringify(next))
        models.set(productAasId, structured)
      } else if (!response.success) {
        throw new Error('The process plan container could not be checked.')
      }
    }
    const references = await getSubmodelRefsById(productAasId)
    if (!references.some(reference => reference.keys?.some((key: { value: string }) => key.value === submodelId))) {
      const endpoint = getAasEndpointById(productAasId)
      const reference = { type: 'ModelReference', keys: [{ type: 'Submodel', value: submodelId }] }
      const linked = await postRequest(`${endpoint}/submodel-refs`, JSON.stringify(reference),
        new Headers({ 'Content-Type': 'application/json' }), 'linking the process plan', true)
      if (!linked.success) {
        throw new Error('The plan could not be linked to the product.')
      }
    }
    if (!created && !await putSubmodel(parsedModel.mustValue(), true, productAasId)) {
      throw new Error('The plan could not be saved. Your draft is still open.')
    }
    baselines.set(productAasId, JSON.stringify(next))
    models.set(productAasId, structured)
    return next
  }

  async function check (productAasId: string): Promise<void> {
    if (!baselines.has(productAasId) || await read(productAasId) !== baselines.get(productAasId)) {
      throw new Error('A linked assembly changed in another view. Reload the latest version before saving.')
    }
  }

  return { load, save, check }
}
