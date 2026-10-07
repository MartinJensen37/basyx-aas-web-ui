import type { StepNode } from '../types/plan'
import { describe, expect, it } from 'vitest'
import { buildPharmaDemo } from '../demo/pharma'
import { upgradeDemoInputs } from '../demo/seed'
import { materialSemantic, readMaterialUses, upgradeMaterialUses } from './materials'
import { buildPlanGraph } from './planGraph'
import { modelRef } from './sequenceModel'

const demo = buildPharmaDemo(id => `${id}/sequence`)
const plan = demo.plans.find(plan => plan.productAasId.endsWith('/syringe-two-dose'))!
const step = (id: string) => structuredClone(plan.scopes[0]!.nodes.find(node => node.id === id) as StepNode)

describe('material requirements and graph projection', () => {
  it('allocates one stopper to each cycle and resolves liquid quantities from effective recipe parameters', () => {
    for (const id of ['Stoppering_1', 'Stoppering_2']) {
      const material = readMaterialUses(step(id).process!, plan.scopes).find(material => material.role === 'incorporated')!
      expect(material).toMatchObject({ name: '8.65 mm rubber stopper', quantity: '1', unit: 'piece', scopeId: 'part-1' })
    }
    const filling = step('Filling_2')
    filling.process!.parameters.find(parameter => parameter.name === 'FillVolume')!.value = '0.7'
    expect(readMaterialUses(filling.process!, plan.scopes).find(material => material.role === 'incorporated')).toMatchObject({ name: 'Demo liquid 2', quantity: '0.7', unit: 'mL' })
    expect(readMaterialUses(step('Unpacking').process!).some(material => material.name === 'Packing tray')).toBe(false)
    expect(readMaterialUses(step('Packing').process!).find(material => material.role === 'output')).toMatchObject({ quantity: '1', unit: 'piece' })
  })

  it('keeps legacy links neutral instead of treating BoM totals as consumption', () => {
    const process = step('Stoppering_1').process!
    process.material = [{ modelType: 'ReferenceElement', idShort: 'Legacy', value: modelRef([{ type: 'Submodel', value: plan.scopes[2]!.material!.submodelId }, ...['Product', 'Part_1'].map(value => ({ type: 'Entity', value }))]) }]
    expect(readMaterialUses(process, plan.scopes)[0]).toMatchObject({ name: '8.65 mm rubber stopper', role: 'linked', quantity: '', warning: expect.stringContaining('not been specified') })
  })

  it('reports missing quantity references and invalid amounts without inventing values', () => {
    const process = step('Filling_1').process!
    process.parameters = []
    expect(readMaterialUses(process).find(material => material.role === 'incorporated')).toMatchObject({ quantity: '', warning: 'The quantity parameter could not be resolved.' })
    const material = process.material[0] as Record<string, any>
    material.value.find((entry: Record<string, any>) => entry.idShort === 'Quantity').value = '-1'
    expect(readMaterialUses(process)[0]!.warning).toContain('non-negative')
  })

  it('upgrades legacy links by occurrence and preserves custom quantities, references and unique names', () => {
    const template = { idShort: 'ProcessBoM', modelType: 'SubmodelElementCollection', value: step('Filling_1').process!.material }
    const entries = template.value as Record<string, any>[]
    const current = { ...template, value: [{ modelType: 'ReferenceElement', idShort: 'Material_0', semanticId: { type: 'ExternalReference', keys: [{ type: 'GlobalReference', value: 'https://smartproductionlab.aau.dk/demo/pharma/semantics/Material_0' }] }, value: structuredClone(entries[1]!.value[0].value) }] }
    upgradeDemoInputs(current, template)
    expect(current.value.every(entry => entry.modelType === 'SubmodelElementCollection')).toBe(true)
    expect(new Set(current.value.map(entry => entry.idShort)).size).toBe(2)
    const before = JSON.stringify(current)
    upgradeDemoInputs(current, template)
    expect(JSON.stringify(current)).toBe(before)
    const authored = structuredClone(template)
    const custom = authored.value[0] as Record<string, any>
    custom.value.find((entry: Record<string, any>) => entry.semanticId?.keys[0].value === materialSemantic('Quantity')).value = '3'
    upgradeMaterialUses(authored, template)
    expect(readMaterialUses({ ...step('Filling_1').process!, material: authored.value })[0]!.quantity).toBe('3')
  })

  it('separates material edges from execution order and lays out branch material cards without overlap', () => {
    const filling = step('Filling_1')
    const packing = step('Packing')
    const sequence = [{ id: 'parallel', name: 'Parallel', kind: 'parallel' as const, branches: [{ id: 'a', name: 'A', nodes: [filling] }, { id: 'b', name: 'B', nodes: [packing] }] }]
    const before = JSON.stringify(sequence)
    const graph = buildPlanGraph(sequence, [], '', plan.scopes)
    const hidden = buildPlanGraph(sequence, [], '', plan.scopes, false)
    expect(graph.edges.filter(edge => edge.data?.kind !== 'material')).toEqual(hidden.edges)
    expect(graph.edges.find(edge => edge.source === 'node:Packing' && edge.data?.kind === 'material')?.target).toContain('material:Packing:')
    expect(graph.edges.find(edge => edge.source === 'material:Filling_1:0')?.markerEnd).toBeUndefined()
    for (const a of graph.nodes) {
      for (const b of graph.nodes) {
        if (a.id === b.id) {
          continue
        }
        const width = a.type === 'material' ? 200 : 240
        const otherWidth = b.type === 'material' ? 200 : 240
        const height = a.data!.height ?? (a.type === 'material' ? 72 : 48)
        const otherHeight = b.data!.height ?? (b.type === 'material' ? 72 : 48)
        expect(a.position.x + width <= b.position.x || b.position.x + otherWidth <= a.position.x || a.position.y + height <= b.position.y || b.position.y + otherHeight <= a.position.y, `${a.id} overlaps ${b.id}`).toBe(true)
      }
    }
    expect(JSON.stringify(sequence)).toBe(before)
  })
})
