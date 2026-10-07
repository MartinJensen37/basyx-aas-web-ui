# Process Sequence architecture

The initial September 2026 redesign proposal has been implemented and superseded by the
[module guide](../aas-web-ui/src/pages/modules/ProcessSequence/README.md) and
[Production Sequence contract](../aas-web-ui/src/pages/modules/ProcessSequence/templates/README.md).
Earlier proposals and their historical verification notes remain in Git history.

The current separation of responsibilities is:

- Hierarchical Structures owns the product composition and material occurrences.
- Process Parameters owns operation inputs and ProcessBoM material requirements.
- Capability Description owns required/offered capability descriptions and skill realization links.
- Production Sequence owns ordered steps, branches, calls, overrides and resource assignments.
- The graph projects that data; it does not store a second set of execution or material edges.

Each product, assembly or part stores its own sequence. Calls reference the next sequence submodel
directly; the parent does not duplicate child definitions. Process-only subprocesses also have their
own submodels. See [shared assembly plans](sharedAssemblyPlans.md).

Native AAS elements replace JSON Definition files for new saves. Compatibility readers remain for
older plans. The editor authors definitions and previews paths; it does not execute equipment or
schedule resources. The [flow rules proposal](../aas-web-ui/src/pages/modules/ProcessSequence/FLOW_RULES_PROPOSAL.md)
separates implemented decisions/optional flows from future events, repetition and execution.
