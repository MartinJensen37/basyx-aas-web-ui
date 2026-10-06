import type { ConditionalNode, PlanNode } from '../types/plan'
import { jsonization } from '@aas-core-works/aas-core3.1-typescript'
import { describe, expect, it } from 'vitest'
import { expandPlan, flattenNodes, newNode, newPlan, parsePlan, structuralIssues } from './plan'
import { buildPlanGraph, conditionalLaneId, findLane } from './planGraph'
import { extractAssembly } from './planTree'
import { buildSequenceSubmodel, readSequenceSubmodel, sequenceSemantic } from './sequenceModel'

function fixture () {
  const plan = newPlan('urn:periodic-product', 'Sampled product')
  const before = newNode('step')
  const inspection = newNode('step')
  const after = newNode('step')
  const flow = newNode('conditional') as ConditionalNode & { condition: { kind: 'everyNthProduct', every: number } }
  flow.nodes.push(inspection)
  plan.scopes[0].nodes = [before, flow, after]
  return { plan, flow, before, inspection, after }
}

describe('periodic optional flows', () => {
  it('runs on products 5, 10 and 15, with a direct predecessor when skipped', () => {
    const { plan, before, inspection, after } = fixture()
    for (let number = 1; number <= 16; number++) {
      const steps = expandPlan(plan, plan.rootScopeId, number)
      const sampled = number % 5 === 0
      expect(steps.map(entry => entry.step.id)).toEqual(sampled ? [before.id, inspection.id, after.id] : [before.id, after.id])
      expect(steps.at(-1)!.after).toEqual([steps.at(-2)!.id])
    }
    for (const number of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => expandPlan(plan, plan.rootScopeId, number)).toThrow('positive whole number')
    }
  })

  it('keeps the same run counter inside calls and joins only active branch work', () => {
    const { plan, flow, inspection, after } = fixture()
    const parallel = newNode('parallel')
    if (parallel.kind !== 'parallel') {
      throw new Error('Expected parallel')
    }
    parallel.branches[0].nodes = [newNode('call', 'inspection')]
    parallel.branches[1].nodes = [newNode('step')]
    plan.scopes[0].nodes = [parallel, after]
    plan.scopes.push({ id: 'inspection', name: 'Inspection', parentId: 'product', material: null, nodes: [flow] })
    const skipped = expandPlan(plan, plan.rootScopeId, 4)
    expect(skipped.map(item => item.step.id)).not.toContain(inspection.id)
    expect(skipped.at(-1)!.after).toEqual([skipped[0].id])
    const sampled = expandPlan(plan, plan.rootScopeId, 5)
    expect(sampled.at(-1)!.after).toEqual(sampled.slice(0, -1).map(item => item.id))
    flow.condition.every = 1
    expect(expandPlan(plan).some(item => item.step.id === inspection.id)).toBe(true)
  })

  it('validates rules and calls even when their optional path is skipped', () => {
    const { plan, flow } = fixture()
    for (const every of [0, -2, 2.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
      flow.condition.every = every
      expect(() => parsePlan(JSON.stringify(plan), plan.productAasId)).toThrow()
    }
    flow.condition.every = 5
    flow.nodes = [newNode('call', 'product')]
    expect(structuralIssues(plan).join(' ')).toContain('cannot call itself')
    expect(() => expandPlan(plan)).toThrow('cannot call itself')
    plan.scopes.push({ id: 'child', name: 'Child', parentId: 'product', material: null, nodes: [flow] })
    plan.scopes[0].nodes = []
    expect(() => extractAssembly(plan, 'child', 'urn:child')).toThrow('outside this assembly')
  })

  it('round trips the rule and body as AAS elements, and rejects unknown counter semantics', () => {
    const { plan, flow } = fixture()
    const parsed = parsePlan(JSON.stringify(plan), plan.productAasId)
    expect(parsed.schema).toBe('process-sequence-plan/4.0')
    const model = buildSequenceSubmodel(parsed, 'urn:periodic-sequence')
    expect(jsonization.submodelFromJsonable(model as never).error).toBeNull()
    expect(parsePlan(JSON.stringify(readSequenceSubmodel(model)), plan.productAasId)).toEqual(parsed)
    const scope = model.submodelElements.find((element: { idShort: string }) => element.idShort === 'Scopes').value[0]
    const saved = scope.value.find((element: { idShort: string }) => element.idShort === 'Steps').value[1]
    const condition = saved.value.find((element: { idShort: string }) => element.idShort === 'Condition')
    const interval = condition.value.find((element: { idShort: string }) => element.idShort === 'EveryNProducts')
    expect(interval).toMatchObject({ semanticId: { keys: [{ value: sequenceSemantic('EveryNProducts') }] }, value: String(flow.condition.every), valueType: 'xs:positiveInteger' })
    interval.idShort = 'RenamedInterval'
    expect(readSequenceSubmodel(model).scopes[0].nodes[1]).toEqual(flow)
    condition.value.find((element: { idShort: string }) => element.idShort === 'CounterScope').value = 'stationVisits'
    expect(() => readSequenceSubmodel(model)).toThrow('counter scope')
  })

  it('draws a skip path and an exclusive merge, and inserts into only the run path', () => {
    const { plan, flow, inspection } = fixture()
    const graph = buildPlanGraph(plan.scopes[0].nodes, [])
    expect(graph.nodes.find(node => node.id === `node:${flow.id}`)?.data).toMatchObject({ kind: 'conditional', subtitle: 'Every 5 products' })
    expect(graph.nodes.find(node => node.id === `join:${flow.id}`)?.data?.title).toBe('Continue after selected path')
    expect(graph.edges.filter(edge => edge.target === `join:${flow.id}`).map(edge => edge.source)).toEqual([`node:${inspection.id}`, `branch:conditional-skip:${flow.id}`])
    const lane = findLane(plan.scopes[0].nodes, conditionalLaneId(flow.id))!
    const inserted = newNode('call', 'subprocess')
    lane.nodes.splice(lane.index + 1, 0, inserted)
    expect(flow.nodes).toEqual([inserted, inspection])
    expect(flattenNodes(plan.scopes[0].nodes)).toContain(inserted)
    expect(findLane(plan.scopes[0].nodes, inspection.id)?.index).toBe(1)
  })

  it('combines nested rules using the same product number', () => {
    const { plan, flow, inspection } = fixture()
    const inner: PlanNode = { id: 'inner', kind: 'conditional', name: 'Every second product', condition: { kind: 'everyNthProduct', every: 2 }, nodes: [inspection] }
    flow.nodes = [inner]
    expect(expandPlan(plan, plan.rootScopeId, 5).some(item => item.step.id === inspection.id)).toBe(false)
    expect(expandPlan(plan, plan.rootScopeId, 10).some(item => item.step.id === inspection.id)).toBe(true)
  })
})
