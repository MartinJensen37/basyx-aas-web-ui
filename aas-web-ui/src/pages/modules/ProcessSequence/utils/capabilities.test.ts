import { describe, expect, it } from 'vitest'
import { capabilitySemantic } from '../constants/capabilities'
import { PROCESS_PARAMETERS_SUBMODEL } from '../constants/contracts'
import { buildDemo, upgradeDemoInputs } from '../demo/seed'
import { capabilityCandidates, readCapabilities, referenceKey } from './capabilities'
import { expandPlan, parsePlan } from './plan'
import { childrenOf, readPlanProcesses, semanticId } from './planSources'

describe('semantic process and capability contracts', () => {
  it('reads renamed IDTA elements and keeps their real model reference paths', () => {
    const sm = buildDemo().submodels.find(sm => semanticId(sm) === PROCESS_PARAMETERS_SUBMODEL.semanticId)!
    const processes = childrenOf(sm)[0]
    const process = childrenOf(processes)[0]
    processes.idShort = 'Operations'
    process.idShort = 'AssemblyOperation'
    const name = childrenOf(process).find(child => child.idShort === 'ProcessName')!
    name.idShort = 'Title'
    const group = childrenOf(process).find(child => child.idShort === 'ProductParameters')!
    group.idShort = 'Targets'
    const [parsed] = readPlanProcesses(sm, 'urn:product')
    expect(parsed.name).toBe('Final assembly')
    expect(parsed.source.path).toEqual(['Operations', 'AssemblyOperation'])
    expect(parsed.parameters[0].source.path).toEqual(['Operations', 'AssemblyOperation', 'Targets', 'Setpoint'])
    name.idShort = 'ProcessName'
    name.semanticId.keys[0].value = 'urn:wrong-meaning'
    expect(readPlanProcesses(sm, 'urn:product')[0].name).toBe('AssemblyOperation')
    processes.semanticId.keys[0].value = 'urn:wrong-container'
    processes.idShort = 'Processes'
    expect(readPlanProcesses(sm, 'urn:product')).toEqual([])
  })

  it('matches all requirements by supplemental meaning and offered role, never the generic Capability ID', () => {
    const { submodels, shells, plan } = buildDemo()
    const catalog = shells.flatMap(shell => (shell.submodels as any[]).flatMap(ref => {
      const sm = submodels.find(sm => sm.id === ref.keys[0].value)!
      return readCapabilities(sm, shell.id)
    }))
    const requirements = expandPlan(plan)[0].step.process!.requiredCapabilities!
    expect(capabilityCandidates(requirements, catalog)).toHaveLength(3)
    expect(catalog.filter(item => item.role === 'Offered').every(item => item.realizedBy.length === 1)).toBe(true)
    const withoutMeaning = catalog.map(item => ({ ...item, semanticIds: [] }))
    expect(capabilityCandidates(requirements, withoutMeaning)).toEqual([])
    expect(capabilityCandidates(requirements, catalog.filter(item => item.role === 'Required'))).toEqual([])
    const unresolved = { ...requirements[0], reference: { ...requirements[0].reference, keys: [{ type: 'Submodel', value: 'urn:missing' }] } }
    expect(capabilityCandidates([...requirements, unresolved], catalog)).toEqual([])
    expect(referenceKey(unresolved.reference)).not.toBe(referenceKey(requirements[0].reference))
  })

  it('does not treat false or contradictory role qualifiers as offered capabilities', () => {
    const sm = buildDemo().submodels.find(sm => sm.id.endsWith('/drive-cell/CapabilityDescription'))!
    const capability = childrenOf(childrenOf(childrenOf(sm)[0])[0])[0]
    capability.qualifiers[0].value = 'false'
    expect(readCapabilities(sm, 'urn:resource')[0].role).toBe('NotAssigned')
    capability.qualifiers[0].value = '1'
    capability.qualifiers.push({ ...capability.qualifiers[0], semanticId: { keys: [{ value: capabilitySemantic('CapabilityRoleQualifier/Required') }] } })
    expect(readCapabilities(sm, 'urn:resource')[0].role).toBe('NotAssigned')
  })

  it('round trips multiple requirements, explicit removal, and legacy inheritance independently', () => {
    const { plan } = buildDemo()
    const step = expandPlan(plan)[0].step
    step.requiredCapabilities = [...step.process!.requiredCapabilities!, { name: 'Unresolved', reference: { type: 'ExternalReference', keys: [{ type: 'GlobalReference', value: 'urn:special-capability' }] } }]
    expect(parsePlan(JSON.stringify(plan), plan.productAasId)).toEqual(plan)
    step.requiredCapabilities = []
    expect(expandPlan(parsePlan(JSON.stringify(plan), plan.productAasId))[0].step.requiredCapabilities).toEqual([])
    delete step.requiredCapabilities
    delete step.process!.requiredCapabilities
    expect(expandPlan(parsePlan(JSON.stringify(plan), plan.productAasId))[0].step.requiredCapabilities).toBeUndefined()
  })

  it('upgrades old demo semantics idempotently without replacing edited values or custom elements', () => {
    const template = buildDemo().submodels.find(sm => semanticId(sm) === PROCESS_PARAMETERS_SUBMODEL.semanticId)!
    const existing = structuredClone(template)
    const process = childrenOf(childrenOf(existing)[0])[0]
    process.semanticId.keys[0].value = 'old-wrong-semantic'
    const name = childrenOf(process).find(child => child.idShort === 'ProcessName')!
    name.value = 'Edited process name'
    process.value = childrenOf(process).filter(child => child.idShort !== 'RequiredCapability')
    process.value.push({ modelType: 'Property', idShort: 'UserNote', value: 'keep me', valueType: 'xs:string' })
    upgradeDemoInputs(existing, template)
    expect(readPlanProcesses(existing, 'urn:product')[0].name).toBe('Edited process name')
    expect(readPlanProcesses(existing, 'urn:product')[0].requiredCapabilities).toHaveLength(1)
    expect(childrenOf(process).find(child => child.idShort === 'UserNote')?.value).toBe('keep me')
    const upgraded = JSON.stringify(existing)
    upgradeDemoInputs(existing, template)
    expect(JSON.stringify(existing)).toBe(upgraded)
  })
})
