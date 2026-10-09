import type { StepNode } from '../types/plan'
import type { AasElement } from '../utils/sequenceModel'
import { writeFileSync } from 'node:fs'
import { jsonization, verification } from '@aas-core-works/aas-core3.1-typescript'
import { describe, expect, it } from 'vitest'
import { newNode } from '../utils/plan'
import { field, members } from '../utils/sequenceModel'
import fixture from './fixtures/fillingModule.json'
import { assignSkill, flowIssues, handedParameter, readFlow, readSkills, withFlow, withNewSkill, withParameter } from './skillFlow'

/** The filling module as iec61499-mgmt-py's modreg describes it (ARSO 0.8): its Skills submodel and those of its components. */
const base = 'https://smartproductionlab.aau.dk/aas'
const submodel = (shell: string) => structuredClone((fixture.submodels as AasElement[]).find(model => model.id === `${base}/${shell}/submodels/Skills`)!)
const moduleSkills = submodel('FillingModuleAAS')
const catalog = ['FillingModuleAAS', 'FillingLinearAxisAAS', 'FillingPumpAAS', 'FillingScaleAAS'].flatMap(shell => readSkills(submodel(shell), `${base}/${shell}`))
const dispensing = catalog.find(skill => skill.idShort === 'Dispensing')!
const child = (element: AasElement, ...path: string[]) => path.reduce((found, idShort) => members(found).find(item => item.idShort === idShort)!, element)
/** What a reader of the AAS sees of an element: no descriptions, which only the vendor's tool writes. */
function plain (element: any): any {
  // The order of the elements of a collection carries no meaning (Order does): compare them by name.
  if (Array.isArray(element)) {
    return element.map(item => plain(item)).toSorted((a, b) => String(a?.idShort ?? '').localeCompare(String(b?.idShort ?? '')))
  }
  if (element && typeof element === 'object') {
    return Object.fromEntries(Object.entries(element).filter(([key]) => key !== 'description').map(([key, item]) => [key, plain(item)]))
  }
  return element
}
const verified = (model: AasElement) => [...verification.verify(jsonization.submodelFromJsonable(model as never).mustValue())].map(error => error.message)

describe('skills of a resource as flows', () => {
  it('reads the kinds of skill, their variables and where they are described', () => {
    expect(catalog.filter(skill => skill.kind === 'Composite').map(skill => skill.idShort)).toEqual(['Dispensing'])
    expect(catalog.filter(skill => skill.kind === 'ModuleControl').map(skill => skill.idShort)).toEqual(['Occupy', 'Release', 'Reset', 'Start', 'Stop', 'Abort', 'Clear'])
    expect(catalog.filter(skill => skill.kind === 'Primitive').map(skill => `${skill.aasId.split('/').at(-1)}.${skill.idShort}`)).toEqual([
      'FillingLinearAxisAAS.Home', 'FillingLinearAxisAAS.MoveAxis', 'FillingPumpAAS.Dispense', 'FillingScaleAAS.Tare', 'FillingScaleAAS.Weigh'])
    expect(dispensing.inputs).toMatchObject([{ idShort: 'Volume', unit: 'mL', minValue: 0.5, maxValue: 10, defaultValue: '1.0' }])
    expect(dispensing.outputs.map(output => [output.idShort, output.unit])).toEqual([['Weight', 'g']])
    expect(dispensing.flows).toEqual(['Start', 'Stop'])
    expect(catalog.find(skill => skill.idShort === 'Reset')!.flows).toEqual(['Start'])
  })

  it('reads the steps of a command as editor nodes', () => {
    const steps = readFlow(moduleSkills, 'Dispensing', 'Start') as StepNode[]
    expect(steps.map(step => [step.id, step.kind, step.skillId, step.resourceAasId.split('/').at(-1)])).toEqual([
      ['NeedleDown', 'step', 'MoveAxis', 'FillingLinearAxisAAS'], ['Dispense', 'step', 'Dispense', 'FillingPumpAAS'],
      ['Home', 'step', 'Home', 'FillingLinearAxisAAS'], ['Weigh', 'step', 'Weigh', 'FillingScaleAAS']])
    expect(steps[0]!.bindings).toMatchObject([{ name: 'Position', value: '40.0', source: null }])
    expect(steps[1]!.bindings.map(binding => [binding.name, binding.value, handedParameter(binding)])).toEqual([['Volume', '', 'Volume'], ['FlowRate', '1.0', '']])
    expect(steps[3]!.outputs).toMatchObject([{ id: 'Weight', name: 'Weight', type: 'number', unit: 'g' }])
    expect((readFlow(moduleSkills, 'Dispensing', 'Stop') as StepNode[]).map(step => step.skillId)).toEqual(['Home'])
    expect((readFlow(moduleSkills, 'Reset', 'Start') as StepNode[]).map(step => step.skillId)).toEqual(['Home', 'Tare'])
    expect(flowIssues(steps, dispensing, catalog)).toEqual([])
  })

  it('writes steps back as the resource model has them', () => {
    for (const [skill, command] of [['Dispensing', 'Start'], ['Dispensing', 'Stop'], ['Reset', 'Start']] as const) {
      const saved = withFlow(moduleSkills, skill, command, readFlow(moduleSkills, skill, command), catalog)
      expect(plain(field(child(saved, 'Skills', skill, command), 'Steps'))).toEqual(plain(field(child(moduleSkills, 'Skills', skill, command), 'Steps')))
      expect(verified(saved)).toEqual([])
    }
  })

  it('says what the module cannot carry out before it is saved', () => {
    const steps = readFlow(moduleSkills, 'Dispensing', 'Start') as StepNode[]
    steps[0]!.bindings[0]!.value = '75'
    expect(flowIssues(steps, dispensing, catalog)).toEqual(['NeedleDown: Position = 75 is outside what MoveAxis takes (0 to 60).'])
    steps[0]!.bindings[0]!.value = '40.0'
    const wide = { ...dispensing, inputs: [{ ...dispensing.inputs[0]!, maxValue: 12 }] }
    expect(flowIssues(steps, wide, catalog)[0]).toContain('allows more than Dispense takes for Volume')
    const added = newNode('step') as StepNode
    expect(flowIssues([...steps, added], dispensing, catalog).at(-1)).toContain('choose the skill of a component')
    expect(flowIssues([...steps, newNode('parallel')], dispensing, catalog).at(-1)).toContain('the module\'s control runs steps one after the other only')
  })

  it('describes a new skill from an existing one, not built yet', () => {
    const copy = withNewSkill(moduleSkills, 'Dispensing', 'DoubleDose')
    const made = child(copy, 'Skills', 'DoubleDose')
    expect(members(child(copy, 'Skills')).map(skill => skill.idShort).at(-1)).toBe('DoubleDose')
    expect(members(made).find(item => item.idShort === 'SemanticId')!.value).toBe('https://smartproductionlab.aau.dk/skills/DoubleDose')
    expect(members(child(made, 'Start')).map(item => item.idShort)).toEqual(['Start', 'Steps']) // no action calls it yet
    expect(JSON.stringify(made)).not.toContain('Dispensing')
    expect(JSON.stringify(child(copy, 'Skills', 'Dispensing'))).toEqual(JSON.stringify(child(moduleSkills, 'Skills', 'Dispensing')))
    expect(() => withNewSkill(moduleSkills, 'Dispensing', 'Stop')).toThrow('cannot be the name')
    expect(() => withNewSkill(moduleSkills, 'Reset', 'Again')).toThrow('not a skill the module composes')

    // Two doses of the same volume: a second dispensing step after the first, bound the same way.
    const owner = readSkills(copy).find(skill => skill.idShort === 'DoubleDose')!
    const steps = readFlow(copy, 'DoubleDose', 'Start') as StepNode[]
    const second = newNode('step') as StepNode
    assignSkill(second, catalog.find(skill => skill.idShort === 'Dispense')!, steps.map(step => step.id))
    second.bindings.find(binding => binding.name === 'Volume')!.source = steps[1]!.bindings[0]!.source && { aasId: '', submodelId: copy.id, path: ['Skills', 'DoubleDose', 'Start', 'Start', 'Volume'] }
    steps.splice(2, 0, second)
    expect(second.id).toBe('Dispense_2')
    expect(flowIssues(steps, owner, catalog)).toEqual([])
    const saved = withParameter(withFlow(copy, 'DoubleDose', 'Start', steps, catalog), 'DoubleDose', 'Volume', { defaultValue: '0.5', maxValue: '5.0' })
    expect(verified(saved)).toEqual([])
    const again = readFlow(saved, 'DoubleDose', 'Start') as StepNode[]
    expect(again.map(step => step.id)).toEqual(['NeedleDown', 'Dispense', 'Dispense_2', 'Home', 'Weigh'])
    expect(handedParameter(again[2]!.bindings[0]!)).toBe('Volume')
    expect(readSkills(saved).find(skill => skill.idShort === 'DoubleDose')!.inputs).toMatchObject([{ idShort: 'Volume', defaultValue: '0.5', maxValue: 5, minValue: 0.5 }])
    // For iec61499-mgmt-py: the same change, brought to a running module by `modsync reconfigure`.
    if (process.env.SKILL_FLOW_OUT) {
      writeFileSync(process.env.SKILL_FLOW_OUT, JSON.stringify(saved, null, 1))
    }
  })
})
