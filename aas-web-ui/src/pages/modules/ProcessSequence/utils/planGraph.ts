import type { PlanNode, PlanScope } from '../types/plan'
import type { Edge, Node } from '@vue-flow/core'
import { MarkerType } from '@vue-flow/core'
import type { MaterialUse } from './materials'
import { materialRoles, readMaterialUses } from './materials'
import { conditionLabel, conditionOptions } from './conditions'
import { flattenNodes } from './plan'

export interface PlanGraphData {
  title: string
  subtitle: string
  details?: string
  kind: PlanNode['kind'] | 'start' | 'end' | 'join' | 'branch' | 'skip' | 'merge' | 'material'
  planId?: string
  branchId?: string
  scopeId?: string
  material?: MaterialUse
  operationName?: string
  hasMaterials?: boolean
  height?: number
}

export const graphNodeHeight: Record<PlanGraphData['kind'], number> = {
  material: 72, step: 132, call: 160, parallel: 96, conditional: 164, decision: 164, branch: 56, join: 56, skip: 56, merge: 56, start: 48, end: 48,
}

export const conditionalLaneId = (id: string) => `conditional-run:${id}`

/** Find the owning sequence, so editing a branch never changes a sibling branch. */
export function findLane (nodes: PlanNode[], id: string): { nodes: PlanNode[], index: number } | undefined {
  for (const [index, node] of nodes.entries()) {
    if (node.id === id) {
      return { nodes, index }
    }
    if (node.kind === 'conditional') {
      if (conditionalLaneId(node.id) === id) {
        return { nodes: node.nodes, index: -1 }
      }
      const found = findLane(node.nodes, id)
      if (found) {
        return found
      }
    }
    if (node.kind === 'parallel' || node.kind === 'decision') {
      for (const branch of node.branches) {
        if (branch.id === id) {
          return { nodes: branch.nodes, index: -1 }
        }
        const found = findLane(branch.nodes, id)
        if (found) {
          return found
        }
      }
    }
  }
}

/** A projection only: positions and presentation nodes never enter the saved plan. */
export function buildPlanGraph (sequence: PlanNode[], targets: { id: string, name: string }[], selectedId = '', scopes: PlanScope[] = [], showMaterials = true): { nodes: Node<PlanGraphData>[], edges: Edge[] } {
  const nodes: Node<PlanGraphData>[] = []
  const edges: Edge[] = []
  const options = conditionOptions(flattenNodes(sequence))
  const uses = new Map(flattenNodes(sequence).filter(node => node.kind === 'step' && node.process).map(node => [node.id, showMaterials ? readMaterialUses(node.process!, scopes) : []]))
  const column = [...uses.values()].some(items => items.length > 0) ? 800 : 280
  const gap = 32
  const width = (lane: PlanNode[]): number => Math.max(1, ...lane.map(node => {
    if (node.kind === 'conditional') {
      return width(node.nodes) + 1
    }
    return (node.kind === 'parallel' || node.kind === 'decision') ? node.branches.reduce((sum, branch) => sum + width(branch.nodes), 0) : 1
  }))

  function add (id: string, x: number, y: number, data: PlanGraphData): string {
    nodes.push({ id, type: data.kind === 'material' ? 'material' : 'plan', position: { x: x * column, y }, data })
    return id
  }

  function connect (source: string, target: string): void {
    edges.push({
      id: JSON.stringify([source, target]), source, target, type: 'smoothstep',
      sourceHandle: 'flow-out', targetHandle: 'flow-in',
      markerEnd: MarkerType.ArrowClosed, style: { stroke: '#78909c', strokeWidth: 2 },
    })
  }

  function layout (lane: PlanNode[], x: number, y: number, incoming: string): { last: string, y: number } {
    let last = incoming
    for (const node of lane) {
      let subtitle = 'Start all branches'
      switch (node.kind) {
        case 'step': {
          subtitle = node.process?.name || 'Process step'
          break
        }
        case 'call': {
          subtitle = targets.find(target => target.id === node.scopeId)?.name || 'Subprocess'
          break
        }
        case 'decision':
        case 'conditional': {
          subtitle = conditionLabel(node.condition, options, true)
          break
        }
        // No default
      }
      const materials = uses.get(node.id) ?? []
      const inputs = materials.filter(material => material.role !== 'output')
      const outputs = materials.filter(material => material.role === 'output')
      const height = Math.max(graphNodeHeight[node.kind] + (node.kind === 'step' && node.outputs?.length ? 24 + 28 * node.outputs.length : 0), Math.max(inputs.length, outputs.length) * 84 - 12)
      const id = add(`node:${node.id}`, x, y, {
        title: node.name, kind: node.kind, planId: node.id,
        height, hasMaterials: materials.length > 0,
        scopeId: node.kind === 'call' ? node.scopeId : undefined,
        details: node.kind === 'decision' || node.kind === 'conditional' ? conditionLabel(node.condition, options) : undefined,
        subtitle,
      })
      connect(last, id)
      for (const [side, items] of [inputs, outputs].entries()) {
        for (const [index, material] of items.entries()) {
          const output = side === 1
          const materialId = add(`material:${node.id}:${material.id}`, x + (output ? 280 : -248) / column, y + index * 84, {
            kind: 'material', title: material.name, subtitle: materialRoles[material.role], material, operationName: node.name, planId: node.id,
          })
          const incoming = material.role === 'incorporated' || material.role === 'consumable'
          edges.push({
            id: `material-edge:${node.id}:${material.id}`, source: output ? id : materialId, target: output ? materialId : id,
            sourceHandle: output ? 'material-out' : 'material-source', targetHandle: output ? 'material-target' : 'material-in', type: 'smoothstep',
            ariaLabel: `${materialRoles[material.role]}: ${material.name} ${output ? 'from' : 'at'} ${node.name}`,
            data: { kind: 'material' }, markerEnd: incoming || output ? MarkerType.ArrowClosed : undefined,
            style: { stroke: incoming || output ? '#00897b' : '#78909c', strokeWidth: 2, strokeDasharray: '3 5' },
          })
        }
      }
      y += height + gap
      if (node.kind !== 'step' && node.kind !== 'call') {
        const branches = (node.kind === 'parallel' || node.kind === 'decision')
          ? node.branches
          : [
              { id: conditionalLaneId(node.id), name: 'Run this flow', nodes: node.nodes },
              { id: `conditional-skip:${node.id}`, name: 'Skip this flow', nodes: [] },
            ]
        const total = branches.reduce((sum, branch) => sum + width(branch.nodes), 0)
        let left = x - total / 2
        const ends = branches.map((branch, index) => {
          const size = width(branch.nodes)
          const center = left + size / 2
          left += size
          const skip = node.kind === 'conditional' && index === 1
          const header = add(`branch:${branch.id}`, center, y, {
            title: node.kind === 'decision' ? (index === 0 ? 'Yes' : 'No') : branch.name, subtitle: skip ? 'Continue without running this flow' : 'Select to insert at branch start',
            kind: skip ? 'skip' : 'branch', branchId: skip ? undefined : branch.id, planId: skip ? node.id : undefined,
          })
          connect(id, header)
          return layout(branch.nodes, center, y + graphNodeHeight.branch + gap, header)
        })
        y = Math.max(...ends.map(end => end.y))
        last = add(`join:${node.id}`, x, y, {
          title: node.kind === 'parallel' ? 'Wait for all branches' : 'Continue after selected path',
          subtitle: node.name, kind: node.kind === 'parallel' ? 'join' : 'merge', planId: node.id,
        })
        y += graphNodeHeight.join + gap
        for (const end of ends) {
          connect(end.last, last)
        }
      } else {
        last = id
      }
    }
    return { last, y }
  }

  const start = add('start', 0, 0, { title: 'Start', subtitle: 'Insert at sequence start', kind: 'start' })
  const end = layout(sequence, 0, graphNodeHeight.start + gap, start)
  connect(end.last, add('end', 0, end.y, { title: 'Complete', subtitle: 'Append to sequence', kind: 'end' }))
  const all = flattenNodes(sequence)
  for (const node of all) {
    if ((node.kind !== 'decision' && node.kind !== 'conditional') || node.condition.kind !== 'comparison') {
      continue
    }
    const operand = node.condition.operand
    if (operand?.kind !== 'output' || (node.id !== selectedId && operand.stepId !== selectedId)) {
      continue
    }
    const producer = all.find(item => item.id === operand.stepId)
    const output = producer?.kind === 'step' ? producer.outputs?.find(item => item.id === operand.outputId) : undefined
    if (!output || !producer) {
      continue
    }
    edges.push({
      id: `result:${node.id}`, source: `node:${producer.id}`, target: `node:${node.id}`,
      sourceHandle: `output:${output.id}`, targetHandle: 'condition-input', type: 'smoothstep',
      label: output.name, ariaLabel: `${output.name} from ${producer.name} to ${node.name}`,
      data: { kind: 'result' }, markerEnd: MarkerType.ArrowClosed,
      style: { stroke: '#7e57c2', strokeWidth: 2, strokeDasharray: '6 4' },
    })
  }
  return { nodes, edges }
}
