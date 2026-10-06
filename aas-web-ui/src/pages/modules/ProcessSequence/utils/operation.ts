import type { PlanProcess, StepNode } from '../types/plan'

/** An operation choice changes the requirements; an old station assignment must be reconsidered. */
export function setOperation (node: StepNode, process: PlanProcess | null): void {
  if (JSON.stringify(node.process?.source) === JSON.stringify(process?.source)) {
    return
  }
  const previousName = node.process?.name
  node.process = process ? structuredClone(toRaw(process)) : null
  if (process && (node.name === 'New step' || node.name === previousName)) {
    node.name = process.name
  }
  delete node.requiredCapabilities
  node.resourceAasId = ''
  node.skillId = ''
  delete node.skillReference
  node.bindings = []
  // Outputs are the authored step contract; retain identities used by downstream decisions.
}
