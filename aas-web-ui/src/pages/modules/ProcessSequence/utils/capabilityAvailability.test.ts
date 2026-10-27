import type { CapabilityRequirement } from '../types/plan'
import type { CapabilityDescription } from './capabilities'
import { describe, expect, it } from 'vitest'
import { readCapabilities } from './capabilities'
import { matchCapabilities } from './capabilityMatching'

const FILLING = 'https://smartproductionlab.aau.dk/semantics/Filling'
const reference = (aas: string, name: string) => ({ type: 'ModelReference' as const, keys: [{ type: 'Submodel', value: `${aas}/submodels/CapabilityDescription` }, { type: 'Capability', value: name }] })
const skill = (aas: string, name: string) => ({ type: 'ModelReference' as const, keys: [{ type: 'Submodel', value: `${aas}/submodels/Skills` }, { type: 'SubmodelElementCollection', value: name }] })

function offered (aas: string, name: string, availability: CapabilityDescription['availability'], max = '10.0'): CapabilityDescription {
  return {
    name, aasId: aas, role: 'Offered', availability, reference: reference(aas, name), semanticIds: [FILLING],
    realizedBy: [skill(aas, name.replace('Filling_', '') || 'Dispensing')], hasConstraints: false,
    properties: [{ name: 'FillVolume', semanticId: 'https://smartproductionlab.aau.dk/semantics/FillVolume', unit: 'mL', dataType: 'xs:double', kind: 'range', value: '', min: '0.5', max }],
  }
}

const required: CapabilityDescription = {
  ...offered('product', 'Filling', 'Now'), role: 'Required',
  properties: [{ name: 'FillVolume', semanticId: 'https://smartproductionlab.aau.dk/semantics/FillVolume', unit: 'mL', dataType: 'xs:double', kind: 'value', value: '12.0', min: '', max: '' }],
}
const requirement: CapabilityRequirement = { name: 'Filling', reference: required.reference }

describe('capabilities offered after a reconfiguration', () => {
  it('reads Availability from the capability', () => {
    const qualifiers = (availability?: string) => [
      { type: 'CapabilityRoleQualifier/Offered', valueType: 'xs:boolean', value: 'true', semanticId: { type: 'ExternalReference', keys: [{ type: 'GlobalReference', value: 'https://admin-shell.io/idta/CapabilityDescription/CapabilityRoleQualifier/Offered/1/0' }] } },
      ...(availability ? [{ type: 'Availability', valueType: 'xs:string', value: availability }] : []),
    ]
    const sem = (name: string) => ({ type: 'ExternalReference', keys: [{ type: 'GlobalReference', value: `https://admin-shell.io/idta/CapabilityDescription/${name}/1/0` }] })
    const container = (idShort: string, availability?: string) => ({
      modelType: 'SubmodelElementCollection', idShort, semanticId: sem('CapabilityContainer'),
      value: [{ modelType: 'Capability', idShort: 'Capability', semanticId: sem('Capability'), qualifiers: qualifiers(availability), supplementalSemanticIds: [{ type: 'ExternalReference', keys: [{ type: 'GlobalReference', value: FILLING }] }] }],
    })
    const submodel = {
      modelType: 'Submodel', id: 'module/submodels/CapabilityDescription',
      semanticId: { type: 'ExternalReference', keys: [{ type: 'GlobalReference', value: 'https://admin-shell.io/idta/SubmodelTemplate/CapabilityDescription/1/0' }] },
      submodelElements: [{ modelType: 'SubmodelElementCollection', idShort: 'OfferedCapabilities', semanticId: sem('CapabilitySet'), value: [container('Filling'), container('Filling_DoubleDose', 'AfterReconfiguration')] }],
    }
    expect(readCapabilities(submodel, 'module').map(item => [item.name, item.availability])).toEqual([['Filling', 'Now'], ['Filling_DoubleDose', 'AfterReconfiguration']])
  })

  it('prefers what is offered now, and says when a match needs a reconfiguration', () => {
    // 12 mL: Dispensing (up to 10 mL) does not take it; a described DoubleDose (up to 20 mL) would.
    const catalog = [required, offered('filling', 'Filling', 'Now'), offered('filling', 'Filling_DoubleDose', 'AfterReconfiguration', '20.0')]
    const [match] = matchCapabilities([requirement], catalog)
    expect(match!.status).toBe('match')
    expect(match!.availability).toBe('AfterReconfiguration')
    expect(match!.reconfigure).toEqual(['DoubleDose'])
    expect(match!.reasons).toContain('Filling: offered after a reconfiguration (the skill is described, not built yet)')
    // Both would do: the one offered now is chosen.
    const both = [required, offered('filling', 'Filling', 'Now', '20.0'), offered('filling', 'Filling_DoubleDose', 'AfterReconfiguration', '20.0')]
    const [now] = matchCapabilities([requirement], both)
    expect([now!.status, now!.availability, now!.reconfigure]).toEqual(['match', 'Now', []])
  })
})
