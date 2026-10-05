# Process Sequence module

Open `/modules/processsequence` without selecting a submodel. **Product to plan** lists AASs with the exact IDTA 02031-1 Process Parameters Type semantic ID. Names and arbitrary files do not qualify a product.

The left tree selects a product, material occurrence or subprocess. The graph contains ordered operations, subprocess calls and parallel branches with an all-branches join, and optional flows with a Run/Skip choice. Selecting a node opens process parameters, material references, capability requirements and station/skill bindings in the inspector. **Combined steps** expands calls and shows precedence for a chosen product number. Cyclic calls are rejected.

Each assembly AAS owns one canonical sequence. A parent material occurrence references that owner; it does not duplicate the child steps. Editing an assembly directly or through its parent saves the same definition. Missing sequences start empty. Shared parts can occur in several products. Save before changing product; browser drafts recover quietly within the same tab. **Reload plans** archives the current browser draft and loads the server version. There are no draft-download reminders or BPMN editor.

## Data contracts

| Submodel | Responsibility |
| --- | --- |
| IDTA 02011 Hierarchical Structures | Product composition and material occurrence references |
| IDTA 02031-1 Process Parameters Type | Available processes, product/process/resource parameters and ProcessBoM |
| IDTA 02020 Capability Description | Required and offered capabilities, properties, role qualifiers and skill realization references |
| Application Production Sequence 1.0 | Ordered operations, calls, branches, snapshots, requirement overrides and assignments |
| Application Skills 1.0 | Station skills and their parameter interfaces |

The IDTA Process Parameters semantic ID is exactly `https://admin-shell-io/idta/SubmodelTemplate/ProcessParameters/1/0`; the hostname spelling is intentional. Required-capability links inside Process collections are an application extension: `https://smartproductionlab.aau.dk/ProcessParameters/RequiredCapability/1/0`. These are repeatable ReferenceElements pointing to Required-role Capability elements. They do not replace or redefine IDTA fields.

Production Sequence and Skills are application templates, not published IDTA standards. See [the sequence contract](templates/README.md) and [machine-readable AAS template](templates/ProductionSequence.json). Saving writes native AAS collections, properties and references visible in the normal AAS viewer. Older JSON Definition attachments are readable and retained when migrated; subsequent saves use structured elements.

## Capability matching

Capability meanings come from supplemental semantic IDs. Required/Offered roles use the IDTA boolean role qualifiers. Matching requires one complete offered capability to satisfy each requirement; properties from incompatible station configurations are never combined. Property identities also use supplemental semantic IDs.

A required scalar must lie within an offered numeric interval. A required interval describes acceptable results: an offered scalar must lie within it (for example, maximum permitted absolute fill error). String values must agree. Units must match exactly. Missing properties, unknown datatypes, unverified unit conversions, range-to-range comparisons and additional constraints produce **Needs verification**. Matching does not reserve equipment or execute skills.

The inspector shows station comparisons and can assign a skill through the capability's `CapabilityRealizedBy` relationship. A step can inherit process requirements or override them; an explicit empty override removes requirements for that occurrence. Manual operations have no station assignment.

The blue **Match resources** button in the Capabilities box opens a chooser for all candidate stations. Each match has a visible **Use resource** button; **Comparison details** expands its property checks. When several stations match, choose one explicitly. The plan stores one selected resource/skill per step; it does not store an alternative-resource pool or schedule by station availability. Assignment requires a single skill linked to all matched capabilities. **No resource** clears the assignment, skill reference and bindings, and can be saved for later planning.

Selection details group product, process and resource parameters by color. Section help, parameter datatypes and capability reference paths are available in tooltips. Planning-check summaries are omitted from the panel; structural validation still runs when saving.

## Persistence and integration

Only this module, its tests and the example environment implement this feature. `index.vue` uses the existing module metadata/autodiscovery convention. The application router, stores, viewers and root build configuration are unchanged. The optional Docker dev optimizer is contained in `dev/vite.config.mts`.

Before saving, all changed assembly definitions are compared with their loaded server versions. Descendants save before parents. Failed saves retain edits. This is optimistic conflict detection, not a repository transaction or atomic compare-and-swap: truly simultaneous writes can still race. Reload after another editor saves. Process inputs and capability submodels remain source data; the plan stores a snapshot and references, and does not rewrite them.

## Demo and checks

See [Docker setup and pharma recipes](../../../../../examples/ProcessSequence/README.md). From `aas-web-ui`:

```sh
pnpm exec eslint src/pages/modules/ProcessSequence tests/pages/modules/ProcessSequence tests/integration/process-*.pw.ts --max-warnings=0
pnpm run type-check
pnpm exec vitest run src/pages/modules/ProcessSequence tests/pages/modules/ProcessSequence
```

Browser tests use the current checkout UI and a disposable repository: set `IT_DISABLE_WEBSERVER=true`, `IT_PORT=3000`, `IT_BASE_PATH=/`, `PS_REPO_URL=http://localhost:8081`, and optionally `IT_BROWSER_CHANNEL=chrome`; run `pnpm exec playwright test tests/integration/process-plan.pw.ts tests/integration/process-hierarchy.pw.ts tests/integration/process-pharma.pw.ts --project integration-core`.


## Periodic inspection and optional flows

Select an inspection step and choose **Make optional**. Set **Run every N products** to 5 to inspect products 5, 10, 15, etc. in each production run. The graph shows the inspection path and a skip path that rejoins before the next operation. **Run every product** removes the condition and preserves its operations. **Optional flow** in the toolbar creates an empty conditional flow; select **Run this flow** to add steps or subprocess calls inside it. Parallel groups and nested optional flows are also supported.

The product number is one-based and belongs to the current production run. Every called subprocess receives the same product number; entering a subprocess or retrying an operation does not advance the counter. Nested intervals must both match. This is a plan definition: the execution system must supply and preserve the product ordinal across retries and reset it when starting a new run. No live equipment counter is simulated by the editor.

In **Combined steps**, change **Product number in run** to preview both paths. Skipped operations do not become required predecessors. The saved condition is an AAS collection with semantic IDs for ConditionType, EveryNProducts and CounterScope. Definitions containing optional flows use PlanSchema `process-sequence-plan/4.0`; older 2.0/3.0 plans remain readable. See the template contract for details.

The prepared **Vial 2 mL - inspection every 5** recipe demonstrates this flow without changing the existing recipes.
