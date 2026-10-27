import type { PlanCondition, PlanNode, SimpleCondition, StepNode } from '../types/plan'
import type { AasElement } from '../utils/sequenceModel'
import type { ResourceSkill, SkillCommand } from './skillFlow'
import { children, collection, field, indexed, modelRef, ordered, prop, ref, value } from '../utils/sequenceModel'

/**
 * The conditions of a skill's decisions and conditional steps (module rules, rule set 2), in the
 * planner's elements: a comparison of a parameter of the skill (OperandType parameter: SourceElement,
 * the variable of the command's Operation) or of a result of a step that has run (OperandType output:
 * StepId, OutputId = the result of the step's skill) with a value, or a group of them (all, any).
 * The module's control compares numbers (gt, gte, lt, lte, eq, ne) and Booleans (eq, ne).
 */
type Comparison = Extract<SimpleCondition, { kind: 'comparison' }>
export type Operand = { key: string, title: string, operand: NonNullable<Comparison['operand']>, type: 'number' | 'boolean', unit: string }

const parameterOf = (comparison: Comparison): string => (comparison.operand?.kind === 'parameter' ? comparison.operand.source.path.at(-1) ?? '' : '')
export function operandKey (operand: Comparison['operand']): string {
  return operand ? (operand.kind === 'parameter' ? `parameter:${operand.source.path.at(-1)}` : `output:${operand.stepId}.${operand.outputId}`) : ''
}

export function readSkillCondition (element: AasElement): PlanCondition {
  const kind = value(element, 'ConditionType')
  if (kind === 'all' || kind === 'any') {
    return { kind, conditions: ordered(children(element, 'Conditions')).map(item => readSkillCondition(item)) }
  }
  if (kind !== 'comparison') {
    throw new Error(`A condition of the kind ${kind || '(none)'} cannot be run by a module: it compares values only.`)
  }
  const operand = field(element, 'Operand')
  const expected = field(element, 'Expected')
  const type = value(expected ?? {}, 'DataType') === 'boolean' ? 'boolean' : 'number'
  const raw = value(expected ?? {}, 'Value')
  const keys: { value: string }[] = field(operand ?? {}, 'SourceElement')?.value?.keys ?? []
  return {
    kind: 'comparison', operator: value(element, 'Operator') as Comparison['operator'], unit: value(element, 'Unit'),
    expected: type === 'boolean' ? { type, value: raw.trim().toLowerCase() === 'true' } : { type, value: Number(raw) },
    operand: operand
      ? (value(operand, 'OperandType') === 'output'
          ? { kind: 'output', stepId: value(operand, 'StepId'), outputId: value(operand, 'OutputId') }
          : { kind: 'parameter', stepId: '', source: { aasId: '', submodelId: keys[0]?.value ?? '', path: keys.slice(1).map(key => key.value) } })
      : null,
  }
}

export function skillConditionElement (condition: PlanCondition, owner: ResourceSkill, command: SkillCommand, order?: number): AasElement {
  const numbered = order === undefined ? [] : [prop('Order', order, 'xs:nonNegativeInteger')]
  const made = (items: AasElement[]) => collection(order === undefined ? 'Condition' : indexed('Condition', order), [...items, ...numbered], 'Condition')
  if ('conditions' in condition) {
    return made([prop('ConditionType', condition.kind),
      collection('Conditions', condition.conditions.map((rule, index) => skillConditionElement(rule, owner, command, index)))])
  }
  if (condition.kind !== 'comparison') {
    throw new Error('A module compares values only: every N-th run is a condition of a product\'s plan.')
  }
  const operand = condition.operand
  const expected = collection('Expected', [prop('DataType', condition.expected.type),
    prop('Value', condition.expected.type === 'number' && Number.isInteger(condition.expected.value) ? condition.expected.value.toFixed(1) : String(condition.expected.value),
      condition.expected.type === 'boolean' ? 'xs:boolean' : 'xs:double')])
  return made([
    prop('ConditionType', 'comparison'), prop('Operator', condition.operator), prop('Unit', condition.unit), expected,
    ...(operand
      ? [collection('Operand', operand.kind === 'output'
          ? [prop('OperandType', 'output'), prop('StepId', operand.stepId), prop('OutputId', operand.outputId)]
          : [prop('OperandType', 'parameter'), prop('StepId', ''), ref('SourceElement', modelRef([
              ...owner.reference.keys, { type: 'SubmodelElementCollection', value: command }, { type: 'Operation', value: command },
              { type: 'Property', value: operand.source.path.at(-1) ?? '' }]))])]
      : []),
  ])
}

/** What a condition placed at ``nodeId`` may compare: the skill's parameters and the results of the steps that have run before it. */
export function operandOptions (nodes: PlanNode[], nodeId: string, owner: ResourceSkill | undefined, catalog: ResourceSkill[]): Operand[] {
  const typeOf = (dataType: string): Operand['type'] | undefined => (dataType === 'xs:boolean' ? 'boolean' : (['xs:double', 'xs:float', 'xs:decimal'].includes(dataType) ? 'number' : undefined))
  const found: Operand[] = []
  for (const input of owner?.inputs ?? []) {
    const type = typeOf(input.dataType)
    if (type) {
      found.push({ key: `parameter:${input.idShort}`, title: `${input.idShort} (a parameter of the skill)`, type, unit: input.unit,
        operand: { kind: 'parameter', stepId: '', source: { aasId: '', submodelId: owner!.submodelId, path: [owner!.idShort, 'Start', 'Start', input.idShort] } } })
    }
  }
  for (const step of ranBefore(nodes, nodeId) ?? []) {
    const skill = catalog.find(item => item.idShort === step.skillId && item.aasId === step.resourceAasId) ?? catalog.find(item => item.idShort === step.skillId)
    for (const output of skill?.outputs ?? []) {
      const type = typeOf(output.dataType)
      if (type) {
        found.push({ key: `output:${step.id}.${output.idShort}`, title: `${step.name}: ${output.idShort}`, type, unit: output.unit,
          operand: { kind: 'output', stepId: step.id, outputId: output.idShort } })
      }
    }
  }
  return found
}

/** The steps that have run whenever the flow reaches ``nodeId`` (undefined: it is not in ``nodes``). */
export function ranBefore (nodes: PlanNode[], nodeId: string, known: StepNode[] = []): StepNode[] | undefined {
  let have = [...known]
  for (const node of nodes) {
    if (node.id === nodeId) {
      return have
    }
    switch (node.kind) {
      case 'step': {
        have.push(node)

        break
      }
      case 'parallel': {
        for (const branch of node.branches) {
          const inside = ranBefore(branch.nodes, nodeId, have)
          if (inside) {
            return inside
          }
        }
        have = [...have, ...node.branches.flatMap(branch => always(branch.nodes))]

        break
      }
      case 'decision':
      case 'conditional': {
        for (const lane of node.kind === 'decision' ? node.branches.map(branch => branch.nodes) : [node.nodes]) {
          const inside = ranBefore(lane, nodeId, have)
          if (inside) {
            return inside
          }
        }

        break
      }
    // No default
    }
  }
  return undefined
}

/** The steps that run whenever the flow succeeds: not those in a decision or a conditional. */
export function always (nodes: PlanNode[]): StepNode[] {
  return nodes.flatMap(node => node.kind === 'step' ? [node] : (node.kind === 'parallel' ? node.branches.flatMap(branch => always(branch.nodes)) : []))
}

/** What is wrong with the condition of the decision or conditional ``node``. */
export function conditionIssues (condition: PlanCondition, node: PlanNode, options: Operand[]): string[] {
  if ('conditions' in condition) {
    return condition.conditions.length === 0
      ? [`${node.name}: a group of conditions needs at least one.`]
      : condition.conditions.flatMap(rule => conditionIssues(rule, node, options))
  }
  if (condition.kind !== 'comparison') {
    return [`${node.name}: a module compares values only (no every N-th run).`]
  }
  const option = options.find(item => item.key === operandKey(condition.operand))
  if (!option) {
    return [`${node.name}: compare a parameter of the skill or a result of a step that has run before it${parameterOf(condition) ? ` (${parameterOf(condition)} is neither)` : ''}.`]
  }
  if (option.type !== condition.expected.type) {
    return [`${node.name}: ${option.title} is a ${option.type}, compared with a ${condition.expected.type}.`]
  }
  if (option.type === 'boolean' && !['eq', 'ne'].includes(condition.operator)) {
    return [`${node.name}: a Boolean is compared by equal or not equal.`]
  }
  if (option.type === 'number' && !Number.isFinite(condition.expected.value)) {
    return [`${node.name}: the value compared with is no number.`]
  }
  return []
}
