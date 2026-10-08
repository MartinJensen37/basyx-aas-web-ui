import type { AasElement } from './sequenceModel.ts'
import { DOCUMENT_SCHEMA, referenceId, semanticOf, DOCUMENT_SEMANTIC_ID as V2_SEMANTIC_ID } from './sequenceDocumentsV2.ts'
import { children, collection, field, indexed, members, modelRef, prop, ref, sem, sequenceSemantic, value } from './sequenceModel.ts'

export const DOCUMENT_SEMANTIC_ID = 'https://smartproductionlab.aau.dk/SubmodelTemplate/ProductionSequence/3/0'
const localDefinitions = (element: AasElement) => children(element, 'LocalSubprocesses')
const keyPath = (reference?: AasElement) => reference?.keys?.map((key: { value: string }) => key.value) ?? []
const identity = (reference?: AasElement) => JSON.stringify(keyPath(reference))
const virtualId = (reference?: AasElement) => `embedded:${identity(reference)}`

/** Remove inactive fields while retaining explicit empty overrides and unresolved legacy assignments. */
function compact (element: AasElement, owner: string): void {
  const items = members(element)
  const referencedBinding = semanticOf(element) === sequenceSemantic('Binding') && field(element, 'SourceElement')
  const omitted = new Set([
    ...(field(element, 'Skill') || !value(element, 'SkillId') ? ['SkillId'] : []),
    ...(referenceId(field(element, 'ProcessOwner')) === owner ? ['ProcessOwner'] : []),
    ...(referenceId(field(element, 'SourceAas')) === owner ? ['SourceAas'] : []),
    ...(referencedBinding ? ['Value'] : []),
    ...['Bindings', 'Outputs'].filter(name => field(element, name) && children(element, name).length === 0),
  ].map(name => sequenceSemantic(name)))
  const filtered = items.filter(child => !omitted.has(semanticOf(child)))
  if (element.modelType === 'Submodel') {
    element.submodelElements = filtered
  } else if (Array.isArray(element.value)) {
    if (filtered.length > 0) {
      element.value = filtered
    } else {
      delete element.value
    }
  }
  for (const child of filtered) {
    compact(child, owner)
  }
}

export function packSequence (documents: AasElement[]): AasElement {
  const primary = structuredClone(documents.find(document => value(document, 'Role') === 'Primary')!)
  if (!primary) {
    throw new Error('The primary sequence is missing.')
  }
  const owner = referenceId(field(primary, 'Subject'))
  const catalog = new Map(documents.map(document => [document.id, document]))
  const paths = new Map<string, AasElement>([[primary.id, modelRef([{ type: 'Submodel', value: primary.id }])]])
  const visited = new Set<string>([primary.id])
  function nest (document: AasElement, path: { type: string, value: string }[]): AasElement[] {
    return children(document, 'Subprocesses').map((link, index) => {
      const child = catalog.get(referenceId(link))
      if (!child) {
        throw new Error('A local subprocess definition is missing.')
      }
      if (visited.has(child.id)) {
        throw new Error('Local subprocess containment contains a cycle or duplicate definition.')
      }
      visited.add(child.id)
      const idShort = indexed('Subprocess', index)
      const next = [...path, { type: 'SubmodelElementCollection', value: 'Subprocesses' }, { type: 'SubmodelElementCollection', value: idShort }]
      paths.set(child.id, modelRef(next))
      const nested = nest(child, next)
      const fields = structuredClone(child.submodelElements).filter((item: AasElement) => !['PlanSchema', 'Revision', 'Role', 'Subject', 'Subprocesses'].some(name => semanticOf(item) === sequenceSemantic(name)))
      if (nested.length > 0) {
        fields.push(collection('Subprocesses', nested, 'LocalSubprocesses'))
      }
      return collection(idShort, fields, 'SubprocessDefinition')
    })
  }
  const nested = nest(primary, paths.get(primary.id)!.keys)
  if (visited.size !== documents.length) {
    throw new Error('A local subprocess is disconnected from the primary sequence.')
  }
  primary.semanticId = sem(DOCUMENT_SEMANTIC_ID)
  primary.submodelElements = members(primary).filter(item => !['PlanSchema', 'Subprocesses'].some(name => semanticOf(item) === sequenceSemantic(name)))
  if (nested.length > 0) {
    primary.submodelElements.push(collection('Subprocesses', nested, 'LocalSubprocesses'))
  }
  function calls (element: AasElement): void {
    const target = field(element, 'SequenceReference')
    if (target && paths.has(referenceId(target))) {
      target.value = structuredClone(paths.get(referenceId(target)))
    }
    for (const child of members(element)) {
      calls(child)
    }
  }
  calls(primary)
  compact(primary, owner)
  return primary
}

/** Expand v3 into the existing validated codec, never into additional repository submodels. */
export function unpackSequence (model: AasElement): AasElement[] {
  if (semanticOf(model) !== DOCUMENT_SEMANTIC_ID) {
    return [model]
  }
  const primary = structuredClone(model)
  const owner = referenceId(field(primary, 'Subject'))
  const documents: AasElement[] = []
  const targets = new Map<string, string>()
  function restore (element: AasElement): void {
    if (field(element, 'ProcessReference') && !field(element, 'ProcessOwner')) {
      element.value.push(ref('ProcessOwner', modelRef([{ type: 'AssetAdministrationShell', value: owner }])))
    }
    if (field(element, 'SourceElement') && !field(element, 'SourceAas')) {
      element.value.push(ref('SourceAas', modelRef([{ type: 'AssetAdministrationShell', value: owner }])))
    }
    for (const child of members(element)) {
      restore(child)
    }
  }
  function extract (element: AasElement, path: { type: string, value: string }[], primaryDocument = false): AasElement {
    if (field(element, 'Subprocesses') || field(element, 'PlanSchema')) {
      throw new Error('A sequence contains an incompatible legacy structure.')
    }
    const id = primaryDocument ? primary.id : virtualId(modelRef(path))
    targets.set(identity(modelRef(path)), id)
    const nested = localDefinitions(element).map(child => {
      if (child.modelType !== 'SubmodelElementCollection' || semanticOf(child) !== sequenceSemantic('SubprocessDefinition')) {
        throw new Error('Invalid local subprocess definition.')
      }
      return extract(child, [...path, { type: 'SubmodelElementCollection', value: field(element, 'LocalSubprocesses')!.idShort }, { type: 'SubmodelElementCollection', value: child.idShort }])
    })
    const fields = members(element).filter(item => semanticOf(item) !== sequenceSemantic('LocalSubprocesses'))
    const document: AasElement = { ...element, modelType: 'Submodel', id, semanticId: sem(V2_SEMANTIC_ID), submodelElements: [
      ...fields, prop('PlanSchema', DOCUMENT_SCHEMA),
      ...(primaryDocument ? [] : [ref('Subject', modelRef([{ type: 'AssetAdministrationShell', value: owner }])), prop('Revision', value(primary, 'Revision')), prop('Role', 'Subprocess')]),
      ...(nested.length > 0 ? [collection('Subprocesses', nested.map((child, index) => ref(indexed('Subprocess', index), modelRef([{ type: 'Submodel', value: child.id }]), 'SequenceReference')))] : []),
    ] }
    delete document.value
    documents.push(document)
    return document
  }
  const root = extract(primary, [{ type: 'Submodel', value: primary.id }], true)
  function calls (element: AasElement): void {
    const reference = field(element, 'SequenceReference')
    if (reference && keyPath(reference.value).length > 1) {
      const target = targets.get(identity(reference.value))
      if (!target) {
        throw new Error('A local sequence reference could not be resolved.')
      }
      reference.value = modelRef([{ type: 'Submodel', value: target }])
    }
    for (const child of members(element)) {
      calls(child)
    }
  }
  for (const document of documents) {
    calls(document)
    restore(document)
  }
  return [root, ...documents.filter(document => document !== root)]
}
