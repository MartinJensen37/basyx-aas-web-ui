import type { SkillParameter } from '../types'
import type { PlanNode } from '../types/plan'
import type { Availability, CapabilityDescription } from '../utils/capabilities'
import type { AasElement } from '../utils/sequenceModel'
import type { ResourceSkill, SkillCommand } from './skillFlow'
import { readFlow, readSkills, ruleSetOf } from './skillFlow'

/**
 * A module's skills at a glance, for the overview the Skills submodel opens on: the skills the
 * module composes, the module's own commands, and its components' primitives (the building blocks),
 * each with what it takes, what it runs, what it offers and whether the program carries it out.
 */
export type Offer = { name: string, availability: Availability, properties: string[] }
export type SkillSummary = ResourceSkill & {
  /** What each command runs, step by step. */
  runs: Partial<Record<SkillCommand, string[]>>
  /** The capabilities it realizes. */
  offers: Offer[]
  /** The module's skills that run it as a step. */
  usedBy: string[]
}
export type ComponentSummary = { aasId: string, name: string, skills: SkillSummary[] }
export type SkillsOverview = { ruleSet: string, composites: SkillSummary[], control: SkillSummary[], components: ComponentSummary[] }

/** The idShort-like last part of an AAS id (``.../aas/FillingPumpAAS``). */
export const shellName = (aasId: string): string => aasId.split('/').findLast(Boolean) ?? aasId

/** A parameter as one line: its name, its range and unit, its default. */
export function parameterLine (item: SkillParameter): string {
  const range = item.minValue != null || item.maxValue != null ? ` ${item.minValue ?? '…'}–${item.maxValue ?? '…'}` : ''
  const unit = item.unit ? ` ${item.unit}` : ''
  return `${item.idShort}${range}${unit}${item.defaultValue != null && item.defaultValue !== '' ? ` (default ${item.defaultValue})` : ''}`
}

function steps (nodes: PlanNode[]): string[] {
  return nodes.flatMap(node => {
    switch (node.kind) {
      case 'step': { return [node.name]
      }
      case 'parallel': { return [`(${node.branches.map(branch => steps(branch.nodes).join(' → ')).join(' ‖ ')})`]
      }
      case 'decision': { return [`${node.name}? (${node.branches.map(branch => steps(branch.nodes).join(' → ') || '–').join(' | ')})`]
      }
      case 'conditional': { return [`${node.name}? (${steps(node.nodes).join(' → ')})`]
      }
      default: { return [node.name]
      }
    }
  })
}

function runs (submodel: AasElement, skill: ResourceSkill): Partial<Record<SkillCommand, string[]>> {
  const found: Partial<Record<SkillCommand, string[]>> = {}
  for (const command of skill.flows) {
    try {
      found[command] = steps(readFlow(submodel, skill.idShort, command))
    } catch (error) {
      found[command] = [error instanceof Error ? error.message : String(error)]
    }
  }
  return found
}

function stepSkills (submodel: AasElement, skill: ResourceSkill): string[] {
  const all = (nodes: PlanNode[]): PlanNode[] => nodes.flatMap(node => [node, ...(node.kind === 'parallel' || node.kind === 'decision'
    ? node.branches.flatMap(branch => all(branch.nodes))
    : (node.kind === 'conditional' ? all(node.nodes) : []))])
  return skill.flows.flatMap(command => {
    try {
      return all(readFlow(submodel, skill.idShort, command)).flatMap(node => (node.kind === 'step' ? [`${node.resourceAasId}#${node.skillId}`] : []))
    } catch {
      return []
    }
  })
}

function offersOf (skill: ResourceSkill, capabilities: CapabilityDescription[]): Offer[] {
  return capabilities.filter(item => item.aasId === skill.aasId && item.realizedBy.some(reference => reference.keys.at(-1)?.value === skill.idShort))
    .map(item => ({
      name: item.name, availability: item.availability,
      properties: item.properties.map(property => `${property.name} ${property.kind === 'range' ? `${property.min}–${property.max}` : property.value}${property.unit ? ` ${property.unit}` : ''}`),
    }))
}

/** The overview of a module's Skills submodel, with its components' skills and its offered capabilities. */
export function overview (submodel: AasElement, aasId: string, components: ResourceSkill[], capabilities: CapabilityDescription[] = []): SkillsOverview {
  const own = readSkills(submodel, aasId)
  const uses = new Map(own.map(skill => [skill.idShort, stepSkills(submodel, skill)]))
  const summary = (skill: ResourceSkill): SkillSummary => ({
    ...skill, runs: runs(submodel, skill), offers: offersOf(skill, capabilities),
    usedBy: own.filter(item => uses.get(item.idShort)?.includes(`${skill.aasId}#${skill.idShort}`)).map(item => item.idShort),
  })
  const byComponent = new Map<string, SkillSummary[]>()
  for (const skill of components) {
    byComponent.set(skill.aasId, [...(byComponent.get(skill.aasId) ?? []), { ...summary(skill), runs: {} }])
  }
  return {
    ruleSet: ruleSetOf(submodel),
    composites: own.filter(skill => skill.kind === 'Composite').map(skill => summary(skill)),
    control: own.filter(skill => skill.kind === 'ModuleControl').map(skill => summary(skill)),
    components: [...byComponent].map(([id, skills]) => ({ aasId: id, name: shellName(id), skills })),
  }
}
