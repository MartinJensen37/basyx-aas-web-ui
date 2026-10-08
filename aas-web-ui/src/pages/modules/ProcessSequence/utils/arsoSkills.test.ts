import type { StepNode } from '../types/plan'
import type { CapabilityDescription } from './capabilities'
import { jsonization, verification } from '@aas-core-works/aas-core3.1-typescript'
import { describe, expect, it } from 'vitest'
import { ARSO_FIXTURE_BASE, buildArsoFixture } from '../fixtures/arsoResources'
import { readCapabilities } from './capabilities'
import { matchCapabilities } from './capabilityMatching'
import { canonicalMeaning } from './parameterSemantics'
import { newPlan, parsePlan } from './plan'
import { readPlanProcesses } from './planSources'
import { readSkillCatalog } from './readers'
import { buildSequenceDocuments, readSequenceDocuments } from './sequenceDocuments'
import { children, field } from './sequenceModel'
import { addSkillResults, assignSkill, clearSkill, inputSource } from './skillAssignment'

const fixture = buildArsoFixture()
const product = `${ARSO_FIXTURE_BASE}/Vial2mLAAS`
const processes = fixture.submodels.flatMap(model => readPlanProcesses(model, product))
const catalog: CapabilityDescription[] = fixture.shells.flatMap(shell => shell.submodels.flatMap((reference: any) => readCapabilities(fixture.submodels.find(model => model.id === reference.keys[0].value)!, shell.id)))
const skills = fixture.submodels.flatMap(model => readSkillCatalog(model).skills)
const dispensing = skills.find(skill => skill.idShort === 'Dispensing')!
const inspection = skills.find(skill => skill.idShort === 'Inspection')!
function step (processId = 'Filling'): StepNode {
  return { id: 'job', name: processId, kind: 'step', process: structuredClone(processes.find(process => process.processId === processId)!), resourceAasId: `${ARSO_FIXTURE_BASE}/${processId}ModuleAAS`, skillId: '', bindings: [] }
}

describe('ARSO resources and effective recipes', () => {
  it('reads all four skill collections and Start variables, excluding protocol fields', () => {
    expect(skills.map(skill => skill.idShort).toSorted()).toEqual(['Capping', 'Dispensing', 'Inspection', 'Stoppering'])
    expect(dispensing.parameters).toMatchObject([{ idShort: 'Volume', unit: 'mL', minValue: 0.5, maxValue: 10, defaultValue: '1.0' }])
    expect(dispensing.parameters[0].reference!.keys.map(key => key.value).slice(1)).toEqual(['Skills', 'Dispensing', 'Start', 'Start', 'Volume'])
    expect(dispensing.outputs!.map(output => output.idShort)).toEqual(['Weight'])
    expect(inspection.parameters).toEqual([])
    expect(inspection.outputs!.map(output => output.idShort)).toEqual(['TopPassed', 'SidePassed'])
    for (const model of fixture.submodels) {
      expect([...verification.verify(jsonization.submodelFromJsonable(model as never).mustValue())].map(error => error.message)).toEqual([])
    }
  })

  it('binds Volume to FillVolume by meaning even after renaming labels, without ambiguous guesses', () => {
    const node = step()
    const volume = node.process!.parameters.find(parameter => parameter.name === 'FillVolume')!
    volume.name = 'Dose target'
    assignSkill(node, dispensing)
    expect(node.bindings).toEqual([{ name: 'Volume', value: '', source: volume.source, target: dispensing.parameters[0].reference }])
    const input = dispensing.parameters[0]
    expect(inputSource(input, [volume, { ...volume }])).toBeUndefined()
    expect(inputSource(input, [{ ...volume, unit: 'L' }])).toBeUndefined()
    expect(inputSource(input, [{ ...volume, semanticIds: ['urn:unrelated'], name: 'Volume' }])).toBeUndefined()
  })

  it('checks effective overrides, rejects incompatible associations and retains independent tolerances', () => {
    const node = step()
    const volume = node.process!.parameters.find(parameter => parameter.name === 'FillVolume')!
    const check = (parameters = node.process!.parameters, capabilities = catalog) => matchCapabilities(node.process!.requiredCapabilities!, capabilities, parameters).find(match => match.aasId === node.resourceAasId)!
    expect(check().status).toBe('match')
    volume.value = '12'
    expect(check()).toMatchObject({ status: 'mismatch', reasons: expect.arrayContaining([expect.stringContaining('FillVolume: required 12')]) })
    volume.value = '2'
    expect(check([...node.process!.parameters, { ...volume }]).status).toBe('unknown')
    volume.unit = 'L'
    expect(check().status).toBe('unknown')
    volume.unit = 'mL'
    const withTolerance = structuredClone(catalog)
    const required = withTolerance.find(item => item.aasId === product && item.semanticIds.some(id => id.endsWith('/Filling')))!
    required.properties.push({ name: 'Accuracy', semanticId: 'https://smartproductionlab.aau.dk/semantics/AbsoluteFillError', unit: 'mL', dataType: 'xs:double', kind: 'range', min: '0', max: '0.01', value: '' })
    expect(check([...node.process!.parameters, { ...volume, name: 'Accuracy', value: '1', semanticIds: ['https://smartproductionlab.aau.dk/semantics/AbsoluteFillError'] }], withTolerance).status).toBe('mismatch')
  })

  it('recognizes only the known legacy demo vocabulary and preserves real format mismatches', () => {
    expect(canonicalMeaning('https://smartproductionlab.aau.dk/demo/pharma/semantics/Filling')).toBe('https://smartproductionlab.aau.dk/semantics/Filling')
    expect(canonicalMeaning('https://other.example/semantics/Filling')).toBe('https://other.example/semantics/Filling')
    const node = step()
    node.process!.parameters.find(parameter => parameter.name === 'ContainerType')!.value = 'syringe'
    expect(matchCapabilities(node.process!.requiredCapabilities!, catalog, node.process!.parameters).find(match => match.aasId === node.resourceAasId)!.status).toBe('mismatch')
  })

  it('saves input targets and output sources as AAS references and keeps stable decision identities', async () => {
    const node = step('Inspection')
    node.outputs = [{ id: 'quality', name: 'TopPassed', type: 'boolean', unit: '' }]
    assignSkill(node, inspection)
    addSkillResults(node, inspection)
    addSkillResults(node, inspection)
    expect(node.outputs).toHaveLength(2)
    expect(node.outputs[0]).toMatchObject({ id: 'quality', source: inspection.outputs![0].reference })
    const fill = step()
    fill.id = 'fill'
    assignSkill(fill, dispensing)
    const plan = newPlan(product, 'Vial')
    plan.scopes[0].nodes = [fill, node]
    const document = buildSequenceDocuments(plan, 'urn:arso:sequence', processes)[0]!
    expect(field(children(children(document, 'Steps')[0], 'Bindings')[0], 'InputReference')).toBeDefined()
    expect(field(children(children(document, 'Steps')[1], 'Outputs')[0], 'ResultReference')).toBeDefined()
    expect([...verification.verify(jsonization.submodelFromJsonable(document as never).mustValue())].map(error => error.message)).toEqual([])
    const restored = parsePlan(JSON.stringify(await readSequenceDocuments(document, async id => fixture.submodels.find(model => model.id === id)!)), product)
    expect((restored.scopes[0].nodes[0] as StepNode).bindings).toEqual(fill.bindings)
    expect((restored.scopes[0].nodes[1] as StepNode).outputs).toEqual(node.outputs)
    clearSkill(node)
    expect(node.outputs[0]).toEqual({ id: 'quality', name: 'TopPassed', type: 'boolean', unit: '' })
  })
})
