import type { AasElement } from '../utils/sequenceModel'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createVuetify } from 'vuetify'
import fixture from './fixtures/fillingModule.json'
import SkillEditor from './SkillEditor.vue'
import { deploymentOf, readFlow, readSkills, skillOf } from './skillFlow'

const base = 'https://smartproductionlab.aau.dk/aas'
const model = (shell: string) => structuredClone((fixture.submodels as AasElement[]).find(item => item.id === `${base}/${shell}/submodels/Skills`)!)
const saved: { submodel: AasElement, skill: string, created: boolean }[] = []
const derived: string[] = []
const pushed: unknown[] = []
const checked: { shell: string, skill: AasElement }[] = []
let reachable = true

vi.mock('vue-router', () => ({ useRoute: () => ({ query: { aas: 'x' } }), useRouter: () => ({ push: (to: unknown) => pushed.push(to) }) }))
vi.mock('./useSkillRepository', () => ({
  useSkillRepository: () => ({
    loadSkills: async (id: string) => structuredClone((fixture.submodels as AasElement[]).find(item => item.id === id)!),
    loadComponentSkills: async () => ['FillingLinearAxisAAS', 'FillingPumpAAS', 'FillingScaleAAS'].flatMap(shell => readSkills(model(shell), `${base}/${shell}`)),
    saveSkill: async (submodel: AasElement, skill: string, _aasId: string, created = false) => {
      saved.push({ submodel: structuredClone(submodel), skill, created })
    },
  }),
}))
vi.mock('./skillService', () => ({
  deriveCapabilities: async (shell: string) => {
    if (!reachable) {
      throw new Error('The skill service at http://localhost:8090 was not reached.')
    }
    derived.push(shell)
    return { shell, stored: '', capabilities: [{ idShort: 'Filling', capability: 'Filling', skill: 'Dispensing' }, { idShort: 'Filling_DoubleDose', capability: 'Filling', skill: 'DoubleDose', Availability: 'AfterReconfiguration' }] }
  },
  derivedLines: (answer: { capabilities: { idShort: string, skill: string, Availability?: string }[] }) =>
    answer.capabilities.map(item => `${item.idShort} (${item.skill})${item.Availability ? ', after a reconfiguration' : ''}`),
  // The checker finds the dose given with the needle up, and nothing once the needle is down first.
  checkSkill: async (shell: string, skill: AasElement) => {
    checked.push({ shell, skill })
    const first = (readFlow({ submodelElements: [skill] }, skill.idShort, 'Start') as { id: string }[])[0]?.id
    return { shell, skills: { [skill.idShort]: first === 'NeedleDown' ? [] : [{ step: 'Dispense', what: 'LinearAxis.Position = FillPosition does not hold', fix: ['MoveAxis'] }] } }
  },
  findingLine: (finding: { step: string, what: string, fix: string[] }) => `${finding.step}: ${finding.what} (run ${finding.fix.join(' or ')} before it)`,
}))

beforeAll(() => {
  vi.stubGlobal('ResizeObserver', class {
    disconnect () {}
    observe () {}
    unobserve () {}
  })
  vi.stubGlobal('visualViewport', { addEventListener: vi.fn(), height: 768, offsetLeft: 0, offsetTop: 0, removeEventListener: vi.fn(), width: 1024 })
})

beforeEach(() => {
  saved.length = 0
  derived.length = 0
  pushed.length = 0
  checked.length = 0
  reachable = true
})

const path = `http://repo/submodels/abc/submodel-elements/Dispensing`
function mounted (skill: string) {
  return mount(SkillEditor, {
    attachTo: document.body,
    props: { aasId: `${base}/FillingModuleAAS`, submodelId: `${base}/FillingModuleAAS/submodels/Skills`, skill, path },
    global: { plugins: [createVuetify()] },
  })
}

describe('skill editor', () => {
  it('shows one skill as a flow, saves only that skill and derives what the module offers', async () => {
    const wrapper = mounted('Dispensing')
    await flushPromises()
    const state = wrapper.vm as any
    expect(wrapper.text()).toContain('Dispensing')
    expect(wrapper.text()).toContain('Module level skill')
    expect(wrapper.text()).toContain('Built')
    expect(state.nodes.map((node: { id: string }) => node.id)).toEqual(['NeedleDown', 'Dispense', 'Home', 'Weigh'])
    expect(wrapper.text()).toContain('MoveAxis (FillingLinearAxis)')
    expect(wrapper.text()).toContain('Volume ← Volume, FlowRate = 1.0')
    expect(state.pending).toBe(false)

    // Selecting a step opens what it runs and what it is handed.
    await wrapper.find('button[aria-label="Dispense"]').trigger('click')
    expect(state.step.skillId).toBe('Dispense')
    // A value the pump does not take is said before anything is saved.
    state.step.bindings.find((binding: { name: string }) => binding.name === 'FlowRate').value = '9'
    await flushPromises()
    expect(state.issues).toEqual(['Dispense: FlowRate = 9 is outside what Dispense takes (0.1 to 5).'])
    state.step.bindings.find((binding: { name: string }) => binding.name === 'FlowRate').value = '2.0'
    await flushPromises()
    expect(state.issues).toEqual([])

    await state.store()
    await flushPromises()
    expect(saved.map(item => [item.skill, item.created])).toEqual([['Dispensing', false]])
    const flow = readFlow(saved[0]!.submodel, 'Dispensing', 'Start') as any[]
    expect(flow[1].bindings.map((binding: { name: string, value: string }) => [binding.name, binding.value])).toEqual([['Volume', ''], ['FlowRate', '2.0']])
    expect(derived).toEqual([`${base}/FillingModuleAAS`])
    expect(state.offered).toBe('The module offers: Filling (Dispensing); Filling_DoubleDose (DoubleDose), after a reconfiguration.')
    expect(state.pending).toBe(false)

    // The steps the skill runs when it is stopped.
    state.open('Stop')
    await flushPromises()
    expect(state.nodes.map((node: { id: string }) => node.id)).toEqual(['Home'])
    wrapper.unmount()
  })

  it('has the flow on screen checked, before it is saved, and forgets the result when the flow changes', async () => {
    const wrapper = mounted('Dispensing')
    await flushPromises()
    const state = wrapper.vm as any
    await state.inspect()
    await flushPromises()
    expect(checked.map(item => [item.shell, item.skill.idShort])).toEqual([[`${base}/FillingModuleAAS`, 'Dispensing']])
    expect(state.checked).toEqual([])
    expect(wrapper.text()).toContain('conditions hold, and so does the end')

    // Without the needle down first: what it is sent is the flow on screen, not what is saved.
    state.nodes = state.nodes.filter((node: { id: string }) => node.id !== 'NeedleDown')
    await flushPromises()
    expect(state.checked).toBeNull()
    await state.inspect()
    await flushPromises()
    const sent = readFlow({ submodelElements: [checked[1]!.skill] }, 'Dispensing', 'Start') as { id: string }[]
    expect(sent.map(node => node.id)).toEqual(['Dispense', 'Home', 'Weigh'])
    expect(state.checked).toEqual(['Dispense: LinearAxis.Position = FillPosition does not hold (run MoveAxis before it)'])
    expect(wrapper.text()).toContain('run MoveAxis before it')
    expect(saved).toHaveLength(0)
    wrapper.unmount()
  })

  it('makes a new skill from this one: described, saved as a new element, opened', async () => {
    const wrapper = mounted('Dispensing')
    await flushPromises()
    const state = wrapper.vm as any
    state.name = 'DoubleDose'
    await state.create()
    await flushPromises()
    expect(saved.map(item => [item.skill, item.created])).toEqual([['DoubleDose', true]])
    expect(deploymentOf(skillOf(saved[0]!.submodel, 'DoubleDose'))).toBe('Described')
    expect(pushed).toEqual([{ query: { aas: 'x', path: 'http://repo/submodels/abc/submodel-elements/DoubleDose' } }])
    wrapper.unmount()
  })

  it('says when the skill service is not reached, and keeps what was saved', async () => {
    reachable = false
    const wrapper = mounted('Dispensing')
    await flushPromises()
    const state = wrapper.vm as any
    state.parameter('Volume', 'maxValue', '8')
    await state.store()
    await flushPromises()
    expect(saved).toHaveLength(1)
    expect(state.failure).toContain('Saved, but the capabilities were not derived anew.')
    expect(state.pending).toBe(false)
    wrapper.unmount()
  })

  it('shows a building block without editing it', async () => {
    const wrapper = mount(SkillEditor, {
      props: { aasId: `${base}/FillingPumpAAS`, submodelId: `${base}/FillingPumpAAS/submodels/Skills`, skill: 'Dispense' },
      global: { plugins: [createVuetify()] },
    })
    await flushPromises()
    expect((wrapper.vm as any).owner.kind).toBe('Primitive')
    expect(wrapper.text()).toContain('Building block')
    expect(wrapper.text()).toContain('Takes: Volume')
    expect(wrapper.text()).not.toContain('Save')
    expect((wrapper.vm as any).issues).toEqual([])
    wrapper.unmount()
  })
})
