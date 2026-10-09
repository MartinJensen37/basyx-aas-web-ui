import type { DecisionNode, PlanCondition, StepNode } from '../types/plan'
import { jsonization, verification } from '@aas-core-works/aas-core3.1-typescript'
import { describe, expect, it } from 'vitest'
import { conditionSchema } from '../types/plan'
import { changeConditionKind, conditionLabel, conditionOptions, newComparison } from './conditions'
import { newNode, newPlan, parsePlan } from './plan'
import { buildPlanGraph } from './planGraph'
import { outputKey, previewPlan } from './planPreview'
import { changeNodeType } from './planTransforms'
import { buildSequenceDocuments, readSequenceDocuments } from './sequenceDocuments'
import { children, field, sequenceSemantic } from './sequenceModel'

function fixture (kind: 'all' | 'any' = 'all') {
  const plan = newPlan('urn:group-product', 'Inspection')
  const inspection = { ...newNode('step'), name: 'Inspection' } as StepNode
  inspection.outputs = ['TopPassed', 'SidePassed'].map(id => ({ id, name: id, type: 'boolean', unit: '' }))
  const rules = inspection.outputs.map(output => ({ ...newComparison(), operand: { kind: 'output' as const, stepId: inspection.id, outputId: output.id } }))
  const decision = newNode('decision') as DecisionNode
  decision.condition = { kind, conditions: rules }
  plan.scopes[0].nodes = [inspection, decision]
  const values = (top: boolean, side: boolean) => Object.fromEntries(inspection.outputs!.map((output, index) => [outputKey(['product'], inspection.id, output.id), index ? side : top]))
  return { plan, inspection, decision, rules, values }
}

describe('combined conditions', () => {
  it.each(['all', 'any'] as const)('evaluates every boolean combination for %s', kind => {
    const { plan, values } = fixture(kind)
    for (const top of [true, false]) {
      for (const side of [true, false]) {
        const expected = kind === 'all' ? top && side : top || side
        expect(previewPlan(plan, 'product', 1, values(top, side)).choices[0].path).toBe(expected ? 'Yes' : 'No')
      }
    }
  })

  it('requires every declared result to be available and correctly typed, without short circuiting', () => {
    for (const kind of ['all', 'any'] as const) {
      const { plan, inspection, values, rules } = fixture(kind)
      const top = kind === 'any'
      const key = outputKey(['product'], inspection.id, 'SidePassed')
      for (const invalid of [undefined, 'true']) {
        const inputs = { ...values(top, true), [key]: invalid } as Record<string, boolean | string>
        expect(previewPlan(plan, 'product', 1, inputs).choices[0].path).toBe('Unresolved')
      }
      rules[1].operand.outputId = 'removed-result'
      expect(previewPlan(plan, 'product', 1, values(top, true)).blocked).toBe(true)
    }
  })

  it('combines nested groups with periodic and numeric parameter checks, including optional flows', () => {
    const { plan, inspection, decision, rules, values } = fixture()
    const source = { aasId: plan.productAasId, submodelId: 'urn:parameters', path: ['Volume'] }
    inspection.process = { processId: 'inspect', name: 'Inspect', source, material: [], parameters: [{ name: 'Volume', group: 'ProductParameters', dataType: 'xs:double', value: '2', source, unit: 'mL' }] }
    const condition: PlanCondition = { kind: 'all', conditions: [
      { kind: 'any', conditions: rules },
      { kind: 'everyNthProduct', every: 5 },
      { ...newComparison(), operand: { kind: 'parameter', stepId: inspection.id, source }, operator: 'gte', expected: { type: 'number', value: 2 }, unit: 'mL' },
    ] }
    decision.condition = condition
    expect(previewPlan(plan, 'product', 5, values(false, true)).choices[0].path).toBe('Yes')
    expect(previewPlan(plan, 'product', 4, values(false, true)).choices[0].path).toBe('No')
    expect(previewPlan(plan, 'product', 5, values(false, false)).choices[0].path).toBe('No')
    plan.scopes[0].nodes[1] = { id: decision.id, name: 'Optional', kind: 'conditional', condition, nodes: [] }
    expect(previewPlan(plan, 'product', 5, values(false, true)).choices[0].path).toBe('Run')
    expect(previewPlan(plan, 'product', 4, values(false, true)).choices[0].path).toBe('Skip')
    inspection.process.parameters[0].unit = 'L'
    expect(previewPlan(plan, 'product', 5, values(false, true)).blocked).toBe(true)
  })

  it('retains existing comparisons when grouping or switching between AND and OR', () => {
    const rule = { ...newComparison(), expected: { type: 'string' as const, value: 'passed' } }
    const all = changeConditionKind(rule, 'all')
    expect(all).toEqual({ kind: 'all', conditions: [rule, newComparison()] })
    expect(changeConditionKind(all, 'any')).toEqual({ ...all, kind: 'any' })
    expect(conditionSchema.safeParse({ kind: 'all', conditions: [] }).success).toBe(false)
    expect(conditionSchema.safeParse({ kind: 'any', conditions: [{ kind: 'unknown' }] }).success).toBe(false)
  })

  it('preserves nested groups and semantic IDs through the native AAS document', async () => {
    const { plan, decision, rules } = fixture()
    decision.condition = { kind: 'all', conditions: [rules[0], { kind: 'any', conditions: [rules[1], { kind: 'everyNthProduct', every: 5 }] }] }
    const model = buildSequenceDocuments(parsePlan(JSON.stringify(plan), plan.productAasId), 'urn:sequence', [])[0]!
    const decoded = jsonization.submodelFromJsonable(model as never)
    expect(decoded.error).toBeNull()
    expect([...verification.verify(decoded.mustValue())]).toEqual([])
    const stored = field(children(model, 'Steps')[1], 'Condition')!
    expect(field(stored, 'Conditions')!.semanticId.keys[0].value).toBe(sequenceSemantic('Conditions'))
    // Storage order is explicit, independent of collection array order.
    field(stored, 'Conditions')!.value.reverse()
    const loaded = await readSequenceDocuments(model, async () => {
      throw new Error('No external models expected')
    })
    expect((loaded.scopes[0].nodes[1] as DecisionNode).condition).toEqual(decision.condition)
    field(stored, 'Conditions')!.value = []
    await expect(readSequenceDocuments(model, async () => model)).rejects.toThrow()
  })

  it('draws both result links, deduplicates repeated sources and labels nested precedence', () => {
    const { plan, decision, inspection, rules } = fixture()
    decision.condition = { kind: 'all', conditions: [rules[0], { kind: 'any', conditions: [rules[1], rules[0]] }] }
    const graph = buildPlanGraph(plan.scopes[0].nodes, [], decision.id)
    const edges = graph.edges.filter(edge => edge.data?.kind === 'result')
    expect(edges.map(edge => edge.sourceHandle)).toEqual(['output:TopPassed', 'output:SidePassed'])
    expect(new Set(edges.map(edge => edge.id)).size).toBe(2)
    expect(conditionLabel(decision.condition, conditionOptions([inspection]), true)).toBe('(TopPassed = true AND (SidePassed = true OR TopPassed = true))')
  })

  it('checks nested output availability and protects subprocess boundaries', () => {
    const { plan, decision, inspection, rules, values } = fixture()
    decision.condition = { kind: 'all', conditions: [{ kind: 'any', conditions: rules }] }
    expect(() => changeNodeType(plan, 'product', inspection.id, 'call')).toThrow('break a condition reference')
    plan.scopes[0].nodes = [decision, inspection]
    expect(previewPlan(plan, 'product', 1, values(true, true)).choices[0].reason).toContain('every path')
    const parallel = newNode('parallel')
    if (parallel.kind !== 'parallel') {
      throw new Error('Expected parallel')
    }
    parallel.branches[0].nodes = [inspection]
    parallel.branches[1].nodes = [decision]
    plan.scopes[0].nodes = [parallel]
    expect(previewPlan(plan, 'product', 1, values(true, true)).blocked).toBe(true)
    parallel.branches[1].nodes = []
    plan.scopes[0].nodes.push(decision)
    expect(previewPlan(plan, 'product', 1, values(true, true)).choices[0].path).toBe('Yes')
  })
})
