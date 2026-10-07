# Process Sequence module

The BPMN-era implementation notes previously stored here are superseded. The BPMN editor has
been removed; the current module uses structured sequences and a derived node-and-edge graph.
The historical implementation and verification notes remain in Git history.

Use these maintained documents:

- [Module guide](../aas-web-ui/src/pages/modules/ProcessSequence/README.md): authoring, material
  flow, capability matching, module boundaries and verification commands.
- [Production Sequence contract](../aas-web-ui/src/pages/modules/ProcessSequence/templates/README.md):
  native AAS structure, semantic IDs, ownership, references, overrides and migration.
- [Docker demo](../examples/ProcessSequence/README.md): hot reload, robot assembly and pharma recipes.
- [Product discovery and capabilities](processCapabilities.md): eligibility and matching conventions.
- [Shared assembly plans](sharedAssemblyPlans.md): editing the same definition from different roots.

Execution order belongs to Production Sequence. Process Parameters collection order does not
establish execution order, and ProcessId is not a standard BoM occurrence join key. Materials use
explicit references to BoM occurrences through ProcessBoM.
