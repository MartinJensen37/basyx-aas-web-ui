import { describe, expect, it } from 'vitest'
import { canCall, expandPlan, newNode, newPlan, parsePlan, structuralIssues } from './plan'
import { readMaterialScopes, readPlanProcesses } from './planSources'

describe('assembly process plans', () => {
  it('waits for every branch of nested parallel subprocesses and distinguishes repeated calls', () => {
    const plan = newPlan('urn:product', 'Product')
    const first = newNode('step')
    const parallel = newNode('parallel')
    if (parallel.kind !== 'parallel') {
      throw new Error('Expected parallel node')
    }
    const left = newNode('step')
    const right = newNode('step')
    const finish = newNode('step')
    parallel.branches[0].nodes.push(left)
    parallel.branches[1].nodes.push(right)
    plan.scopes.push({ id: 'assembly', name: 'Assembly', parentId: 'product', material: null, nodes: [first, parallel, finish] })
    plan.scopes[0].nodes.push(newNode('call', 'assembly'), newNode('call', 'assembly'))
    const expanded = expandPlan(plan)
    expect(expanded).toHaveLength(8)
    expect(new Set(expanded.map(step => step.id)).size).toBe(8)
    expect(expanded[1].after).toEqual([expanded[0].id])
    expect(expanded[2].after).toEqual([expanded[0].id])
    expect(expanded[3].after).toEqual([expanded[1].id, expanded[2].id])
    expect(expanded[4].after).toEqual([expanded[3].id])
    expect(expanded[7].after).toEqual([expanded[5].id, expanded[6].id])
  })

  it('round trips every scope, parameter reference and parallel branch without requiring resources', () => {
    const plan = newPlan('urn:product', 'Product')
    plan.scopes[0].nodes.push(newNode('parallel'), newNode('step'))
    expect(parsePlan(JSON.stringify(plan), plan.productAasId)).toEqual(plan)
    expect(() => parsePlan(JSON.stringify(plan), 'urn:other')).toThrow('another product')
    expect(() => parsePlan(JSON.stringify({ ...plan, schema: 'future' }), plan.productAasId)).toThrow()
  })

  it('rejects recursive subprocess calls and cyclic parent relationships', () => {
    const plan = newPlan('urn:product', 'Product')
    plan.scopes.push({ id: 'child', name: 'Child', parentId: 'product', material: null, nodes: [] })
    plan.scopes[0].nodes.push(newNode('call', 'child'))
    expect(canCall(plan, 'child', 'product')).toBe(false)
    expect(canCall(plan, 'product', 'child')).toBe(true)
    plan.scopes[1].nodes.push(newNode('call', 'product'))
    expect(() => parsePlan(JSON.stringify(plan), plan.productAasId)).toThrow('cannot call itself')
    plan.scopes[1].nodes = []
    plan.scopes[1].parentId = 'child'
    expect(structuralIssues(plan).join(',')).toContain('hierarchy contains a cycle')
  })

  it('retains separate material occurrences of the same asset', () => {
    const entity = (idShort: string) => ({ modelType: 'Entity', idShort, globalAssetId: 'urn:motor', statements: [] })
    const submodel = {
      id: 'urn:bom', submodelElements: [{ modelType: 'Entity', idShort: 'Product', statements: [entity('Left'), entity('Right')] }],
    }
    const scopes = readMaterialScopes(submodel, 'urn:product', 'product')
    expect(scopes[0].id).not.toBe(scopes[1].id)
    expect(scopes[0].material?.path).toEqual(['Product', 'Left'])
    expect(scopes[1].material?.path).toEqual(['Product', 'Right'])
  })

  it('reads all parameter groups and ProcessBoM without requiring numbered process names', () => {
    const property = (idShort: string, value: string) => ({ modelType: 'Property', idShort, valueType: 'xs:string', value })
    const collection = (idShort: string, value: unknown[]) => ({ modelType: 'SubmodelElementCollection', idShort, value })
    const material = collection('Input', [property('Asset', 'urn:part')])
    const submodel = {
      id: 'urn:inputs', submodelElements: [collection('Processes', [collection('CustomName', [
        property('ProcessId', 'weld'), property('ProcessName', 'Weld'),
        ...['ProductParameters', 'ProcessParameters', 'ResourceParameters'].map(group => collection(group, [property('Setpoint', group)])),
        collection('ProcessBoM', [material]),
      ])])],
    }
    const [process] = readPlanProcesses(submodel, 'urn:product')
    expect(process.parameters).toHaveLength(3)
    expect(new Set(process.parameters.map(parameter => JSON.stringify(parameter.source))).size).toBe(3)
    expect(process.parameters[1].source.path).toEqual(['Processes', 'CustomName', 'ProcessParameters', 'Setpoint'])
    expect(process.material).toEqual([material])
    expect(process.source.submodelId).toBe('urn:inputs')
  })
})
