import { z } from 'zod'

const sourceSchema = z.object({ aasId: z.string(), submodelId: z.string(), path: z.array(z.string()) })
export const capabilityReferenceSchema = z.object({
  type: z.enum(['ModelReference', 'ExternalReference']),
  keys: z.array(z.object({ type: z.string(), value: z.string() })).min(1),
})
const requirementSchema = z.object({ name: z.string(), reference: capabilityReferenceSchema })
export type CapabilityReference = z.infer<typeof capabilityReferenceSchema>
export type CapabilityRequirement = z.infer<typeof requirementSchema>
const parameterSchema = z.object({
  name: z.string(), group: z.enum(['ProductParameters', 'ProcessParameters', 'ResourceParameters']),
  dataType: z.string(), value: z.string(), source: sourceSchema, unit: z.string().optional(), semanticIds: z.array(z.string()).optional(),
})
const processSchema = z.object({
  processId: z.string(), name: z.string(), source: sourceSchema,
  parameters: z.array(parameterSchema), material: z.array(z.unknown()),
  requiredCapabilities: z.array(requirementSchema).optional(),
})
const bindingSchema = z.object({ name: z.string(), value: z.string(), source: sourceSchema.nullable(), target: capabilityReferenceSchema.optional() })
export const outputSchema = z.object({ id: z.string().min(1), name: z.string(), type: z.enum(['boolean', 'number', 'string']), unit: z.string(), source: capabilityReferenceSchema.optional() })
export type PlanOutput = z.infer<typeof outputSchema>
export const conditionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('everyNthProduct'), every: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER) }),
  z.object({
    kind: z.literal('comparison'),
    operand: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('parameter'), stepId: z.string(), source: sourceSchema }),
      z.object({ kind: z.literal('output'), stepId: z.string(), outputId: z.string() }),
    ]).nullable(),
    operator: z.enum(['eq', 'ne', 'gt', 'gte', 'lt', 'lte']),
    expected: z.discriminatedUnion('type', [
      z.object({ type: z.literal('boolean'), value: z.boolean() }),
      z.object({ type: z.literal('number'), value: z.number() }),
      z.object({ type: z.literal('string'), value: z.string() }),
    ]),
    unit: z.string(),
  }),
])
export type PlanCondition = z.infer<typeof conditionSchema>

export type SourceReference = z.infer<typeof sourceSchema>
export type PlanParameter = z.infer<typeof parameterSchema>
export type PlanProcess = z.infer<typeof processSchema>
export type PlanBinding = z.infer<typeof bindingSchema>
export type StepNode = {
  id: string
  kind: 'step'
  name: string
  process: PlanProcess | null
  resourceAasId: string
  skillId: string
  skillReference?: CapabilityReference
  bindings: PlanBinding[]
  executionMode?: 'manual' | 'station'
  /** Undefined inherits process requirements; [] explicitly removes them for this occurrence. */
  requiredCapabilities?: CapabilityRequirement[]
  outputs?: PlanOutput[]
}
export type CallNode = { id: string, kind: 'call', name: string, scopeId: string }
export type ParallelNode = { id: string, kind: 'parallel', name: string, branches: PlanBranch[] }
export type ConditionalNode = { id: string, kind: 'conditional', name: string, condition: PlanCondition, nodes: PlanNode[] }
export type DecisionNode = { id: string, kind: 'decision', name: string, condition: PlanCondition, branches: [PlanBranch, PlanBranch] }
export type PlanNode = StepNode | CallNode | ParallelNode | ConditionalNode | DecisionNode
export type PlanBranch = { id: string, name: string, nodes: PlanNode[] }

const nodeSchema: z.ZodType<PlanNode> = z.lazy(() => z.discriminatedUnion('kind', [
  z.object({
    id: z.string().min(1), kind: z.literal('step'), name: z.string(), process: processSchema.nullable(),
    resourceAasId: z.string(), skillId: z.string(), bindings: z.array(bindingSchema),
    skillReference: capabilityReferenceSchema.optional(),
    executionMode: z.enum(['manual', 'station']).optional(),
    requiredCapabilities: z.array(requirementSchema).optional(),
    outputs: z.array(outputSchema).optional(),
  }),
  z.object({ id: z.string().min(1), kind: z.literal('call'), name: z.string(), scopeId: z.string() }),
  z.object({
    id: z.string().min(1), kind: z.literal('parallel'), name: z.string(),
    branches: z.array(z.object({ id: z.string(), name: z.string(), nodes: z.array(nodeSchema) })).min(2),
  }),
  z.object({
    id: z.string().min(1), kind: z.literal('conditional'), name: z.string(),
    condition: conditionSchema,
    nodes: z.array(nodeSchema),
  }),
  z.object({
    id: z.string().min(1), kind: z.literal('decision'), name: z.string(), condition: conditionSchema,
    branches: z.tuple([
      z.object({ id: z.string().min(1), name: z.string(), nodes: z.array(nodeSchema) }),
      z.object({ id: z.string().min(1), name: z.string(), nodes: z.array(nodeSchema) }),
    ]),
  }),
]))

export const planSchema = z.object({
  schema: z.enum(['process-sequence-plan/2.0', 'process-sequence-plan/3.0', 'process-sequence-plan/4.0', 'process-sequence-plan/5.0']),
  productAasId: z.string().min(1),
  revision: z.number().int().nonnegative(),
  rootScopeId: z.string(),
  /** Revision vector for composed browser drafts; omitted from each stored definition. */
  linkedRevisions: z.record(z.string(), z.number().int().nonnegative()).optional(),
  scopes: z.array(z.object({
    id: z.string().min(1), name: z.string(), parentId: z.string().nullable(),
    material: sourceSchema.extend({ globalAssetId: z.string(),
      /** Live BoM metadata for display; sequence documents store only the occurrence reference. */
      bulkCount: z.string().optional(), bulkCountWarning: z.string().optional(),
    }).nullable(),
    /** This occurrence uses the root sequence owned by another product/assembly AAS. */
    planAasId: z.string().min(1).optional(),
    /** Actual persisted sequence ID; scopes themselves are only an editor projection. */
    sequenceId: z.string().optional(),
    nodes: z.array(nodeSchema),
  })),
})
export type ProcessPlan = z.infer<typeof planSchema>
export type PlanScope = ProcessPlan['scopes'][number]
