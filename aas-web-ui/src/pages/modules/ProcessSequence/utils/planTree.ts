import type { PlanNode, ProcessPlan } from '../types/plan.ts'

/** A standalone subtree must not depend on a parent's or sibling's private definitions. */
export function extractAssembly (plan: ProcessPlan, rootId: string, aasId: string): ProcessPlan {
  const ids = new Set([rootId])
  for (let previous = 0; previous !== ids.size;) {
    previous = ids.size
    for (const scope of plan.scopes) {
      if (scope.parentId && ids.has(scope.parentId)) {
        ids.add(scope.id)
      }
    }
  }
  const scopes = structuredClone(plan.scopes.filter(scope => ids.has(scope.id)))
  const root = scopes.find(scope => scope.id === rootId)
  if (!root) {
    throw new Error('Assembly definition is missing.')
  }
  root.parentId = null
  root.material = null
  delete root.planAasId
  function check (nodes: PlanNode[]): void {
    for (const node of nodes) {
      if (node.kind === 'call' && !ids.has(node.scopeId)) {
        throw new Error(`Cannot share ${root!.name}: ${node.name} calls a definition outside this assembly.`)
      }
      if (node.kind === 'parallel' || node.kind === 'decision') {
        for (const branch of node.branches) {
          check(branch.nodes)
        }
      }
      if (node.kind === 'conditional') {
        check(node.nodes)
      }
    }
  }
  for (const scope of scopes) {
    check(scope.nodes)
  }
  return { schema: plan.schema, productAasId: aasId, revision: 0, rootScopeId: rootId, scopes }
}
