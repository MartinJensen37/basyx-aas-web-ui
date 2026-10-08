import type { AasElement } from './sequenceModel.ts'

export const BULK_COUNT_SEMANTIC_ID = 'https://admin-shell.io/idta/HierarchicalStructures/BulkCount/1/0'

/** Occurrence multiplicity, not a step allocation or a volume. Keep unsignedLong precision. */
export function readBulkCount (entity: AasElement): { bulkCount?: string, bulkCountWarning?: string } {
  const counts = (entity.statements ?? []).filter((item: AasElement) => item.semanticId?.keys?.length === 1
    && item.semanticId.keys[0].value === BULK_COUNT_SEMANTIC_ID)
  if (counts.length === 0) {
    return {}
  }
  const count = counts[0]
  const raw = String(count.value ?? '').trim()
  if (counts.length !== 1 || count.modelType !== 'Property' || count.valueType !== 'xs:unsignedLong'
    || !/^\+?\d+$/.test(raw) || BigInt(raw) > 18_446_744_073_709_551_615n) {
    return { bulkCountWarning: 'BoM BulkCount must be a single xs:unsignedLong property.' }
  }
  return { bulkCount: BigInt(raw).toString() }
}

/** Upgrade only the known pharma count extension; retain authored values and existing BulkCount. */
export function upgradeDemoBulkCounts (model: AasElement): void {
  if (model.modelType === 'Entity') {
    const items: AasElement[] = model.statements ?? []
    const existing = items.some(item => item.semanticId?.keys?.[0]?.value === BULK_COUNT_SEMANTIC_ID)
    const quantity = items.find(item => item.semanticId?.keys?.[0]?.value === 'https://smartproductionlab.aau.dk/demo/pharma/semantics/Quantity')
    const unit = items.find(item => item.semanticId?.keys?.[0]?.value === 'https://smartproductionlab.aau.dk/demo/pharma/semantics/QuantityUnit')
    if (!existing && quantity && unit?.value === 'piece' && !items.some(item => item.idShort === 'BulkCount')) {
      const candidate = { ...quantity, idShort: 'BulkCount', valueType: 'xs:unsignedLong', semanticId: { type: 'ExternalReference', keys: [{ type: 'GlobalReference', value: BULK_COUNT_SEMANTIC_ID }] } }
      if (readBulkCount({ statements: [candidate] }).bulkCount !== undefined) {
        Object.assign(quantity, candidate)
        model.statements = items.filter(item => item !== unit)
      }
    }
  }
  for (const child of model.submodelElements ?? model.statements ?? []) {
    upgradeDemoBulkCounts(child)
  }
}
