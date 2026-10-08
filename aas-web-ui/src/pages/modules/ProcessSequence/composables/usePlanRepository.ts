import type { PlanProcess, ProcessPlan } from '../types/plan'
import type { AasElement } from '../utils/sequenceModel'
import { jsonization } from '@aas-core-works/aas-core3.1-typescript'
import { useAASRepositoryClient } from '@/composables/Client/AASRepositoryClient'
import { useSMRepositoryClient } from '@/composables/Client/SMRepositoryClient'
import { useRequestHandling } from '@/composables/RequestHandling'
import { base64Encode } from '@/utils/EncodeDecodeUtils'
import { newPlan, parsePlan } from '../utils/plan'
import { readPlanProcesses } from '../utils/planSources'
import { buildSequenceDocuments, canonical, defaultSequenceId, DOCUMENT_SEMANTIC_ID, isSequenceDocument, processReferences, readSequenceDocuments, referenceId, semanticOf } from '../utils/sequenceDocuments'
import { field, readSequenceSubmodel, SEQUENCE_SEMANTIC_ID, value } from '../utils/sequenceModel'

export const planSubmodelId = defaultSequenceId
export function buildPlanSubmodel (productAasId: string) {
  return buildSequenceDocuments(newPlan(productAasId, 'Product'), planSubmodelId(productAasId), [])[0]!
}

/** Documents own their steps. Product trees and resolved process values exist only in the editor. */
export function usePlanRepository () {
  const { getSmEndpointById, postSubmodel, putSubmodel, fetchAttachmentFile } = useSMRepositoryClient()
  const { getAasEndpointById, getSubmodelRefsById } = useAASRepositoryClient()
  const { getRequest, postRequest, deleteRequest } = useRequestHandling()
  const primaryIds = new Map<string, string>()
  const baselines = new Map<string, Map<string, { owner: string, content: string | null }>>()
  const models = new Map<string, AasElement>()
  const migration = new Set<string>()
  const legacyContents = new Map<string, string>()

  async function fetchModel (id: string, owner: string): Promise<AasElement | null> {
    const endpoint = getSmEndpointById(id, owner)
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
    return response.data
  }

  async function discover (owner: string): Promise<string> {
    const references = await getSubmodelRefsById(owner)
    const candidates = references.flatMap(reference => reference.keys ?? []).filter(key => key.type === 'Submodel').map(key => String(key.value))
    const found: string[] = []
    for (const id of candidates) {
      const model = await fetchModel(id, owner)
      if (model && (semanticOf(model) === SEQUENCE_SEMANTIC_ID || semanticOf(model) === 'https://smartproductionlab.aau.dk/SubmodelTemplate/ProcessSequence/2/0' || (isSequenceDocument(model) && value(model, 'Role') === 'Primary'))) {
        found.push(id)
      }
    }
    if (found.length > 1) {
      throw new Error('This product has several primary sequences. Resolve the ambiguous primary reference before editing.')
    }
    return found[0] ?? planSubmodelId(owner)
  }

  async function load (owner: string, explicitId?: string): Promise<ProcessPlan | null> {
    const id = explicitId || await discover(owner)
    migration.delete(owner)
    legacyContents.delete(owner)
    primaryIds.set(owner, id)
    const baseline = new Map<string, { owner: string, content: string | null }>()
    baselines.set(owner, baseline)
    async function get (id: string, aas = owner): Promise<AasElement> {
      const model = await fetchModel(id, aas)
      const sequence = model && (isSequenceDocument(model) || semanticOf(model) === SEQUENCE_SEMANTIC_ID)
      const documentOwner = sequence && (referenceId(field(model!, 'Subject')) || referenceId(field(model!, 'Product')))
      // Another asset's sequence is checked by that asset's own repository session.
      if (!documentOwner || documentOwner === owner) {
        baseline.set(id, { owner: aas, content: model ? canonical(model) : null })
      }
      if (!model) {
        throw new Error(`Referenced submodel ${id} is missing.`)
      }
      models.set(id, model)
      return model
    }
    const model = await fetchModel(id, owner)
    baseline.set(id, { owner, content: model ? canonical(model) : null })
    if (!model) {
      return null
    }
    models.set(id, model)
    if (isSequenceDocument(model)) {
      if (semanticOf(model) !== DOCUMENT_SEMANTIC_ID) {
        migration.add(owner)
      }
      return parsePlan(JSON.stringify(await readSequenceDocuments(model, get)), owner)
    }
    migration.add(owner)
    if (semanticOf(model) === SEQUENCE_SEMANTIC_ID) {
      return parsePlan(JSON.stringify(readSequenceSubmodel(model)), owner)
    }
    const definition = model.submodelElements?.find((element: AasElement) => element.idShort === 'Definition')
    if (!definition || definition.modelType !== 'File') {
      throw new Error('The saved plan has no Definition file.')
    }
    if (!definition.value) {
      return null
    }
    const blob = await fetchAttachmentFile(`${getSmEndpointById(id, owner)}/submodel-elements/Definition`, 'blob')
    if (!blob) {
      throw new Error('The plan attachment could not be read.')
    }
    // Track attachment content as well as its container when checking legacy plans.
    const plan = parsePlan(await blob.text(), owner)
    legacyContents.set(owner, JSON.stringify(plan))
    return plan
  }

  async function check (owner: string): Promise<void> {
    const baseline = baselines.get(owner)
    if (!baseline) {
      throw new Error('Load the sequence before saving.')
    }
    for (const [id, expected] of baseline) {
      const model = await fetchModel(id, expected.owner)
      if ((model ? canonical(model) : null) !== expected.content) {
        throw new Error('The server plan or a referenced process changed in another view. Reload the latest version before saving.')
      }
    }
    if (legacyContents.has(owner)) {
      const id = primaryIds.get(owner)!
      const blob = await fetchAttachmentFile(`${getSmEndpointById(id, owner)}/submodel-elements/Definition`, 'blob')
      if (!blob || JSON.stringify(parsePlan(await blob.text(), owner)) !== legacyContents.get(owner)) {
        throw new Error('The server plan changed in another view. Reload the latest version before saving.')
      }
    }
  }

  async function save (plan: ProcessPlan): Promise<ProcessPlan> {
    const owner = plan.productAasId
    const primaryId = primaryIds.get(owner)
    const baseline = baselines.get(owner)
    if (!primaryId || !baseline) {
      throw new Error('Load the sequence before saving.')
    }
    await check(owner)
    const processes: PlanProcess[] = []
    for (const source of processReferences(plan)) {
      const model = await fetchModel(source.submodelId, source.aasId)
      if (!model) {
        throw new Error(`The process source for ${source.submodelId} is missing.`)
      }
      if (!baseline.has(source.submodelId)) {
        baseline.set(source.submodelId, { owner: source.aasId, content: canonical(model) })
      }
      processes.push(...readPlanProcesses(model, source.aasId))
    }
    const revision = Math.max(plan.revision, Number(value(models.get(primaryId) ?? {}, 'Revision')) || 0) + 1
    const next = parsePlan(JSON.stringify({ ...plan, revision }), owner)
    const documents = buildSequenceDocuments(next, primaryId, processes, aas => primaryIds.get(aas) ?? planSubmodelId(aas))
    for (const document of documents) {
      if (!baseline.has(document.id)) {
        const existing = await fetchModel(document.id, owner)
        if (existing) {
          throw new Error(`Submodel ${document.id} already exists outside this loaded plan. Reload before saving.`)
        }
        baseline.set(document.id, { owner, content: null })
      }
    }
    await check(owner)
    for (const document of documents) {
      const original = models.get(document.id)
      const owned = new Set(document.submodelElements.map((element: AasElement) => element.idShort))
      document.submodelElements.push(...(original?.submodelElements ?? []).filter((element: AasElement) => !owned.has(element.idShort)
        && !element.semanticId?.keys?.some((key: { value: string }) => key.value.startsWith('https://smartproductionlab.aau.dk/ProductionSequence/'))))
      const parsed = jsonization.submodelFromJsonable(document as never)
      if (parsed.error) {
        throw new Error('The sequence could not be represented as valid AAS elements.')
      }
      const existed = baseline.get(document.id)!.content !== null
      const saved = existed ? await putSubmodel(parsed.mustValue(), true, owner) : await postSubmodel(parsed.mustValue(), true, owner)
      if (!saved) {
        throw new Error('The plan could not be saved. Your draft is still open; successfully written documents can be retried.')
      }
      baseline.set(document.id, { owner, content: canonical(jsonization.toJsonable(parsed.mustValue())) })
      models.set(document.id, document)
      if (document.id === primaryId) {
        legacyContents.delete(owner)
      }
      const references = await getSubmodelRefsById(owner)
      if (!references.some(reference => reference.keys?.some((key: { value: string }) => key.value === document.id))) {
        const linked = await postRequest(`${getAasEndpointById(owner)}/submodel-refs`, JSON.stringify({ type: 'ModelReference', keys: [{ type: 'Submodel', value: document.id }] }), new Headers({ 'Content-Type': 'application/json' }), 'linking the process plan', true)
        if (!linked.success) {
          throw new Error('The plan could not be linked to the product.')
        }
      }
    }
    // The embedded copy is now authoritative. Keep legacy repository documents for other consumers.
    const references = await getSubmodelRefsById(owner)
    for (const [id] of baseline) {
      const old = models.get(id)
      if (id === primaryId || !old || value(old, 'Role') !== 'Subprocess' || referenceId(field(old, 'Subject')) !== owner) {
        continue
      }
      if (references.some(reference => reference.keys?.some((key: { value: string }) => key.value === id))) {
        const detached = await deleteRequest(`${getAasEndpointById(owner)}/submodel-refs/${base64Encode(id)}`, new Headers(), 'removing the migrated subprocess link', true)
        if (!detached.success && detached.status !== 404) {
          throw new Error('The sequence was saved, but a legacy subprocess link could not be removed. Retry saving.')
        }
      }
      baseline.delete(id)
    }
    migration.delete(owner)
    for (const scope of next.scopes) {
      const document = documents.find(document => value(document, 'SequenceId') === scope.id)
      if (document) {
        scope.sequenceId = document.id
      }
    }
    return next
  }

  return { load, save, check, needsMigration: (owner: string) => migration.has(owner) }
}
