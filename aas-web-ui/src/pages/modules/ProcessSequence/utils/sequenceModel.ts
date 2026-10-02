import type { CapabilityReference, PlanNode, PlanProcess, ProcessPlan, SourceReference } from '../types/plan.ts'

/** Application template: IDTA input/capability submodels remain separate and are linked by references. */
export const SEQUENCE_SEMANTIC_ID = 'https://smartproductionlab.aau.dk/SubmodelTemplate/ProductionSequence/1/0'
export const sequenceSemantic = (name: string) => `https://smartproductionlab.aau.dk/ProductionSequence/${name}/1/0`
export type AasElement = Record<string, any>
const sem = (value: string) => ({ type: 'ExternalReference', keys: [{ type: 'GlobalReference', value }] })
export const modelRef = (keys: { type: string, value: string }[]): CapabilityReference => ({ type: 'ModelReference', keys })
const prop = (idShort: string, value: string | number, valueType = 'xs:string'): AasElement => ({ modelType: 'Property', idShort, semanticId: sem(sequenceSemantic(idShort)), valueType, value: String(value) })
const collection = (idShort: string, value: AasElement[], meaning = idShort): AasElement => ({ modelType: 'SubmodelElementCollection', idShort, semanticId: sem(sequenceSemantic(meaning)), value })
const ref = (idShort: string, value: CapabilityReference, meaning = idShort): AasElement => ({ modelType: 'ReferenceElement', idShort, semanticId: sem(sequenceSemantic(meaning)), value })
const indexed = (prefix: string, index: number) => `${prefix}_${String(index).padStart(4, '0')}`
function members (element: AasElement): AasElement[] {
  const items = element.submodelElements ?? element.value
  return Array.isArray(items) ? items : []
}
const field = (element: AasElement, name: string): AasElement | undefined => members(element).find(child => child.semanticId?.keys?.[0]?.value === sequenceSemantic(name))
const value = (element: AasElement, name: string): string => String(field(element, name)?.value ?? '')
const children = (element: AasElement, name: string): AasElement[] => members(field(element, name) ?? { value: [] })
const ordered = (elements: AasElement[]): AasElement[] => elements.toSorted((a, b) => Number(value(a, 'Order')) - Number(value(b, 'Order')))

function sourceElements (source: SourceReference): AasElement[] {
  return [
    ref('SourceAas', modelRef([{ type: 'AssetAdministrationShell', value: source.aasId }])),
    ref('SourceElement', modelRef([{ type: 'Submodel', value: source.submodelId }, ...source.path.map(value => ({ type: 'SubmodelElement', value }))])),
  ]
}

function sourceFrom (element: AasElement): SourceReference {
  const keys = field(element, 'SourceElement')?.value?.keys ?? []
  return { aasId: field(element, 'SourceAas')?.value?.keys?.[0]?.value ?? '', submodelId: keys[0]?.value ?? '', path: keys.slice(1).map((key: { value: string }) => key.value) }
}

function processElements (process: PlanProcess): AasElement[] {
  return [prop('ProcessId', process.processId), prop('Name', process.name), ...sourceElements(process.source),
    collection('Parameters', process.parameters.map((parameter, index) => collection(indexed('Parameter', index), [
      prop('Name', parameter.name), prop('Group', parameter.group), prop('DataType', parameter.dataType), prop('Value', parameter.value),
      ...sourceElements(parameter.source),
    ], 'Parameter'))), collection('Materials', structuredClone(process.material) as AasElement[]),
    ...(process.requiredCapabilities === undefined ? [] : [requirements(process.requiredCapabilities)]),
  ]
}

function requirements (items: NonNullable<PlanProcess['requiredCapabilities']>): AasElement {
  return collection('RequiredCapabilities', items.map((item, index) => ({
    ...ref(indexed('RequiredCapability', index), item.reference, 'RequiredCapability'), displayName: [{ language: 'en', text: item.name }],
  })))
}

function readRequirements (element: AasElement) {
  return field(element, 'RequiredCapabilities')
    ? children(element, 'RequiredCapabilities').map(item => ({
        name: item.displayName?.find((name: { language: string }) => name.language === 'en')?.text ?? item.idShort, reference: item.value as CapabilityReference,
      }))
    : undefined
}

export function buildSequenceSubmodel (plan: ProcessPlan, id: string): AasElement {
  const scopePaths = new Map(plan.scopes.map((scope, index) => [scope.id, indexed('Scope', index)]))
  const scopeRef = (scopeId: string) => modelRef([{ type: 'Submodel', value: id }, { type: 'SubmodelElementCollection', value: 'Scopes' }, { type: 'SubmodelElementCollection', value: scopePaths.get(scopeId)! }])
  function nodes (items: PlanNode[]): AasElement {
    return collection('Steps', items.map((node, index) => {
      const common = [prop('NodeId', node.id), prop('Kind', node.kind), prop('Name', node.name), prop('Order', index, 'xs:nonNegativeInteger')]
      if (node.kind === 'call') {
        common.push(ref('CalledScope', scopeRef(node.scopeId)))
      } else if (node.kind === 'parallel') {
        common.push(collection('Branches', node.branches.map((branch, index) => collection(indexed('Branch', index), [
          prop('BranchId', branch.id), prop('Name', branch.name), prop('Order', index, 'xs:nonNegativeInteger'), nodes(branch.nodes),
        ], 'Branch'))))
      } else {
        if (node.process) {
          common.push(collection('Process', processElements(node.process)))
        }
        if (node.requiredCapabilities !== undefined) {
          common.push(requirements(node.requiredCapabilities))
        }
        if (node.resourceAasId) {
          common.push(ref('Resource', modelRef([{ type: 'AssetAdministrationShell', value: node.resourceAasId }])))
        }
        common.push(prop('SkillId', node.skillId))
        if (node.skillReference) {
          common.push(ref('Skill', node.skillReference))
        }
        if (node.executionMode) {
          common.push(prop('ExecutionMode', node.executionMode))
        }
        common.push(collection('Bindings', node.bindings.map((binding, index) => collection(indexed('Binding', index), [
          prop('Name', binding.name), prop('Value', binding.value), ...(binding.source ? sourceElements(binding.source) : []),
        ], 'Binding'))))
      }
      return collection(indexed('Step', index), common, 'Step')
    }))
  }
  return {
    modelType: 'Submodel', id, idShort: 'ProductionSequence', kind: 'Instance', semanticId: sem(SEQUENCE_SEMANTIC_ID),
    submodelElements: [prop('PlanSchema', plan.schema), prop('Revision', plan.revision, 'xs:nonNegativeInteger'),
      ref('Product', modelRef([{ type: 'AssetAdministrationShell', value: plan.productAasId }])), ref('RootScope', scopeRef(plan.rootScopeId)),
      collection('Scopes', plan.scopes.map(scope => collection(scopePaths.get(scope.id)!, [
        prop('ScopeId', scope.id), prop('Name', scope.name), ...(scope.parentId ? [ref('ParentScope', scopeRef(scope.parentId))] : []),
        ...(scope.material ? [collection('Material', [...sourceElements(scope.material), prop('GlobalAssetId', scope.material.globalAssetId)])] : []),
        ...(scope.planAasId ? [ref('SharedPlanOwner', modelRef([{ type: 'AssetAdministrationShell', value: scope.planAasId }]))] : []), nodes(scope.nodes),
      ], 'Scope'))),
    ],
  }
}

/** Semantic lookup and explicit order make storage independent of idShort spelling and array ordering. */
export function readSequenceSubmodel (submodel: AasElement): ProcessPlan {
  const rawScopes = children(submodel, 'Scopes')
  const scopeIds = new Map(rawScopes.map(scope => [scope.idShort, value(scope, 'ScopeId')]))
  const target = (element: AasElement, name: string) => {
    const keys = field(element, name)?.value?.keys ?? []
    if (keys.length !== 3 || keys[0].value !== submodel.id || keys[1].value !== field(submodel, 'Scopes')?.idShort) {
      return ''
    }
    return scopeIds.get(keys[2].value) ?? ''
  }
  function nodes (parent: AasElement): PlanNode[] {
    return ordered(children(parent, 'Steps')).map(element => {
      const common = { id: value(element, 'NodeId'), name: value(element, 'Name') }
      const kind = value(element, 'Kind')
      if (kind === 'call') {
        return { ...common, kind, scopeId: target(element, 'CalledScope') }
      }
      if (kind === 'parallel') {
        return { ...common, kind, branches: ordered(children(element, 'Branches')).map(branch => ({ id: value(branch, 'BranchId'), name: value(branch, 'Name'), nodes: nodes(branch) })) }
      }
      if (kind !== 'step') {
        throw new Error(`Unsupported sequence node kind: ${kind}`)
      }
      const process = field(element, 'Process')
      return {
        ...common, kind, process: process
          ? {
              processId: value(process, 'ProcessId'), name: value(process, 'Name'), source: sourceFrom(process),
              parameters: children(process, 'Parameters').map(parameter => ({ name: value(parameter, 'Name'), group: value(parameter, 'Group') as 'ProductParameters', dataType: value(parameter, 'DataType'), value: value(parameter, 'Value'), source: sourceFrom(parameter) })),
              material: children(process, 'Materials'), ...(readRequirements(process) ? { requiredCapabilities: readRequirements(process) } : {}),
            }
          : null,
        resourceAasId: field(element, 'Resource')?.value?.keys?.[0]?.value ?? '', skillId: value(element, 'SkillId'),
        ...(field(element, 'Skill') ? { skillReference: field(element, 'Skill')!.value } : {}),
        ...(field(element, 'ExecutionMode') ? { executionMode: value(element, 'ExecutionMode') as 'manual' | 'station' } : {}),
        ...(readRequirements(element) ? { requiredCapabilities: readRequirements(element) } : {}),
        bindings: children(element, 'Bindings').map(binding => ({ name: value(binding, 'Name'), value: value(binding, 'Value'), source: field(binding, 'SourceElement') ? sourceFrom(binding) : null })),
      }
    })
  }
  return {
    schema: value(submodel, 'PlanSchema') as ProcessPlan['schema'], productAasId: field(submodel, 'Product')?.value?.keys?.[0]?.value ?? '',
    revision: Number(value(submodel, 'Revision')), rootScopeId: target(submodel, 'RootScope'),
    scopes: rawScopes.map(scope => {
      const material = field(scope, 'Material')
      return {
        id: value(scope, 'ScopeId'), name: value(scope, 'Name'), parentId: field(scope, 'ParentScope') ? target(scope, 'ParentScope') : null,
        material: material ? { ...sourceFrom(material), globalAssetId: value(material, 'GlobalAssetId') } : null,
        ...(field(scope, 'SharedPlanOwner') ? { planAasId: field(scope, 'SharedPlanOwner')!.value.keys[0].value } : {}), nodes: nodes(scope),
      }
    }),
  }
}
