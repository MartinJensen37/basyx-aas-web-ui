import type { AasElement } from '../utils/sequenceModel'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { createVuetify } from 'vuetify'
import fixture from './fixtures/fillingModule.json'
import { readFlow, readSkills } from './skillFlow'
import SkillFlowEditor from './SkillFlowEditor.vue'

const base = 'https://smartproductionlab.aau.dk/aas'
const model = (shell: string) => structuredClone((fixture.submodels as AasElement[]).find(item => item.id === `${base}/${shell}/submodels/Skills`)!)
const saved: AasElement[] = []

vi.mock('./useSkillRepository', () => ({
  useSkillRepository: () => ({
    loadSkills: async () => model('FillingModuleAAS'),
    loadComponentSkills: async () => ['FillingLinearAxisAAS', 'FillingPumpAAS', 'FillingScaleAAS'].flatMap(shell => readSkills(model(shell), `${base}/${shell}`)),
    save: async (submodel: AasElement) => {
      saved.push(structuredClone(submodel))
    },
  }),
}))

beforeAll(() => {
  vi.stubGlobal('ResizeObserver', class {
    disconnect () {}
    observe () {}
    unobserve () {}
  })
  vi.stubGlobal('visualViewport', { addEventListener: vi.fn(), height: 768, offsetLeft: 0, offsetTop: 0, removeEventListener: vi.fn(), width: 1024 })
})

describe('skill editor', () => {
  it('shows a skill as a flow, takes a change of a step and saves the submodel', async () => {
    const wrapper = mount(SkillFlowEditor, {
      attachTo: document.body,
      props: { aasId: `${base}/FillingModuleAAS`, submodelId: `${base}/FillingModuleAAS/submodels/Skills` },
      global: { plugins: [createVuetify()] },
    })
    await flushPromises()
    const state = wrapper.vm as any
    expect(wrapper.text()).toContain('Skills as flows')
    expect(state.current).toBe('Dispensing')
    expect(state.choices.map((choice: { value: string }) => choice.value)).toEqual(['Dispensing', 'Reset', 'Stop'])
    expect(state.nodes.map((node: { id: string }) => node.id)).toEqual(['NeedleDown', 'Dispense', 'Home', 'Weigh'])
    expect(wrapper.find('button[aria-label="NeedleDown"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('MoveAxis (FillingLinearAxis)')
    expect(wrapper.text()).toContain('Volume ← Volume, FlowRate = 1.0')
    expect(state.pending).toBe(false)

    // Selecting a step opens what it runs and what it is handed.
    await wrapper.find('button[aria-label="Dispense"]').trigger('click')
    expect(state.step.skillId).toBe('Dispense')
    expect(wrapper.text()).toContain('What it is handed')
    // A value the pump does not take is said before anything is saved.
    state.step.bindings.find((binding: { name: string }) => binding.name === 'FlowRate').value = '9'
    await flushPromises()
    expect(state.issues).toEqual(['Dispense: FlowRate = 9 is outside what Dispense takes (0.1 to 5).'])
    expect(wrapper.text()).toContain('is outside what Dispense takes')
    state.step.bindings.find((binding: { name: string }) => binding.name === 'FlowRate').value = '2.0'
    await flushPromises()
    expect(state.issues).toEqual([])
    expect(state.pending).toBe(true)

    await state.store()
    expect(saved).toHaveLength(1)
    const flow = readFlow(saved[0]!, 'Dispensing', 'Start') as any[]
    expect(flow[1].bindings.map((binding: { name: string, value: string }) => [binding.name, binding.value])).toEqual([['Volume', ''], ['FlowRate', '2.0']])
    expect(state.pending).toBe(false)

    // A new skill from this one, then the steps the module runs while it stops.
    state.name = 'DoubleDose'
    state.create()
    await flushPromises()
    expect(state.current).toBe('DoubleDose')
    expect(state.choices.map((choice: { value: string }) => choice.value)).toContain('DoubleDose')
    state.open('DoubleDose', 'Stop')
    await flushPromises()
    expect(state.nodes.map((node: { id: string }) => node.id)).toEqual(['Home'])
    expect(state.pending).toBe(true)
    wrapper.unmount()
  })
})
