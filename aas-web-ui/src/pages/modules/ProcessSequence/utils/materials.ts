import type { PlanProcess, PlanScope, SourceReference } from '../types/plan.ts'
import type { AasElement } from './sequenceModel.ts'

export const materialSemantic = (name: string) => `https://smartproductionlab.aau.dk/ProcessParameters/MaterialUse/${name}/1/0`
export const materialRoles = { workpiece: 'Workpiece', incorporated: 'Added component', consumable: 'Consumable', output: 'Produced material', linked: 'Linked material' } as const
export type MaterialRole = keyof typeof materialRoles
export interface MaterialUse {
  id: string
  name: string
  role: MaterialRole
  quantity: string
  unit: string
  reference?: SourceReference
  scopeId?: string
  warning?: string
}
export const materialAmount = (material: MaterialUse) => material.quantity ? `${material.quantity}${material.unit ? ` ${material.unit}` : ''}` : 'Quantity unspecified'
const elements = (model: AasElement): AasElement[] => Array.isArray(model.value) ? model.value : []
const field = (model: AasElement, name: string) => elements(model).find(item => item.semanticId?.keys?.[0]?.value === materialSemantic(name))
const referencePath = (reference: AasElement) => reference?.keys?.map((key: { value: string }) => key.value) ?? []
const samePath = (source: SourceReference, reference: AasElement) => JSON.stringify([source.submodelId, ...source.path]) === JSON.stringify(referencePath(reference))

/** Project material requirements; a BoM total is never treated as a per-operation quantity. */
export function readMaterialUses (process: PlanProcess, scopes: PlanScope[] = []): MaterialUse[] {
  return process.material.flatMap((raw, index) => {
    if (!raw || typeof raw !== 'object') return []
    const entry = raw as AasElement
    const structured = entry.semanticId?.keys?.[0]?.value === materialSemantic('MaterialUse')
    const reference = structured ? field(entry, 'MaterialReference')?.value : (entry.modelType === 'ReferenceElement' ? entry.value : undefined)
    const path = referencePath(reference)
    const scope = scopes.find(scope => scope.material && samePath(scope.material, reference))
    const roleValue = String(field(entry, 'Role')?.value ?? '')
    const role: MaterialRole = structured && Object.hasOwn(materialRoles, roleValue) ? roleValue as MaterialRole : 'linked'
    const quantityReference = field(entry, 'QuantityParameterReference')?.value
    const parameter = quantityReference ? process.parameters.find(parameter => samePath(parameter.source, quantityReference)) : undefined
    const quantity = String(quantityReference ? parameter?.value ?? '' : field(entry, 'Quantity')?.value ?? '')
    const unit = String(quantityReference ? parameter?.unit ?? '' : field(entry, 'Unit')?.value ?? '')
    let warning = role === 'linked' ? 'Material participation only; how it is used has not been specified.' : undefined
    if (!path.length) warning = 'No resolvable BoM occurrence reference.'
    if (quantityReference && !parameter) warning = 'The quantity parameter could not be resolved.'
    if (quantity && (!Number.isFinite(Number(quantity)) || Number(quantity) < 0)) warning = 'The quantity must be a non-negative number.'
    return [{
      id: String(index), name: scope?.name ?? entry.displayName?.find((name: { language: string }) => name.language === 'en')?.text ?? path.at(-1) ?? entry.idShort ?? 'Material',
      role, quantity, unit, scopeId: scope?.id, warning,
      reference: path.length ? { aasId: process.source.aasId, submodelId: path[0], path: path.slice(1) } : undefined,
    }]
  })
}

/** Application extension inside the standard ProcessBoM collection. */
export function materialUse (idShort: string, name: string, reference: AasElement, role: Exclude<MaterialRole, 'linked'>, quantity: { value: number, unit: string } | { reference: AasElement }): AasElement {
  const semanticId = (name: string) => ({ type: 'ExternalReference', keys: [{ type: 'GlobalReference', value: materialSemantic(name) }] })
  const property = (name: string, value: string | number, valueType = 'xs:string') => ({ modelType: 'Property', idShort: name, semanticId: semanticId(name), valueType, value: String(value) })
  return { modelType: 'SubmodelElementCollection', idShort, displayName: [{ language: 'en', text: name }], semanticId: semanticId('MaterialUse'), value: [
    { modelType: 'ReferenceElement', idShort: 'MaterialReference', semanticId: semanticId('MaterialReference'), value: reference },
    property('Role', role),
    ...('reference' in quantity ? [{ modelType: 'ReferenceElement', idShort: 'QuantityParameterReference', semanticId: semanticId('QuantityParameterReference'), value: quantity.reference }]
      : [property('Quantity', quantity.value, 'xs:double'), property('Unit', quantity.unit)]),
  ] }
}

/** Upgrade plain demo links by target, preserving authored entries and unknown references. */
export function upgradeMaterialUses (current: AasElement, template: AasElement): void {
  const pending = [...elements(template)]
  const entries = elements(current).map(entry => {
    const reference = entry.modelType === 'ReferenceElement' ? entry.value : field(entry, 'MaterialReference')?.value
    const index = pending.findIndex(candidate => JSON.stringify(referencePath(field(candidate, 'MaterialReference')?.value)) === JSON.stringify(referencePath(reference)) && referencePath(reference).length > 0)
    if (index < 0) return entry
    const replacement = pending.splice(index, 1)[0]!
    return entry.modelType === 'ReferenceElement' && !entry.semanticId ? structuredClone(replacement) : entry
  })
  const used = new Set<string>()
  current.value = [...entries, ...structuredClone(pending)].map(entry => {
    const base = entry.idShort
    let suffix = 1
    while (used.has(entry.idShort)) entry.idShort = `${base}_${suffix++}`
    used.add(entry.idShort)
    return entry
  })
}
