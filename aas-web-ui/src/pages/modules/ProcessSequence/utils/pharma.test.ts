import type { CapabilityDescription } from './capabilities'
import { jsonization } from '@aas-core-works/aas-core3.1-typescript'
import { describe, expect, it } from 'vitest'
import { buildPharmaDemo, PHARMA_RECIPES } from '../demo/pharma'
import { buildDemo } from '../demo/seed'
import template from '../templates/ProductionSequence.json'
import { readCapabilities } from './capabilities'
import { matchCapabilities } from './capabilityMatching'
import { parsePlan } from './plan'
import { readPlanProcesses } from './planSources'
import { readSkillCatalog } from './readers'
import { buildSequenceSubmodel, readSequenceSubmodel } from './sequenceModel'

const demo = buildPharmaDemo(id => `${id}/sequence`)
const catalog: CapabilityDescription[] = demo.shells.flatMap(shell => shell.submodels.flatMap((reference: { keys: { value: string }[] }) =>
  readCapabilities(demo.submodels.find(model => model.id === reference.keys[0].value)!, shell.id)))

describe('pharma recipes and structured sequence', () => {
  it('creates valid AAS shells and submodels with resolvable submodel references', () => {
    expect(jsonization.submodelFromJsonable(template as never).error).toBeNull()
    expect(template.kind).toBe('Template')
    for (const shell of demo.shells) {
      expect(jsonization.assetAdministrationShellFromJsonable(shell as never).error, shell.id).toBeNull()
      for (const reference of shell.submodels) {
        expect(demo.submodels.some(model => model.id === reference.keys[0].value)).toBe(true)
      }
    }
    for (const model of demo.submodels) {
      expect(jsonization.submodelFromJsonable(model as never).error, model.id).toBeNull()
    }
  })

  it('round trips empty, recipe, subprocess and parallel plans through native AAS elements', () => {
    for (const plan of [...demo.plans, buildDemo().plan, ...buildDemo().plans]) {
      const model = buildSequenceSubmodel(plan, `${plan.productAasId}/sequence`)
      expect(jsonization.submodelFromJsonable(model as never).error).toBeNull()
      const loaded = parsePlan(JSON.stringify(readSequenceSubmodel(model)), plan.productAasId)
      expect(loaded).toEqual(parsePlan(JSON.stringify(plan), plan.productAasId))
      expect(model.submodelElements.some((element: { modelType: string }) => element.modelType === 'File')).toBe(false)
    }
  })

  it('uses the prescribed cycle order and the same parameters as the IDTA process reader', () => {
    for (const recipe of PHARMA_RECIPES) {
      const plan = demo.plans.find(plan => plan.productAasId.endsWith(`/aas/${recipe.id}`))!
      const steps = plan.scopes[0].nodes
      expect(steps.map(step => step.id)).toEqual(['Unpacking', 'Loading', ...recipe.volume.flatMap((_, index) => [`Filling_${index + 1}`, `Stoppering_${index + 1}`]), ...(recipe.format === 'vial' ? ['Capping'] : []), 'Inspection', 'Unloading', 'Packing'])
      for (const step of steps) {
        if (step.kind !== 'step') {
          throw new Error('Expected operation')
        }
        const model = demo.submodels.find(model => model.id === step.process!.source.submodelId)!
        expect(readPlanProcesses(model, plan.productAasId).find(process => process.processId === step.id)).toEqual(step.process)
        if (step.executionMode === 'manual') {
          expect(step.resourceAasId).toBe('')
          continue
        }
        const matches = matchCapabilities(step.requiredCapabilities!, catalog)
        expect(matches.find(match => match.aasId === step.resourceAasId)?.status, step.id).toBe('match')
        const skillModel = demo.submodels.find(model => model.id === step.skillReference!.keys[0].value)!
        expect(readSkillCatalog(skillModel).byIdShort.has(step.skillId)).toBe(true)
      }
    }
  })

  it('rejects a volume outside station limits and does not guess unit conversions', () => {
    const required = structuredClone(catalog.find(item => item.role === 'Required' && item.properties.some(property => property.name === 'FillVolume'))!)
    const volume = required.properties.find(property => property.name === 'FillVolume')!
    volume.value = '100'
    const others = catalog.filter(item => item.role === 'Offered')
    const requirements = [{ name: required.name, reference: required.reference }]
    expect(matchCapabilities(requirements, [required, ...others]).every(match => match.status !== 'match')).toBe(true)
    volume.value = '2'
    volume.unit = 'L'
    expect(matchCapabilities(requirements, [required, ...others]).find(match => match.aasId.endsWith('/filling-station'))?.status).toBe('unknown')
  })

  it('checks accuracy, inclusive boundaries, missing data and additional constraints', () => {
    const required = structuredClone(catalog.find(item => item.role === 'Required' && item.properties.some(property => property.name === 'FillVolume'))!)
    const offered = structuredClone(catalog.find(item => item.role === 'Offered' && item.properties.some(property => property.name === 'FillVolume') && item.properties.some(property => property.name === 'ContainerType' && property.value === 'vial'))!)
    const requirements = [{ name: required.name, reference: required.reference }]
    const match = () => matchCapabilities(requirements, [required, offered])[0].status
    const volume = required.properties.find(property => property.name === 'FillVolume')!
    const offeredVolume = offered.properties.find(property => property.name === 'FillVolume')!
    for (const boundary of [offeredVolume.min, offeredVolume.max]) {
      volume.value = boundary
      expect(match()).toBe('match')
    }
    const error = offered.properties.find(property => property.name === 'AbsoluteFillError')!
    error.value = '0.2'
    expect(match()).toBe('mismatch')
    error.value = '0.05'
    offered.hasConstraints = true
    expect(match()).toBe('unknown')
    offered.hasConstraints = false
    offeredVolume.max = ''
    expect(match()).toBe('unknown')
    offered.properties = offered.properties.filter(property => property.name !== 'FillVolume')
    expect(match()).toBe('unknown')
  })
})
