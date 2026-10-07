import type { AasElement } from '../../src/pages/modules/ProcessSequence/utils/sequenceModel'
import type { APIRequestContext } from '@playwright/test'
import { Buffer } from 'node:buffer'
import { DOCUMENT_SEMANTIC_ID, readSequenceDocuments, semanticOf } from '../../src/pages/modules/ProcessSequence/utils/sequenceDocuments'
import { readSequenceSubmodel } from '../../src/pages/modules/ProcessSequence/utils/sequenceModel'

export async function readStoredSequence (model: AasElement, request: APIRequestContext, repository: string) {
  if (semanticOf(model) !== DOCUMENT_SEMANTIC_ID) {
    return readSequenceSubmodel(model)
  }
  return readSequenceDocuments(model, async id => {
    const response = await request.get(`${repository}/submodels/${Buffer.from(id).toString('base64url')}`)
    if (!response.ok()) {
      throw new Error(`Reading referenced sequence/process ${id}: ${response.status()}`)
    }
    return response.json()
  })
}

/** Delete all sequence documents owned by these fixture AASs, including newly authored subprocesses. */
export async function cleanSequenceDocuments (request: APIRequestContext, repository: string, owners: string[]) {
  for (const owner of owners) {
    const response = await request.get(`${repository}/shells/${Buffer.from(owner).toString('base64url')}`)
    if (!response.ok()) {
      continue
    }
    for (const reference of (await response.json()).submodels ?? []) {
      const id = reference.keys?.[0]?.value
      if (!id) {
        continue
      }
      const endpoint = `${repository}/submodels/${Buffer.from(id).toString('base64url')}`
      const model = await request.get(endpoint)
      if (model.ok() && semanticOf(await model.json()) === DOCUMENT_SEMANTIC_ID) {
        await request.delete(endpoint)
      }
    }
  }
}
