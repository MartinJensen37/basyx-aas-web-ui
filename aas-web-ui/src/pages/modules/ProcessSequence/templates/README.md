# Application Production Sequence 3.0

Semantic ID: `https://smartproductionlab.aau.dk/SubmodelTemplate/ProductionSequence/3/0`.
The submodel semantic ID identifies the contract version; no duplicate PlanSchema property is stored.

This is a project-owned authoring contract, not an IDTA publication. Element semantic IDs use `https://smartproductionlab.aau.dk/ProductionSequence/{Name}/1/0`; unchanged element meanings retain their identifiers. [ProductionSequence.json](ProductionSequence.json) is an AAS `kind=Template` example with cardinality qualifiers. Generate it with `pnpm exec node src/pages/modules/ProcessSequence/templates/generate.ts`.

## Ownership and references

Each product, assembly or part owns one primary sequence. It stores its own steps and references only its immediate dependencies. The Hierarchical Structures submodel owns the physical product tree; Production Sequence does not repeat it. A part without work has an empty Steps collection.

A subprocess authored within the same product is a nested SubmodelElementCollection inside its owner's ProductionSequence. The optional Subprocesses collection (semantic meaning `LocalSubprocesses`) contains direct `SubprocessDefinition` collections, including unfinished definitions that have not yet been called. Each definition contains its own Steps and optional nested Subprocesses. A call uses an AAS ModelReference with the root Submodel key and the complete collection path. Multiple calls reuse one definition. The new collection meanings have new semantic IDs; the former reference catalog's semantic ID is not reused.

Product-component calls still target that component's own sequence submodel. Its children are resolved recursively. Opening the component on its own edits the same definition shown from a parent product. A process-only subprocess belongs inside its owner's sequence; a separately owned assembly keeps its own submodel.

```text
Robot sequence:      parallel { call Drive sequence; call Control sequence }
                    -> Final assembly -> Functional test
Drive sequence:     Prepare housing -> Install motor -> call Drive inspection
Drive inspection:   Inspect drive
Control sequence:   Mount board -> Test electronics
```

There are no persisted Scopes, ParentScope or RootScope fields. The editor still uses an in-memory scope tree to compose the BoM, locally authored subprocesses and referenced assembly plans. It never writes that expanded tree back into the parent submodel.

## Structure and cardinalities

| Location | Fields |
| --- | --- |
| Root | Revision (nonnegative integer), SequenceId, Name, Role (`Primary`), Subject (owner AAS reference), Steps |
| Root, optional | Component occurrence and Subprocesses (direct local child definition collections) |
| SubprocessDefinition | SequenceId, Name, Steps; optional Component and nested Subprocesses; owner and revision inherited from root |
| Steps | Zero or more Step collections with NodeId, Kind, Name and unique nonnegative Order |
| Operation (`step`) | Optional ProcessReference; optional ParameterOverrides, MaterialOverrides, RequiredCapabilities, Resource, Skill, ExecutionMode, Outputs and Bindings; ProcessOwner only for a different AAS |
| Call (`call`) | SequenceReference (Submodel reference for a component or collection path for a local subprocess); optional OccurrenceId and Component for an external component occurrence |
| Optional (`conditional`) | Condition and nested Steps |
| Parallel (`parallel`) | At least two ordered Branch collections, each with BranchId, Name, Order and Steps |
| Decision (`decision`) | Condition and exactly two branches: Order 0 Yes and Order 1 No |
| ParameterOverride | ParameterReference, Value, DataType; optional Unit |
| Component | SourceElement (BoM occurrence), GlobalAssetId; SourceAas only when different from Subject |
| RequiredCapabilities | Zero or more RequiredCapability references with display names |
| Bindings | Zero or more Binding collections with Name and either constant Value or SourceElement; SourceAas only when different from Subject |

A new plan contains only root metadata and empty Steps. Draft operations may have no selected process. Local SequenceId values must be unique within an owner; NodeId values must be unique within a definition including branches. Sequence submodel IDs remain stable when labels change. Order determines execution order independently of collection array order. Containment, ownership and call cycles are invalid. Missing definitions and incompatible overrides are errors, not empty replacement plans.

Subject and Resource reference AASs. ProcessOwner defaults to Subject and is written only for a different source AAS; ProcessReference identifies the full Process Parameters collection path. ParameterReference identifies the original parameter. Capability references identify IDTA Capability elements; Skill identifies an offered skill catalog entry. Binding sources identify process parameters; an absent source uses the constant Value (including an explicit empty string). Reference bindings omit the inactive Value. SourceAas defaults to Subject. Skill is authoritative; the inspector selects its catalog entry by reference, without persisting a second identifier. A nonempty legacy SkillId without a reference is retained until reassigned, so unresolved older assignments are not silently discarded. Empty Bindings and Outputs are omitted. Explicit empty requirement/material overrides remain meaningful and are preserved. NodeId is stable identity, while Name is an editable label; they are not interchangeable.

## Defaults and overrides

Operations resolve the current Process Parameters definition. Unchanged parameter values, names, groups, units, material requirements and capability requirements are not copied into the sequence. Only changed parameter values are persisted in ParameterOverrides. Each override includes its datatype and unit so a later incompatible source change cannot silently reinterpret it. Changed material requirements use MaterialOverrides. RequiredCapabilities absence means inherit the process requirements; a present empty collection explicitly clears inherited requirements.

Parameter edits in the editor affect the sequence override, not the Process Parameters source. Reopening a plan follows updated source defaults for values without overrides. Legacy snapshot values that differ from current defaults become overrides during migration. Removed parameters and changed datatypes/units require reconciliation before migration. This is a live authoring model; it is not a frozen batch recipe or execution record.

A save compares loaded sequence documents and resolved process sources against the repository. Conflicts require reload. All local definitions are saved in one owner submodel; failed writes retain the remaining edits for retry. These checks are optimistic, not atomic repository transactions. Other assets' sequences are checked in their own editing session. Primary sequences are discovered by semantic ID and Role; the generated ID convention is only a fallback, not the reference contract. Multiple primary candidates are rejected as ambiguous.

## Migration

The reader accepts separate ProductionSequence 2.0 documents, older structured 1.0 and legacy JSON Definition attachments. On save it writes one 3.0 submodel per owner, preserving authored values, stable step IDs, control flow and assignments. After the owner document is saved, legacy local-subprocess links are detached from the owner AAS. Their repository documents remain available for existing external references. Existing attachment backups remain available but are no longer authoritative. The demo seeder backs up old definitions before migration and preserves edited demo recipes. Source Process Parameters, Hierarchical Structures and Capability Description schemas are unchanged.

## Matching convention

See the module README for the supported capability-property comparison rules. Numeric intervals are inclusive. FillVolume is a required setpoint against an offered range. AbsoluteFillError is a required acceptable interval against the station's declared error. Units use IEC 61360 data specifications. These comparison conventions and pharma property meanings belong to the application; the IDTA capability template supplies their structure.


## Periodic optional flow semantics

A conditional node contains its executable body in Steps. If the one-based product ordinal modulo EveryNProducts equals zero, execute the body and wait for it to finish; otherwise skip directly to the following node. The merge is exclusive, not an all-branches parallel join. Empty bodies are valid drafts and perform no work. Removing the wrapper preserves the body's original order.

CounterScope is the production run of the selected product plan. All subprocess calls and parallel branches inherit the same ordinal. The execution system owns the counter and must reuse it for retries; no mutable counter is stored in this template. A new run starts again at ordinal 1. A standalone assembly preview uses the ordinal of its own run. This rule does not mean every fifth station visit, fifth retry, or random 20-percent sampling.

EveryNProducts must be an integer from 1 to 9007199254740991; 1 means every product. Unknown condition types and counter scopes are rejected. No mutable counter is stored in the definition.

## Typed decisions and optional flows

A decision has exactly two ordered branches: Order 0 is Yes and Order 1 is No. Branch names are labels, not executable expressions. Evaluate once, execute exactly one branch, then merge that selected path. Conditional nodes keep their existing body/skip structure. Either node can use a periodic condition or the following comparison condition:

| Collection | Fields |
| --- | --- |
| Condition | ConditionType=`comparison`, Operator, Unit, Expected; optional Operand for an unfinished draft |
| Expected | DataType=`boolean`, `number` or `string`; Value typed `xs:boolean`, `xs:double` or `xs:string` respectively |
| Operand, OperandType=`parameter` | StepId and the SourceElement reference and optional SourceAas identifying an effective parameter in that operation |
| Operand, OperandType=`output` | StepId and OutputId identifying an operation output within the same scope |
| Operation Outputs | Zero or more Output collections containing OutputId, Name, DataType and Unit |

Operators are `eq`, `ne`, `gt`, `gte`, `lt`, `lte`. Ordered comparisons require numbers. Missing or incompatible values, removed sources, invalid numbers and mismatched units remain unresolved; they never select No or Skip. Unit conversion is not implicit. Output IDs are unique within an operation, and node IDs remain unique within a scope. Semantic IDs use the existing application namespace with the field names above. Display-name changes do not change references.

Operation outputs are declarations, not execution values. Preview results are scoped to each invocation and stay in browser component state. An output may be referenced after its operation, within its branch, and after an all-branches parallel join. A sibling parallel branch cannot consume it before the join. Outputs introduced inside decisions or optional flows cannot escape their selected-path merge until explicit merge mappings are implemented. Calls isolate output values; cross-subprocess mappings are not yet supported. A condition can read an effective parameter as a definition input independently of when that operation runs.

All these flow shapes are supported by Production Sequence 3.0. Unsupported semantic contract versions and unknown condition/node types are rejected rather than silently dropped.

Empty comparison operands are valid incomplete drafts. General expressions, event subscriptions, repeated execution, resource allocation, live measurements and execution history are outside this version's contract.


## Material use and diagram connections

ProcessBoM remains the source of operation material requirements. Its optional application extension uses a MaterialUse collection with semantic ID `https://smartproductionlab.aau.dk/ProcessParameters/MaterialUse/1/0`. Child fields use `https://smartproductionlab.aau.dk/ProcessParameters/MaterialUse/{Field}/1/0`:

| Field | Meaning |
| --- | --- |
| MaterialReference | ModelReference to the exact BoM Entity occurrence, including its full path |
| Role | `workpiece`, `incorporated`, `consumable`, or `output` |
| Quantity + Unit | Explicit quantity per operation invocation (e.g. 1 piece), never the overall BoM total |
| QuantityParameterReference | Alternative to Quantity/Unit: reference a parameter in this process and inherit its effective value and unit, including a sequence override |

Use either Quantity/Unit or QuantityParameterReference. For a reusable process in two filling cycles, each invocation resolves its own effective volume. Each stoppering cycle uses one stopper even when the overall BoM lists two. Workpiece indicates the existing item being processed; it must not be counted as a newly consumed part at each operation. Produced material is separate from measured operation Outputs.

The graph derives material cards and edges at runtime. Added components and consumables point into the operation, produced materials point out, and workpieces use neutral connections without consumption arrows. Legacy plain references appear as Linked material. If the referenced BoM occurrence declares BulkCount, the card shows that count explicitly labelled BoM; it does not become a per-step consumption quantity. Names resolve from the mounted BoM occurrences, with displayName/path fallbacks. Clicking a material shows its occurrence and opens the part's sequence when available. Hide materials only changes the view.

The same roles and quantities appear under Process inputs / Process materials. Sequence storage inherits ProcessBoM and only persists MaterialOverrides when requirements differ. Layout positions, resolved labels and material graph edges are never saved in the sequence. The diagram is an authoring view; it does not calculate inventory, material balances, lot traceability or implicit dependencies between branches.

### BoM count versus operation quantity

The reader resolves `https://admin-shell.io/idta/HierarchicalStructures/BulkCount/1/0` on the referenced
Entity by semantic ID. It accepts a single `xs:unsignedLong` Property and preserves integer precision,
including zero. Missing counts stay unknown; invalid counts produce a diagnostic. Counts refer to the
specific occurrence, not every occurrence of the same asset. Parent counts are not multiplied into
material cards. The current tree reader follows nested Entity statements; it does not reconstruct an
arbitrary HasPart/IsPartOf relationship graph.

[IDTA 02011-1-1, pages 11 and 18](https://industrialdigitaltwin.org/en/wp-content/uploads/sites/2/2024/06/IDTA-02011-1-1_Submodel_HierarchicalStructuresEnablingBoM.pdf)
restricts BulkCount to type assets. It is a component multiplicity, not a mass or volume. Pharma solids
use BulkCount; liquid quantities retain their domain units. The demo migration converts only known
legacy piece counts and preserves their edited values and any existing standard count.

ProcessBoM identifies the material occurrence participating in a process. Production Sequence invokes
that process at a particular position. MaterialUse adds its role and per-invocation allocation; it is an
application extension. Explicit Quantity or QuantityParameterReference takes precedence on the card.
The details dialog also shows the BoM count. For two stoppers used in separate cycles, BulkCount is 2
and each Stoppering operation allocates 1. A plain link alone cannot establish this split, consumption,
or a material balance. Missing step allocations remain unallocated even when the BoM count is known.

BoM counts are live display metadata. They are loaded again with Reload plans and are not copied into
Production Sequence documents or inferred as material overrides.

## AAS conventions

Semantic IDs describe meaning using ExternalReference / GlobalReference; they do not locate instances. ModelReferences locate instances using a globally identified Submodel followed by each nested element's idShort and key type. Readers identify fields by semantic ID, so a renamed idShort works when reference paths are updated. Collections have unique idShort values. Steps and branches keep explicit Order because SubmodelElementCollection array order has no execution meaning. SequenceId and NodeId preserve editor identities independently of labels and collection placement. The AAS SDK verifies the generated structure; repository tests verify reference resolution and round trips. These checks do not make this project-owned contract a published IDTA template.

See the [AAS metamodel's submodel element definitions](https://industrialdigitaltwin.io/aas-specifications/IDTA-01001/v3.1.2/spec-metamodel/submodel-elements.html).
