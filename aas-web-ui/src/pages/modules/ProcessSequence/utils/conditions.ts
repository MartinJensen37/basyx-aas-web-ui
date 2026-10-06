import type { PlanCondition, PlanNode, PlanOutput } from '../types/plan'

export type Comparison = Extract<PlanCondition, { kind: 'comparison' }>
export type ConditionOption = { key: string, name: string, shortName: string, operand: NonNullable<Comparison['operand']>, type: PlanOutput['type'], unit: string, value?: boolean | number | string }
export const operators = [
  { title: 'Equals', value: 'eq' }, { title: 'Does not equal', value: 'ne' },
  { title: 'Greater than', value: 'gt' }, { title: 'At least', value: 'gte' },
  { title: 'Less than', value: 'lt' }, { title: 'At most', value: 'lte' },
]

export function newComparison (): Comparison {
  return { kind: 'comparison', operand: null, operator: 'eq', expected: { type: 'boolean', value: true }, unit: '' }
}

/** Only explicitly supported scalar datatypes are exposed; unknown types are not coerced. */
export function scalarType (datatype: string): PlanOutput['type'] | undefined {
  if (datatype === 'xs:boolean') {
    return 'boolean'
  }
  if (datatype === 'xs:string') {
    return 'string'
  }
  if (/^xs:(?:double|float|decimal|integer|int|long|short|byte|nonNegativeInteger|positiveInteger|unsignedInt|unsignedLong|unsignedShort|unsignedByte)$/.test(datatype)) {
    return 'number'
  }
}

export function parseScalar (type: PlanOutput['type'], text: string): boolean | number | string | undefined {
  if (type === 'string') {
    return text
  }
  if (type === 'boolean') {
    return text === 'true' || text === '1' ? true : (text === 'false' || text === '0' ? false : undefined)
  }
  return text.trim() && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text.trim()) && Number.isFinite(Number(text)) ? Number(text) : undefined
}

export function conditionOptions (nodes: PlanNode[]): ConditionOption[] {
  return nodes.flatMap(node => {
    if (node.kind !== 'step') {
      return []
    }
    const parameters = (node.process?.parameters ?? []).flatMap(parameter => {
      const type = scalarType(parameter.dataType)
      if (!type) {
        return []
      }
      const operand: NonNullable<Comparison['operand']> = { kind: 'parameter', stepId: node.id, source: parameter.source }
      return [{ key: JSON.stringify(operand), name: `${node.name} / ${parameter.group} / ${parameter.name}`, shortName: parameter.name, operand, type, unit: parameter.unit ?? '', value: parseScalar(type, parameter.value) }]
    })
    return [...parameters, ...(node.outputs ?? []).map(output => {
      const operand: NonNullable<Comparison['operand']> = { kind: 'output', stepId: node.id, outputId: output.id }
      return { key: JSON.stringify(operand), name: `${node.name} / Output / ${output.name || 'Unnamed output'}`, shortName: output.name || 'Unnamed output', operand, type: output.type, unit: output.unit }
    })]
  })
}

export function conditionLabel (condition: PlanCondition, options: ConditionOption[], compact = false): string {
  if (condition.kind === 'everyNthProduct') {
    return `Every ${condition.every} products`
  }
  const option = options.find(option => option.key === JSON.stringify(condition.operand))
  if (!option) {
    return 'Choose a condition value'
  }
  const symbols = { eq: '=', ne: '≠', gt: '>', gte: '≥', lt: '<', lte: '≤' }
  return `${compact ? option.shortName : option.name} ${symbols[condition.operator]} ${condition.expected.value}${condition.unit ? ` ${condition.unit}` : ''}`
}

/** Undefined is unresolved, never a false branch. Values are supplied by a preview/executor. */
export function evaluateCondition (condition: PlanCondition, option: ConditionOption | undefined, actual: unknown, productNumber: number): { value?: boolean, reason?: string } {
  if (condition.kind === 'everyNthProduct') {
    return { value: productNumber % condition.every === 0 }
  }
  if (!option) {
    return { reason: 'Choose an existing parameter or operation output.' }
  }
  if (option.type !== condition.expected.type || option.unit !== condition.unit) {
    return { reason: 'Condition datatype or unit no longer matches its source.' }
  }
  if (typeof actual !== option.type || (typeof actual === 'number' && !Number.isFinite(actual))) {
    return { reason: `A valid ${option.type} value is required for ${option.name}.` }
  }
  const expected = condition.expected.value
  if (condition.operator === 'eq') {
    return { value: actual === expected }
  }
  if (condition.operator === 'ne') {
    return { value: actual !== expected }
  }
  if (typeof actual !== 'number' || typeof expected !== 'number') {
    return { reason: 'Ordered comparisons require numeric values.' }
  }
  switch (condition.operator) {
    case 'gt': { return { value: actual > expected }
    }
    case 'gte': { return { value: actual >= expected }
    }
    case 'lt': { return { value: actual < expected }
    }
    case 'lte': { return { value: actual <= expected }
    }
  }
}
