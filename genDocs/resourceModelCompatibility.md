# Resource model compatibility review

Reviewed 2026-10-08 against the live BaSyx repository at `http://localhost:8081`
and UI commit `1a96df6`. This is a read-only compatibility assessment; no resource,
product, sequence, or implementation was changed.

## Implementation follow-up

The UI now supports the ARSO Start operation contract, semantic input assignment,
effective-parameter capability matching, and optional InputReference/ResultReference
fields. Known historical pharma vocabulary IDs are mapped explicitly when read,
so existing demo data works without rewriting the resource models. The original
findings below describe the reviewed pre-adapter commit. Actual format and accuracy
limits remain in force; execution sessions and live result acquisition remain
outside this authoring module. See the module README for the current behavior.

## Conclusion

Keep CappingModuleAAS, FillingModuleAAS, InspectionModuleAAS and StopperingModuleAAS
as the resource contracts. Their capability descriptions are readable and their
skill links resolve. Production Sequence can already retain their assignments.
The UI needs an adapter for their operation-based skill structure, semantic
parameter binding, and resource result mappings. Existing demo capability
identifiers also need a deliberate migration.

## Evidence

- Ran the actual capability reader, skill reader, matcher and sequence codec on
  a snapshot of the server, using a temporary Vitest audit.
- All eight Skills/CapabilityDescription submodels parsed and passed the AAS
  SDK's recursive constraint verification. This is structural verification,
  not certification against every template or execution-system rule.
- All 43 ModelReferences in those submodels' ReferenceElements and
  RelationshipElements resolved, including operation-variable targets.
- Each resource yielded one offered capability, but zero skills through the
  current UI skill reader.
- All four corresponding process requirements in `Vial2mLAAS` matched their
  respective resource. Its saved sequence loads, and an in-memory conversion
  to the current sequence format preserved all four resource/skill assignments
  and the `Volume -> FillVolume` binding. The converted sequence passed AAS
  constraint verification.
- No equipment operations were invoked. Runtime communication, occupation,
  completion and measurement delivery were not tested.

## Resource contracts

All four declare `ContainerType = vial` and a grasp diameter of 6–30 mm.

| Resource | Capability / linked skill | Additional offer | Start recipe inputs | Start domain outputs |
| --- | --- | --- | --- | --- |
| CappingModuleAAS | Capping / Capping | Cap diameter 13–20 mm | None | None |
| FillingModuleAAS | Filling / Dispensing | Volume 0.5–10 mL; absolute fill error 0.05 mL | Volume | Weight (g) |
| InspectionModuleAAS | Inspection / Inspection | Inspection method: vision | None | TopPassed, SidePassed |
| StopperingModuleAAS | Stoppering / Stoppering | Stopper diameter 6–20 mm | None | None |

Every Start operation additionally takes Session and returns Accepted/ErrorID.
These are control-protocol fields. Accepted is not an inspection result or proof
of process completion. The resource models also expose lifecycle operations and
operational state; execution integration needs its own completion/result rules.
Physical capability ranges do not imply corresponding configurable Start inputs.

## Confirmed gaps

### 1. Skill discovery and assignment are blocked by the old reader

The resources use `https://smartproductionlab.aau.dk/ARSO/Skills/1/0/Submodel`.
Their structure is `Skills > <skill> > Start > Start` with AAS Operation variables.
The current [reader](../aas-web-ui/src/pages/modules/ProcessSequence/utils/readers.ts)
only recognizes collections containing the old SkillId field and Parameters
catalog. Resource discovery still succeeds through offered capabilities, but
the skill dropdown is empty and Match resources cannot complete assignment.

Adapt the reader to this explicit contract and use CapabilityRealizedBy as the
skill collection reference. Read input/output variables from the Start Operation.
Keep module-internal composite steps in the resource Skills submodel; they do not
need to be copied into the product's ProductionSequence.

### 2. Older pharma demos use different capability meanings

The resource capability meaning is, for example,
`https://smartproductionlab.aau.dk/semantics/Filling`. Existing pharma demos use
`https://smartproductionlab.aau.dk/demo/pharma/semantics/Filling`; their stored
property meanings also use that older namespace. These are different identifiers,
so the current matcher correctly reports no matching capability.

The generator still uses the old namespace for capability meanings, although it
now uses the shared vocabulary for property meanings. The seeder does not update
existing CapabilityDescription contents. Both the generator and a controlled
data migration need attention. Avoid matching arbitrary semantic IDs by suffix.

In an in-memory vocabulary-alignment experiment:

- Vial 2 mL, sampled vial 2 mL and vial 10 mL matched all four relevant resources.
- Syringes and cartridges still failed ContainerType because these resources
  currently declare vial support only.
- Syringe filling additionally failed accuracy: required maximum error 0.01 mL,
  offered error 0.05 mL.

The latter failures describe the declared resource envelope, not a UI parser bug.
`Vial2mLAAS` already uses the shared vocabulary and matches without this alignment.
It currently has no required AbsoluteFillError property, so its successful match
does not check a product accuracy requirement.

### 3. Matching ignores effective process-parameter edits

[matchCapabilities](../aas-web-ui/src/pages/modules/ProcessSequence/utils/capabilityMatching.ts)
compares the referenced CapabilityDescription properties. It does not receive
the operation's effective Process Parameters or sequence overrides.

Reproduced with an in-memory Vial2mLAAS change: setting FillVolume to 12 mL still
reported a match against the station's 0.5–10 mL range, because its required
capability still said 2 mL. Explicit semantic associations between effective
process parameters and capability constraints are needed. Independent tolerance
requirements must remain independent; do not overwrite every requirement value
with a similarly named process parameter.

### 4. Automatic input binding currently compares names

The resource input is named Volume, while the product parameter is FillVolume.
They share the FillVolume semantic meaning (primary on the product parameter,
supplemental on the skill input), but the UI's automatic assignment currently
compares only names. A reader adapter alone could therefore leave Volume at its
1 mL default for a 2 mL recipe.

The existing Vial2mLAAS sequence already has a correct explicit binding and keeps
it on round trip. Extend the parameter types/readers to retain semantic IDs, match
unambiguous compatible meanings and units, and retain explicit source/target
references. Session should be provided by execution context, not a recipe field.

### 5. Sequence outputs have no resource-result mapping

The current [output schema](../aas-web-ui/src/pages/modules/ProcessSequence/types/plan.ts)
stores a local ID, label, primitive type and unit. It has no reference to a skill
output or OperationalData element. Thus TopPassed/SidePassed cannot automatically
feed decisions, and Weight is not imported as a measured result. Weight in grams
also cannot be treated as filled volume in mL without an explicit conversion model.

Add output-reference mappings while retaining the stable local output IDs used
by decisions. Keep Accepted/ErrorID distinct from product quality results. The
authoring UI can expose these mappings without executing equipment.

## Suggested implementation order

1. Add an explicit ARSO skill adapter and preserve reference-based assignment.
2. Support semantic input binding and effective-parameter capability checks.
3. Align known demo vocabulary IDs while preserving authored recipe values.
4. Add skill-result references to sequence outputs and decision selection.
5. Separately establish supported container formats and execution protocol.

The existing product BoM, ProcessBoM material links, and hierarchical sequence
ownership do not need redesign to accommodate these four resource models.
