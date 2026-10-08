import type { ProcessPlan } from '../types/plan.ts'
import type { AasElement } from './sequenceModel.ts'
import { buildSequenceDocuments as buildV2, readSequenceDocuments as readV2, DOCUMENT_SEMANTIC_ID as V2_SEMANTIC_ID } from './sequenceDocumentsV2.ts'
import { DOCUMENT_SEMANTIC_ID, packSequence, unpackSequence } from './sequencePacking.ts'
export { canonical, defaultSequenceId, processReferences, referenceId, semanticOf } from './sequenceDocumentsV2.ts'
export { DOCUMENT_SEMANTIC_ID } from './sequencePacking.ts'

export const isSequenceDocument = (model: AasElement) => [V2_SEMANTIC_ID, DOCUMENT_SEMANTIC_ID].includes(model.semanticId?.keys?.[0]?.value)

/** One submodel per owner; local subprocesses are nested AAS collections. */
export function buildSequenceDocuments (...args: Parameters<typeof buildV2>): AasElement[] {
  return [packSequence(buildV2(...args))]
}

/** Older documents remain readable; only the editor projection uses virtual document IDs. */
export async function readSequenceDocuments (root: AasElement, load: (id: string, owner?: string) => Promise<AasElement>): Promise<ProcessPlan> {
  const projected = new Map<string, AasElement>()
  function project (model: AasElement): AasElement {
    const documents = unpackSequence(model)
    for (const document of documents) {
      projected.set(document.id, document)
    }
    return documents[0]!
  }
  const primary = project(root)
  return readV2(primary, async (id, owner) => projected.get(id) ?? project(await load(id, owner)))
}
