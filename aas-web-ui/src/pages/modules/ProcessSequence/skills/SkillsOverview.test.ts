import type { CapabilityDescription } from '../utils/capabilities'
import type { AasElement } from '../utils/sequenceModel'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createVuetify } from 'vuetify'
import fixture from './fixtures/fillingModule.json'
import { deploymentOf, readSkills, skillOf } from './skillFlow'
import { overview, parameterLine } from './skillOverview'
import SkillsOverview from './SkillsOverview.vue'

const base = 'https://smartproductionlab.aau.dk/aas'
const module = `${base}/FillingModuleAAS`
const model = (shell: string) => structuredClone((fixture.submodels as AasElement[]).find(item => item.id === `${base}/${shell}/submodels/Skills`)!)
const components = () => ['FillingLinearAxisAAS', 'FillingPumpAAS', 'FillingScaleAAS'].flatMap(shell => readSkills(model(shell), `${base}/${shell}`))
const filling: CapabilityDescription = {
  name: 'Filling', aasId: module, role: 'Offered', availability: 'Now', semanticIds: [], hasConstraints: false,
  reference: { type: 'ModelReference', keys: [{ type: 'Submodel', value: `${module}/submodels/CapabilityDescription` }] },
  realizedBy: [{ type: 'ModelReference', keys: [{ type: 'Submodel', value: `${module}/submodels/Skills` }, { type: 'SubmodelElementCollection', value: 'Dispensing' }] }],
  properties: [{ name: 'FillVolume', semanticId: '', unit: 'mL', dataType: 'xs:double', kind: 'range', value: '', min: '0.5', max: '10.0' }],
}
const saved: string[] = []
const pushed: unknown[] = []

vi.mock('vue-router', () => ({ useRoute: () => ({ query: {} }), useRouter: () => ({ push: (to: unknown) => pushed.push(to) }) }))
vi.mock('./useSkillRepository', () => ({
  useSkillRepository: () => ({
    loadSkills: async () => model('FillingModuleAAS'),
    loadComponentSkills: async () => components(),
    loadCapabilities: async () => [filling],
    saveSkill: async (submodel: AasElement, skill: string, _aasId: string, created: boolean) => {
      expect(created).toBe(true)
      expect(deploymentOf(skillOf(submodel, skill))).toBe('Described')
      saved.push(skill)
    },
  }),
}))
vi.mock('./skillService', () => ({
  deriveCapabilities: async () => ({ shell: module, stored: '', capabilities: [] }),
  derivedLines: () => [],
  setSkillServiceUrl: () => {},
  skillServiceUrl: () => 'http://localhost:8090',
}))

beforeEach(() => {
  saved.length = 0
  pushed.length = 0
})

describe('skills overview', () => {
  it('summarises the module skills, the building blocks and the module itself', () => {
    const found = overview(model('FillingModuleAAS'), module, components(), [filling])
    const [dispensing] = found.composites
    expect(found.composites.map(skill => skill.idShort)).toEqual(['Dispensing'])
    expect(dispensing!.runs).toEqual({ Start: ['NeedleDown', 'Dispense', 'Home', 'Weigh'], Stop: ['Home'] })
    expect(dispensing!.inputs.map(item => parameterLine(item))).toEqual(['Volume 0.5–10 mL (default 1.0)'])
    expect(dispensing!.offers).toEqual([{ name: 'Filling', availability: 'Now', properties: ['FillVolume 0.5–10.0 mL'] }])
    expect(dispensing!.deployment).toBe('Built')
    expect(found.components.map(component => [component.name, component.skills.map(skill => skill.idShort)])).toEqual([
      ['FillingLinearAxisAAS', ['Home', 'MoveAxis']], ['FillingPumpAAS', ['Dispense']], ['FillingScaleAAS', ['Tare', 'Weigh']]])
    // Which skill of the module runs a building block as a step; Reset runs Home and Tare.
    const used = Object.fromEntries(found.components.flatMap(component => component.skills).map(skill => [skill.idShort, skill.usedBy]))
    expect(used).toEqual({ Home: ['Dispensing', 'Reset', 'Stop'], MoveAxis: ['Dispensing'], Dispense: ['Dispensing'], Tare: ['Reset'], Weigh: ['Dispensing'] })
    expect(found.control.map(skill => skill.idShort)).toEqual(['Occupy', 'Release', 'Reset', 'Start', 'Stop', 'Abort', 'Clear'])
  })

  it('opens a skill in the tree, and makes a new one described like an existing one', async () => {
    const wrapper = mount(SkillsOverview, {
      props: { aasId: module, submodelId: `${module}/submodels/Skills`, path: 'http://repo/submodels/abc' },
      global: { plugins: [createVuetify()] },
    })
    await flushPromises()
    const state = wrapper.vm as any
    expect(wrapper.text()).toContain('Skills of FillingModuleAAS')
    expect(wrapper.text()).toContain('NeedleDown → Dispense → Home → Weigh')
    expect(wrapper.text()).toContain('FillVolume 0.5–10.0 mL')
    state.open('Dispensing')
    expect(pushed).toEqual([{ query: { path: 'http://repo/submodels/abc/submodel-elements/Dispensing' } }])

    state.from = 'Dispensing'
    state.name = 'DoubleDose'
    await state.create()
    await flushPromises()
    expect(saved).toEqual(['DoubleDose'])
    expect(pushed.at(-1)).toEqual({ query: { path: 'http://repo/submodels/abc/submodel-elements/DoubleDose' } })
    wrapper.unmount()
  })
})
