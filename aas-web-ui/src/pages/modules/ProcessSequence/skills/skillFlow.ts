import type { SkillParameter } from '../types'
import type { CapabilityReference, PlanNode, StepNode } from '../types/plan'
import type { AasElement } from '../utils/sequenceModel'
import { PROCESS_SEQUENCE_IRI_BASE } from '../constants/contracts'
import { children, collection, field, indexed, members, modelRef, ordered, prop, ref, sem, value } from '../utils/sequenceModel'

/**
 * A resource's skills (ARSO 0.8) as the sequence editor's nodes, and back.
 *
 * A skill of a module is its commands. What Start (and Stop) run is a flow in the elements of
 * Production Sequence: steps with NodeId, Kind, Name and Order; a step of the kind `step` runs a
 * skill of one of the module's components, with Bindings (a constant, or a parameter of the skill
 * it is a step of) and Outputs (which result of the skill it gives). The module's control program
 * is brought to what is saved here by `modsync reconfigure` (iec61499-mgmt-py).
 */
export type SkillKind = 'Primitive' | 'Composite' | 'ModuleControl'
export type SkillCommand = 'Start' | 'Stop'
export type ResourceSkill = {
  idShort: string
  kind: SkillKind
  description: string
  /** The AAS and the Skills submodel it is described in: the module's, or a component's. */
  aasId: string
  submodelId: string
  reference: CapabilityReference
  inputs: SkillParameter[]
  outputs: SkillParameter[]
  /** The commands that run steps. */
  flows: SkillCommand[]
}

const skillMeaning = `${PROCESS_SEQUENCE_IRI_BASE}/skill`
const protocolMeaning = `${PROCESS_SEQUENCE_IRI_BASE}/ControlComponent/Skill/OperationVariable/1/0`
const kinds: SkillKind[] = ['Primitive', 'Composite', 'ModuleControl']
/** What a module built by the module rules can run; ARSO describes more kinds of step. */
export const RUNNABLE_KINDS: PlanNode['kind'][] = ['step']
const IDENTIFIER = /^[A-Z]\w*$/i
const child = (element: AasElement | undefined, idShort: string): AasElement | undefined => members(element ?? {}).find(item => item.idShort === idShort)
const meaning = (element: AasElement | undefined): string => element?.semanticId?.keys?.[0]?.value ?? ''
const qualifier = (element: AasElement, name: string): string | undefined => element.qualifiers?.find((item: AasElement) => item.type === name)?.value
const lastKey = (reference?: CapabilityReference): string => reference?.keys.at(-1)?.value ?? ''
const number = (raw: unknown): number | null => (raw != null && String(raw).trim() !== '' && Number.isFinite(Number(raw)) ? Number(raw) : null)

/** A copy of AAS JSON. The editor holds it in reactive state, and steps it edited carry reactive objects. */
// eslint-disable-next-line unicorn/prefer-structured-clone -- reactive proxies nested in the JSON cannot be cloned
const plainCopy = <T>(element: T): T => JSON.parse(JSON.stringify(element))

export function skillKind (element: AasElement): SkillKind {
  const stated = new Set([...(element.supplementalSemanticIds ?? []).map((item: AasElement) => item.keys?.[0]?.value ?? ''), meaning(element)])
  return kinds.find(kind => stated.has(`${skillMeaning}/${kind}`)) ?? 'Primitive'
}

/** The reference to a variable of a command's Operation in a Skills submodel. */
export function variableReference (submodelId: string, skill: string, command: string, variable: string): CapabilityReference {
  return modelRef([
    { type: 'Submodel', value: submodelId }, { type: 'SubmodelElementCollection', value: 'Skills' },
    { type: 'SubmodelElementCollection', value: skill }, { type: 'SubmodelElementCollection', value: command },
    { type: 'Operation', value: command }, { type: 'Property', value: variable },
  ])
}

/** The skills of one Skills submodel, with the variables of their Start operation. */
export function readSkills (submodel: AasElement, aasId = ''): ResourceSkill[] {
  const read = (skill: AasElement, direction: 'inputVariables' | 'outputVariables'): SkillParameter[] =>
    (child(child(skill, 'Start'), 'Start')?.[direction] ?? []).map((item: AasElement) => item.value).filter((variable: AasElement) => variable?.modelType === 'Property' && meaning(variable) !== protocolMeaning).map((variable: AasElement) => ({
      idShort: variable.idShort, name: variable.idShort, dataType: variable.valueType,
      unit: qualifier(variable, 'Unit') ?? variable.embeddedDataSpecifications?.find((spec: AasElement) => spec.dataSpecificationContent?.unit)?.dataSpecificationContent?.unit ?? '',
      minValue: number(qualifier(variable, 'Minimum')), maxValue: number(qualifier(variable, 'Maximum')),
      defaultValue: qualifier(variable, 'Default') ?? variable.value ?? null,
      reference: variableReference(submodel.id, skill.idShort, 'Start', variable.idShort),
    }))
  return members(child(submodel, 'Skills') ?? {}).filter(skill => skill.modelType === 'SubmodelElementCollection').map(skill => ({
    idShort: skill.idShort, kind: skillKind(skill), aasId, submodelId: submodel.id,
    description: skill.description?.find((item: AasElement) => item.language === 'en')?.text ?? '',
    reference: modelRef([{ type: 'Submodel', value: submodel.id }, { type: 'SubmodelElementCollection', value: 'Skills' }, { type: 'SubmodelElementCollection', value: skill.idShort }]),
    inputs: read(skill, 'inputVariables'), outputs: read(skill, 'outputVariables'),
    flows: (['Start', 'Stop'] as SkillCommand[]).filter(command => field(child(skill, command) ?? {}, 'Steps')),
  }))
}

function readSteps (steps: AasElement | undefined): PlanNode[] {
  return ordered(members(steps ?? {})).map((step): PlanNode => {
    const id = value(step, 'NodeId') || step.idShort
    const kind = value(step, 'Kind') || 'step'
    if (kind === 'parallel') {
      return {
        id, kind, name: value(step, 'Name'),
        branches: ordered(children(step, 'Branches')).map(branch => ({ id: value(branch, 'BranchId'), name: value(branch, 'Name'), nodes: readSteps(field(branch, 'Steps')) })),
      }
    }
    if (kind !== 'step') {
      throw new Error(`Step ${id} is of the kind ${kind}, which the skill editor does not show yet.`)
    }
    const skillReference: CapabilityReference | undefined = field(step, 'Skill')?.value
    return {
      id, kind, name: value(step, 'Name') || id, process: null,
      resourceAasId: (skillReference?.keys[0]?.value ?? '').replace(/\/submodels\/.*$/, ''),
      skillId: lastKey(skillReference), skillReference,
      bindings: children(step, 'Bindings').map(binding => {
        const handed: CapabilityReference | undefined = field(binding, 'SourceElement')?.value
        return {
          name: value(binding, 'Name'), value: handed ? '' : value(binding, 'Value'),
          source: handed ? { aasId: '', submodelId: handed.keys[0]?.value ?? '', path: handed.keys.slice(1).map(key => key.value) } : null,
          target: field(binding, 'InputReference')?.value,
        }
      }),
      outputs: children(step, 'Outputs').map(output => ({
        id: value(output, 'OutputId'), name: value(output, 'Name'), type: (value(output, 'DataType') || 'number') as 'boolean' | 'number' | 'string',
        unit: value(output, 'Unit'), source: field(output, 'ResultReference')?.value,
      })),
    }
  })
}

/** What a command of a skill runs, as nodes of the sequence editor. */
export function readFlow (submodel: AasElement, skill: string, command: SkillCommand): PlanNode[] {
  return readSteps(field(child(child(child(submodel, 'Skills'), skill), command) ?? {}, 'Steps'))
}

/** The name of the parameter of the skill a binding hands down, if it hands one down. */
export const handedParameter = (binding: StepNode['bindings'][number]): string => binding.source?.path.at(-1) ?? ''

/** A name FORTE takes for a block instance, made from what the user typed and unique among ``taken``. */
export function instanceName (wanted: string, taken: string[]): string {
  const base = wanted.replaceAll(/\W/g, '').replace(/^[^A-Z]+/i, '') || 'Step'
  let name = base
  for (let n = 2; taken.includes(name); n++) {
    name = `${base}_${n}`
  }
  return name
}

/** Give a step the skill it runs: its inputs become bindings to their defaults. */
export function assignSkill (node: StepNode, skill: ResourceSkill, taken: string[]): void {
  node.skillId = skill.idShort
  node.resourceAasId = skill.aasId
  node.skillReference = skill.reference
  node.bindings = skill.inputs.map(input => ({ name: input.idShort, value: String(input.defaultValue ?? ''), source: null, target: input.reference }))
  node.outputs = []
  node.name = instanceName(skill.idShort, taken)
  node.id = node.name
}

function outside (inner: SkillParameter, outer: SkillParameter): boolean {
  return (outer.minValue != null && (inner.minValue == null || inner.minValue < outer.minValue))
    || (outer.maxValue != null && (inner.maxValue == null || inner.maxValue > outer.maxValue))
}
const span = (item: SkillParameter): string => `${item.minValue ?? '-'} to ${item.maxValue ?? '-'}`

/** What is wrong with what a step hands to its skill; ``owner``: the skill whose parameters it may hand down. */
function bindingIssues (node: StepNode, skill: ResourceSkill, owner: ResourceSkill | undefined): string[] {
  const issues: string[] = []
  for (const input of skill.inputs) {
    const binding = node.bindings.find(item => item.name === input.idShort)
    if (!binding) {
      continue // not handed anything: the skill's own default
    }
    const handed = handedParameter(binding)
    if (handed) {
      const parameter = owner?.inputs.find(item => item.idShort === handed)
      if (!parameter) {
        issues.push(`${node.name}: ${input.idShort} is handed ${handed}, which the skill does not take.`)
      } else if (outside(parameter, input)) {
        issues.push(`${node.name}: ${handed} (${span(parameter)}) allows more than ${skill.idShort} takes for ${input.idShort} (${span(input)}).`)
      }
      continue
    }
    const constant = number(binding.value)
    if (input.dataType !== 'xs:boolean' && constant == null) {
      issues.push(`${node.name}: ${input.idShort} needs a value.`)
    } else if (constant != null && ((input.minValue != null && constant < input.minValue) || (input.maxValue != null && constant > input.maxValue))) {
      issues.push(`${node.name}: ${input.idShort} = ${constant} is outside what ${skill.idShort} takes (${span(input)}).`)
    }
  }
  return issues
}

/** Why a flow cannot be saved or built, in the words of the module rules. */
export function flowIssues (nodes: PlanNode[], owner: ResourceSkill | undefined, catalog: ResourceSkill[], command: SkillCommand = 'Start'): string[] {
  const issues: string[] = []
  const seen = new Set<string>()
  const given = new Set<string>()
  for (const node of nodes) {
    if (!RUNNABLE_KINDS.includes(node.kind)) {
      issues.push(`${node.name}: a ${node.kind} step is described by the model, but the module's control runs steps one after the other only.`)
      continue
    }
    if (node.kind !== 'step') {
      continue
    }
    if (!IDENTIFIER.test(node.id) || seen.has(node.id)) {
      issues.push(`${node.name || 'A step'}: the name has to start with a letter, use letters, digits and _ only, and be unique in the skill.`)
    }
    seen.add(node.id)
    const skill = catalog.find(item => item.kind === 'Primitive' && item.idShort === node.skillId)
    if (!skill) {
      issues.push(`${node.name}: choose the skill of a component it runs.`)
      continue
    }
    issues.push(...bindingIssues(node, skill, command === 'Start' ? owner : undefined))
    for (const output of node.outputs ?? []) {
      if (given.has(output.id)) {
        issues.push(`${node.name}: the result ${output.id} is already given by an earlier step.`)
      }
      given.add(output.id)
    }
  }
  return issues
}

function buildSteps (nodes: PlanNode[], submodelId: string, owner: ResourceSkill, command: SkillCommand, catalog: ResourceSkill[]): AasElement {
  const base = owner.kind === 'ModuleControl'
    ? `${PROCESS_SEQUENCE_IRI_BASE}/procedures/${owner.idShort === 'Reset' ? 'Resetting' : 'Stopping'}`
    : `${PROCESS_SEQUENCE_IRI_BASE}/skills/${owner.idShort}/${command === 'Start' ? 'Execute' : 'Stopping'}`
  return collection('Steps', nodes.map((node, index) => {
    const common = [prop('NodeId', node.id), prop('Kind', node.kind), prop('Name', node.name), prop('Order', index, 'xs:nonNegativeInteger')]
    if (node.kind === 'parallel') {
      common.push(collection('Branches', node.branches.map((branch, order) => collection(indexed('Branch', order), [
        prop('BranchId', branch.id), prop('Name', branch.name), prop('Order', order, 'xs:nonNegativeInteger'), buildSteps(branch.nodes, submodelId, owner, command, catalog),
      ], 'Branch'))))
    } else if (node.kind === 'step') {
      const skill = catalog.find(item => item.idShort === node.skillId)
      if (node.skillReference) {
        common.push(ref('Skill', node.skillReference))
      }
      if (node.bindings.length > 0) {
        common.push(collection('Bindings', node.bindings.map((binding, order) => {
          const handed = handedParameter(binding)
          const input = skill?.inputs.find(item => item.idShort === binding.name)
          return collection(indexed('Binding', order), [
            prop('Name', binding.name),
            handed ? ref('SourceElement', variableReference(submodelId, owner.idShort, command, handed)) : prop('Value', binding.value, input?.dataType ?? 'xs:double'),
            ...(binding.target ? [ref('InputReference', binding.target)] : []),
          ], 'Binding')
        })))
      }
      if (node.outputs?.length) {
        common.push(collection('Outputs', node.outputs.map((output, order) => collection(indexed('Output', order), [
          prop('OutputId', output.id), prop('Name', output.name), prop('DataType', output.type), prop('Unit', output.unit),
          ...(output.source ? [ref('ResultReference', output.source)] : []),
        ], 'Output'))))
      }
    } else {
      throw new Error(`A ${node.kind} step cannot be saved in a skill yet.`)
    }
    const step = collection(indexed('Step', index), common, 'Step')
    // What the step's instance in the program is called: its state is the data point named from there.
    step.supplementalSemanticIds = [sem(`${base}/${node.id}`)]
    return step
  }))
}

/** The Skills submodel with what a command of a skill runs replaced by ``nodes``. */
export function withFlow (submodel: AasElement, skill: string, command: SkillCommand, nodes: PlanNode[], catalog: ResourceSkill[]): AasElement {
  const copy = plainCopy(submodel)
  const owner = readSkills(copy).find(item => item.idShort === skill)
  const held = child(child(child(copy, 'Skills'), skill), command)
  if (!owner || !held) {
    throw new Error(`${skill} has no ${command} command.`)
  }
  held.value = members(held).filter(item => item !== field(held, 'Steps'))
  if (nodes.length > 0) {
    held.value.push(buildSteps(nodes, copy.id, owner, command, catalog))
  }
  return copy
}

/** Change the default or the limits of a parameter of a skill (the variable of its Start operation). */
export function withParameter (submodel: AasElement, skill: string, parameter: string, change: { defaultValue?: string, minValue?: string, maxValue?: string }): AasElement {
  const copy = plainCopy(submodel)
  const operation = child(child(child(child(copy, 'Skills'), skill), 'Start'), 'Start')
  const variable = (operation?.inputVariables ?? []).map((item: AasElement) => item.value).find((item: AasElement) => item.idShort === parameter)
  if (!variable) {
    throw new Error(`${skill} has no parameter ${parameter}.`)
  }
  const set = (type: string, text: string | undefined) => {
    if (text === undefined) {
      return
    }
    variable.qualifiers = (variable.qualifiers ?? []).filter((item: AasElement) => item.type !== type)
    if (text !== '') {
      variable.qualifiers.push({ type, valueType: 'xs:string', value: text, kind: 'ConceptQualifier' })
    }
  }
  set('Default', change.defaultValue)
  set('Minimum', change.minValue)
  set('Maximum', change.maxValue)
  if (change.defaultValue !== undefined && change.defaultValue !== '') {
    variable.value = change.defaultValue
  }
  if (variable.qualifiers?.length === 0) {
    delete variable.qualifiers
  }
  return copy
}

/**
 * The Skills submodel with one more module level skill, described like ``from`` under another name.
 * It is described, not built: it has no action of the interface yet (no InterfaceReference), and
 * the module's Control Configuration records no instance of it until `modsync reconfigure` built it.
 */
export function withNewSkill (submodel: AasElement, from: string, name: string): AasElement {
  const copy = plainCopy(submodel)
  const skills = child(copy, 'Skills')
  const source = child(skills, from)
  if (!IDENTIFIER.test(name) || !skills || !source || child(skills, name)) {
    throw new Error(`${name} cannot be the name of a new skill: it has to be an identifier no skill of the module has.`)
  }
  if (skillKind(source) !== 'Composite') {
    throw new Error(`${from} is not a skill the module composes.`)
  }
  const renamed = (text: string) => text.replaceAll(`/skills/${from}/`, `/skills/${name}/`).replace(new RegExp(`/skills/${from}$`), `/skills/${name}`)
  function rename (element: any): any {
    if (Array.isArray(element)) {
      return element.map(item => rename(item))
    }
    if (element && typeof element === 'object') {
      if (element.type === 'ModelReference' && Array.isArray(element.keys)) {
        const own = element.keys[0]?.value === copy.id && element.keys[1]?.value === 'Skills' && element.keys[2]?.value === from
        return { ...element, keys: element.keys.map((key: AasElement, index: number) => (own && index === 2 ? { ...key, value: name } : key)) }
      }
      return Object.fromEntries(Object.entries(element).map(([key, item]) => [key, key === 'description' ? describe(item) : rename(item)]))
    }
    return typeof element === 'string' ? renamed(element) : element
  }
  // A description names the skill in words ("Start Dispensing; ...").
  const describe = (texts: any) => (Array.isArray(texts) ? texts.map(item => ({ ...item, text: String(item.text ?? '').replaceAll(new RegExp(String.raw`\b${from}\b`, 'g'), name) })) : texts)
  const made = rename(source)
  made.idShort = name
  made.description = [{ language: 'en', text: `Skill ${name}` }]
  for (const command of members(made).filter(item => item.modelType === 'SubmodelElementCollection')) {
    // Not callable until it is built: the action that calls it does not exist yet.
    command.value = members(command).filter(item => item.idShort !== 'InterfaceReference')
    for (const operation of members(command).filter(item => item.modelType === 'Operation')) {
      delete operation.qualifiers // the delegation to an action that is not there
    }
  }
  skills.value.push(made)
  return copy
}
