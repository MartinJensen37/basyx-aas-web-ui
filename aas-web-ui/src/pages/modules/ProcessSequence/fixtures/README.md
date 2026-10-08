# ARSO resource fixture

`arsoResources.ts` reproduces the planning-relevant structure of CappingModuleAAS,
FillingModuleAAS, InspectionModuleAAS, StopperingModuleAAS and Vial2mLAAS inspected
on the local BaSyx server on 2026-10-08. It retains their exact semantic identifiers,
skill/Start/Operation nesting, input/output names, datatypes, units, limits and
capability-to-skill reference paths. It deliberately excludes invocation endpoints,
composite internals, control state and unrelated submodels.

Unit tests check semantic input binding, effective recipe matching, protocol-field
exclusion, uncertainty, AAS validity and reference persistence. The browser test
rewrites AAS/submodel identifiers into its own namespace and cleans those fixtures
up afterward. It does not modify the live resources or invoke any operations.
