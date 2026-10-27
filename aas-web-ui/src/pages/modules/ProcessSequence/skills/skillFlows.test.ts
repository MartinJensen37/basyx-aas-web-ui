import type { DecisionNode, ParallelNode, PlanNode, StepNode } from '../types/plan'
import type { AasElement } from '../utils/sequenceModel'
import { jsonization, verification } from '@aas-core-works/aas-core3.1-typescript'
import { describe, expect, it } from 'vitest'
import { field, members } from '../utils/sequenceModel'
import fixture from './fixtures/fillingFlows.json'
import { operandOptions, ranBefore } from './skillConditions'
import { flowIssues, readFlow, readSkills, withFlow } from './skillFlow'

/**
 * Rule set 2: skills whose steps run in decisions and a parallel block, as iec61499-mgmt-py's modreg
 * writes them (fixtures/fillingFlows.json: the filling module with Checked and Ready, made by its
 * test_modsync_flow_live.flow_spec). The editor reads them, writes them back alike, and says what a
 * module could not run, in the terms modsync refuses it by.
 */
const base = 'https://smartproductionlab.aau.dk/aas'
const submodel = (shell: string) => structuredClone((fixture.submodels as AasElement[]).find(model => model.id === `${base}/${shell}/submodels/Skills`)!)
const moduleSkills = submodel('FillingModuleAAS')
const catalog = ['FillingModuleAAS', 'FillingLinearAxisAAS', 'FillingPumpAAS', 'FillingScaleAAS'].flatMap(shell => readSkills(submodel(shell), `${base}/${shell}`))
const checked = catalog.find(skill => skill.idShort === 'Checked')!
const ready = catalog.find(skill => skill.idShort === 'Ready')!
const child = (element: AasElement, ...path: string[]) => path.reduce((found, idShort) => members(found).find(item => item.idShort === idShort)!, element)
function plain (element: any): any {
  if (Array.isArray(element)) {
    return element.map(item => plain(item)).toSorted((a, b) => String(a?.idShort ?? '').localeCompare(String(b?.idShort ?? '')))
  }
  if (element && typeof element === 'object') {
    return Object.fromEntries(Object.entries(element).filter(([key]) => !['description', 'supplementalSemanticIds'].includes(key)).map(([key, item]) => [key, plain(item)]))
  }
  return element
}
const verified = (model: AasElement) => [...verification.verify(jsonization.submodelFromJsonable(model as never).mustValue())].map(error => error.message)
function names (nodes: PlanNode[]): unknown[] {
  return nodes.map(node => node.kind === 'step'
    ? node.id
    : (node.kind === 'conditional' ? [node.id, names(node.nodes)] : [node.id, ...('branches' in node ? node.branches.map(branch => names(branch.nodes)) : [])]))
}

describe('flows of a skill (rule set 2)', () => {
  it('reads decisions, conditional steps and parallel blocks with their conditions', () => {
    const flow = readFlow(moduleSkills, 'Checked', 'Start')
    expect(names(flow)).toEqual(['NeedleDown', 'Dispense', 'Weigh', ['Light', ['TopUp'], ['Fine']], ['Empty', ['Again']], 'Home'])
    const light = flow[3] as DecisionNode
    expect(light.condition).toEqual({ kind: 'comparison', operator: 'lt', unit: 'g', expected: { type: 'number', value: 2.5 },
      operand: { kind: 'output', stepId: 'Weigh', outputId: 'Weight' } })
    expect(flow[4]!.kind).toBe('conditional')
    const both = readFlow(moduleSkills, 'Ready', 'Start')[0] as ParallelNode
    expect([both.kind, both.branches.map(branch => names(branch.nodes))]).toEqual(['parallel', [['Home'], ['Tare']]])
    expect(flowIssues(flow, checked, catalog)).toEqual([])
    expect(flowIssues(readFlow(moduleSkills, 'Ready', 'Start'), ready, catalog)).toEqual([])
  })

  it('writes them back as the resource model has them', () => {
    for (const skill of ['Checked', 'Ready']) {
      const saved = withFlow(moduleSkills, skill, 'Start', readFlow(moduleSkills, skill, 'Start'), catalog)
      expect(plain(field(child(saved, skill, 'Start'), 'Steps'))).toEqual(plain(field(child(moduleSkills, skill, 'Start'), 'Steps')))
      expect(verified(saved)).toEqual([])
    }
  })

  it('knows what a condition may compare where it stands', () => {
    const flow = readFlow(moduleSkills, 'Checked', 'Start')
    expect(ranBefore(flow, 'Light')!.map(step => step.id)).toEqual(['NeedleDown', 'Dispense', 'Weigh'])
    // The steps of a decision's branches are not known after it: they may not have run.
    expect(ranBefore(flow, 'Empty')!.map(step => step.id)).toEqual(['NeedleDown', 'Dispense', 'Weigh'])
    expect(operandOptions(flow, 'Light', checked, catalog).map(option => option.key)).toEqual(['parameter:Volume', 'output:Weigh.Weight'])
  })

  it('says what a module could not run', () => {
    const flow = readFlow(moduleSkills, 'Checked', 'Start')
    const light = flow[3] as DecisionNode
    // A result of a step that has not run yet.
    light.condition = { ...light.condition as any, operand: { kind: 'output', stepId: 'Home', outputId: 'Weight' } }
    expect(flowIssues(flow, checked, catalog)).toEqual(['Light: compare a parameter of the skill or a result of a step that has run before it.'])
    // A number compared with a Boolean.
    light.condition = { kind: 'comparison', operator: 'lt', unit: '', expected: { type: 'boolean', value: true }, operand: { kind: 'output', stepId: 'Weigh', outputId: 'Weight' } }
    expect(flowIssues(flow, checked, catalog)[0]).toContain('is a number, compared with a boolean')
    // Two branches that command one component.
    const both = readFlow(moduleSkills, 'Ready', 'Start')
    const branches = (both[0] as ParallelNode).branches
    branches[1]!.nodes.push(structuredClone(branches[0]!.nodes[0]!) as StepNode)
    ;(branches[1]!.nodes[1] as StepNode).id = 'Home_2'
    expect(flowIssues(both, ready, catalog)).toContain('Both: two branches use FillingLinearAxisAAS; a component runs one step at a time.')
    // A result from a step that may not run.
    ;(light.branches[0].nodes[0] as StepNode).outputs = [{ id: 'Weight', name: 'Weight', type: 'number', unit: 'g' }]
    expect(flowIssues(flow, checked, catalog).some(issue => issue.includes('a result of the skill comes from a step that runs on every path'))).toBe(true)
  })
})
