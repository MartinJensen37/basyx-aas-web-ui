import type { PlanNode } from '../types/plan'
import type { Edge, Node } from '@vue-flow/core'
import { MarkerType } from '@vue-flow/core'

export interface PlanGraphData {
  title: string
  subtitle: string
  kind: PlanNode['kind'] | 'start' | 'end' | 'join' | 'branch'
  planId?: string
  branchId?: string
  scopeId?: string
}

export const graphNodeHeight: Record<PlanGraphData['kind'], number> = {
  step: 96, call: 120, parallel: 96, branch: 56, join: 56, start: 48, end: 48,
}

/** Find the owning sequence, so editing a branch never changes a sibling branch. */
export function findLane (nodes: PlanNode[], id: string): { nodes: PlanNode[], index: number } | undefined {
  for (const [index, node] of nodes.entries()) {
    if (node.id === id) {
      return { nodes, index }
    }
    if (node.kind === 'parallel') {
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
  const column = 280
  const gap = 32
  const width = (lane: PlanNode[]): number => Math.max(1, ...lane.map(node => node.kind === 'parallel'
    ? node.branches.reduce((sum, branch) => sum + width(branch.nodes), 0)
    : 1))

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
      const id = add(`node:${node.id}`, x, y, {
        title: node.name, kind: node.kind, planId: node.id,
        scopeId: node.kind === 'call' ? node.scopeId : undefined,
        subtitle: node.kind === 'step'
          ? (node.process?.name || 'Process step')
          : (node.kind === 'call'
              ? (targets.find(target => target.id === node.scopeId)?.name || 'Subprocess')
              : 'Start all branches'),
      })
      connect(last, id)
      y += graphNodeHeight[node.kind] + gap
      if (node.kind === 'parallel') {
        const total = node.branches.reduce((sum, branch) => sum + width(branch.nodes), 0)
        let left = x - total / 2
        const ends = node.branches.map(branch => {
          const size = width(branch.nodes)
          const center = left + size / 2
          left += size
          const header = add(`branch:${branch.id}`, center, y, {
            title: branch.name, subtitle: 'Select to insert at branch start', kind: 'branch', branchId: branch.id,
          })
          connect(id, header)
          return layout(branch.nodes, center, y + graphNodeHeight.branch + gap, header)
        })
        y = Math.max(...ends.map(end => end.y))
        last = add(`join:${node.id}`, x, y, {
          title: 'Wait for all branches', subtitle: node.name, kind: 'join', planId: node.id,
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
