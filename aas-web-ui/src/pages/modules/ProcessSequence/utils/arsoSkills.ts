import type { SkillDefinition, SkillParameter } from '../types'
import type { CapabilityReference } from '../types/plan'
import { ARSO_SKILLS_SUBMODEL, PROCESS_SEQUENCE_IRI_BASE } from '../constants/contracts'
import { parameterMeanings } from './parameterSemantics'
import { childrenOf, semanticId } from './planSources'

type Element = Record<string, any>
const startMeaning = `${PROCESS_SEQUENCE_IRI_BASE}/skill/Start`
const protocolMeaning = `${PROCESS_SEQUENCE_IRI_BASE}/ControlComponent/Skill/OperationVariable/1/0`
const label = (element: Element) => element.displayName?.find((item: Element) => item.language === 'en')?.text ?? element.idShort
const qualifier = (element: Element, name: string) => element.qualifiers?.find((item: Element) => item.type === name)?.value
function limit (element: Element, name: string): number | null {
  const raw = qualifier(element, name)
  return raw != null && String(raw).trim() !== '' && Number.isFinite(Number(raw)) ? Number(raw) : null
}

/** ARSO variables belong to the Start operation; lifecycle/session fields are execution context. */
export function readArsoSkills (submodel: Element): SkillDefinition[] {
  if (semanticId(submodel) !== ARSO_SKILLS_SUBMODEL) {
    return []
  }
  const skills: SkillDefinition[] = []
  function visit (element: Element, keys: CapabilityReference['keys']): void {
    const start = childrenOf(element).find(child => child.modelType === 'SubmodelElementCollection' && semanticId(child) === startMeaning)
    const operation = start && childrenOf(start).find(child => child.modelType === 'Operation' && semanticId(child) === startMeaning)
    if (start && operation) {
      const operationKeys = [...keys, { type: 'SubmodelElementCollection', value: start.idShort }, { type: 'Operation', value: operation.idShort }]
      function variables (direction: 'inputVariables' | 'outputVariables'): SkillParameter[] {
        return (operation![direction] ?? []).map((variable: Element) => variable.value).filter((variable: Element) => variable?.modelType === 'Property' && semanticId(variable) !== protocolMeaning).map((variable: Element) => ({
          idShort: variable.idShort, name: label(variable), dataType: variable.valueType,
          unit: variable.embeddedDataSpecifications?.find((spec: Element) => spec.dataSpecificationContent?.modelType === 'DataSpecificationIec61360')?.dataSpecificationContent?.unit ?? qualifier(variable, 'Unit') ?? '',
          minValue: limit(variable, 'Minimum'), maxValue: limit(variable, 'Maximum'),
          defaultValue: qualifier(variable, 'Default') ?? variable.value ?? null,
          semanticIds: parameterMeanings(variable),
          reference: { type: 'ModelReference', keys: [...operationKeys, { type: variable.modelType, value: variable.idShort }] },
        }))
      }
      skills.push({ idShort: element.idShort, name: label(element), description: element.description?.find((item: Element) => item.language === 'en')?.text ?? '', capabilities: [], reference: { type: 'ModelReference', keys }, parameters: variables('inputVariables'), outputs: variables('outputVariables') })
      return // Composite internals stay in the resource definition.
    }
    for (const child of childrenOf(element)) {
      if (child.modelType === 'SubmodelElementCollection') {
        visit(child, [...keys, { type: child.modelType, value: child.idShort }])
      }
    }
  }
  visit(submodel, [{ type: 'Submodel', value: submodel.id }])
  return skills
}
