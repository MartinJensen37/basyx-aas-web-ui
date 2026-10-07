import type { PlanProcess, PlanScope, ProcessPlan, SourceReference, StepNode } from '../types/plan.ts'
import type { AasElement } from './sequenceModel.ts'
import { readPlanProcesses } from './planSources.ts'
import { buildNodes, children, collection, field, members, modelRef, processElements, prop, readSequenceSubmodel, ref, sem, sourceElements, sourceFrom, value } from './sequenceModel.ts'

export const DOCUMENT_SEMANTIC_ID = 'https://smartproductionlab.aau.dk/SubmodelTemplate/ProductionSequence/2/0'
export const DOCUMENT_SCHEMA = 'production-sequence/2.0'
export const semanticOf = (model: AasElement) => model.semanticId?.keys?.[0]?.value
export const referenceId = (element?: AasElement): string => element?.value?.keys?.[0]?.value ?? ''
export function canonical (input: unknown): string {
  return JSON.stringify(input, (_key, value) => value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).filter(([, item]) => item != null && (!Array.isArray(item) || item.length > 0)).toSorted(([a], [b]) => a.localeCompare(b)))
    : value)
}
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b)
const sourceKey = (source: SourceReference) => canonical(source)
const elementReference = (source: SourceReference) => modelRef([{ type: 'Submodel', value: source.submodelId }, ...source.path.map(value => ({ type: 'SubmodelElement', value }))])

export function defaultSequenceId (aasId: string): string {
  const encoded = btoa(String.fromCodePoint(...new TextEncoder().encode(aasId))).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
  return `https://smartproductionlab.aau.dk/sm/process-plan/${encoded}`
}

/** One document for each locally owned definition. The BoM is never serialized into a plan. */
export function buildSequenceDocuments (plan: ProcessPlan, primaryId: string, processes: PlanProcess[], ownerId = defaultSequenceId): AasElement[] {
  const root = plan.scopes.find(scope => scope.id === plan.rootScopeId)!
  if (!root) {
    throw new Error('The sequence has no root definition.')
  }
  const ids = new Map(plan.scopes.map(scope => [scope.id, scope.sequenceId || (scope.planAasId ? ownerId(scope.planAasId) : (scope.id === root.id ? primaryId : `${primaryId}/subprocess/${encodeURIComponent(scope.id)}`))]))
  const catalog = new Map(processes.map(process => [sourceKey(process.source), process]))
  const local = plan.scopes.filter(scope => !scope.planAasId && (scope.id === root.id || !scope.material || scope.nodes.length > 0
    || plan.scopes.some(child => child.parentId === scope.id && !child.planAasId)))

  function operation (node: StepNode): AasElement[] {
    if (!node.process) {
      return []
    }
    const process = node.process
    const baseline = catalog.get(sourceKey(process.source))
    if (!baseline) {
      throw new Error(`The process definition for ${node.name} could not be resolved. Restore it before migrating or saving.`)
    }
    const overrides = process.parameters.flatMap(parameter => {
      const original = baseline.parameters.find(item => same(item.source, parameter.source))
      // Older snapshots may omit unit metadata; inherit it rather than inventing a unit.
      const unit = parameter.unit ?? original?.unit
      if (!original || original.dataType !== parameter.dataType || original.unit !== unit) {
        throw new Error(`The definition of ${node.name} / ${parameter.name} changed. Reconcile its type, unit or removed parameter before saving.`)
      }
      return original.value === parameter.value
        ? []
        : [collection(`Override_${overridesIndex++}`, [
            ref('ParameterReference', elementReference(parameter.source)), prop('Value', parameter.value), prop('DataType', parameter.dataType),
            ...(unit === undefined ? [] : [prop('Unit', unit)]),
          ], 'ParameterOverride')]
    })
    return [ref('ProcessOwner', modelRef([{ type: 'AssetAdministrationShell', value: process.source.aasId }])), ref('ProcessReference', elementReference(process.source)),
      ...(overrides.length > 0 ? [collection('ParameterOverrides', overrides)] : []),
      ...(same(process.material, baseline.material) ? [] : [collection('MaterialOverrides', structuredClone(process.material) as AasElement[])]),
    ]
  }

  let overridesIndex = 0
  return local.map(scope => {
    const nodes = structuredClone(scope.nodes)
    function normalize (items: typeof nodes): void {
      for (const node of items) {
        if (node.kind === 'step' && node.process) {
          const baseline = catalog.get(sourceKey(node.process.source))
          const effective = node.requiredCapabilities ?? node.process.requiredCapabilities
          if (baseline && same(effective ?? [], baseline.requiredCapabilities ?? [])) {
            delete node.requiredCapabilities
          } else if (effective !== undefined) {
            node.requiredCapabilities = effective
          }
        } else if (node.kind === 'conditional') {
          normalize(node.nodes)
        } else if (node.kind === 'parallel' || node.kind === 'decision') {
          for (const branch of node.branches) {
            normalize(branch.nodes)
          }
        }
      }
    }
    normalize(nodes)
    const steps = buildNodes(nodes, () => {
      throw new Error('Calls require a direct sequence reference.')
    }, operation, node => {
      const target = plan.scopes.find(item => item.id === node.scopeId)
      if (!target) {
        throw new Error(`The subprocess ${node.name} has no definition.`)
      }
      return [ref('SequenceReference', modelRef([{ type: 'Submodel', value: ids.get(target.id)! }])),
        ...(target.planAasId ? [prop('OccurrenceId', target.id)] : []),
        ...(target.material ? [collection('Component', [...sourceElements(target.material), prop('GlobalAssetId', target.material.globalAssetId)])] : []),
      ]
    })
    const subprocesses = local.filter(child => child.parentId === scope.id)
    return {
      modelType: 'Submodel', kind: 'Instance', id: ids.get(scope.id), idShort: scope.id === root.id ? 'ProductionSequence' : 'ProductionSubprocess', semanticId: sem(DOCUMENT_SEMANTIC_ID),
      submodelElements: [prop('PlanSchema', DOCUMENT_SCHEMA), prop('Revision', plan.revision, 'xs:nonNegativeInteger'),
        prop('SequenceId', scope.id), prop('Name', scope.name), prop('Role', scope.id === root.id ? 'Primary' : 'Subprocess'),
        ref('Subject', modelRef([{ type: 'AssetAdministrationShell', value: plan.productAasId }])),
        ...(scope.material ? [collection('Component', [...sourceElements(scope.material), prop('GlobalAssetId', scope.material.globalAssetId)])] : []),
        ...(subprocesses.length > 0 ? [collection('Subprocesses', subprocesses.map((child, index) => ref(`Subprocess_${index}`, modelRef([{ type: 'Submodel', value: ids.get(child.id)! }]), 'SequenceReference')))] : []),
        steps,
      ],
    }
  })
}

/** Resolve reference-based documents into the editor's transient tree and effective process values. */
export async function readSequenceDocuments (root: AasElement, load: (id: string, owner?: string) => Promise<AasElement>): Promise<ProcessPlan> {
  const owner = referenceId(field(root, 'Subject'))
  const models = new Map<string, AasElement>([[root.id, root]])
  const scopes = new Map<string, PlanScope>()
  const pendingCalls: AasElement[] = []
  const idToScope = new Map<string, string>()
  const processes = new Map<string, PlanProcess>()
  const get = async (id: string, aas = owner) => {
    if (!id) {
      throw new Error('A sequence reference is missing its target.')
    }
    if (!models.has(id)) {
      models.set(id, await load(id, aas))
    }
    return models.get(id)!
  }
  const rootId = value(root, 'SequenceId')

  async function visit (document: AasElement, parentId: string | null, ancestors = new Set<string>()): Promise<void> {
    if (ancestors.has(document.id)) {
      throw new Error('Sequence definitions contain a cycle.')
    }
    if (idToScope.has(document.id)) {
      return
    }
    if (semanticOf(document) !== DOCUMENT_SEMANTIC_ID || value(document, 'PlanSchema') !== DOCUMENT_SCHEMA || referenceId(field(document, 'Subject')) !== owner) {
      throw new Error('A local subprocess has an incompatible schema or owner.')
    }
    const id = value(document, 'SequenceId')
    if (!id || scopes.has(id)) {
      throw new Error('Sequence identities must be present and unique for their owner.')
    }
    const component = field(document, 'Component')
    const scope: PlanScope = { id, name: value(document, 'Name'), parentId, sequenceId: document.id, material: component ? { ...sourceFrom(component), globalAssetId: value(component, 'GlobalAssetId') } : null, nodes: [] }
    scopes.set(id, scope)
    idToScope.set(document.id, id)
    const projected = structuredClone(document)

    async function resolve (parent: AasElement): Promise<void> {
      for (const element of children(parent, 'Steps')) {
        if (value(element, 'Kind') === 'call') {
          pendingCalls.push(element)
        }
        const processRef = field(element, 'ProcessReference')
        if (processRef) {
          const source: SourceReference = { aasId: referenceId(field(element, 'ProcessOwner')), submodelId: referenceId(processRef), path: processRef.value.keys.slice(1).map((key: { value: string }) => key.value) }
          const key = sourceKey(source)
          if (!processes.has(key)) {
            const model = await get(source.submodelId, source.aasId)
            const process = readPlanProcesses(model, source.aasId).find(item => same(item.source, source))
            if (!process) {
              throw new Error(`The process used by ${value(element, 'Name')} is missing.`)
            }
            processes.set(key, process)
          }
          const process = structuredClone(processes.get(key)!)
          for (const override of children(element, 'ParameterOverrides')) {
            const reference = field(override, 'ParameterReference')?.value
            const parameter = process.parameters.find(item => same([item.source.submodelId, ...item.source.path], reference?.keys?.map((key: { value: string }) => key.value)))
            if (!parameter || parameter.dataType !== value(override, 'DataType') || (parameter.unit ?? '') !== value(override, 'Unit')) {
              throw new Error(`An override in ${value(element, 'Name')} no longer matches its parameter definition.`)
            }
            parameter.value = value(override, 'Value')
          }
          if (field(element, 'MaterialOverrides')) {
            process.material = children(element, 'MaterialOverrides')
          }
          element.value.push(collection('Process', processElements(process)))
        }
        await resolve(element)
        for (const branch of children(element, 'Branches')) {
          await resolve(branch)
        }
      }
    }
    await resolve(projected)
    // The existing node codec also validates typed conditions. Only the projection uses scopes.
    scope.nodes = []
    models.set(`projected:${document.id}`, projected)
    const next = new Set([...ancestors, document.id])
    for (const child of children(document, 'Subprocesses')) {
      await visit(await get(referenceId(child)), id, next)
    }
  }
  await visit(root, null)
  for (const node of pendingCalls) {
    const targetId = referenceId(field(node, 'SequenceReference'))
    const target = await get(targetId)
    const targetOwner = referenceId(field(target, 'Subject')) || referenceId(field(target, 'Product'))
    let targetScope = idToScope.get(targetId)
    if (targetOwner === owner) {
      if (!targetScope) {
        await visit(target, rootId)
        targetScope = idToScope.get(targetId)
      }
    } else {
      if (!targetOwner) {
        throw new Error(`The subprocess ${value(node, 'Name')} has no owner.`)
      }
      targetScope = value(node, 'OccurrenceId') || `sequence:${targetId}`
      const component = field(node, 'Component')
      const stub: PlanScope = { id: targetScope, name: value(target, 'Name') || value(node, 'Name'), parentId: rootId, sequenceId: targetId, planAasId: targetOwner, nodes: [], material: component ? { ...sourceFrom(component), globalAssetId: value(component, 'GlobalAssetId') } : null }
      const existing = scopes.get(targetScope)
      if (existing && (existing.sequenceId !== targetId || !same(existing.material, stub.material))) {
        throw new Error('A component occurrence references conflicting sequence definitions.')
      }
      if (!existing) {
        scopes.set(targetScope, stub)
      }
    }
    node.value.push(prop('ResolvedTarget', targetScope!))
  }
  const rawScopes = [...scopes.values()].map(scope => {
    const projected = models.get(`projected:${scope.sequenceId}`)
    return collection(scope.id, [prop('ScopeId', scope.id), prop('Name', scope.name),
      ...(scope.parentId ? [ref('ParentScope', modelRef([{ type: 'Submodel', value: root.id }, { type: 'SubmodelElementCollection', value: 'Scopes' }, { type: 'SubmodelElementCollection', value: scope.parentId }]))] : []),
      field(projected ?? {}, 'Steps') ?? collection('Steps', []),
    ], 'Scope')
  })
  function calls (element: AasElement): void {
    if (field(element, 'ResolvedTarget')) {
      element.value.push(ref('CalledScope', modelRef([{ type: 'Submodel', value: root.id }, { type: 'SubmodelElementCollection', value: 'Scopes' }, { type: 'SubmodelElementCollection', value: value(element, 'ResolvedTarget') }])))
    }
    for (const child of members(element)) {
      calls(child)
    }
  }
  for (const scope of rawScopes) {
    calls(scope)
  }
  const projected = { id: root.id, submodelElements: [prop('PlanSchema', 'process-sequence-plan/5.0'), prop('Revision', value(root, 'Revision')), ref('Product', modelRef([{ type: 'AssetAdministrationShell', value: owner }])), ref('RootScope', modelRef([{ type: 'Submodel', value: root.id }, { type: 'SubmodelElementCollection', value: 'Scopes' }, { type: 'SubmodelElementCollection', value: rootId }])), collection('Scopes', rawScopes)] }
  const plan = readSequenceSubmodel(projected)
  plan.scopes = plan.scopes.map(scope => ({ ...scopes.get(scope.id)!, nodes: scope.nodes }))
  return plan
}

export function processReferences (plan: ProcessPlan): SourceReference[] {
  const sources = new Map<string, SourceReference>()
  function visit (nodes: PlanScope['nodes']): void {
    for (const node of nodes) {
      if (node.kind === 'step' && node.process) {
        sources.set(sourceKey(node.process.source), node.process.source)
      } else if (node.kind === 'conditional') {
        visit(node.nodes)
      } else if (node.kind === 'parallel' || node.kind === 'decision') {
        for (const branch of node.branches) {
          visit(branch.nodes)
        }
      }
    }
  }
  for (const scope of plan.scopes.filter(scope => !scope.planAasId)) {
    visit(scope.nodes)
  }
  return [...sources.values()]
}
