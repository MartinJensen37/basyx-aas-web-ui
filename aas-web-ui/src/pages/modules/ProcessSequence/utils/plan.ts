import type { PlanBranch, PlanNode, PlanScope, ProcessPlan, StepNode } from '../types/plan'
import { v4 } from 'uuid'
import { planSchema } from '../types/plan'

export function newNode (kind: PlanNode['kind'], scopeId = ''): PlanNode {
  const id = v4()
  if (kind === 'call') {
    return { id, kind, name: 'Subprocess', scopeId }
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
    return [node, ...(node.kind === 'parallel' ? node.branches.flatMap(branch => flattenNodes(branch.nodes)) : [])]
  })
}

export function parsePlan (text: string, productAasId: string): ProcessPlan {
  const plan = planSchema.parse(JSON.parse(text))
  if (plan.scopes.some(scope => flattenNodes(scope.nodes).some(node => node.kind === 'conditional'))) {
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
      if (node.kind === 'conditional' && (node.condition.kind !== 'everyNthProduct' || !Number.isSafeInteger(node.condition.every) || node.condition.every < 1)) {
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

export function planningNotes (plan: ProcessPlan): string[] {
  const notes = structuralIssues(plan)
  for (const scope of plan.scopes) {
    for (const node of flattenNodes(scope.nodes)) {
      if (node.kind === 'step' && node.executionMode !== 'manual' && (!node.resourceAasId || !node.skillId)) {
        notes.push(`${scope.name} / ${node.name}: resource skill not assigned.`)
      }
      if (node.kind === 'call' && !plan.scopes.find(item => item.id === node.scopeId)?.nodes.length) {
        notes.push(`${scope.name} / ${node.name}: subprocess is empty.`)
      }
      if (node.kind === 'parallel' && node.branches.some(branch => branch.nodes.length === 0)) {
        notes.push(`${scope.name} / ${node.name}: a parallel branch is empty.`)
      }
      if (node.kind === 'conditional' && node.nodes.length === 0) {
        notes.push(`${scope.name} / ${node.name}: optional flow is empty.`)
      }
    }
  }
  return notes
}

/** Source refresh adds occurrences, but never replaces sequences already authored for them. */
export function mergeScopes (plan: ProcessPlan, incoming: PlanScope[]): void {
  for (const scope of incoming) {
    if (!plan.scopes.some(existing => existing.id === scope.id)) {
      plan.scopes.push(scope)
    }
  }
}

export type ExpandedStep = { id: string, scopeId: string, step: StepNode, after: string[] }

/** Expand calls per invocation and preserve all branch prerequisites at a join. No scheduling is implied. */
export function expandPlan (plan: ProcessPlan, scopeId = plan.rootScopeId, productNumber = 1): ExpandedStep[] {
  if (!Number.isSafeInteger(productNumber) || productNumber < 1) {
    throw new Error('Product number must be a positive whole number within this production run.')
  }
  const errors = structuralIssues(plan)
  if (errors.length > 0) {
    throw new Error(errors[0])
  }
  const result: ExpandedStep[] = []
  function expand (nodes: PlanNode[], owner: string, path: string[], incoming: string[]): string[] {
    let previous = incoming
    for (const node of nodes) {
      const nextPath = [...path, node.id]
      switch (node.kind) {
        case 'step': {
          const id = JSON.stringify(nextPath)
          result.push({ id, scopeId: owner, step: node, after: previous })
          previous = [id]

          break
        }
        case 'call': {
          const child = plan.scopes.find(scope => scope.id === node.scopeId)!
          previous = expand(child.nodes, child.id, nextPath, previous)

          break
        }
        case 'conditional': {
          if (productNumber % node.condition.every === 0) {
            previous = expand(node.nodes, owner, nextPath, previous)
          }

          break
        }
        default: {
          previous = [...new Set(node.branches.flatMap(branch => expand(branch.nodes, owner, [...nextPath, branch.id], previous)))]
        }
      }
    }
    return previous
  }
  expand(plan.scopes.find(scope => scope.id === scopeId)?.nodes ?? [], scopeId, [scopeId], [])
  return result
}
