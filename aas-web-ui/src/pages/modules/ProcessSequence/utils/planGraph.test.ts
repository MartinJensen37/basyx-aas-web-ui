import type { PlanNode } from '../types/plan'
import { describe, expect, it } from 'vitest'
import { newNode } from './plan'
import { buildPlanGraph, findLane, graphNodeHeight } from './planGraph'

describe('process graph', () => {
  it('joins all nested branches before the following step, including empty branches', () => {
    const outer = newNode('parallel')
    const inner = newNode('parallel')
    if (outer.kind !== 'parallel' || inner.kind !== 'parallel') {
      throw new Error('Expected parallel nodes')
    }
    const step = newNode('step')
    const after = newNode('step')
    inner.branches[0]!.nodes.push(step)
    outer.branches[0]!.nodes.push(inner)
    const plan = [outer, after]
    const before = JSON.stringify(plan)
    const graph = buildPlanGraph(plan, [])
    const sources = (id: string) => graph.edges.filter(edge => edge.target === id).map(edge => edge.source)
    expect(sources(`join:${inner.id}`)).toEqual([`node:${step.id}`, `branch:${inner.branches[1]!.id}`])
    expect(sources(`join:${outer.id}`)).toEqual([`join:${inner.id}`, `branch:${outer.branches[1]!.id}`])
    expect(sources(`node:${after.id}`)).toEqual([`join:${outer.id}`])
    expect(sources('end')).toEqual([`node:${after.id}`])
    const positions = graph.nodes.map(node => JSON.stringify(node.position))
    expect(new Set(positions).size).toBe(positions.length)
    expect(JSON.stringify(plan)).toBe(before)
    for (const edge of graph.edges) {
      const source = graph.nodes.find(node => node.id === edge.source)!
      const target = graph.nodes.find(node => node.id === edge.target)!
      expect(target.position.y - source.position.y).toBeGreaterThan(graphNodeHeight[source.data!.kind])
    }
  })

  it('finds insertion points within nested branches without changing sibling sequences', () => {
    const parallel = newNode('parallel')
    if (parallel.kind !== 'parallel') {
      throw new Error('Expected parallel node')
    }
    const root = [parallel]
    const branch = findLane(root, parallel.branches[0]!.id)!
    const step = newNode('step')
    branch.nodes.splice(branch.index + 1, 0, step)
    expect(findLane(root, step.id)).toEqual({ nodes: parallel.branches[0]!.nodes, index: 0 })
    expect(parallel.branches[1]!.nodes).toEqual([])
    expect(root).toHaveLength(1)
    expect(findLane(root, 'missing')).toBeUndefined()
  })

  it('connects start to completion in an empty sequence and keeps calls as navigable nodes', () => {
    expect(buildPlanGraph([], []).edges).toMatchObject([{ source: 'start', target: 'end' }])
    const call: PlanNode = { id: 'call', name: 'Build drive', kind: 'call', scopeId: 'drive' }
    expect(buildPlanGraph([call], [{ id: 'drive', name: 'Drive assembly' }]).nodes[1]?.data)
      .toMatchObject({ scopeId: 'drive', title: 'Build drive', subtitle: 'Drive assembly' })
  })
})
