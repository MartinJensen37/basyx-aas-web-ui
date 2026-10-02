# Application Production Sequence 1.0

Semantic ID: `https://smartproductionlab.aau.dk/SubmodelTemplate/ProductionSequence/1/0`.

Element semantic IDs use `https://smartproductionlab.aau.dk/ProductionSequence/{Name}/1/0`. This is a project-owned authoring contract, not an IDTA publication. [ProductionSequence.json](ProductionSequence.json) is an AAS `kind=Template` example with cardinality qualifiers and all three conditional node shapes. Concrete example values illustrate the fields. Generate it with `pnpm exec node src/pages/modules/ProcessSequence/templates/generate.ts` from the application directory.

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
| Step, Kind=parallel | Branches containing at least two Branch collections; no operation or call fields |
| Branch | BranchId, Name, unique Order and recursive Steps collection |
| Process snapshot | ProcessId, Name, SourceAas, SourceElement, Parameters, Materials; optional RequiredCapabilities |
| Parameter | Name, Group, DataType, Value, SourceAas, SourceElement |
| RequiredCapabilities | Zero or more RequiredCapability references with display names |
| Bindings | Zero or more Binding collections with Name and Value; optional paired SourceAas/SourceElement |

Cardinality qualifiers express local multiplicity; the conditional and graph constraints in this document are also normative. Scopes has at least one entry, even though the repeatable Scope prototype uses ZeroToMany to allow additional scopes. SourceAas/SourceElement are mandatory together in snapshots and materials, and optional together for constant bindings. ExecutionMode is `station` (default when absent) or `manual`.

An empty plan has its product/root references, revision zero, one root scope, and an empty Steps collection. No operation, capability or material is invented. Scopes and nodes have stable IDs independent of their AAS idShorts. Step and branch Order values determine execution order; collection array order is not an execution contract. Scope IDs are unique within a definition; node IDs are unique within a scope including its branches. Every non-root scope has an existing parent; parent and call cycles are invalid.

Operations execute in order. A call waits for its entire target sequence. Parallel branches all start after their predecessor and join before the following operation. This template supports structured fork/join, not arbitrary cycles or conditional gateways. It represents an editable plan, not execution history, station availability or a pharmaceutical batch record.

## References and ownership

Product and Resource reference AASs. Process SourceElement references the full Process Parameters path. Material SourceElement references a BoM Entity occurrence. RequiredCapability points to the full IDTA Capability element path. Skill points to a skill catalog entry, linked from offered capabilities using IDTA CapabilityRealizedBy. Binding sources identify process parameters; a null source means the constant Value is used.

Process snapshots retain all three parameter groups and ProcessBoM elements for inspection. Relinking a process refreshes its snapshot. Requirement absence means inherit the snapshot's requirements; a present but empty RequiredCapabilities collection is an explicit override. The template links these concerns rather than embedding a second Capability Description schema.

SharedPlanOwner points to another product/part AAS. Its canonical submodel identifier is `https://smartproductionlab.aau.dk/sm/process-plan/{base64url(AAS-id)}`. Such a material scope stores no child steps. The editor loads that owner's root and descendants, retaining the parent's occurrence identity. A call references the local occurrence; editing the mounted content updates its owner. Saving a parent never serializes the composed child definitions into it. Ownership cycles are rejected.

Revision increments on save. Legacy JSON plans are migrated on save, preserving attachments as backups; only structured AAS elements remain authoritative. The wire PlanSchema supports existing `process-sequence-plan/2.0` graphs and shared-owner `process-sequence-plan/3.0` graphs; both are serialized using this AAS template.

## Matching convention

See the module README for the supported capability-property comparison rules. Numeric intervals are inclusive. FillVolume is a required setpoint against an offered range. AbsoluteFillError is a required acceptable interval against the station's declared error. Units use IEC 61360 data specifications. These comparison conventions and pharma property meanings belong to the application; the IDTA capability template supplies their structure.
