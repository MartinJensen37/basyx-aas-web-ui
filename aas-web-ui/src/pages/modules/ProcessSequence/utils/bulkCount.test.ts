import type { StepNode } from '../types/plan'
import { describe, expect, it } from 'vitest'
import { buildPharmaDemo } from '../demo/pharma'
import { BULK_COUNT_SEMANTIC_ID, readBulkCount, upgradeDemoBulkCounts } from './bulkCount'
import { materialAmount, readMaterialUses } from './materials'
import { parsePlan } from './plan'
import { readMaterialScopes, readPlanProcesses } from './planSources'
import { buildSequenceDocuments } from './sequenceDocuments'
import { modelRef, sem } from './sequenceModel'

const count = (value: string) => ({ modelType: 'Property', idShort: 'RenamedCount', valueType: 'xs:unsignedLong', value, semanticId: sem(BULK_COUNT_SEMANTIC_ID) })
const entity = (value: string) => ({ modelType: 'Entity', idShort: 'Part', globalAssetId: 'urn:shared-part', statements: [count(value)] })

describe('BoM occurrence counts', () => {
  it('reads semantic IDs and exact unsignedLong values without inventing absent counts', () => {
    expect(readBulkCount(entity('18446744073709551615'))).toEqual({ bulkCount: '18446744073709551615' })
    expect(readBulkCount(entity('+002'))).toEqual({ bulkCount: '2' })
    expect(readBulkCount(entity('0'))).toEqual({ bulkCount: '0' })
    expect(readBulkCount({ statements: [{ ...count('2'), idShort: 'BulkCount', semanticId: sem('urn:unrelated') }] })).toEqual({})
    expect(readBulkCount({})).toEqual({})
    for (const value of ['', '-1', '1.5', '1e3', '18446744073709551616']) {
      expect(readBulkCount(entity(value))).toHaveProperty('bulkCountWarning')
    }
    expect(readBulkCount({ statements: [count('1'), count('2')] })).toHaveProperty('bulkCountWarning')
    expect(readBulkCount({ statements: [{ ...count('2'), valueType: 'xs:double' }] })).toHaveProperty('bulkCountWarning')
  })

  it('retains each occurrence count without multiplying ancestors or merging identical assets', () => {
    const model = { id: 'urn:bom', submodelElements: [{ modelType: 'Entity', idShort: 'Product', statements: [
      { ...entity('2'), statements: [count('2'), { ...entity('3'), idShort: 'Nested' }] },
      { ...entity('5'), idShort: 'Other' },
    ] }] }
    const scopes = readMaterialScopes(model, 'urn:owner', 'root')
    expect(scopes.map(scope => scope.material?.bulkCount)).toEqual(['2', '3', '5'])
    expect(scopes.map(scope => scope.material?.path)).toEqual([['Product', 'Part'], ['Product', 'Part', 'Nested'], ['Product', 'Other']])
  })

  it('shows BoM totals for plain links while preserving explicit per-step allocations', () => {
    const demo = buildPharmaDemo(id => `${id}/sequence`)
    const plan = demo.plans.find(plan => plan.productAasId.endsWith('/syringe-two-dose'))!
    const process = (plan.scopes[0]!.nodes.find(node => node.id === 'Stoppering_1') as StepNode).process!
    const allocated = readMaterialUses(process, plan.scopes).find(material => material.role === 'incorporated')!
    expect(allocated).toMatchObject({ quantity: '1', bomCount: '2' })
    expect(materialAmount(allocated)).toBe('1 piece')
    const occurrence = plan.scopes.find(scope => scope.id === 'part-1')!.material!
    process.material = [{ modelType: 'ReferenceElement', value: modelRef([{ type: 'Submodel', value: occurrence.submodelId }, ...occurrence.path.map(value => ({ type: 'Entity', value }))]) }]
    const linked = readMaterialUses(process, plan.scopes)[0]!
    expect(linked).toMatchObject({ role: 'linked', quantity: '', bomCount: '2' })
    expect(materialAmount(linked)).toBe('BoM: 2 pieces')
    occurrence.bulkCount = '0'
    expect(materialAmount(readMaterialUses(process, plan.scopes)[0]!)).toBe('BoM: 0 pieces')
    expect(materialAmount(readMaterialUses(process)[0]!)).toBe('Quantity unspecified')
  })

  it('retains metadata through workspace parsing but keeps BoM counts out of sequence documents', () => {
    const demo = buildPharmaDemo(id => `${id}/sequence`)
    const plan = demo.plans.find(plan => plan.productAasId.endsWith('/syringe-two-dose'))!
    const parsed = parsePlan(JSON.stringify(plan), plan.productAasId)
    expect(parsed.scopes.find(scope => scope.id === 'part-1')!.material?.bulkCount).toBe('2')
    const models = buildSequenceDocuments(parsed, 'urn:sequence', demo.submodels.flatMap(model => readPlanProcesses(model, plan.productAasId)))
    expect(JSON.stringify(models)).not.toMatch(/bulkCount|BulkCount/)
  })

  it('migrates known demo piece counts while preserving liquid quantities and authored standard counts', () => {
    const legacy = (unit: string) => ({ modelType: 'Entity', statements: [
      { modelType: 'Property', idShort: 'Quantity', valueType: 'xs:double', value: '3', semanticId: sem('https://smartproductionlab.aau.dk/demo/pharma/semantics/Quantity') },
      { modelType: 'Property', idShort: 'QuantityUnit', valueType: 'xs:string', value: unit, semanticId: sem('https://smartproductionlab.aau.dk/demo/pharma/semantics/QuantityUnit') },
    ] })
    const pieces = legacy('piece')
    upgradeDemoBulkCounts(pieces)
    expect(readBulkCount(pieces)).toEqual({ bulkCount: '3' })
    const migrated = structuredClone(pieces)
    upgradeDemoBulkCounts(pieces)
    expect(pieces).toEqual(migrated)
    for (const untouched of [legacy('mL'), { ...legacy('piece'), statements: [...legacy('piece').statements, count('7')] }]) {
      const before = structuredClone(untouched)
      upgradeDemoBulkCounts(untouched)
      expect(untouched).toEqual(before)
    }
  })
})
