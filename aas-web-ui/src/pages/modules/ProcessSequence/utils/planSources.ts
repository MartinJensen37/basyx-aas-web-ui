import type { PlanParameter, PlanProcess, PlanScope, SourceReference } from '../types/plan.ts'
import { PROCESS_STEP_CAPABILITY_SEMANTIC_ID, processParameterSemantic } from '../constants/contracts.ts'
import { capabilityReferenceSchema } from '../types/plan.ts'
import { readBulkCount } from './bulkCount.ts'

type Element = Record<string, any>

export function childrenOf (element: Element): Element[] {
  const children = element.submodelElements ?? element.value
  return Array.isArray(children) ? children : []
}

function named (element: Element, name: string): Element | undefined {
  const expected = processParameterSemantic(name)
  return childrenOf(element).find(child => semanticId(child) === expected)
    ?? childrenOf(element).find(child => !semanticId(child) && child.idShort === name)
}

export function semanticId (element: Element): string {
  const keys = element.semanticId?.keys
  return keys?.length === 1 ? String(keys[0].value ?? '') : ''
}

function label (element: Element): string {
  const names = element.displayName ?? element.name
  return typeof names === 'string' ? names : names?.find((item: Element) => item.language === 'en')?.text ?? names?.[0]?.text ?? element.idShort ?? ''
}

/** Keep each material occurrence's path; asset identity alone cannot distinguish repeated parts. */
export function readMaterialScopes (submodel: Element, aasId: string, rootId: string): PlanScope[] {
  const elements = childrenOf(submodel)
  const entry = elements.find(element => semanticId(element).includes('/EntryNode/'))
    ?? elements.find(element => element.modelType === 'Entity')
  if (!entry) {
    return []
  }
  const scopes: PlanScope[] = []
  function visit (entity: Element, parentId: string, path: string[]): void {
    for (const child of (entity.statements ?? []) as Element[]) {
      if (child.modelType !== 'Entity') {
        continue
      }
      const next = [...path, String(child.idShort)]
      const id = JSON.stringify([rootId, submodel.id, next])
      scopes.push({
        id, name: label(child), parentId, nodes: [],
        material: { aasId, submodelId: submodel.id, path: next, globalAssetId: child.globalAssetId ?? '', ...readBulkCount(child) },
      })
      visit(child, id, next)
    }
  }
  visit(entry, rootId, [String(entry.idShort)])
  return scopes
}

function parameterLeaves (element: Element, source: SourceReference, group: PlanParameter['group']): PlanParameter[] {
  const children = childrenOf(element)
  if (element.modelType === 'SubmodelElementCollection' || element.modelType === 'SubmodelElementList') {
    return children.flatMap((child, index) => parameterLeaves(child, {
      ...source, path: [...source.path, child.idShort ?? String(index)],
    }, group))
  }
  const unit = element.embeddedDataSpecifications?.find((spec: Element) => spec.dataSpecificationContent?.modelType === 'DataSpecificationIec61360')?.dataSpecificationContent?.unit
  return [{
    name: label(element) || source.path.at(-1) || '', group, source,
    dataType: String(element.valueType ?? element.modelType ?? ''),
    value: typeof element.value === 'object' ? JSON.stringify(element.value) : String(element.value ?? ''),
    ...(typeof unit === 'string' ? { unit } : {}),
  }]
}

export function readPlanProcesses (submodel: Element, aasId: string): PlanProcess[] {
  const container = named(submodel, 'Processes')
  if (!container) {
    return []
  }
  return childrenOf(container).filter(process => process.modelType === 'SubmodelElementCollection'
    && (!semanticId(process) || semanticId(process) === processParameterSemantic('Process'))
    && named(process, 'ProcessId')).map(process => {
    const source = { aasId, submodelId: String(submodel.id), path: [String(container.idShort), String(process.idShort)] }
    const parameters: PlanParameter[] = []
    for (const group of ['ProductParameters', 'ProcessParameters', 'ResourceParameters'] as const) {
      const collection = named(process, group)
      if (collection) {
        parameters.push(...parameterLeaves(collection, { ...source, path: [...source.path, String(collection.idShort)] }, group))
      }
    }
    return {
      processId: String(named(process, 'ProcessId')?.value ?? ''),
      name: String(named(process, 'ProcessName')?.value ?? process.idShort), source, parameters,
      material: childrenOf(named(process, 'ProcessBoM') ?? {}),
      requiredCapabilities: childrenOf(process).filter(child => child.modelType === 'ReferenceElement'
        && semanticId(child) === PROCESS_STEP_CAPABILITY_SEMANTIC_ID).flatMap(child => {
        const parsed = capabilityReferenceSchema.safeParse(child.value)
        return parsed.success ? [{ name: label(child), reference: parsed.data }] : []
      }),
    }
  })
}
