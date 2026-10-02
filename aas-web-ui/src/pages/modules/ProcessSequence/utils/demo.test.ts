import { jsonization } from '@aas-core-works/aas-core3.1-typescript'
import { describe, expect, it } from 'vitest'
import { buildDemo } from '../demo/seed.ts'
import { expandPlan, parsePlan } from './plan'
import { readMaterialScopes, readPlanProcesses } from './planSources'
import { readSkillCatalog } from './readers'

describe('Docker process plan example', () => {
  it('uses valid AAS JSON and links every shell submodel to an example object', () => {
    const { shells, submodels } = buildDemo()
    const ids = new Set(submodels.map(sm => sm.id))
    for (const shell of shells) {
      const parsed = jsonization.assetAdministrationShellFromJsonable(shell as never)
      expect(parsed.error).toBeNull()
      expect(parsed.mustValue().submodels?.every(ref => ids.has(ref.keys[0].value))).toBe(true)
    }
    for (const submodel of submodels) {
      expect(jsonization.submodelFromJsonable(submodel as never).error).toBeNull()
    }
  })

  it('opens the saved plan with the same occurrence identities as the live readers', () => {
    const { submodels, plan } = buildDemo()
    expect(parsePlan(JSON.stringify(plan), plan.productAasId)).toEqual(plan)
    const bom = submodels.find(sm => sm.idShort === 'HierarchicalStructures')!
    const materials = readMaterialScopes(bom, plan.productAasId, 'product')
    expect(materials).toHaveLength(6)
    expect(materials.every(material => plan.scopes.some(scope => scope.id === material.id))).toBe(true)
    const steps = expandPlan(plan)
    expect(steps).toHaveLength(7)
    expect(steps.find(item => item.step.id === 'final-assembly')?.after).toHaveLength(2)
    expect(steps.find(item => item.step.id === 'mount-board')?.after).toEqual([])
    for (const item of steps) {
      const source = submodels.find(sm => sm.id === item.step.process?.source.submodelId)!
      const process = readPlanProcesses(source, item.step.process!.source.aasId).find(process => process.processId === item.step.process?.processId)
      expect(process).toEqual(item.step.process)
      const catalog = submodels.find(sm => sm.id === item.step.resourceAasId.replace('/aas/', '/sm/') + '/Skills')!
      expect(readSkillCatalog(catalog).byIdShort.has(item.step.skillId)).toBe(true)
    }
  })
})
