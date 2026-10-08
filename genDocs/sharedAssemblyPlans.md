# Shared assembly plans

The selected product is the root of the current view. Each product, assembly or part owns its own
ProductionSequence submodel. A parent calls the child's sequence through a direct SequenceReference;
opening the child separately edits the same definition. The BoM supplies the physical hierarchy.

The [Production Sequence contract](../aas-web-ui/src/pages/modules/ProcessSequence/templates/README.md)
is the authoritative description of the stored structure and migration. It uses submodel semantic version
`ProductionSequence/3/0`. Earlier scope-based and JSON definitions are read for compatibility.

## Ownership

A selectable product has a Process Parameters Type submodel with the published semantic ID.
Hierarchical Structures supplies its material occurrences and links to child assets. A missing
sequence starts empty; an explicitly referenced but missing definition is an error. Capability
Description supplies additional required/offered capability information for matching.

Each sequence stores only its own Steps and direct references. Process-only subprocesses are
nested collections under Subprocesses in the same owner submodel. Calls reference those
collection paths and reuse the definitions. There are no persisted Scopes, ParentScope or RootScope fields in the current contract.
The editor composes an in-memory scope tree for navigation and editing.

## Editing and persistence

Selecting a shared assembly identifies its owner above the editor. Edits made through a parent or
through the standalone assembly view save to that owner. Repeated occurrences synchronize within
the open workspace. Execution expansion still distinguishes separate calls and parallel prerequisites.

Save draft writes changed definitions to their owners, descendants before parents. Unchanged parents
do not need a new revision when only a child changes. Reopening a parent loads saved child definitions.
Reload plans loads server state and archives the browser draft. Save before changing viewpoints to
make edits available in another view.

Saves compare loaded sequence documents and resolved process sources with the repository. Conflicts
require reload. These checks are optimistic, not atomic transactions; partial failures retain remaining
edits for retry. Editing is disabled during save. Cycles and missing explicitly linked definitions
stop loading rather than becoming empty replacements.

## Examples and verification

The [Docker demo](../examples/ProcessSequence/README.md) includes a robot that builds drive/control
assemblies in parallel and pharma recipes with independently addressable parts. The seed service
preserves edited definitions and migrates supported legacy formats. Existing backups are retained.

Unit and browser tests cover parent/standalone edits, nested subprocesses, repeated occurrences,
revision conflicts, partial-save retries, cycles, missing links and migration. Run commands are in the
[module guide](../aas-web-ui/src/pages/modules/ProcessSequence/README.md#demo-and-checks).
