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
  dataType: z.string(), value: z.string(), source: sourceSchema,
})
const processSchema = z.object({
  processId: z.string(), name: z.string(), source: sourceSchema,
  parameters: z.array(parameterSchema), material: z.array(z.unknown()),
  requiredCapabilities: z.array(requirementSchema).optional(),
})
const bindingSchema = z.object({ name: z.string(), value: z.string(), source: sourceSchema.nullable() })

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
}
export type CallNode = { id: string, kind: 'call', name: string, scopeId: string }
export type ParallelNode = { id: string, kind: 'parallel', name: string, branches: PlanBranch[] }
export type PlanNode = StepNode | CallNode | ParallelNode
export type PlanBranch = { id: string, name: string, nodes: PlanNode[] }

const nodeSchema: z.ZodType<PlanNode> = z.lazy(() => z.discriminatedUnion('kind', [
  z.object({
    id: z.string().min(1), kind: z.literal('step'), name: z.string(), process: processSchema.nullable(),
    resourceAasId: z.string(), skillId: z.string(), bindings: z.array(bindingSchema),
    skillReference: capabilityReferenceSchema.optional(),
    executionMode: z.enum(['manual', 'station']).optional(),
    requiredCapabilities: z.array(requirementSchema).optional(),
  }),
  z.object({ id: z.string().min(1), kind: z.literal('call'), name: z.string(), scopeId: z.string() }),
  z.object({
    id: z.string().min(1), kind: z.literal('parallel'), name: z.string(),
    branches: z.array(z.object({ id: z.string(), name: z.string(), nodes: z.array(nodeSchema) })).min(2),
  }),
]))

export const planSchema = z.object({
  schema: z.enum(['process-sequence-plan/2.0', 'process-sequence-plan/3.0']),
  productAasId: z.string().min(1),
  revision: z.number().int().nonnegative(),
  rootScopeId: z.string(),
  /** Revision vector for composed browser drafts; omitted from each stored definition. */
  linkedRevisions: z.record(z.string(), z.number().int().nonnegative()).optional(),
  scopes: z.array(z.object({
    id: z.string().min(1), name: z.string(), parentId: z.string().nullable(),
    material: sourceSchema.extend({ globalAssetId: z.string() }).nullable(),
    /** This occurrence uses the root sequence owned by another product/assembly AAS. */
    planAasId: z.string().min(1).optional(),
    nodes: z.array(nodeSchema),
  })),
})
export type ProcessPlan = z.infer<typeof planSchema>
export type PlanScope = ProcessPlan['scopes'][number]
