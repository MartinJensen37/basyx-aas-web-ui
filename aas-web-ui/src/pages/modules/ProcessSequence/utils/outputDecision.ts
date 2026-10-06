import type { DecisionNode, PlanOutput, StepNode } from '../types/plan'
import { newNode } from './plan'

/** Insert immediately after the producer, in the same lane, so the result is available. */
export function decisionForOutput (step: StepNode, output: PlanOutput): DecisionNode {
  const decision = newNode('decision') as DecisionNode
  decision.name = `Check ${output.name}`
  decision.condition = {
    kind: 'comparison', operand: { kind: 'output', stepId: step.id, outputId: output.id },
    operator: 'eq', unit: output.type === 'number' ? output.unit : '',
    expected: output.type === 'boolean'
      ? { type: 'boolean', value: true }
      : (output.type === 'number' ? { type: 'number', value: 0 } : { type: 'string', value: '' }),
  }
  return decision
}
