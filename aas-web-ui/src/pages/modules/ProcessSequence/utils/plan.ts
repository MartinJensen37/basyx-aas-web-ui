import type { PlanBranch, PlanNode, ProcessPlan } from '../types/plan'
import { v4 } from 'uuid'
import { planSchema } from '../types/plan'
import { conditionLeaves, newComparison } from './conditions'
export { expandPlan } from './planPreview'

export function newNode (kind: PlanNode['kind'], scopeId = ''): PlanNode {
  const id = v4()
  if (kind === 'call') {
    return { id, kind, name: 'Subprocess', scopeId }
  }
  if (kind === 'decision') {
    return { id, kind, name: 'Decision', condition: newComparison(), branches: [newBranch('Yes'), newBranch('No')] }
  }
  if (kind === 'conditional') {
    return { id, kind, name: 'Optional flow', condition: { kind: 'everyNthProduct', every: 5 }, nodes: [] }
  }
  if (kind === 'parallel') {
    return {
      id, kind, name: 'Run in parallel',
      branches: [newBranch('Branch 1'), newBranch('Branch 2')],
    }
  }
  return { id, kind, name: 'New step', process: null, resourceAasId: '', skillId: '', bindings: [] }
}

export function newBranch (name: string): PlanBranch {
  return { id: v4(), name, nodes: [] }
}

export function newPlan (productAasId: string, name: string): ProcessPlan {
  return {
    schema: 'process-sequence-plan/2.0', productAasId, revision: 0, rootScopeId: 'product',
    scopes: [{ id: 'product', name, parentId: null, material: null, nodes: [] }],
  }
}

export function flattenNodes (nodes: PlanNode[]): PlanNode[] {
  return nodes.flatMap(node => {
    if (node.kind === 'conditional') {
      return [node, ...flattenNodes(node.nodes)]
    }
    return [node, ...((node.kind === 'parallel' || node.kind === 'decision') ? node.branches.flatMap(branch => flattenNodes(branch.nodes)) : [])]
  })
}

export function parsePlan (text: string, productAasId: string): ProcessPlan {
  const plan = planSchema.parse(JSON.parse(text))
  const nodes = plan.scopes.flatMap(scope => flattenNodes(scope.nodes))
  if (nodes.some(node => node.kind === 'decision' || (node.kind === 'conditional' && node.condition.kind !== 'everyNthProduct') || (node.kind === 'step' && (node.outputs !== undefined || node.process?.parameters.some(parameter => parameter.unit !== undefined))))) {
    plan.schema = 'process-sequence-plan/5.0'
  } else if (plan.schema !== 'process-sequence-plan/5.0' && nodes.some(node => node.kind === 'conditional')) {
    plan.schema = 'process-sequence-plan/4.0'
  }
  if (plan.productAasId !== productAasId) {
    throw new Error('This plan belongs to another product.')
  }
  const errors = structuralIssues(plan)
  if (errors.length > 0) {
    throw new Error(errors[0])
  }
  return plan
}

/** Structural validation applies to drafts too; missing bindings only affect readiness. */
export function structuralIssues (plan: ProcessPlan): string[] {
  const issues: string[] = []
  const scopes = new Map(plan.scopes.map(scope => [scope.id, scope]))
  if (scopes.size !== plan.scopes.length || !scopes.has(plan.rootScopeId)) {
    issues.push('Scope identities must be unique and include the product root.')
  }
  for (const scope of plan.scopes) {
    const ids = new Set<string>()
    if (scope.id === plan.rootScopeId ? scope.parentId !== null : !scope.parentId || !scopes.has(scope.parentId)) {
      issues.push(`Invalid parent for ${scope.name}.`)
    }
    const parents = new Set([scope.id])
    let parent = scope.parentId
    while (parent && scopes.has(parent)) {
      if (parents.has(parent)) {
        issues.push(`Assembly hierarchy contains a cycle at ${scope.name}.`)
        break
      }
      parents.add(parent)
      parent = scopes.get(parent)!.parentId
    }
    for (const node of flattenNodes(scope.nodes)) {
      if (node.kind === 'step' && new Set(node.outputs?.map(output => output.id)).size !== (node.outputs?.length ?? 0)) {
        issues.push(`Output identities must be unique in ${node.name}.`)
      }
      if (node.kind === 'parallel' || node.kind === 'decision') {
        for (const branch of node.branches) {
          if (ids.has(branch.id)) {
            issues.push(`Duplicate branch identity in ${scope.name}.`)
          }
          ids.add(branch.id)
        }
      }
      if ((node.kind === 'conditional' || node.kind === 'decision') && conditionLeaves(node.condition).some(rule => rule.kind === 'everyNthProduct' && (!Number.isSafeInteger(rule.every) || rule.every < 1))) {
        issues.push(`${scope.name} / ${node.name}: enter a positive whole number of products.`)
      }
      if (ids.has(node.id)) {
        issues.push(`Duplicate step identity in ${scope.name}.`)
      }
      ids.add(node.id)
      if (node.kind === 'call' && !scopes.has(node.scopeId)) {
        issues.push(`Subprocess ${node.name} has no definition.`)
      }
    }
  }
  const completed = new Set<string>()
  function visit (id: string, path: Set<string>): void {
    if (path.has(id)) {
      issues.push('A subprocess cannot call itself, directly or indirectly.')
      return
    }
    if (completed.has(id)) {
      return
    }
    const next = new Set([...path, id])
    for (const node of flattenNodes(scopes.get(id)?.nodes ?? [])) {
      if (node.kind === 'call') {
        visit(node.scopeId, next)
      }
    }
    completed.add(id)
  }
  for (const scope of plan.scopes) {
    visit(scope.id, new Set())
  }
  return [...new Set(issues)]
}

export function canCall (plan: ProcessPlan, from: string, target: string): boolean {
  if (from === target) {
    return false
  }
  const visited = new Set<string>()
  function reaches (id: string): boolean {
    if (id === from) {
      return true
    }
    if (visited.has(id)) {
      return false
    }
    visited.add(id)
    return flattenNodes(plan.scopes.find(scope => scope.id === id)?.nodes ?? [])
      .some(node => node.kind === 'call' && reaches(node.scopeId))
  }
  return !reaches(target)
}
