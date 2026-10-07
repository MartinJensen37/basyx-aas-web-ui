import type { SkillCatalog, SkillDefinition } from '../types'
import { skillSemantic } from '../constants/contracts'
import { childrenOf, semanticId } from './planSources'

type Element = Record<string, any>
function named (element: Element, name: string): Element | undefined {
  return childrenOf(element).find(child => semanticId(child) === skillSemantic(name))
    ?? childrenOf(element).find(child => !semanticId(child) && child.idShort === name)
}
const text = (element: Element, name: string): string => String(named(element, name)?.value ?? '')
function number (element: Element, name: string): number | null {
  const value = text(element, name)
  return value.trim() && Number.isFinite(Number(value)) ? Number(value) : null
}

/** The skill catalog is an application contract; IDTA CapabilityRealizedBy points to these entries. */
export function readSkillCatalog (submodel: Element): SkillCatalog {
  const skills: SkillDefinition[] = []
  function visit (element: Element, path: string[]): void {
    if (named(element, 'SkillId')) {
      skills.push({
        idShort: text(element, 'SkillId'), name: text(element, 'SkillName') || text(element, 'SkillId'),
        description: text(element, 'SkillDescription'),
        reference: { type: 'ModelReference', keys: [{ type: 'Submodel', value: submodel.id }, ...path.map(value => ({ type: 'SubmodelElementCollection', value }))] },
        capabilities: childrenOf(element).filter(child => semanticId(child) === skillSemantic('ProvidedCapability') || (!semanticId(child) && child.idShort === 'ProvidedCapability')).flatMap(child => child.value?.keys?.map((key: { value: string }) => key.value) ?? []),
        parameters: childrenOf(named(element, 'Parameters') ?? {}).map(parameter => ({
          idShort: text(parameter, 'ParameterId'), name: text(parameter, 'ParameterName') || text(parameter, 'ParameterId'),
          dataType: text(parameter, 'DataType'), unit: text(parameter, 'Unit'),
          minValue: number(parameter, 'MinValue'), maxValue: number(parameter, 'MaxValue'), defaultValue: text(parameter, 'DefaultValue') || null,
        })),
      })
      return
    }
    for (const child of childrenOf(element)) {
      if (child.modelType === 'SubmodelElementCollection') {
        visit(child, [...path, child.idShort])
      }
    }
  }
  visit(submodel, [])
  return { skills, byIdShort: new Map(skills.map(skill => [skill.idShort, skill])) }
}
