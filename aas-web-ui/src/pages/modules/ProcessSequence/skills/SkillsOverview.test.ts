import type { CapabilityDescription } from '../utils/capabilities'
import type { AasElement } from '../utils/sequenceModel'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
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
const planRequests: unknown[] = []
// Once a planned skill is described, the server has it.
let described = false

vi.mock('vue-router', () => ({ useRoute: () => ({ query: {} }), useRouter: () => ({ push: (to: unknown) => pushed.push(to) }) }))
vi.mock('./useSkillRepository', () => ({
  useSkillRepository: () => ({
    loadSkills: async () => {
      const found = model('FillingModuleAAS')
      if (described) {
        found.submodelElements.push({ ...structuredClone(skillOf(found, 'Dispensing')), idShort: 'FillTwo' })
      }
      return found
    },
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
  planSkill: async (shell: string, request: { capability: string, name?: string, write?: boolean }) => {
    planRequests.push(request)
    if (request.write) {
      described = true
    }
    return {
      shell, capability: request.capability, name: request.write ? request.name : undefined,
      steps: [{ skill: 'MoveAxis', capability: 'Positioning', component: 'FillingLinearAxis', args: { Position: 40 } },
        { skill: 'Dispense', capability: 'Dosing', component: 'FillingPump', args: { Volume: 2, FlowRate: 1 } }],
    }
  },
  skillServiceUrl: () => 'http://localhost:8090',
}))

beforeAll(() => {
  // What Vuetify's dialogs ask of the browser.
  vi.stubGlobal('ResizeObserver', class {
    disconnect () {}
    observe () {}
    unobserve () {}
  })
  vi.stubGlobal('visualViewport', { addEventListener: vi.fn(), height: 768, offsetLeft: 0, offsetTop: 0, removeEventListener: vi.fn(), width: 1024 })
})

beforeEach(() => {
  saved.length = 0
  pushed.length = 0
  planRequests.length = 0
  described = false
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

  it('plans a skill for a capability the module offers: its steps, then described on the server and opened', async () => {
    const wrapper = mount(SkillsOverview, {
      attachTo: document.body,
      props: { aasId: module, submodelId: `${module}/submodels/Skills`, path: 'http://repo/submodels/abc' },
      global: { plugins: [createVuetify()] },
    })
    await flushPromises()
    const state = wrapper.vm as any
    state.openPlanning()
    expect(state.capability).toBe('Filling')
    // What the capability is given: its ranges.
    expect(state.ranges.map((property: { name: string }) => property.name)).toEqual(['FillVolume'])
    state.values = { FillVolume: '2' }
    state.results = ['FillWeight']
    state.plannedName = 'FillTwo'

    await state.plan(false)
    expect(planRequests).toEqual([{ capability: 'Filling', values: { FillVolume: 2 }, results: ['FillWeight'], name: 'FillTwo', write: false }])
    expect(state.planned.steps.map((step: never) => state.stepLine(step))).toEqual([
      'MoveAxis (FillingLinearAxis): Position = 40', 'Dispense (FillingPump): Volume = 2, FlowRate = 1'])
    expect(state.planning).toBe(true)

    await state.plan(true)
    await flushPromises()
    expect(state.planning).toBe(false)
    expect(state.note).toBe('FillTwo is planned and described; modsync reconfigure builds it.')
    expect(pushed.at(-1)).toEqual({ query: { path: 'http://repo/submodels/abc/submodel-elements/FillTwo' } })
    wrapper.unmount()
  })
})
