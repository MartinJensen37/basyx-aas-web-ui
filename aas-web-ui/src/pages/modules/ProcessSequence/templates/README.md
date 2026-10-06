# Application Production Sequence 1.0

Semantic ID: `https://smartproductionlab.aau.dk/SubmodelTemplate/ProductionSequence/1/0`.

Element semantic IDs use `https://smartproductionlab.aau.dk/ProductionSequence/{Name}/1/0`. This is a project-owned authoring contract, not an IDTA publication. [ProductionSequence.json](ProductionSequence.json) is an AAS `kind=Template` example with cardinality qualifiers and all five node shapes. Concrete example values illustrate the fields. Generate it with `pnpm exec node src/pages/modules/ProcessSequence/templates/generate.ts` from the application directory.

## Structure and cardinalities

| Location | Required structure |
| --- | --- |
| Root | PlanSchema string, Revision nonnegative integer, Product AAS reference, RootScope local reference, Scopes collection |
| Scopes | One or more Scope collections, including exactly one root |
| Scope | ScopeId and Name strings; Steps collection; optional ParentScope, Material and SharedPlanOwner |
| Material | SourceAas reference, SourceElement reference to a BoM occurrence, GlobalAssetId string |
| Steps | Zero or more Step collections; each has NodeId, Kind, Name and unique nonnegative Order |
| Step, Kind=step | Optional Process, RequiredCapabilities, Resource, Skill, ExecutionMode; SkillId string and Bindings collection |
| Step, Kind=call | CalledScope reference to a local scope; no operation or branch fields |
| Step, Kind=conditional | Condition collection and recursive Steps; no operation, call or parallel branch fields |
| Condition | ConditionType=`everyNthProduct`, EveryNProducts positive safe integer, CounterScope=`productionRun` |
| Step, Kind=parallel | Branches containing at least two Branch collections; no operation or call fields |
| Step, Kind=decision (5.0) | Condition and exactly two Branches, ordered Yes then No; no operation or call fields |
| Branch | BranchId, Name, unique Order and recursive Steps collection |
| Process snapshot | ProcessId, Name, SourceAas, SourceElement, Parameters, Materials; optional RequiredCapabilities |
| Parameter | Name, Group, DataType, Value, SourceAas, SourceElement |
| Parameter (5.0 addition) | Optional Unit string from the source's IEC 61360 data specification |
| RequiredCapabilities | Zero or more RequiredCapability references with display names |
| Bindings | Zero or more Binding collections with Name and Value; optional paired SourceAas/SourceElement |

PlanSchema 5.0 extends the Condition and operation fields as detailed below; the periodic-only Condition row describes earlier versions.

Cardinality qualifiers express local multiplicity; the conditional and graph constraints in this document are also normative. Scopes has at least one entry, even though the repeatable Scope prototype uses ZeroToMany to allow additional scopes. SourceAas/SourceElement are mandatory together in snapshots and materials, and optional together for constant bindings. ExecutionMode is `station` (default when absent) or `manual`.

An empty plan has its product/root references, revision zero, one root scope, and an empty Steps collection. No operation, capability or material is invented. Scopes and nodes have stable IDs independent of their AAS idShorts. Step and branch Order values determine execution order; collection array order is not an execution contract. Scope IDs are unique within a definition; node IDs are unique within a scope including its branches. Every non-root scope has an existing parent; parent and call cycles are invalid.

Operations execute in order. A call waits for its entire target sequence. Parallel branches all start after their predecessor and join before the following operation. This template supports structured fork/join and periodic optional flows, and typed comparisons (PlanSchema 5.0 below), but not arbitrary cycles or executable scripts. It represents an editable plan, not execution history, station availability or a pharmaceutical batch record.

## References and ownership

Product and Resource reference AASs. Process SourceElement references the full Process Parameters path. Material SourceElement references a BoM Entity occurrence. RequiredCapability points to the full IDTA Capability element path. Skill points to a skill catalog entry, linked from offered capabilities using IDTA CapabilityRealizedBy. Binding sources identify process parameters; a null source means the constant Value is used.

Process snapshots retain all three parameter groups and ProcessBoM elements for inspection. Relinking a process refreshes its snapshot. Requirement absence means inherit the snapshot's requirements; a present but empty RequiredCapabilities collection is an explicit override. The template links these concerns rather than embedding a second Capability Description schema.

SharedPlanOwner points to another product/part AAS. Its canonical submodel identifier is `https://smartproductionlab.aau.dk/sm/process-plan/{base64url(AAS-id)}`. Such a material scope stores no child steps. The editor loads that owner's root and descendants, retaining the parent's occurrence identity. A call references the local occurrence; editing the mounted content updates its owner. Saving a parent never serializes the composed child definitions into it. Ownership cycles are rejected.

Revision increments on save. Legacy JSON plans are migrated on save, preserving attachments as backups; only structured AAS elements remain authoritative. The wire PlanSchema supports existing `process-sequence-plan/2.0` graphs, shared-owner `process-sequence-plan/3.0` graphs, and `process-sequence-plan/4.0` graphs with optional flows; all are serialized using this AAS template.

## Matching convention

See the module README for the supported capability-property comparison rules. Numeric intervals are inclusive. FillVolume is a required setpoint against an offered range. AbsoluteFillError is a required acceptable interval against the station's declared error. Units use IEC 61360 data specifications. These comparison conventions and pharma property meanings belong to the application; the IDTA capability template supplies their structure.


## Periodic optional flow semantics (PlanSchema 4.0)

A conditional node contains its executable body in Steps. If the one-based product ordinal modulo EveryNProducts equals zero, execute the body and wait for it to finish; otherwise skip directly to the following node. The merge is exclusive, not an all-branches parallel join. Empty bodies are valid drafts and perform no work. Removing the wrapper preserves the body's original order.

CounterScope is the production run of the selected product plan. All subprocess calls and parallel branches inherit the same ordinal. The execution system owns the counter and must reuse it for retries; no mutable counter is stored in this template. A new run starts again at ordinal 1. A standalone assembly preview uses the ordinal of its own run. This rule does not mean every fifth station visit, fifth retry, or random 20-percent sampling.

EveryNProducts must be an integer from 1 to 9007199254740991; 1 means every product. Unknown condition types and counter scopes are rejected. The common root and element semantic IDs remain stable; the PlanSchema value explicitly gates support for the new conditional node shape. Older editors reject 4.0 rather than silently dropping its rule. Existing 2.0/3.0 definitions are upgraded when a conditional flow is added; shared owners retain their own schema versions. Rule elements use the existing element namespace with names Condition, ConditionType, EveryNProducts and CounterScope.

## Typed decisions and optional flows (PlanSchema 5.0)

A decision has exactly two ordered branches: Order 0 is Yes and Order 1 is No. Branch names are labels, not executable expressions. Evaluate once, execute exactly one branch, then merge that selected path. Conditional nodes keep their existing body/skip structure. Either node can use a periodic condition or the following comparison condition:

| Collection | Fields |
| --- | --- |
| Condition | ConditionType=`comparison`, Operator, Unit, Expected; optional Operand for an unfinished draft |
| Expected | DataType=`boolean`, `number` or `string`; Value typed `xs:boolean`, `xs:double` or `xs:string` respectively |
| Operand, OperandType=`parameter` | StepId and the paired SourceAas/SourceElement references identifying a parameter snapshot in that operation |
| Operand, OperandType=`output` | StepId and OutputId identifying an operation output within the same scope |
| Operation Outputs | Zero or more Output collections containing OutputId, Name, DataType and Unit |

Operators are `eq`, `ne`, `gt`, `gte`, `lt`, `lte`. Ordered comparisons require numbers. Missing or incompatible values, removed sources, invalid numbers and mismatched units remain unresolved; they never select No or Skip. Unit conversion is not implicit. Output IDs are unique within an operation, and node IDs remain unique within a scope. Semantic IDs use the existing application namespace with the field names above. Display-name changes do not change references.

Operation outputs are declarations, not execution values. Preview results are scoped to each invocation and stay in browser component state. An output may be referenced after its operation, within its branch, and after an all-branches parallel join. A sibling parallel branch cannot consume it before the join. Outputs introduced inside decisions or optional flows cannot escape their selected-path merge until explicit merge mappings are implemented. Calls isolate output values; cross-subprocess mappings are not yet supported. A condition can read a parameter snapshot as a definition input independently of when that operation runs.

New decisions, comparison conditions, output declarations and parameter unit snapshots upgrade the owning definition to 5.0. Existing 2.0/3.0/4.0 plans retain their behavior. Composed views can require 5.0 while a stored parent only containing calls remains at an earlier version. Shared definitions are serialized independently. Unsupported future PlanSchema values and unknown condition/node types are rejected rather than silently dropped. The root semantic ID is unchanged.

Empty comparison operands are valid incomplete drafts. General expressions, event subscriptions, repeated execution, resource allocation, live measurements and execution history are outside this version's contract.
