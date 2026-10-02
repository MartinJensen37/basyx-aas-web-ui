import type { CapabilityReference } from './plan'

export type SkillParameter = {
  idShort: string
  name: string
  dataType: string
  unit: string
  minValue: number | null
  maxValue: number | null
  defaultValue: string | null
}
export type SkillDefinition = {
  idShort: string
  name: string
  description: string
  capabilities: string[]
  parameters: SkillParameter[]
  reference?: CapabilityReference
}
export type SkillCatalog = {
  skills: SkillDefinition[]
  byIdShort: Map<string, SkillDefinition>
}
