import type { PlanNode, PlanProcess, ProcessPlan, StepNode } from '../types/plan.ts'
import { buildSequenceSubmodel, modelRef } from '../utils/sequenceModel.ts'

export const PHARMA_BASE = 'https://smartproductionlab.aau.dk/demo/pharma'
const sem = (value: string) => ({ type: 'ExternalReference', keys: [{ type: 'GlobalReference', value }] })
const pp = (name: string) => `https://admin-shell.io/idta/ProcessParameters/${name}/1/0`
const cap = (name: string) => `https://admin-shell.io/idta/CapabilityDescription/${name}/1/0`
const meaning = (name: string) => `${PHARMA_BASE}/semantics/${name}`
const property = (idShort: string, value: string | number, semanticId = meaning(idShort), valueType = typeof value === 'number' ? 'xs:double' : 'xs:string') => ({ modelType: 'Property', idShort, semanticId: sem(semanticId), valueType, value: String(value) })
const collection = (idShort: string, value: unknown[], semanticId = meaning(idShort)) => ({ modelType: 'SubmodelElementCollection', idShort, semanticId: sem(semanticId), value })
const reference = (idShort: string, value: ReturnType<typeof modelRef>, semanticId = meaning(idShort)) => ({ modelType: 'ReferenceElement', idShort, semanticId: sem(semanticId), value })
const submodel = (id: string, idShort: string, semanticId: string, submodelElements: unknown[]) => ({ modelType: 'Submodel', id, idShort, semanticId: sem(semanticId), submodelElements })
const aas = (name: string) => `${PHARMA_BASE}/aas/${name}`
const sm = (name: string, kind: string) => `${PHARMA_BASE}/sm/${name}/${kind}`
const capRef = (owner: string, name: string) => modelRef([{ type: 'Submodel', value: sm(owner, 'capabilities') }, { type: 'SubmodelElementCollection', value: 'Capabilities' }, { type: 'SubmodelElementCollection', value: name }, { type: 'Capability', value: 'Capability' }])
const skillRef = (owner: string, name: string) => modelRef([{ type: 'Submodel', value: sm(owner, 'skills') }, { type: 'SubmodelElementCollection', value: name }])

type Limit = { name: string, value?: string | number, min?: number, max?: number, unit?: string }
type Recipe = { id: string, name: string, format: 'vial' | 'syringe' | 'cartridge', volume: number[], diameter: number, stopper: number, accuracy: number, inspectionEvery?: number }
export const PHARMA_RECIPES: Recipe[] = [
  { id: 'vial-2ml', name: 'Vial 2 mL', format: 'vial', volume: [2], diameter: 16, stopper: 13, accuracy: 0.1 },
  { id: 'vial-2ml-sampled', name: 'Vial 2 mL - inspection every 5', format: 'vial', volume: [2], diameter: 16, stopper: 13, accuracy: 0.1, inspectionEvery: 5 },
  { id: 'vial-10ml', name: 'Vial 10 mL', format: 'vial', volume: [10], diameter: 24, stopper: 20, accuracy: 0.1 },
  { id: 'syringe-1ml', name: 'Prefilled syringe 1 mL', format: 'syringe', volume: [1], diameter: 8.15, stopper: 6.35, accuracy: 0.01 },
  { id: 'syringe-two-dose', name: 'Prefilled syringe — two doses', format: 'syringe', volume: [0.5, 0.5], diameter: 10.85, stopper: 8.65, accuracy: 0.01 },
  { id: 'cartridge-3ml', name: 'Cartridge 3 mL', format: 'cartridge', volume: [3], diameter: 11.6, stopper: 10.3, accuracy: 0.05 },
  { id: 'cartridge-5ml', name: 'Cartridge 5 mL', format: 'cartridge', volume: [5], diameter: 14, stopper: 12.3, accuracy: 0.05 },
]
const operations = ['Unpacking', 'Loading', 'Filling', 'Stoppering', 'Capping', 'Inspection', 'Unloading', 'Packing'] as const
const stationName = (operation: string) => `${operation.toLowerCase()}-station`
const stationOperations = operations.filter(operation => !['Unpacking', 'Packing'].includes(operation))

function unitDefinition (name: string, unit?: string) {
  return unit
    ? { embeddedDataSpecifications: [{
        dataSpecification: sem('https://admin-shell.io/DataSpecificationTemplates/DataSpecificationIEC61360/3/0'),
        dataSpecificationContent: { modelType: 'DataSpecificationIec61360', preferredName: [{ language: 'en', text: name }], dataType: 'REAL_MEASURE', unit },
      }] }
    : {}
}

function capability (owner: string, name: string, operation: string, role: 'Required' | 'Offered', limits: Limit[]) {
  return collection(name, [
    { modelType: 'Capability', idShort: 'Capability', displayName: [{ language: 'en', text: `${operation} — ${name}` }], semanticId: sem(cap('Capability')),
      supplementalSemanticIds: [sem(meaning(operation))], qualifiers: [{ type: role, kind: 'ValueQualifier', valueType: 'xs:boolean', value: 'true', semanticId: sem(cap(`CapabilityRoleQualifier/${role}`)) }] },
    collection('Properties', limits.map(limit => collection(limit.name, [{
      ...(limit.value === undefined
        ? { modelType: 'Range', idShort: 'Value', valueType: 'xs:double', min: String(limit.min), max: String(limit.max), semanticId: sem('https://admin-shell.io/idta/CapabilityPropertyEnumType/Range/1/0') }
        : property('Value', limit.value, 'https://admin-shell.io/idta/CapabilityPropertyType/Property/1/0')),
      displayName: [{ language: 'en', text: limit.name }], supplementalSemanticIds: [sem(meaning(limit.name))], ...unitDefinition(limit.name, limit.unit),
    }], cap('PropertyContainer'))), cap('PropertySet')),
    ...(role === 'Offered' ? [collection('Relations', [{ modelType: 'RelationshipElement', idShort: 'RealizedBy', semanticId: sem(cap('CapabilityRealizedBy')), first: capRef(owner, name), second: skillRef(owner, name) }], cap('CapabilityRelations'))] : []),
  ], cap('CapabilityContainer'))
}

export function buildPharmaDemo (planId: (aasId: string) => string) {
  const shells: Record<string, any>[] = []
  const submodels: Record<string, any>[] = []
  const plans: ProcessPlan[] = []
  function shell (owner: string, name: string, ids: string[], resource = false): void {
    shells.push({ modelType: 'AssetAdministrationShell', id: aas(owner), idShort: owner.replaceAll('-', '_'), displayName: [{ language: 'en', text: name }],
      assetInformation: { assetKind: resource ? 'Instance' : 'Type', globalAssetId: `${PHARMA_BASE}/asset/${owner}` }, submodels: ids.map(id => modelRef([{ type: 'Submodel', value: id }])) })
  }
  function savePlan (plan: ProcessPlan): void {
    plans.push(plan)
    submodels.push(buildSequenceSubmodel(plan, planId(plan.productAasId)))
  }
  function emptyPart (owner: string, name: string, specifications: Limit[]): void {
    if (shells.some(shell => shell.id === aas(owner))) {
      return
    }
    submodels.push(submodel(sm(owner, 'parameters'), 'ProcessParameters', 'https://admin-shell-io/idta/SubmodelTemplate/ProcessParameters/1/0', [collection('Processes', [], pp('Processes'))]),
      submodel(sm(owner, 'bom'), 'HierarchicalStructures', 'https://admin-shell.io/idta/HierarchicalStructures/1/0/Submodel', []),
      submodel(sm(owner, 'specification'), 'ComponentSpecification', meaning('ComponentSpecification'), specifications.map(item => ({ ...property(item.name, item.value ?? ''), ...unitDefinition(item.name, item.unit) }))))
    savePlan({ schema: 'process-sequence-plan/3.0', productAasId: aas(owner), revision: 0, rootScopeId: 'product', scopes: [{ id: 'product', name, parentId: null, material: null, nodes: [] }] })
    shell(owner, name, [sm(owner, 'parameters'), sm(owner, 'bom'), sm(owner, 'specification'), planId(aas(owner))])
  }

  for (const operation of stationOperations) {
    const owner = stationName(operation)
    const formats = operation === 'Capping' ? ['vial'] : ['vial', 'syringe', 'cartridge']
    const capabilities: unknown[] = []
    const skills: unknown[] = []
    for (const format of formats) {
      const name = `${operation}_${format}`
      const limits: Limit[] = [{ name: 'ContainerType', value: format }, { name: 'GraspDiameter', min: 6, max: 30, unit: 'mm' }]
      if (operation === 'Filling') {
        limits.push({ name: 'FillVolume', min: format === 'syringe' ? 0.1 : 0.5, max: format === 'vial' ? 10 : (format === 'syringe' ? 3 : 5), unit: 'mL' }, { name: 'AbsoluteFillError', value: format === 'vial' ? 0.05 : (format === 'syringe' ? 0.005 : 0.02), unit: 'mL' })
      }
      if (operation === 'Stoppering') {
        limits.push({ name: 'StopperDiameter', min: 6, max: 20, unit: 'mm' })
      }
      if (operation === 'Capping') {
        limits.push({ name: 'CapDiameter', min: 13, max: 20, unit: 'mm' })
      }
      if (operation === 'Inspection') {
        limits.push({ name: 'InspectionMethod', value: 'vision' })
      }
      capabilities.push(capability(owner, name, operation, 'Offered', limits))
      const skillSem = (name: string) => `https://smartproductionlab.aau.dk/Skills/${name}/1/0`
      skills.push(collection(name, [property('SkillId', name, skillSem('SkillId')), property('SkillName', `${operation} ${format}`, skillSem('SkillName')),
        reference('ProvidedCapability', sem(meaning(operation)) as ReturnType<typeof modelRef>, skillSem('ProvidedCapability')),
        collection('Parameters', limits.filter(item => item.name !== 'AbsoluteFillError').map(item => collection(item.name, [
          property('ParameterId', item.name, skillSem('ParameterId')), property('ParameterName', item.name, skillSem('ParameterName')),
          property('DataType', typeof item.value === 'string' ? 'xs:string' : 'xs:double', skillSem('DataType')),
          property('Unit', item.unit ?? '', skillSem('Unit')), property('DefaultValue', item.value ?? item.min ?? '', skillSem('DefaultValue')),
          ...(item.min === undefined ? [] : [property('MinValue', item.min, skillSem('MinValue')), property('MaxValue', item.max!, skillSem('MaxValue'))]),
        ], skillSem('Parameter'))), skillSem('Parameters')),
      ], skillSem('Skill')))
    }
    submodels.push(submodel(sm(owner, 'capabilities'), 'CapabilityDescription', 'https://admin-shell.io/idta/SubmodelTemplate/CapabilityDescription/1/0', [collection('Capabilities', capabilities, cap('CapabilitySet'))]),
      submodel(sm(owner, 'skills'), 'Skills', 'https://smartproductionlab.aau.dk/SubmodelTemplate/Skills/1/0', skills))
    shell(owner, `${operation} station`, [sm(owner, 'capabilities'), sm(owner, 'skills')], true)
  }

  for (const recipe of PHARMA_RECIPES) {
    const bomId = sm(recipe.id, 'bom')
    const parts = [
      { id: `${recipe.id}-container`, name: `${recipe.name} container`, quantity: 1, specs: [{ name: 'Diameter', value: recipe.diameter, unit: 'mm' }] },
      { id: `stopper-${String(recipe.stopper).replace('.', '_')}`, name: `${recipe.stopper} mm rubber stopper`, quantity: recipe.volume.length, specs: [{ name: 'StopperDiameter', value: recipe.stopper, unit: 'mm' }] },
      ...recipe.volume.map((volume, index) => ({ id: `demo-liquid-${index + 1}`, name: `Demo liquid ${index + 1}`, quantity: volume, specs: [{ name: 'Description', value: 'Illustrative liquid; no active pharmaceutical formulation' }] })),
      { id: 'packing-tray', name: 'Packing tray', quantity: 1, specs: [{ name: 'Material', value: 'polymer' }] },
      ...(recipe.format === 'vial' ? [{ id: `cap-${recipe.stopper}`, name: `${recipe.stopper} mm vial cap`, quantity: 1, specs: [{ name: 'CapDiameter', value: recipe.stopper, unit: 'mm' }] }] : []),
    ]
    for (const part of parts) {
      emptyPart(part.id, part.name, part.specs)
    }
    const entities = parts.map((part, index) => ({ modelType: 'Entity', idShort: `Part_${index}`, displayName: [{ language: 'en', text: part.name }], entityType: 'SelfManagedEntity', globalAssetId: `${PHARMA_BASE}/asset/${part.id}`, statements: [property('Quantity', part.quantity), property('QuantityUnit', part.id.startsWith('demo-liquid') ? 'mL' : 'piece')] }))
    submodels.push(submodel(bomId, 'HierarchicalStructures', 'https://admin-shell.io/idta/HierarchicalStructures/1/0/Submodel', [{ modelType: 'Entity', idShort: 'Product', entityType: 'SelfManagedEntity', globalAssetId: `${PHARMA_BASE}/asset/${recipe.id}`, semanticId: sem('https://admin-shell.io/idta/HierarchicalStructures/EntryNode/1/0'), statements: entities }]))
    const sequence = ['Unpacking', 'Loading', ...recipe.volume.flatMap((_, index) => [`Filling_${index + 1}`, `Stoppering_${index + 1}`]), ...(recipe.format === 'vial' ? ['Capping'] : []), 'Inspection', 'Unloading', 'Packing']
    const processes: unknown[] = []
    const capabilities: unknown[] = []
    const nodes: StepNode[] = sequence.map((id, index) => {
      const operation = id.split('_', 1)[0]
      const cycle = Number(id.split('_', 2)[1] ?? 1)
      const manual = operation === 'Unpacking' || operation === 'Packing'
      const name = recipe.volume.length > 1 && ['Filling', 'Stoppering'].includes(operation) ? `${operation} — dose ${cycle}` : operation
      const limits: Limit[] = [{ name: 'ContainerType', value: recipe.format }, { name: 'GraspDiameter', value: recipe.diameter, unit: 'mm' }]
      if (operation === 'Filling') {
        limits.push({ name: 'FillVolume', value: recipe.volume[cycle - 1], unit: 'mL' }, { name: 'AbsoluteFillError', min: 0, max: recipe.accuracy, unit: 'mL' })
      }
      if (operation === 'Stoppering') {
        limits.push({ name: 'StopperDiameter', value: recipe.stopper, unit: 'mm' })
      }
      if (operation === 'Capping') {
        limits.push({ name: 'CapDiameter', value: recipe.stopper, unit: 'mm' })
      }
      if (operation === 'Inspection') {
        limits.push({ name: 'InspectionMethod', value: 'vision' })
      }
      if (!manual) {
        capabilities.push(capability(recipe.id, id, operation, 'Required', limits))
      }
      const source = { aasId: aas(recipe.id), submodelId: sm(recipe.id, 'parameters'), path: ['Processes', `Process_${index}`] }
      const parameters: PlanProcess['parameters'] = limits.filter(item => item.value !== undefined).map(item => ({ name: item.name, group: 'ProductParameters' as const, dataType: typeof item.value === 'number' ? 'xs:double' : 'xs:string', value: String(item.value), ...(item.unit ? { unit: item.unit } : {}), source: { ...source, path: [...source.path, 'ProductParameters', item.name] } }))
      parameters.push(...[{ name: 'Cycle', value: String(cycle), dataType: 'xs:double' }, { name: 'RecipeNote', value: 'Illustrative values; editable engineering demo', dataType: 'xs:string' }].map(parameter => ({ ...parameter, group: 'ProcessParameters' as const, source: { ...source, path: [...source.path, 'ProcessParameters', parameter.name] } })))
      const requiredCapabilities = manual ? [] : [{ name, reference: capRef(recipe.id, id) }]
      const relevant = parts.filter(part => {
        if (operation === 'Filling') {
          return part.id === `demo-liquid-${cycle}`
        }
        if (operation === 'Stoppering') {
          return part.id.startsWith('stopper-')
        }
        if (operation === 'Capping') {
          return part.id.startsWith('cap-')
        }
        return part.id.endsWith('-container') || (manual && part.id === 'packing-tray')
      })
      const material = relevant.map((part, index) => reference(`Material_${index}`, modelRef([{ type: 'Submodel', value: bomId }, { type: 'Entity', value: 'Product' }, { type: 'Entity', value: `Part_${parts.indexOf(part)}` }])))
      const process: PlanProcess = { processId: id, name, source, parameters, material, requiredCapabilities }
      processes.push(collection(`Process_${index}`, [property('ProcessId', id, pp('ProcessId')), property('ProcessName', name, pp('ProcessName')),
        { modelType: 'MultiLanguageProperty', idShort: 'ProcessDescription', semanticId: sem(pp('ProcessDescription')), value: [{ language: 'en', text: `${name} for ${recipe.name}. Illustrative engineering recipe.` }] },
        property('PlannedProcessTime', 'PT5S', pp('PlannedProcessTime'), 'xs:duration'),
        collection('ProductParameters', parameters.filter(parameter => parameter.group === 'ProductParameters').map(parameter => ({ ...property(parameter.name, parameter.value, meaning(parameter.name), parameter.dataType), ...unitDefinition(parameter.name, limits.find(item => item.name === parameter.name)?.unit) })), pp('ProductParameters')),
        collection('ProcessParameters', [property('Cycle', cycle), property('RecipeNote', 'Illustrative values; editable engineering demo')], pp('ProcessParameters')),
        collection('ResourceParameters', [], pp('ResourceParameters')), collection('ProcessBoM', material, pp('ProcessBoM')),
        ...requiredCapabilities.map(item => ({ ...reference('RequiredCapability', item.reference, 'https://smartproductionlab.aau.dk/ProcessParameters/RequiredCapability/1/0'), displayName: [{ language: 'en', text: name }] })),
      ], pp('Process')))
      const station = stationName(operation)
      return { id, kind: 'step', name, process, requiredCapabilities, executionMode: manual ? 'manual' : 'station', resourceAasId: manual ? '' : aas(station), skillId: manual ? '' : `${operation}_${recipe.format}`,
        ...(manual ? {} : { skillReference: skillRef(station, `${operation}_${recipe.format}`) }), bindings: manual ? [] : parameters.filter(parameter => parameter.group === 'ProductParameters').map(parameter => ({ name: parameter.name, value: '', source: parameter.source })) }
    })
    submodels.push(submodel(sm(recipe.id, 'parameters'), 'ProcessParameters', 'https://admin-shell-io/idta/SubmodelTemplate/ProcessParameters/1/0', [collection('Processes', processes, pp('Processes'))]),
      submodel(sm(recipe.id, 'capabilities'), 'CapabilityDescription', 'https://admin-shell.io/idta/SubmodelTemplate/CapabilityDescription/1/0', [collection('Capabilities', capabilities, cap('CapabilitySet'))]))
    const plannedNodes: PlanNode[] = nodes.map(node => node.id === 'Inspection' && recipe.inspectionEvery
      ? { id: 'periodic-inspection', kind: 'conditional', name: 'Periodic inspection', condition: { kind: 'everyNthProduct', every: recipe.inspectionEvery }, nodes: [node] }
      : node)
    savePlan({ schema: 'process-sequence-plan/5.0', productAasId: aas(recipe.id), revision: 1, rootScopeId: 'product', scopes: [
      { id: 'product', name: recipe.name, parentId: null, material: null, nodes: plannedNodes },
      ...parts.map((part, index) => ({ id: `part-${index}`, name: part.name, parentId: 'product', nodes: [], planAasId: aas(part.id), material: { aasId: aas(recipe.id), submodelId: bomId, path: ['Product', `Part_${index}`], globalAssetId: `${PHARMA_BASE}/asset/${part.id}` } })),
    ] })
    shell(recipe.id, recipe.name, [bomId, sm(recipe.id, 'parameters'), sm(recipe.id, 'capabilities'), planId(aas(recipe.id))])
  }
  return { shells, submodels, plans }
}
