import type { PlanNode } from '../types/plan'
import type { Edge, Node } from '@vue-flow/core'
import { MarkerType } from '@vue-flow/core'
import { conditionLabel, conditionOptions } from './conditions'
import { flattenNodes } from './plan'

export interface PlanGraphData {
  title: string
  subtitle: string
  details?: string
  kind: PlanNode['kind'] | 'start' | 'end' | 'join' | 'branch' | 'skip' | 'merge'
  planId?: string
  branchId?: string
  scopeId?: string
}

export const graphNodeHeight: Record<PlanGraphData['kind'], number> = {
  step: 96, call: 120, parallel: 96, conditional: 120, decision: 120, branch: 56, join: 56, skip: 56, merge: 56, start: 48, end: 48,
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
export function buildPlanGraph (sequence: PlanNode[], targets: { id: string, name: string }[]): { nodes: Node<PlanGraphData>[], edges: Edge[] } {
  const nodes: Node<PlanGraphData>[] = []
  const edges: Edge[] = []
  const options = conditionOptions(flattenNodes(sequence))
  const column = 280
  const gap = 32
  const width = (lane: PlanNode[]): number => Math.max(1, ...lane.map(node => {
    if (node.kind === 'conditional') {
      return width(node.nodes) + 1
    }
    return (node.kind === 'parallel' || node.kind === 'decision') ? node.branches.reduce((sum, branch) => sum + width(branch.nodes), 0) : 1
  }))

  function add (id: string, x: number, y: number, data: PlanGraphData): string {
    nodes.push({ id, type: 'plan', position: { x: x * column, y }, data })
    return id
  }

  function connect (source: string, target: string): void {
    edges.push({
      id: JSON.stringify([source, target]), source, target, type: 'smoothstep',
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
      const id = add(`node:${node.id}`, x, y, {
        title: node.name, kind: node.kind, planId: node.id,
        scopeId: node.kind === 'call' ? node.scopeId : undefined,
        details: node.kind === 'decision' || node.kind === 'conditional' ? conditionLabel(node.condition, options) : undefined,
        subtitle,
      })
      connect(last, id)
      y += graphNodeHeight[node.kind] + gap
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
  return { nodes, edges }
}
