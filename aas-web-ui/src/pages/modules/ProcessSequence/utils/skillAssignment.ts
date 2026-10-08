import type { SkillDefinition, SkillParameter } from '../types'
import type { PlanOutput, PlanParameter, StepNode } from '../types/plan'
import { v4 } from 'uuid'
import { canonicalMeaning, compatibleType, numericTypes } from './parameterSemantics'

export function inputSource (input: SkillParameter, parameters: PlanParameter[]): PlanParameter | undefined {
  const meanings = input.semanticIds?.map(id => canonicalMeaning(id)) ?? []
  const candidates = parameters.filter(parameter => {
    const ids = parameter.semanticIds?.map(id => canonicalMeaning(id)) ?? []
    const sameMeaning = meanings.length > 0 && ids.length > 0 ? meanings.some(id => ids.includes(id)) : meanings.length === 0 && [input.idShort, input.name].includes(parameter.name)
    return sameMeaning && (parameter.unit ?? '') === input.unit && compatibleType(parameter.dataType, input.dataType)
  })
  return candidates.length === 1 ? candidates[0] : undefined
}

export function resultType (result: SkillParameter): PlanOutput['type'] | undefined {
  if (numericTypes.has(result.dataType)) {
    return 'number'
  }
  if (result.dataType === 'xs:boolean') {
    return 'boolean'
  }
  if (['xs:string', 'xs:anyURI'].includes(result.dataType)) {
    return 'string'
  }
}

/** Keep authored output identities for decisions; changing equipment invalidates its result links. */
export function clearSkill (node: StepNode): void {
  node.skillId = ''
  delete node.skillReference
  node.bindings = []
  for (const output of node.outputs ?? []) {
    delete output.source
  }
}

export function assignSkill (node: StepNode, skill: SkillDefinition): void {
  if (JSON.stringify(node.skillReference) !== JSON.stringify(skill.reference)) {
    clearSkill(node)
  }
  node.skillId = skill.idShort
  node.skillReference = skill.reference
  node.bindings = skill.parameters.map(parameter => {
    const source = inputSource(parameter, node.process?.parameters ?? [])
    return { name: parameter.idShort, source: source?.source ?? null,
      value: source ? '' : String(parameter.defaultValue ?? ''),
      ...(parameter.reference ? { target: parameter.reference } : {}),
    }
  })
}

export function addSkillResults (node: StepNode, skill: SkillDefinition): void {
  const outputs = node.outputs ?? []
  for (const result of skill.outputs ?? []) {
    const type = resultType(result)
    if (!type || !result.reference || outputs.some(output => JSON.stringify(output.source) === JSON.stringify(result.reference))) {
      continue
    }
    // Reuse only an unambiguous compatible authored declaration, preserving decision references.
    const existing = outputs.filter(output => !output.source && output.name === result.name && output.type === type && output.unit === result.unit)
    if (existing.length === 1) {
      existing[0].source = result.reference
    } else {
      outputs.push({ id: v4(), name: result.name, type, unit: result.unit, source: result.reference })
    }
  }
  node.outputs = outputs
}
