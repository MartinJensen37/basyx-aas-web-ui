import type { ProcessPlan, StepNode } from '../types/plan'
import type { AasElement } from './sequenceModel'
import { jsonization, verification } from '@aas-core-works/aas-core3.1-typescript'
import { describe, expect, it } from 'vitest'
import { buildPharmaDemo } from '../demo/pharma'
import { flattenNodes, newPlan, parsePlan } from './plan'
import { readPlanProcesses } from './planSources'
import { buildSequenceDocuments, DOCUMENT_SEMANTIC_ID, readSequenceDocuments } from './sequenceDocuments'
import { buildSequenceDocuments as buildV2 } from './sequenceDocumentsV2'
import { buildSequenceSubmodel, children, collection, field, modelRef, readSequenceSubmodel, ref } from './sequenceModel'
import { packSequence } from './sequencePacking'

const demo = buildPharmaDemo(id => `${id}/sequence`)
const original = demo.plans.find(plan => plan.productAasId.endsWith('/vial-2ml'))!
const processes = demo.submodels.flatMap(model => readPlanProcesses(model, original.productAasId))
const clone = <T>(value: T): T => structuredClone(value)
const catalog = new Map(demo.submodels.map(model => [model.id, model]))
async function load (id: string): Promise<AasElement> {
  const model = catalog.get(id)
  if (!model) {
    throw new Error(`Missing ${id}`)
  }
  return clone(model)
}

describe('locally owned sequence documents', () => {
  it('stores only the product steps and references, without component scopes or parameter snapshots', async () => {
    const documents = buildSequenceDocuments(original, 'urn:vial:sequence', processes)
    expect(documents).toHaveLength(1)
    const model = documents[0]!
    const parsed = jsonization.submodelFromJsonable(model as never)
    expect(parsed.error).toBeNull()
    expect([...verification.verify(parsed.mustValue())].map(error => `${error.path}: ${error.message}`)).toEqual([])
    expect(field(model, 'Scopes')).toBeUndefined()
    expect(field(model, 'RootScope')).toBeUndefined()
    expect(children(model, 'Steps')).toHaveLength(8)
    for (const step of children(model, 'Steps')) {
      expect(field(step, 'Process')).toBeUndefined()
      expect(field(step, 'ProcessOwner')).toBeUndefined()
      expect(field(step, 'SkillId')).toBeUndefined()
      expect(field(step, 'ProcessReference')).toBeDefined()
      expect(field(step, 'ParameterOverrides')).toBeUndefined()
      expect(field(step, 'RequiredCapabilities')).toBeUndefined()
    }
    const loaded = await readSequenceDocuments(model, load)
    expect(loaded.scopes).toHaveLength(1)
    expect(loaded.scopes[0]!.nodes.map(node => node.name)).toEqual(original.scopes[0]!.nodes.map(node => node.name))
    expect((loaded.scopes[0]!.nodes[2] as StepNode).process).toEqual((original.scopes[0]!.nodes[2] as StepNode).process)
  })

  it('migrates edited legacy values into overrides and inherits unmodified source values after reload', async () => {
    const legacy = clone(original)
    const fill = legacy.scopes[0]!.nodes[2] as StepNode
    fill.process!.parameters.find(parameter => parameter.name === 'FillVolume')!.value = '1.8'
    const migrated = readSequenceSubmodel(buildSequenceSubmodel(legacy, 'urn:old'))
    const model = buildSequenceDocuments(migrated, 'urn:vial:sequence', processes)[0]!
    const overrides = children(children(model, 'Steps')[2]!, 'ParameterOverrides')
    expect(overrides).toHaveLength(1)
    // References can use the concrete Property key type or the generic SubmodelElement type.
    field(overrides[0]!, 'ParameterReference')!.value.keys.at(-1).type = 'Property'
    const changedSource = async (id: string) => {
      const model = await load(id)
      function edit (element: AasElement): void {
        if (element.idShort === 'RecipeNote') {
          element.value = 'Updated source note'
        }
        for (const child of element.submodelElements ?? (Array.isArray(element.value) ? element.value : [])) {
          edit(child)
        }
      }
      edit(model)
      return model
    }
    const loaded = await readSequenceDocuments(model, changedSource)
    const actual = (loaded.scopes[0]!.nodes[2] as StepNode).process!
    expect(actual.parameters.find(parameter => parameter.name === 'FillVolume')!.value).toBe('1.8')
    expect(actual.parameters.find(parameter => parameter.name === 'RecipeNote')!.value).toBe('Updated source note')
  })

  it('migrates pre-unit formats and rejects incompatible or missing source definitions', async () => {
    const legacy = clone(original)
    legacy.schema = 'process-sequence-plan/3.0'
    for (const node of legacy.scopes[0]!.nodes) {
      if (node.kind === 'step') {
        for (const parameter of node.process!.parameters) {
          delete parameter.unit
        }
      }
    }
    const fill = legacy.scopes[0]!.nodes[2] as StepNode
    fill.process!.parameters.find(parameter => parameter.name === 'FillVolume')!.value = '1.8'
    const model = buildSequenceDocuments(legacy, 'urn:vial:sequence', processes)[0]!
    const loaded = await readSequenceDocuments(model, load)
    expect((loaded.scopes[0]!.nodes[2] as StepNode).process!.parameters.find(parameter => parameter.name === 'FillVolume')).toMatchObject({ value: '1.8', unit: 'mL' })
    fill.process!.parameters[0]!.unit = 'incompatible'
    expect(() => buildSequenceDocuments(legacy, 'urn:sequence', processes)).toThrow('Reconcile')
    expect(() => buildSequenceDocuments(legacy, 'urn:sequence', [])).toThrow('could not be resolved')
    await expect(readSequenceDocuments(model, async () => ({ submodelElements: [] }))).rejects.toThrow('missing')
  })

  it('writes local subprocesses once, keeps uncalled definitions, and resolves direct calls', async () => {
    const plan = newPlan('urn:product', 'Product')
    plan.scopes.push({ id: 'prepare', name: 'Prepare', parentId: 'product', material: null, nodes: [{ id: 'job', kind: 'step', name: 'Mix', process: null, resourceAasId: '', skillId: '', bindings: [] }] }, { id: 'unused', name: 'Unused draft', parentId: 'prepare', material: null, nodes: [] })
    plan.scopes[0]!.nodes = [{ id: 'first', kind: 'call', name: 'Prepare first', scopeId: 'prepare' }, { id: 'second', kind: 'call', name: 'Prepare second', scopeId: 'prepare' }]
    const documents = buildSequenceDocuments(plan, 'urn:primary', [])
    expect(documents).toHaveLength(1)
    const root = documents[0]!
    const nested = children(root, 'LocalSubprocesses')
    expect(nested).toHaveLength(1)
    expect(children(nested[0]!, 'LocalSubprocesses')).toHaveLength(1)
    expect(field(nested[0]!, 'Subject')).toBeUndefined()
    const target = field(children(root, 'Steps')[0]!, 'SequenceReference')!.value
    expect(target.keys).toEqual([
      { type: 'Submodel', value: root.id },
      { type: 'SubmodelElementCollection', value: 'Subprocesses' },
      { type: 'SubmodelElementCollection', value: nested[0]!.idShort },
    ])
    expect([...verification.verify(jsonization.submodelFromJsonable(root as never).mustValue())].map(error => `${error.path}: ${error.message}`)).toEqual([])
    const loaded = await readSequenceDocuments(root, load)
    const old = buildV2(plan, 'urn:primary', [])
    const migrated = await readSequenceDocuments(old[0]!, async id => clone(old.find(model => model.id === id)!))
    expect(buildSequenceDocuments(migrated, 'urn:primary', [])).toEqual(documents)
    // Semantic meaning survives idShort changes when reference paths are updated.
    field(root, 'LocalSubprocesses')!.idShort = 'Definitions'
    for (const step of children(root, 'Steps')) {
      field(step, 'SequenceReference')!.value.keys[1].value = 'Definitions'
    }
    expect((await readSequenceDocuments(root, load)).scopes.map(scope => scope.nodes)).toEqual(loaded.scopes.map(scope => scope.nodes))
    target.keys.at(-1).value = 'Missing'
    await expect(readSequenceDocuments(root, load)).rejects.toThrow('could not be resolved')
    expect(parsePlan(JSON.stringify(loaded), plan.productAasId).scopes.map(scope => scope.nodes)).toEqual(plan.scopes.map(scope => scope.nodes))
  })

  it('preserves explicit clears, constants, foreign owners and reference-based skill identity', async () => {
    const plan = clone(original)
    const operation = plan.scopes[0]!.nodes[2] as StepNode
    operation.requiredCapabilities = []
    operation.process!.material = []
    operation.bindings.push({ name: 'empty', value: '', source: null }, { name: 'zero', value: '0', source: null })
    operation.skillId = 'obsolete cached identity'
    const root = buildSequenceDocuments(plan, 'urn:primary', processes)[0]!
    const step = children(root, 'Steps')[2]!
    expect(field(step, 'SkillId')).toBeUndefined()
    expect(field(step, 'RequiredCapabilities')).toBeDefined()
    expect(field(step, 'MaterialOverrides')).toBeDefined()
    const binding = children(step, 'Bindings').find(binding => field(binding, 'SourceElement'))!
    expect(field(binding, 'Value')).toBeUndefined()
    expect(field(binding, 'SourceAas')).toBeUndefined()
    const restored = (await readSequenceDocuments(root, load)).scopes[0]!.nodes[2] as StepNode
    expect(restored.skillId).toBe('')
    expect(restored.skillReference).toEqual(operation.skillReference)
    expect(restored.bindings).toEqual(operation.bindings)
    expect(restored.requiredCapabilities).toEqual([])
    expect(restored.process!.material).toEqual([])
    plan.productAasId = 'urn:another-owner'
    const foreign = children(buildSequenceDocuments(plan, 'urn:foreign', processes)[0]!, 'Steps')[2]!
    expect(field(foreign, 'ProcessOwner')).toBeDefined()
    expect(field(children(foreign, 'Bindings')[0]!, 'SourceAas')).toBeDefined()
  })

  it('finds the primary independently of array order and rejects disconnected definitions', () => {
    const plan = newPlan('urn:product', 'P')
    plan.scopes.unshift({ id: 'child', name: 'Child', parentId: 'product', material: null, nodes: [] })
    const documents = buildV2(plan, 'urn:primary', [])
    expect(packSequence(documents).id).toBe('urn:primary')
    plan.scopes[0]!.parentId = 'missing'
    expect(() => buildSequenceDocuments(plan, 'urn:primary', [])).toThrow('disconnected')
  })

  it('references an external component sequence without copying its steps', async () => {
    const plan: ProcessPlan = newPlan('urn:parent', 'Parent')
    plan.scopes.push({ id: 'child', name: 'Child', parentId: 'product', planAasId: 'urn:child', sequenceId: 'urn:custom:child-sequence', material: { aasId: 'urn:parent', submodelId: 'urn:bom', path: ['Product', 'Child'], globalAssetId: 'urn:asset:child' }, nodes: [] })
    plan.scopes[0]!.nodes = [{ id: 'call', name: 'Prepare child', kind: 'call', scopeId: 'child' }]
    const child = buildSequenceDocuments(newPlan('urn:child', 'Child'), 'urn:custom:child-sequence', [])[0]!
    const root = buildSequenceDocuments(plan, 'urn:parent:sequence', [])[0]!
    expect(field(children(root, 'Steps')[0]!, 'SequenceReference')?.value.keys).toEqual([{ type: 'Submodel', value: child.id }])
    const loaded = await readSequenceDocuments(root, async () => child)
    expect(loaded.scopes[1]).toMatchObject({ planAasId: 'urn:child', sequenceId: child.id, nodes: [], material: plan.scopes[1]!.material })
    expect(flattenNodes(loaded.scopes[0]!.nodes)[0]).toMatchObject({ kind: 'call', scopeId: 'child' })
  })

  it('refuses missing references, containment cycles and unknown schema versions', async () => {
    const model = buildV2(newPlan('urn:p', 'P'), 'urn:primary', [])[0]!
    model.submodelElements.push(collection('Subprocesses', [ref('Child', modelRef([{ type: 'Submodel', value: model.id }]), 'SequenceReference')]))
    await expect(readSequenceDocuments(model, load)).rejects.toThrow('cycle')
    model.submodelElements.pop()
    field(model, 'PlanSchema')!.value = 'production-sequence/999.0'
    await expect(readSequenceDocuments(model, load)).rejects.toThrow('incompatible')
    model.semanticId.keys[0].value = DOCUMENT_SEMANTIC_ID
    await expect(readSequenceDocuments(model, load)).rejects.toThrow('incompatible')
  })
})
