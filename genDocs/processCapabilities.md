# Product discovery and capability requirements

The Assembly processes editor keeps three distinct concerns: IDTA 02031-1 holds process inputs,
IDTA 02020 describes capabilities, and ProcessSequencePlan holds the authored order, parallel branches,
subprocess calls and assignments. The SmartFactory Production Plan plugin uses a different contract;
it is not required by this editor and no projection to that format is generated.

## Product discovery

Open `/modules/processsequence` directly or through Modules, then choose **Product to plan**.
The selector lists AASs with an attached submodel whose semantic ID is exactly
`https://admin-shell-io/idta/SubmodelTemplate/ProcessParameters/1/0`.
The unusual `admin-shell-io` spelling is from the published template and is intentional.
This is the application's eligibility rule for products and assemblies, not a universal product
classification semantic ID. A name such as ProcessParameters, a File, or an execution-history
submodel does not qualify an AAS. Renaming the submodel does not prevent discovery.

Process children are read by their IDTA semantic IDs. The standard element prefix is
`https://admin-shell.io/idta/ProcessParameters/`, followed by `Processes`, `Process`, `ProcessId`,
`ProcessName`, `ProcessDescription`, `PlannedProcessTime`, `ProductParameters`, `ProcessParameters`,
`ResourceParameters` or `ProcessBoM`, then `/1/0`. Model references retain actual idShort paths,
including renamed collections. Unsigned legacy children can still be read by name; a conflicting
semantic ID never falls back to a matching name. Parameter leaves use domain-specific meanings,
not invented IDTA parameter identifiers.

## Connecting the templates

IDTA 02020 explicitly covers required capabilities of products/processes and offered capabilities
of resources. Its structure is:

```text
CapabilityDescription
  CapabilitySet (one or more)
    CapabilityContainer (one or more)
      Capability
        semanticId: .../CapabilityDescription/Capability/1/0
        supplementalSemanticIds: domain meanings, e.g. drilling
        qualifier: Required=true OR Offered=true OR NotAssigned=true
      PropertySet / CapabilityRelations (optional)
```

The submodel semantic ID is
`https://admin-shell.io/idta/SubmodelTemplate/CapabilityDescription/1/0`.
Set, container and capability elements use the prefix
`https://admin-shell.io/idta/CapabilityDescription/`, their element name, and `/1/0`.
Role qualifiers use that prefix plus `CapabilityRoleQualifier/Required/1/0`,
`CapabilityRoleQualifier/Offered/1/0` or `CapabilityRoleQualifier/NotAssigned/1/0`.
Use `kind: ValueQualifier`, `valueType: xs:boolean`, and value `true` or `1` for the active role.
The specification PDF clarifies the boolean datatype; the template JSON contains placeholder strings.

Process Parameters does not define a required-capability field. Each process therefore has zero or
more **application extension** ReferenceElements with this semantic ID:

`https://smartproductionlab.aau.dk/ProcessParameters/RequiredCapability/1/0`

Use unique idShorts such as RequiredCapability01 and RequiredCapability02. Each value is an AAS
ModelReference to the required Capability element in the owning product/assembly's Capability
Description submodel:

```json
{
  "type": "ModelReference",
  "keys": [
    { "type": "Submodel", "value": "urn:product:capability-description" },
    { "type": "SubmodelElementCollection", "value": "CapabilitySet" },
    { "type": "SubmodelElementCollection", "value": "Assembly" },
    { "type": "Capability", "value": "Capability" }
  ]
}
```

This extends the process collection without changing the mandatory IDTA fields or pretending the
extension is part of IDTA 02031. ResourceParameters remains the template's resource-parameter
collection. Keep reusable capability properties and constraints in Capability Description. If a
deployment forbids additional elements in a template instance, use the plan's step requirements
without extending its source Process Parameters submodel.

## Editor behavior and matching limits

Linking a process inherits its required capability references. **Required capabilities** can select
multiple Required-role descriptions belonging to the current product or the linked process's AAS.
Changes override requirements for this step occurrence; **Use process requirements** restores
inheritance. These edits are saved in the plan, not written back into shared source submodels.
An empty override explicitly removes requirements; an absent override inherits. Older plans with
no capability field remain readable and gain missing source requirements when that assembly's
inputs load. Existing explicit requirements are preserved. Unresolved saved references remain visible
and survive saving.

Semantic candidates must offer a matching supplemental semantic ID for **every** requirement.
The generic IDTA Capability semantic ID is never used as a capability meaning. Unresolved references,
missing meanings or unassigned/contradictory roles cannot establish a match. Legacy direct external
capability references are supported. Candidates do not imply that properties, ranges, constraints,
capability composition, scheduling, skills or availability have been verified. The reader also preserves
standard CapabilityRealizedBy links; the demo links these to its existing application-specific Skills
submodel. The editor's skill binding remains an explicit separate selection.

## Demo migration and verification

The demo has required descriptions on the robot and both assemblies, and offered descriptions on
the three resource cells. Domain identities are demonstration URIs under
`https://smartproductionlab.aau.dk/demo/process-plan/capability/`; they are not an industrial ontology.
Reseeding adds missing objects/references and corrects the known demo inputs' template semantics
without replacing scalar values, custom elements or the stored plan attachment.

Unit tests cover renamed fields, conflicting meanings, role qualifiers, all-requirement matching,
unresolved references, draft round trips, strict product discovery and idempotent migration. The
browser integration test opens the standalone module, filters products, changes requirements,
saves and reloads them through the running checkout's Docker UI.

## Authoritative references

- [IDTA 02031-1 Process Parameters Type template and specification](https://github.com/admin-shell-io/submodel-templates/tree/main/published/Process%20Parameters%20Type/1/0)
- [IDTA 02020 Capability Description specification and template](https://github.com/admin-shell-io/submodel-templates/tree/main/published/Capability%20Description/1/0), especially sections 1.2, 1.8.3, and Capability / CapabilityRoleQualifier.
- [BaSyx SmartFactory Production Plan plugin contract](https://wiki.basyx.org/en/latest/content/user_documentation/basyx_components/web_ui/features/plugins/production_plan.html)
