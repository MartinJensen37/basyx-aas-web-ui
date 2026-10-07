import type { PlanProcess, PlanScope, ProcessPlan, StepNode } from '../types/plan.ts'
import { Buffer } from 'node:buffer'
import { materialSemantic, upgradeMaterialUses } from '../utils/materials.ts'
import { readPlanProcesses } from '../utils/planSources.ts'
import { extractAssembly } from '../utils/planTree.ts'
import { buildSequenceDocuments, canonical, DOCUMENT_SEMANTIC_ID, processReferences, readSequenceDocuments, referenceId, semanticOf } from '../utils/sequenceDocuments.ts'
import { field, readSequenceSubmodel, SEQUENCE_SEMANTIC_ID, value } from '../utils/sequenceModel.ts'
import { buildPharmaDemo } from './pharma.ts'

const base = 'https://smartproductionlab.aau.dk'
const demo = `${base}/demo/process-plan`
const productId = `${demo}/aas/product`
const bomId = `${demo}/sm/bom`
const encode = (value: string) => Buffer.from(value).toString('base64url')
const sourceId = (owner: string) => `${demo}/sm/${owner}/ProcessParameters`
const aasId = (owner: string) => owner === 'product' ? productId : `${demo}/aas/${owner}`
const semantic = (value: string) => ({ type: 'ExternalReference', keys: [{ type: 'GlobalReference', value }] })
const reference = (type: string, value: string) => ({ type: 'ModelReference', keys: [{ type, value }] })
const property = (idShort: string, value: string, valueType = 'xs:string') => ({ modelType: 'Property', idShort, value, valueType })
const collection = (idShort: string, value: unknown[]) => ({ modelType: 'SubmodelElementCollection', idShort, value })
const indexed = (prefix: string, index: number) => `${prefix}__${String(index).padStart(2, '0')}__`
const ppSemantic = (name: string) => semantic(`https://admin-shell.io/idta/ProcessParameters/${name}/1/0`)
const capSemantic = (name: string) => semantic(`https://admin-shell.io/idta/CapabilityDescription/${name}/1/0`)
const capabilityId = (owner: string) => `${demo}/sm/${owner}/CapabilityDescription`
function capabilityReference (owner: string, skill: string) {
  return {
    type: 'ModelReference' as const, keys: [
      { type: 'Submodel', value: capabilityId(owner) },
      { type: 'SubmodelElementCollection', value: 'CapabilitySet' },
      { type: 'SubmodelElementCollection', value: skill },
      { type: 'Capability', value: 'Capability' },
    ],
  }
}

type JsonModel = { [key: string]: unknown, id: string, idShort: string, modelType: string }
type ProcessSpec = { owner: string, id: string, name: string, resource: string, skill: string, setpoint: string, material: string[] }

const specifications: ProcessSpec[] = [
  { owner: 'drive', id: 'prepare-housing', name: 'Prepare housing', resource: 'drive-cell', skill: 'Prepare', setpoint: '1', material: ['DriveAssembly', 'Housing'] },
  { owner: 'drive', id: 'install-motor', name: 'Install motor', resource: 'drive-cell', skill: 'Assemble', setpoint: '8', material: ['DriveAssembly', 'Motor'] },
  { owner: 'drive', id: 'inspect-drive', name: 'Inspect drive', resource: 'drive-cell', skill: 'Inspect', setpoint: '0.2', material: ['DriveAssembly'] },
  { owner: 'control', id: 'mount-board', name: 'Mount control board', resource: 'control-cell', skill: 'Assemble', setpoint: '2', material: ['ControlAssembly', 'ControlBoard'] },
  { owner: 'control', id: 'test-control', name: 'Test control electronics', resource: 'control-cell', skill: 'Inspect', setpoint: '24', material: ['ControlAssembly'] },
  { owner: 'product', id: 'final-assembly', name: 'Final assembly', resource: 'final-cell', skill: 'Assemble', setpoint: '6', material: [] },
  { owner: 'product', id: 'functional-test', name: 'Functional test', resource: 'final-cell', skill: 'Inspect', setpoint: '60', material: [] },
]

/** Self-contained data so the same seed can run in Node on the host or in a Docker sidecar. */
export function buildDemo (): { shells: JsonModel[], submodels: JsonModel[], plan: ProcessPlan, plans: ProcessPlan[] } {
  const shells: JsonModel[] = []
  const submodels: JsonModel[] = []
  const processes = new Map<string, PlanProcess>()
  const scopeId = (path: string[]) => JSON.stringify(['product', bomId, ['Product', ...path]])
  const scopes: PlanScope[] = [{ id: 'product', name: 'Demo robot', parentId: null, material: null, nodes: [] }]

  function addCapabilities (owner: string, role: 'Required' | 'Offered', skills: string[]): void {
    submodels.push({
      modelType: 'Submodel', id: capabilityId(owner), idShort: 'CapabilityDescription',
      semanticId: semantic('https://admin-shell.io/idta/SubmodelTemplate/CapabilityDescription/1/0'),
      submodelElements: [{
        ...collection('CapabilitySet', skills.map((skill, index) => ({
          ...collection(skill, [
            {
              modelType: 'Capability', idShort: 'Capability', displayName: [{ language: 'en', text: skill }],
              semanticId: capSemantic('Capability'), supplementalSemanticIds: [semantic(`${demo}/capability/${skill}`)],
              qualifiers: [{ type: role, kind: 'ValueQualifier', valueType: 'xs:boolean', value: 'true', semanticId: capSemantic(`CapabilityRoleQualifier/${role}`) }],
            },
            ...(role === 'Offered'
              ? [{
                  ...collection('CapabilityRelations', [{
                    modelType: 'RelationshipElement', idShort: 'RealizedBy', semanticId: capSemantic('CapabilityRealizedBy'),
                    first: capabilityReference(owner, skill),
                    second: { type: 'ModelReference', keys: [
                      { type: 'Submodel', value: `${demo}/sm/${owner}/Skills` },
                      { type: 'SubmodelElementCollection', value: indexed('Skill', index) },
                    ] },
                  }]), semanticId: capSemantic('CapabilityRelations'),
                }]
              : []),
          ]), semanticId: capSemantic('CapabilityContainer'),
        }))), semanticId: capSemantic('CapabilitySet'),
      }],
    })
  }

  function materialEntity (idShort: string, name: string, parentPath: string[], owner?: string, children: unknown[] = []): unknown {
    const path = [...parentPath, idShort]
    const asset = owner ? `${demo}/asset/${owner}` : ''
    scopes.push({
      id: scopeId(path), name, parentId: parentPath.length > 0 ? scopeId(parentPath) : 'product', nodes: [],
      material: { aasId: productId, submodelId: bomId, path: ['Product', ...path], globalAssetId: asset },
    })
    return {
      modelType: 'Entity', idShort, displayName: [{ language: 'en', text: name }],
      entityType: owner ? 'SelfManagedEntity' : 'CoManagedEntity',
      ...(asset ? { globalAssetId: asset } : {}), statements: children,
    }
  }

  const drive = materialEntity('DriveAssembly', 'Drive assembly', [], 'drive', [
    materialEntity('Housing', 'Housing', ['DriveAssembly']),
    materialEntity('Motor', 'Motor', ['DriveAssembly']),
  ])
  const control = materialEntity('ControlAssembly', 'Control assembly', [], 'control', [
    materialEntity('ControlBoard', 'Control board', ['ControlAssembly']),
    materialEntity('Enclosure', 'Enclosure', ['ControlAssembly']),
  ])
  submodels.push({
    modelType: 'Submodel', id: bomId, idShort: 'HierarchicalStructures',
    semanticId: semantic('https://admin-shell.io/idta/HierarchicalStructures/1/0/Submodel'),
    submodelElements: [{
      modelType: 'Entity', idShort: 'Product', entityType: 'SelfManagedEntity', globalAssetId: `${demo}/asset/product`,
      semanticId: semantic('https://admin-shell.io/idta/HierarchicalStructures/EntryNode/1/0'), statements: [drive, control],
    }],
  })

  for (const owner of ['product', 'drive', 'control']) {
    if (owner !== 'product') {
      const entity = structuredClone(owner === 'drive' ? drive : control) as Record<string, unknown>
      submodels.push({
        modelType: 'Submodel', id: `${demo}/sm/${owner}/bom`, idShort: 'HierarchicalStructures',
        semanticId: semantic('https://admin-shell.io/idta/HierarchicalStructures/1/0/Submodel'),
        submodelElements: [{ ...entity, semanticId: semantic('https://admin-shell.io/idta/HierarchicalStructures/EntryNode/1/0') }],
      })
    }
    addCapabilities(owner, 'Required', [...new Set(specifications.filter(spec => spec.owner === owner).map(spec => spec.skill))])
    const elements = specifications.filter(spec => spec.owner === owner).map((spec, index) => {
      const path = ['Processes', indexed('Process', index)]
      const source = { aasId: aasId(owner), submodelId: sourceId(owner), path }
      const parameters = [
        { group: 'ProductParameters' as const, name: 'Setpoint', value: spec.setpoint, dataType: 'xs:double' },
        { group: 'ProcessParameters' as const, name: 'Speed', value: '0.5', dataType: 'xs:double' },
        { group: 'ResourceParameters' as const, name: 'Fixture', value: 'standard', dataType: 'xs:string' },
      ].map(parameter => ({ ...parameter, source: { ...source, path: [...path, parameter.group, parameter.name] } }))
      const material = [{
        modelType: 'ReferenceElement', idShort: 'Workpiece',
        value: {
          type: 'ModelReference', keys: [
            { type: 'Submodel', value: bomId },
            ...['Product', ...spec.material].map(value => ({ type: 'Entity', value })),
          ],
        },
      }]
      const requiredCapabilities = [{ name: spec.skill, reference: capabilityReference(owner, spec.skill) }]
      processes.set(spec.id, { processId: spec.id, name: spec.name, source, parameters, material, requiredCapabilities })
      return {
        ...collection(indexed('Process', index), [...[
          property('ProcessId', spec.id), property('ProcessName', spec.name),
          { modelType: 'MultiLanguageProperty', idShort: 'ProcessDescription', value: [{ language: 'en', text: `${spec.name} in the demonstration process.` }] },
          property('PlannedProcessTime', 'PT30S', 'xs:duration'),
          ...parameters.map(parameter => collection(parameter.group, [property(parameter.name, parameter.value, parameter.dataType)])),
          collection('ProcessBoM', material),
        ].map(element => ({ ...element, semanticId: ppSemantic(element.idShort) })),
        {
          modelType: 'ReferenceElement', idShort: 'RequiredCapability',
          displayName: [{ language: 'en', text: spec.skill }],
          value: capabilityReference(owner, spec.skill),
          semanticId: semantic(`${base}/ProcessParameters/RequiredCapability/1/0`),
        },
        ]),
        semanticId: ppSemantic('Process'),
      }
    })
    submodels.push({
      modelType: 'Submodel', id: sourceId(owner), idShort: 'ProcessParameters',
      semanticId: semantic('https://admin-shell-io/idta/SubmodelTemplate/ProcessParameters/1/0'),
      submodelElements: [{ ...collection('Processes', elements), semanticId: ppSemantic('Processes') }],
    })
    shells.push({
      modelType: 'AssetAdministrationShell', id: aasId(owner),
      idShort: { product: 'PSDemoRobot', drive: 'PSDemoDriveAssembly', control: 'PSDemoControlAssembly' }[owner]!,
      assetInformation: { assetKind: 'Type', globalAssetId: `${demo}/asset/${owner}` },
      submodels: [owner === 'product' ? bomId : `${demo}/sm/${owner}/bom`, sourceId(owner), `${base}/sm/process-plan/${encode(aasId(owner))}`, capabilityId(owner)].map(id => reference('Submodel', id)),
    })
  }

  for (const [resource, name] of [['drive-cell', 'PSDemoDriveCell'], ['control-cell', 'PSDemoControlCell'], ['final-cell', 'PSDemoFinalCell']]) {
    addCapabilities(resource, 'Offered', ['Prepare', 'Assemble', 'Inspect'])
    const skillsId = `${demo}/sm/${resource}/Skills`
    const skills = ['Prepare', 'Assemble', 'Inspect'].map((skill, index) => collection(indexed('Skill', index), [
      property('SkillId', skill), property('SkillName', skill), property('SkillDescription', `${skill} on ${name}`),
      { modelType: 'ReferenceElement', idShort: 'ProvidedCapability', value: semantic(`${demo}/capability/${skill}`) },
      collection('Parameters', [collection('Parameter__00__', [
        property('ParameterId', 'setpoint'), property('ParameterName', 'Setpoint'), property('DataType', 'xs:double'),
        property('DefaultValue', '1', 'xs:double'), property('MinValue', '0', 'xs:double'), property('MaxValue', '100', 'xs:double'),
      ])]),
      collection('Requires', []), collection('Ensures', []),
      collection('Occupies', [{ modelType: 'ReferenceElement', idShort: 'Equipment', value: semantic(`${demo}/equipment/${resource}`) }]),
    ]))
    submodels.push({
      modelType: 'Submodel', id: skillsId, idShort: 'Skills',
      semanticId: semantic(`${base}/SubmodelTemplate/Skills/1/0`), submodelElements: skills,
    })
    shells.push({
      modelType: 'AssetAdministrationShell', id: aasId(resource), idShort: name,
      assetInformation: { assetKind: 'Instance', globalAssetId: `${demo}/asset/${resource}` },
      submodels: [reference('Submodel', skillsId), reference('Submodel', capabilityId(resource))],
    })
  }

  function step (id: string): StepNode {
    const spec = specifications.find(spec => spec.id === id)!
    const process = processes.get(id)!
    return {
      id, kind: 'step', name: spec.name, process, resourceAasId: aasId(spec.resource), skillId: spec.skill,
      bindings: [{ name: 'setpoint', value: '', source: process.parameters[0].source }],
    }
  }
  const driveScope = scopes.find(scope => scope.id === scopeId(['DriveAssembly']))!
  const controlScope = scopes.find(scope => scope.id === scopeId(['ControlAssembly']))!
  scopes.push({ id: 'inspect-drive-process', name: 'Drive inspection', parentId: driveScope.id, material: null, nodes: [step('inspect-drive')] })
  driveScope.nodes = [step('prepare-housing'), step('install-motor'), { id: 'call-drive-inspection', kind: 'call', name: 'Drive inspection', scopeId: 'inspect-drive-process' }]
  controlScope.nodes = [step('mount-board'), step('test-control')]
  scopes[0].nodes = [
    {
      id: 'parallel-assemblies', kind: 'parallel', name: 'Build subassemblies in parallel', branches: [
        { id: 'drive-branch', name: 'Drive assembly', nodes: [{ id: 'call-drive', kind: 'call', name: 'Build drive assembly', scopeId: driveScope.id }] },
        { id: 'control-branch', name: 'Control assembly', nodes: [{ id: 'call-control', kind: 'call', name: 'Build control assembly', scopeId: controlScope.id }] },
      ],
    }, step('final-assembly'), step('functional-test'),
  ]
  const plan: ProcessPlan = { schema: 'process-sequence-plan/2.0', productAasId: productId, revision: 1, rootScopeId: 'product', scopes }
  const plans = splitDemoPlan(plan)
  for (const definition of plans) {
    const documents = buildSequenceDocuments(definition, `${base}/sm/process-plan/${encode(definition.productAasId)}`, [...processes.values()])
    submodels.push(...documents as JsonModel[])
    const shell = shells.find(shell => shell.id === definition.productAasId)!
    shell.submodels = [...shell.submodels as unknown[], ...documents.slice(1).map(document => reference('Submodel', document.id))]
  }
  return { shells, submodels, plan, plans }
}

/** Split the existing demo, including user-authored steps and nested subprocesses. */
export function splitDemoPlan (original: ProcessPlan): ProcessPlan[] {
  const root = structuredClone(original)
  root.schema = 'process-sequence-plan/3.0'
  delete root.linkedRevisions
  const children: ProcessPlan[] = []
  for (const owner of ['drive', 'control']) {
    const scope = root.scopes.find(scope => scope.material?.globalAssetId === `${demo}/asset/${owner}`)
    if (!scope || scope.planAasId) {
      continue
    }
    const child = extractAssembly(root, scope.id, aasId(owner))
    child.revision = 1
    const descendants = new Set(child.scopes.filter(item => item.id !== scope.id).map(item => item.id))
    root.scopes = root.scopes.filter(item => !descendants.has(item.id))
    scope.nodes = []
    scope.planAasId = child.productAasId
    children.push(child)
  }
  return [...children, root]
}

/** Add template semantics and missing capability links without replacing user values or extra elements. */
export function upgradeDemoInputs (existing: Record<string, any>, template: Record<string, any>): void {
  const semanticKey = (value: Record<string, any> | undefined) => JSON.stringify([value?.type, value?.keys?.map((key: Record<string, string>) => [key.type, key.value])])
  if (template.semanticId && semanticKey(existing.semanticId) !== semanticKey(template.semanticId)) {
    existing.semanticId = template.semanticId
  }
  if (template.idShort === 'ProcessBoM' && template.value?.some((item: Record<string, any>) => item.semanticId?.keys?.[0]?.value === materialSemantic('MaterialUse'))) {
    upgradeMaterialUses(existing, template)
    return
  }
  const key = Array.isArray(template.submodelElements) ? 'submodelElements' : 'value'
  if (!Array.isArray(template[key])) {
    return
  }
  if (!Array.isArray(existing[key])) {
    existing[key] = []
  }
  for (const child of template[key]) {
    const current = existing[key].find((element: Record<string, any>) => element.idShort === child.idShort)
    if (current) {
      upgradeDemoInputs(current, child)
    } else {
      existing[key].push(child)
    }
  }
}

export async function seedDemo (repository: string): Promise<void> {
  const target = repository.replace(/\/$/, '')
  const { shells, submodels, plans } = buildDemo()
  const pharma = buildPharmaDemo(id => `${base}/sm/process-plan/${encode(id)}`)
  shells.push(...pharma.shells as JsonModel[])
  submodels.push(...pharma.submodels as JsonModel[])
  async function ensure (collection: string, model: JsonModel): Promise<void> {
    const existing = await fetch(`${target}/${collection}/${encode(model.id)}`)
    if (existing.ok) {
      const current = await existing.json() as Record<string, any>
      if (collection === 'submodels' && model.idShort === 'ProcessParameters') {
        const before = canonical(current)
        upgradeDemoInputs(current, model)
        if (canonical(current) !== before) {
          const updated = await fetch(`${target}/${collection}/${encode(model.id)}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(current),
          })
          if (!updated.ok) {
            throw new Error(`Updating demo input semantics: HTTP ${updated.status}`)
          }
          console.log(`Updated semantic IDs and capability links for ${model.id}`)
        }
      }
      if (collection === 'shells') {
        for (const ref of model.submodels as { keys: { value: string }[] }[]) {
          if (!(current.submodels ?? []).some((item: { keys: { value: string }[] }) => item.keys[0]?.value === ref.keys[0].value)) {
            const source = await fetch(`${target}/submodels/${encode(ref.keys[0].value)}`)
            if (source.status === 404) {
              continue
            }
            if (!source.ok) {
              throw new Error(`Checking demo reference: HTTP ${source.status}`)
            }
            const attached = await fetch(`${target}/shells/${encode(model.id)}/submodel-refs`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ref),
            })
            if (!attached.ok) {
              throw new Error(`Attaching demo capability submodel: HTTP ${attached.status}`)
            }
          }
        }
      }
      return
    }
    if (existing.status !== 404) {
      throw new Error(`Checking ${model.idShort}: HTTP ${existing.status}`)
    }
    const response = await fetch(`${target}/${collection}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(model),
    })
    if (!response.ok) {
      throw new Error(`Creating ${model.idShort}: HTTP ${response.status} ${await response.text()}`)
    }
    console.log(`Created ${model.idShort}`)
  }
  const existingOwners = new Set<string>()
  for (const model of submodels.filter(model => semanticOf(model) === DOCUMENT_SEMANTIC_ID && value(model, 'Role') === 'Primary')) {
    const response = await fetch(`${target}/submodels/${encode(model.id)}`)
    if (response.ok) {
      existingOwners.add(referenceId(field(model, 'Subject')))
    } else if (response.status !== 404) {
      throw new Error(`Checking demo sequence: HTTP ${response.status}`)
    }
  }
  for (const submodel of submodels) {
    if (value(submodel, 'Role') === 'Subprocess' && existingOwners.has(referenceId(field(submodel, 'Subject')))) {
      continue
    }
    await ensure('submodels', submodel)
  }
  for (const shell of shells) {
    await ensure('shells', shell)
  }
  const pathFor = (id: string) => `${target}/submodels/${encode(`${base}/sm/process-plan/${encode(id)}`)}/submodel-elements/Definition`
  async function fetchSubmodel (id: string): Promise<Record<string, any>> {
    const response = await fetch(`${target}/submodels/${encode(id)}`)
    if (!response.ok) {
      throw new Error(`Reading ${id}: HTTP ${response.status}`)
    }
    return response.json() as Promise<Record<string, any>>
  }
  async function storeSequence (plan: ProcessPlan): Promise<void> {
    const primaryId = `${base}/sm/process-plan/${encode(plan.productAasId)}`
    const original = await fetchSubmodel(primaryId)
    const sources = new Map<string, Record<string, any>>()
    const processes: PlanProcess[] = []
    for (const source of processReferences(plan)) {
      if (!sources.has(source.submodelId)) {
        sources.set(source.submodelId, await fetchSubmodel(source.submodelId))
      }
      processes.push(...readPlanProcesses(sources.get(source.submodelId)!, source.aasId))
    }
    const documents = buildSequenceDocuments(plan, primaryId, processes)
    // Check source and owner content again before the migration writes anything.
    for (const [id, model] of [[primaryId, original], ...sources] as [string, Record<string, any>][]) {
      if (canonical(await fetchSubmodel(id)) !== canonical(model)) {
        throw new Error('Demo data changed during migration; reload and retry.')
      }
    }
    for (const document of documents.toReversed()) {
      if (document.id === primaryId) {
        // Retain backup attachments, not the obsolete embedded scopes or process snapshots.
        document.submodelElements.push(...original.submodelElements.filter((element: Record<string, any>) => element.modelType === 'File'))
      }
      const endpoint = `${target}/submodels/${encode(document.id)}`
      const existing = await fetch(endpoint)
      if (!existing.ok && existing.status !== 404) {
        throw new Error(`Checking sequence: HTTP ${existing.status}`)
      }
      if (existing.ok && document.id !== primaryId && canonical(await existing.json()) !== canonical(document)) {
        throw new Error('A subprocess already exists with different content. Preserve and reconcile it before migration.')
      }
      const saved = await fetch(existing.ok ? endpoint : `${target}/submodels`, { method: existing.ok ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(document) })
      if (!saved.ok) {
        throw new Error(`Saving sequence: HTTP ${saved.status} ${await saved.text()}`)
      }
      const shell = await fetch(`${target}/shells/${encode(plan.productAasId)}`)
      if (!shell.ok) {
        throw new Error(`Reading sequence owner: HTTP ${shell.status}`)
      }
      const refs = (await shell.json() as Record<string, any>).submodels ?? []
      if (!refs.some((ref: Record<string, any>) => ref.keys?.[0]?.value === document.id)) {
        const attached = await fetch(`${target}/shells/${encode(plan.productAasId)}/submodel-refs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(reference('Submodel', document.id)) })
        if (!attached.ok) {
          throw new Error(`Attaching sequence: HTTP ${attached.status}`)
        }
      }
    }
  }
  async function readPlan (id: string): Promise<ProcessPlan | null> {
    const modelResponse = await fetch(pathFor(id).replace('/submodel-elements/Definition', ''))
    if (!modelResponse.ok) {
      throw new Error(`Reading sequence: HTTP ${modelResponse.status}`)
    }
    const model = await modelResponse.json() as Record<string, any>
    if (semanticOf(model) === DOCUMENT_SEMANTIC_ID) {
      return readSequenceDocuments(model, fetchSubmodel)
    }
    if (model.semanticId?.keys?.[0]?.value === SEQUENCE_SEMANTIC_ID) {
      return readSequenceSubmodel(model)
    }
    const response = await fetch(pathFor(id))
    if (!response.ok) {
      throw new Error(`Reading definition: HTTP ${response.status}`)
    }
    if (!(await response.json() as { value?: string }).value) {
      return null
    }
    const attachment = await fetch(`${pathFor(id)}/attachment`)
    if (!attachment.ok) {
      throw new Error(`Reading plan: HTTP ${attachment.status}`)
    }
    return attachment.json() as Promise<ProcessPlan>
  }
  async function upload (path: string, plan: ProcessPlan): Promise<void> {
    const body = new FormData()
    body.append('file', new Blob([JSON.stringify(plan, null, 2)], { type: 'application/json' }), 'process-plan.json')
    body.append('fileName', 'process-plan.json')
    const response = await fetch(`${path}/attachment`, { method: 'PUT', body })
    if (!response.ok) {
      throw new Error(`Uploading plan: HTTP ${response.status} ${await response.text()}`)
    }
  }
  const existing = await readPlan(productId)
  const migration = existing ? splitDemoPlan(existing) : plans
  const migrating = !!existing && migration.length > 1
  if (existing && !migrating) {
    migration.unshift(...plans.filter(plan => plan.productAasId !== productId))
  }
  async function backupPlan (plan: ProcessPlan): Promise<void> {
    const endpoint = pathFor(plan.productAasId).replace(/\/Definition$/, '')
    const backup = await fetch(`${endpoint}/BeforeReferencedSequences`)
    if (backup.status === 404) {
      const created = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        modelType: 'File', idShort: 'BeforeReferencedSequences', contentType: 'application/json', value: '',
      }) })
      if (!created.ok) {
        throw new Error(`Creating migration backup: HTTP ${created.status}`)
      }
      await upload(`${endpoint}/BeforeReferencedSequences`, plan)
    } else if (!backup.ok) {
      throw new Error(`Checking migration backup: HTTP ${backup.status}`)
    } else if (!(await backup.json() as { value?: string }).value) {
      await upload(`${endpoint}/BeforeReferencedSequences`, plan)
    }
  }
  if (migrating) {
    await backupPlan(existing!)
  }
  for (const candidate of migration) {
    const current = await readPlan(candidate.productAasId)
    const fillEmptyAssembly = migrating && current && current.scopes.every(scope => scope.nodes.length === 0)
      && candidate.scopes.some(scope => scope.nodes.length > 0)
    if (current && !(migrating && (candidate.productAasId === productId || !existingOwners.has(candidate.productAasId))) && !fillEmptyAssembly) {
      console.log(`Kept existing plan for ${candidate.productAasId}`)
      continue
    }
    if (candidate.productAasId === productId && migrating && JSON.stringify(current) !== JSON.stringify(existing)) {
      throw new Error('The robot plan changed during migration; retry after reviewing edits.')
    }
    if (current) {
      await backupPlan(current)
      if (JSON.stringify(await readPlan(candidate.productAasId)) !== JSON.stringify(current)) {
        throw new Error('An assembly changed during migration; retry after reviewing edits.')
      }
      candidate.revision = current.revision + 1
    }
    await storeSequence(candidate)
    console.log(`Stored shared plan for ${candidate.productAasId}`)
  }
  // Migrate every demo product, preserving edited recipes and legacy attachments.
  const owners = [...new Set([...plans.map(plan => plan.productAasId), ...pharma.plans.map(plan => plan.productAasId)])]
  for (const owner of owners) {
    const model = await fetchSubmodel(`${base}/sm/process-plan/${encode(owner)}`)
    if (semanticOf(model) === DOCUMENT_SEMANTIC_ID) {
      continue
    }
    const current = await readPlan(owner)
    if (current) {
      await backupPlan(current)
      await storeSequence(current)
      console.log(`Converted to referenced sequences for ${owner}`)
    }
  }
  const browserRepository = process.env.PS_BROWSER_REPO_URL || 'http://localhost:8081'
  console.log(`Open http://localhost:3000/modules/processsequence?aas=${encodeURIComponent(`${browserRepository}/shells/${encode(productId)}`)}`)
}

if (import.meta.main) {
  await seedDemo(process.env.PS_REPO_URL || 'http://localhost:8081')
}
