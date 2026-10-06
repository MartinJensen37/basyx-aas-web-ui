import type { PlanProcess, StepNode } from '../types/plan'
import { describe, expect, it } from 'vitest'
import { setOperation } from './operation'
import { decisionForOutput } from './outputDecision'
import { newNode } from './plan'
import { buildPlanGraph, findLane } from './planGraph'

const process: PlanProcess = {
  processId: 'packing', name: 'Packing', source: { aasId: 'product', submodelId: 'parameters', path: ['Packing'] },
  parameters: [], material: [], requiredCapabilities: [{ name: 'Pack', reference: { type: 'ExternalReference', keys: [{ type: 'GlobalReference', value: 'urn:pack' }] } }],
}

describe('operation choices and result connections', () => {
  it('refreshes inputs and requirements without retaining an incompatible station or bindings', () => {
    const step = newNode('step') as StepNode
    step.name = 'Custom operation'
    step.resourceAasId = 'old station'
    step.skillId = 'old skill'
    step.skillReference = process.requiredCapabilities![0]!.reference
    step.requiredCapabilities = []
    step.bindings = [{ name: 'old input', source: null, value: '42' }]
    step.outputs = [{ id: 'result', name: 'Passed', type: 'boolean', unit: '' }]
    const decision = decisionForOutput(step, step.outputs[0]!)
    setOperation(step, reactive(process))
    expect(step).toMatchObject({ name: 'Custom operation', resourceAasId: '', skillId: '', bindings: [], process })
    expect(step).not.toHaveProperty('skillReference')
    expect(step).not.toHaveProperty('requiredCapabilities')
    expect(step.process).not.toBe(process)
    expect(decision.condition).toMatchObject({ operand: { stepId: step.id, outputId: step.outputs[0]!.id } })
    step.resourceAasId = 'new station'
    setOperation(step, process)
    expect(step.resourceAasId).toBe('new station')
    setOperation(step, null)
    expect(step).toMatchObject({ process: null, resourceAasId: '', outputs: [{ id: 'result' }] })
  })

  it('updates automatically named operations, while retaining user names', () => {
    const step = newNode('step') as StepNode
    setOperation(step, process)
    expect(step.name).toBe('Packing')
    setOperation(step, { ...process, name: 'Inspection', source: { ...process.source, path: ['Inspection'] } })
    expect(step.name).toBe('Inspection')
  })

  it.each(['boolean', 'number', 'string'] as const)('connects a %s result explicitly, without altering execution order or serializing the drawing', type => {
    const step = newNode('step') as StepNode
    const output = { id: 'result', name: 'Result', type, unit: type === 'number' ? 'mL' : '' }
    step.outputs = [output]
    const decision = decisionForOutput(step, output)
    expect(decision.condition).toMatchObject({ expected: { type, value: type === 'boolean' ? true : (type === 'number' ? 0 : '') }, unit: output.unit })
    const parallel = newNode('parallel')
    if (parallel.kind !== 'parallel') {
      throw new Error('Expected parallel')
    }
    parallel.branches[0]!.nodes = [step]
    const sequence = [parallel]
    const lane = findLane(sequence, step.id)!
    lane.nodes.splice(lane.index + 1, 0, decision)
    expect(parallel.branches[1]!.nodes).toEqual([])
    const before = JSON.stringify(sequence)
    const graph = buildPlanGraph(sequence, [], decision.id)
    expect(graph.edges.filter(edge => edge.data?.kind === 'result')).toMatchObject([{
      source: `node:${step.id}`, target: `node:${decision.id}`, sourceHandle: 'output:result', targetHandle: 'condition-input',
    }])
    const source = graph.nodes.find(node => node.id === `node:${step.id}`)!
    const target = graph.nodes.find(node => node.id === `node:${decision.id}`)!
    expect(target.position.y).toBeGreaterThan(source.position.y + source.data!.height!)
    expect(buildPlanGraph(sequence, []).edges).toEqual(graph.edges.filter(edge => edge.data?.kind !== 'result'))
    expect(JSON.stringify(sequence)).toBe(before)
    step.outputs = []
    expect(buildPlanGraph(sequence, [], decision.id).edges.some(edge => edge.data?.kind === 'result')).toBe(false)
  })
})
