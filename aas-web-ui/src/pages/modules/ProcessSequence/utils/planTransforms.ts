import type { PlanNode, ProcessPlan } from '../types/plan'
import { v4 } from 'uuid'
import { conditionLeaves } from './conditions'
import { flattenNodes, newBranch, newNode, parsePlan } from './plan'
import { findLane } from './planGraph'

export const nodeTypes = [
  { title: 'Operation', value: 'step' }, { title: 'Subprocess', value: 'call' },
  { title: 'Decision', value: 'decision' }, { title: 'Parallel', value: 'parallel' },
  { title: 'Optional', value: 'conditional' },
] as const

export function isPlaceholder (node: PlanNode): boolean {
  return node.kind === 'step' && node.name === 'New step' && !node.process && !node.resourceAasId && !node.skillId
    && !node.skillReference && node.bindings.length === 0 && !node.outputs?.length && !node.requiredCapabilities?.length && !node.executionMode
}

export function isEmptyContainer (node: PlanNode): boolean {
  if (node.kind === 'conditional') {
    return node.nodes.length === 0
  }
  return (node.kind === 'decision' || node.kind === 'parallel') && node.branches.every(branch => branch.nodes.length === 0)
}

export function typeChangeDescription (node: PlanNode, kind: PlanNode['kind']): string {
  if (isPlaceholder(node)) {
    return 'Replace the empty step with the selected type.'
  }
  if (kind === 'step') {
    if (isEmptyContainer(node)) {
      return 'Replace this empty flow with an operation. Its condition and branch rules will be removed.'
    }
    return 'A configured flow cannot become a single operation without losing its meaning. Keep it, or extract it into a subprocess.'
  }
  if (node.kind === 'conditional' && kind === 'decision') {
    return 'Keep the condition and Run steps as Yes. The Skip path becomes an editable No branch.'
  }
  if (node.kind === 'decision' && kind === 'conditional' && node.branches[1].nodes.length === 0) {
    return 'Keep the condition and Yes steps. The empty No branch becomes Skip.'
  }
  if (kind === 'call') {
    return 'Move the complete selected flow into a new local subprocess and insert a call. Operations keep their IDs and bindings.'
  }
  return `Wrap the complete selected flow in the ${kind === 'parallel' ? 'first branch' : (kind === 'decision' ? 'Yes branch' : 'Run branch')}. Existing steps and bindings are retained.`
}

/** Atomic transformations preserve all configured content. Destructive flattening is deliberately unavailable. */
export function changeNodeType (input: ProcessPlan, scopeId: string, nodeId: string, kind: PlanNode['kind'], callTarget = ''): { plan: ProcessPlan, selectedId: string } {
  const plan = parsePlan(JSON.stringify(input), input.productAasId)
  const scope = plan.scopes.find(scope => scope.id === scopeId)
  const lane = scope && findLane(scope.nodes, nodeId)
  if (!scope || !lane || lane.index < 0) {
    throw new Error('Select an existing step to change its type.')
  }
  const current = lane.nodes[lane.index]
  if (current.kind === kind) {
    return { plan, selectedId: current.id }
  }
  const empty = isPlaceholder(current)
  if (!empty && kind === 'step' && !isEmptyContainer(current)) {
    throw new Error(typeChangeDescription(current, kind))
  }
  let replacement = newNode(kind, callTarget)
  if (kind === 'step') {
    replacement = { ...replacement, id: current.id, name: current.name }
  }
  if (empty) {
    replacement.id = current.id
  } else if (current.kind === 'conditional' && replacement.kind === 'decision') {
    replacement = { ...replacement, id: current.id, name: current.name, condition: current.condition, branches: [{ ...newBranch('Yes'), nodes: current.nodes }, newBranch('No')] }
  } else if (current.kind === 'decision' && replacement.kind === 'conditional' && current.branches[1].nodes.length === 0) {
    replacement = { ...replacement, id: current.id, name: current.name, condition: current.condition, nodes: current.branches[0].nodes }
  } else if (replacement.kind === 'conditional') {
    replacement.name = `Optional ${current.name}`
    replacement.nodes = [current]
  } else if (replacement.kind === 'decision' || replacement.kind === 'parallel') {
    replacement.branches[0].nodes = [current]
  }
  if (replacement.kind === 'call' && (!empty || !callTarget)) {
    const moved = new Set(flattenNodes([current]).map(node => node.id))
    const crossing = flattenNodes(scope.nodes).some(node => (node.kind === 'decision' || node.kind === 'conditional')
      && conditionLeaves(node.condition).some(rule => rule.kind === 'comparison' && rule.operand
        && moved.has(node.id) !== moved.has(rule.operand.stepId)))
    if (crossing) {
      throw new Error('This extraction would break a condition reference across the subprocess boundary. Keep the referenced operations and their decisions in the same sequence.')
    }
    const id = v4()
    plan.scopes.push({ id, name: empty ? 'New subprocess' : current.name, parentId: scopeId, material: null, nodes: empty ? [] : [current] })
    replacement.scopeId = id
    replacement.name = empty ? 'Subprocess' : current.name
  }
  lane.nodes[lane.index] = replacement
  return { plan: parsePlan(JSON.stringify(plan), plan.productAasId), selectedId: replacement.id }
}

export function unwrapConditional (input: ProcessPlan, scopeId: string, nodeId: string): { plan: ProcessPlan, selectedId: string } {
  const plan = parsePlan(JSON.stringify(input), input.productAasId)
  const scope = plan.scopes.find(scope => scope.id === scopeId)
  const lane = scope && findLane(scope.nodes, nodeId)
  const node = lane?.nodes[lane.index]
  if (!lane || node?.kind !== 'conditional') {
    throw new Error('Select an optional flow to remove its condition.')
  }
  lane.nodes.splice(lane.index, 1, ...node.nodes)
  return { plan, selectedId: node.nodes[0]?.id ?? '' }
}
