import type { DecisionNode, StepNode } from '../types/plan'
import { jsonization } from '@aas-core-works/aas-core3.1-typescript'
import { describe, expect, it } from 'vitest'
import { newComparison, parseScalar } from './conditions'
import { expandPlan, flattenNodes, newNode, newPlan, parsePlan } from './plan'
import { buildPlanGraph, findLane } from './planGraph'
import { outputKey, previewPlan } from './planPreview'
import { changeNodeType, unwrapConditional } from './planTransforms'
import { buildSequenceSubmodel, readSequenceSubmodel } from './sequenceModel'

function operation (name: string): StepNode {
  return { ...newNode('step') as StepNode, name }
}

function fixture () {
  const plan = newPlan('urn:decisions', 'Decisions')
  const inspection = operation('Inspection')
  inspection.outputs = [{ id: 'passed', name: 'Passed', type: 'boolean', unit: '' }]
  const decision = newNode('decision') as DecisionNode
  decision.condition = { ...newComparison(), operand: { kind: 'output', stepId: inspection.id, outputId: 'passed' } }
  decision.branches[0].nodes = [operation('Accept')]
  decision.branches[1].nodes = [operation('Review')]
  const after = operation('After decision')
  plan.scopes[0].nodes = [inspection, decision, after]
  const key = outputKey(['product'], inspection.id, 'passed')
  return { plan, inspection, decision, after, key }
}

describe('typed decisions and preview', () => {
  it('chooses exactly one path and waits for its last operation at the merge', () => {
    const { plan, key } = fixture()
    for (const value of [true, false]) {
      const result = previewPlan(plan, 'product', 1, { [key]: value })
      expect(result.blocked).toBe(false)
      expect(result.steps.map(entry => entry.step.name)).toEqual(['Inspection', value ? 'Accept' : 'Review', 'After decision'])
      expect(result.steps.at(-1)!.after).toEqual([result.steps[1].id])
      expect(result.choices[0].path).toBe(value ? 'Yes' : 'No')
    }
  })

  it('holds missing or wrongly typed results instead of choosing No', () => {
    const { plan, key } = fixture()
    for (const values of [{}, { [key]: 'true' }]) {
      const result = previewPlan(plan, 'product', 1, values)
      expect(result.blocked).toBe(true)
      expect(result.steps.map(entry => entry.step.name)).toEqual(['Inspection'])
      expect(result.choices[0].path).toBe('Unresolved')
    }
    expect(() => expandPlan(plan)).toThrow('valid boolean')
  })

  it('evaluates typed parameter snapshots by source identity, not display names', () => {
    const { plan, inspection, decision } = fixture()
    const source = { aasId: 'urn:decisions', submodelId: 'urn:parameters', path: ['Fill', 'Volume'] }
    inspection.process = { processId: 'fill', name: 'Fill', source, material: [], parameters: [{ name: 'Volume', group: 'ProductParameters', dataType: 'xs:double', value: '2.5', source }] }
    decision.condition = { kind: 'comparison', operand: { kind: 'parameter', stepId: inspection.id, source }, operator: 'gte', expected: { type: 'number', value: 2 }, unit: '' }
    expect(previewPlan(plan).choices[0].path).toBe('Yes')
    inspection.process.parameters[0].name = 'Renamed'
    expect(previewPlan(plan).choices[0].path).toBe('Yes')
    inspection.process.parameters[0].value = ''
    expect(previewPlan(plan).blocked).toBe(true)
    inspection.process.parameters[0].dataType = 'xs:string'
    inspection.process.parameters[0].value = '2.5'
    expect(previewPlan(plan).choices[0].reason).toContain('datatype or unit')
  })

  it('does not infer conversions or accept malformed numeric values', () => {
    const { plan, decision, inspection, key } = fixture()
    inspection.outputs![0] = { id: 'passed', name: 'Volume', type: 'number', unit: 'mL' }
    decision.condition = { ...newComparison(), operand: { kind: 'output', stepId: inspection.id, outputId: 'passed' }, operator: 'lt', expected: { type: 'number', value: 3 }, unit: 'mL' }
    expect(previewPlan(plan, 'product', 1, { [key]: 2 }).choices[0].path).toBe('Yes')
    decision.condition.unit = 'L'
    expect(previewPlan(plan, 'product', 1, { [key]: 2 }).blocked).toBe(true)
    for (const value of ['', ' ', '0x10', 'Infinity', '1ml']) {
      expect(parseScalar('number', value)).toBeUndefined()
    }
    expect(parseScalar('number', '-2.5e2')).toBe(-250)
  })

  it('rejects future, sibling-branch and optional outputs even with supplied preview values', () => {
    const { plan, inspection, decision, key } = fixture()
    plan.scopes[0].nodes = [decision, inspection]
    expect(previewPlan(plan, 'product', 1, { [key]: true }).blocked).toBe(true)
    const optional = newNode('conditional')
    if (optional.kind !== 'conditional') {
      throw new Error('Expected optional')
    }
    optional.condition = { kind: 'everyNthProduct', every: 1 }
    optional.nodes = [inspection]
    plan.scopes[0].nodes = [optional, decision]
    expect(previewPlan(plan, 'product', 1, { [key]: true }).choices.at(-1)?.reason).toContain('every path')
    const parallel = newNode('parallel')
    if (parallel.kind !== 'parallel') {
      throw new Error('Expected parallel')
    }
    parallel.branches[0].nodes = [inspection]
    parallel.branches[1].nodes = [decision]
    plan.scopes[0].nodes = [parallel]
    expect(previewPlan(plan, 'product', 1, { [key]: true }).blocked).toBe(true)
  })

  it('allows outputs after an all-branch join and holds the join if one path is unresolved', () => {
    const { plan, inspection, decision, after, key } = fixture()
    const parallel = newNode('parallel')
    if (parallel.kind !== 'parallel') {
      throw new Error('Expected parallel')
    }
    parallel.branches[0].nodes = [inspection]
    parallel.branches[1].nodes = [operation('Prepare')]
    plan.scopes[0].nodes = [parallel, decision, after]
    expect(previewPlan(plan, 'product', 1, { [key]: false }).blocked).toBe(false)
    parallel.branches[0].nodes.push(decision)
    plan.scopes[0].nodes = [parallel, after]
    const result = previewPlan(plan)
    expect(result.blocked).toBe(true)
    expect(result.steps.map(entry => entry.step.name)).toEqual(['Inspection', 'Prepare'])
  })

  it('isolates simulated outputs for each subprocess invocation', () => {
    const { plan, inspection, decision } = fixture()
    plan.scopes.push({ id: 'child', name: 'Child', parentId: 'product', material: null, nodes: [inspection, decision] })
    const first = newNode('call', 'child')
    const second = newNode('call', 'child')
    plan.scopes[0].nodes = [first, second]
    const values = { [outputKey(['product', first.id], inspection.id, 'passed')]: true, [outputKey(['product', second.id], inspection.id, 'passed')]: false }
    const result = previewPlan(plan, 'product', 1, values)
    expect(result.choices.map(choice => choice.path)).toEqual(['Yes', 'No'])
    expect(new Set(result.inputs.map(input => input.key)).size).toBe(2)
  })

  it('round trips conditions, outputs and ordered branches through native AAS elements', () => {
    const { plan } = fixture()
    const expected = parsePlan(JSON.stringify(plan), plan.productAasId)
    expect(expected.schema).toBe('process-sequence-plan/5.0')
    const model = buildSequenceSubmodel(expected, 'urn:decision-sequence')
    expect(jsonization.submodelFromJsonable(model as never).error).toBeNull()
    expect(parsePlan(JSON.stringify(readSequenceSubmodel(model)), plan.productAasId)).toEqual(expected)
    expect(() => parsePlan(JSON.stringify({ ...expected, schema: 'process-sequence-plan/99.0' }), plan.productAasId)).toThrow()
  })

  it('does not turn a missing stored expected value into an empty-string match', () => {
    const { plan, decision } = fixture()
    decision.condition = { ...newComparison(), expected: { type: 'string', value: '' } }
    const model = buildSequenceSubmodel(parsePlan(JSON.stringify(plan), plan.productAasId), 'urn:incomplete')
    const scope = model.submodelElements.find((element: { idShort: string }) => element.idShort === 'Scopes').value[0]
    const saved = scope.value.find((element: { idShort: string }) => element.idShort === 'Steps').value[1]
    const condition = saved.value.find((element: { idShort: string }) => element.idShort === 'Condition')
    const expected = condition.value.find((element: { idShort: string }) => element.idShort === 'Expected')
    const literal = expected.value.find((element: { idShort: string }) => element.idShort === 'Value')
    for (const value of [null, undefined]) {
      literal.value = value
      expect(() => readSequenceSubmodel(model)).toThrow('explicit expected value')
    }
    expected.value = expected.value.filter((element: { idShort: string }) => element.idShort !== 'Value')
    expect(() => readSequenceSubmodel(model)).toThrow('explicit expected value')
  })

  it('projects editable Yes/No lanes and an exclusive merge, including empty branches', () => {
    const { plan, decision } = fixture()
    decision.branches[1].nodes = []
    const graph = buildPlanGraph(plan.scopes[0].nodes, [])
    expect(graph.nodes.find(node => node.id === `join:${decision.id}`)?.data?.title).toBe('Continue after selected path')
    expect(graph.nodes.find(node => node.id === `node:${decision.id}`)?.data).toMatchObject({ subtitle: 'Passed = true', details: 'Inspection / Output / Passed = true' })
    expect(graph.nodes.filter(node => node.data?.branchId).map(node => node.data?.title)).toEqual(['Yes', 'No'])
    const lane = findLane(plan.scopes[0].nodes, decision.branches[1].id)!
    lane.nodes.push(operation('Review'))
    expect(flattenNodes(plan.scopes[0].nodes).map(node => node.name)).toContain('Review')
  })
})

describe('safe type changes', () => {
  it('wraps a configured operation without changing its IDs or bindings, and unwraps losslessly', () => {
    const plan = newPlan('urn:transform', 'Transform')
    const step = operation('Fill')
    step.resourceAasId = 'urn:station'
    step.bindings = [{ name: 'Volume', value: '2', source: null }]
    plan.scopes[0].nodes = [step]
    const result = changeNodeType(plan, 'product', step.id, 'conditional')
    const flow = result.plan.scopes[0].nodes[0]
    expect(flow.kind).toBe('conditional')
    expect(result.selectedId).not.toBe(step.id)
    expect(flattenNodes(result.plan.scopes[0].nodes).find(node => node.id === step.id)).toEqual(step)
    expect(unwrapConditional(result.plan, 'product', flow.id).plan.scopes[0].nodes).toEqual([step])
    expect(plan.scopes[0].nodes).toEqual([step])
  })

  it('keeps a populated No branch when switching a decision to optional', () => {
    const { plan, decision } = fixture()
    const result = changeNodeType(plan, 'product', decision.id, 'conditional')
    const wrapper = result.plan.scopes[0].nodes[1]
    expect(wrapper.kind).toBe('conditional')
    if (wrapper.kind === 'conditional') {
      expect(wrapper.nodes).toEqual([decision])
    }
    expect(() => changeNodeType(plan, 'product', decision.id, 'step')).toThrow('without losing')
  })

  it('extracts configured content into a local subprocess and rejects broken cross-boundary conditions', () => {
    const { plan, inspection, decision } = fixture()
    expect(() => changeNodeType(plan, 'product', inspection.id, 'call')).toThrow('break a condition reference')
    const container = newNode('parallel')
    if (container.kind !== 'parallel') {
      throw new Error('Expected parallel')
    }
    container.branches[0].nodes = [inspection, decision]
    plan.scopes[0].nodes = [container]
    const result = changeNodeType(plan, 'product', container.id, 'call')
    expect(result.plan.scopes).toHaveLength(2)
    expect(result.plan.scopes[1].nodes).toEqual([container])
    expect(result.plan.scopes[0].nodes[0].kind).toBe('call')
  })
})
