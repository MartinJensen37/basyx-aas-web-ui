import type { PlanNode, ProcessPlan, StepNode } from '../types/plan'
import { conditionLabel, conditionOptions, evaluateCondition } from './conditions'
import { flattenNodes, structuralIssues } from './plan'

export type ExpandedStep = { id: string, scopeId: string, step: StepNode, after: string[] }
export type FlowChoice = { id: string, name: string, condition: string, path: string, reason?: string }
export type PreviewValue = boolean | number | string
export const outputKey = (invocation: string[], stepId: string, outputId: string) => JSON.stringify([...invocation, stepId, outputId])

/** Preview only: supplied results are scoped to an invocation; no station is contacted. */
export function previewPlan (plan: ProcessPlan, scopeId = plan.rootScopeId, productNumber = 1, values: Record<string, PreviewValue> = {}) {
  if (!Number.isSafeInteger(productNumber) || productNumber < 1) {
    throw new Error('Product number must be a positive whole number within this production run.')
  }
  const errors = structuralIssues(plan)
  if (errors.length > 0) {
    throw new Error(errors[0])
  }
  const steps: ExpandedStep[] = []
  const choices: FlowChoice[] = []
  const inputs: { key: string, name: string, type: 'boolean' | 'number' | 'string', unit: string }[] = []

  function expand (nodes: PlanNode[], owner: string, invocation: string[], path: string[], incoming: string[], available: Set<string>): { after: string[], blocked: boolean } {
    let previous = incoming
    for (const node of nodes) {
      const nextPath = [...path, node.id]
      switch (node.kind) {
        case 'step': {
          const id = JSON.stringify(nextPath)
          steps.push({ id, scopeId: owner, step: node, after: previous })
          for (const output of node.outputs ?? []) {
            inputs.push({ key: outputKey(invocation, node.id, output.id), name: `${node.name} / ${output.name}`, type: output.type, unit: output.unit })
          }
          available.add(node.id)
          previous = [id]
          break
        }
        case 'call': {
          const child = plan.scopes.find(scope => scope.id === node.scopeId)!
          const result = expand(child.nodes, child.id, nextPath, nextPath, previous, new Set())
          if (result.blocked) {
            return result
          }
          previous = result.after
          break
        }
        case 'conditional':
        case 'decision': {
          const options = conditionOptions(flattenNodes(plan.scopes.find(scope => scope.id === owner)!.nodes))
          const condition = node.condition
          const evaluation = evaluateCondition(condition, comparison => {
            const option = options.find(option => option.key === JSON.stringify(comparison.operand))
            const operand = option?.operand
            const actual = operand?.kind === 'output' ? values[outputKey(invocation, operand.stepId, operand.outputId)] : option?.value
            return operand?.kind === 'output' && !available.has(operand.stepId)
              ? { reason: 'This output is not available on every path reaching this condition. Move the decision into the producing branch or use an earlier operation.' }
              : { option, actual }
          }, productNumber)
          const labels = node.kind === 'conditional' ? ['Skip', 'Run'] : ['No', 'Yes']
          const choice: FlowChoice = {
            id: JSON.stringify(nextPath), name: node.name, condition: conditionLabel(condition, options),
            path: evaluation.value === undefined ? 'Unresolved' : labels[Number(evaluation.value)],
            reason: evaluation.reason,
          }
          choices.push(choice)
          if (evaluation.value === undefined) {
            return { after: previous, blocked: true }
          }
          const branch = node.kind === 'decision' ? node.branches[evaluation.value ? 0 : 1] : undefined
          const body = node.kind === 'conditional' ? (evaluation.value ? node.nodes : []) : branch!.nodes
          const result = expand(body, owner, invocation, branch ? [...nextPath, branch.id] : nextPath, previous, new Set(available))
          if (result.blocked) {
            return result
          }
          previous = result.after
          // Outputs created inside alternatives require an explicit merge contract before escaping.
          break
        }
        case 'parallel': {
          const branches = node.branches.map(branch => {
            const branchAvailable = new Set(available)
            return { ...expand(branch.nodes, owner, invocation, [...nextPath, branch.id], previous, branchAvailable), available: branchAvailable }
          })
          previous = [...new Set(branches.flatMap(branch => branch.after))]
          if (branches.some(branch => branch.blocked)) {
            return { after: previous, blocked: true }
          }
          for (const branch of branches) {
            for (const id of branch.available) {
              available.add(id)
            }
          }
          break
        }
      }
    }
    return { after: previous, blocked: false }
  }
  const scope = plan.scopes.find(scope => scope.id === scopeId)
  if (!scope) {
    throw new Error('The selected sequence no longer exists.')
  }
  const result = expand(scope.nodes, scopeId, [scopeId], [scopeId], [], new Set())
  const occurrences = new Map<string, number>()
  const counts = new Map<string, number>()
  for (const input of inputs) {
    counts.set(input.name, (counts.get(input.name) ?? 0) + 1)
  }
  for (const input of inputs) {
    const occurrence = (occurrences.get(input.name) ?? 0) + 1
    occurrences.set(input.name, occurrence)
    if (counts.get(input.name)! > 1) {
      input.name += ` (invocation ${occurrence})`
    }
  }
  return { steps, choices, inputs, blocked: result.blocked }
}

/** Existing callers require a complete expansion, never a silently truncated unresolved plan. */
export function expandPlan (plan: ProcessPlan, scopeId = plan.rootScopeId, productNumber = 1): ExpandedStep[] {
  const preview = previewPlan(plan, scopeId, productNumber)
  if (preview.blocked) {
    throw new Error(preview.choices.find(choice => choice.reason)?.reason ?? 'A flow condition is unresolved.')
  }
  return preview.steps
}
