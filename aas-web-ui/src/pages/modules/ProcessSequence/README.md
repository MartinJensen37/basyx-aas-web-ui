# Process Sequence module

The [flow rules proposal](FLOW_RULES_PROPOSAL.md) describes the broader direction. Its first increment is implemented: a unified step editor, Boolean decisions, comparison-based optional flows and simulated operation outputs. Events, repetition and execution remain future work.

Open `/modules/processsequence` without selecting a submodel. **Product to plan** lists AASs with the exact IDTA 02031-1 Process Parameters Type semantic ID. Names and arbitrary files do not qualify a product.

The left tree selects a product, material occurrence or subprocess. Use **Add step**, then **Step type** to choose Operation, Subprocess, Decision, Parallel or Optional. The graph generates all-branch parallel joins and selected-path decision merges. The type dropdown on each diagram card changes the step kind. Its second dropdown selects the operation, subprocess definition or condition rule. Selecting a node opens its configuration in the inspector. **Combined steps** expands calls and previews the chosen paths for a product number and simulated outputs. Cyclic calls are rejected.

Each assembly AAS owns one canonical sequence. A parent material occurrence references that owner; it does not duplicate the child steps. Editing an assembly directly or through its parent saves the same definition. Missing sequences start empty. Shared parts can occur in several products. Save before changing product; browser drafts recover quietly within the same tab. **Reload plans** archives the current browser draft and loads the server version. There are no draft-download reminders or BPMN editor.

## Editing operations and results

**Operation type**, directly below **Name** in the inspector and on the diagram card, selects a process from the product's Process Parameters submodel. It resolves the process parameters and inherited capability requirements, clears step-specific requirement overrides and clears the previous station, skill and input bindings. Match the new operation again or leave it unassigned. Custom names and declared output identities are retained; review outputs when changing the operation. Selecting the same operation preserves edits. The execution mode remains an explicit choice because Process Parameters does not prescribe manual versus station execution.

Process inputs, Capabilities, Resource assignment and Operation outputs start collapsed with concise summaries. **Match resources** remains visible in the Capabilities header.

Declare an output such as Boolean `Passed` under **Operation outputs**. It then appears in the diagram card's Results area. Click that result to insert a decision immediately after its producer in the same branch, with the result reference already selected. Boolean comparisons start at `true`; numeric and text results start at `0` and empty text and should be configured in the inspector.

Solid arrows show execution order. Selecting a producer or consuming decision shows a dashed result connection between them. These are two different relationships: outputs are runtime results, while Process inputs are resolved recipe inputs. Results are not automatically wired to the next operation or to a station skill. Output references currently feed explicit conditions within the same scope and follow the availability rules below. **Combined steps** accepts simulated result values; the editor does not execute stations.

## Decisions and type changes

Decisions have Yes and No branches. Optional flows have a Run body and an empty Skip path. Both support Every N products or a typed comparison against a Process Parameters input or a declared operation output. Boolean/string values support equality and inequality; numbers also support ordered comparisons. Parameter units are retained when available, and output units are explicit. Comparisons require matching types and units; no unit conversion is inferred.

Declare an operation's outputs in **Operation outputs**. **Combined steps** accepts simulated results for each subprocess invocation and lists the selected paths. Missing values, incompatible types/units and unavailable outputs pause the affected path and its successors. Other parallel branches can still be previewed. A result produced only in an alternative path cannot be referenced after its merge; keep the decision inside that path until explicit merge-output contracts are supported. Process parameters are definition inputs, not live station measurements. Simulated values are never saved in the definition or sent to equipment.

Changing a configured operation to a container wraps it without losing its identity, process or bindings. Optional-to-Decision retains the Run body and exposes Skip as No. A populated No branch is preserved by wrapping the entire decision when changing to Optional. Subprocess conversion extracts configured content into a local scope; extraction that would break a condition reference is refused. Destructive container-to-operation conversion is unavailable. **Remove condition** unwraps an optional body. **Undo type change** restores the previous structure until another edit or save changes the draft. The conversion dialog explains the transformation before applying it.

## Data contracts

| Submodel | Responsibility |
| --- | --- |
| IDTA 02011 Hierarchical Structures | Product composition and material occurrence references |
| IDTA 02031-1 Process Parameters Type | Available processes, product/process/resource parameters and ProcessBoM |
| IDTA 02020 Capability Description | Required and offered capabilities, properties, role qualifiers and skill realization references |
| Application Production Sequence 3.0 | Ordered operations, calls, branches, parameter overrides, requirement overrides and assignments |
| Application Skills 1.0 | Station skills and their parameter interfaces |

The IDTA Process Parameters semantic ID is exactly `https://admin-shell-io/idta/SubmodelTemplate/ProcessParameters/1/0`; the hostname spelling is intentional. Required-capability links inside Process collections are an application extension: `https://smartproductionlab.aau.dk/ProcessParameters/RequiredCapability/1/0`. These are repeatable ReferenceElements pointing to Required-role Capability elements. They do not replace or redefine IDTA fields.

Production Sequence and Skills are application templates, not published IDTA standards. See [the sequence contract](templates/README.md) and [machine-readable AAS template](templates/ProductionSequence.json). Each product stores its own Steps; local subprocesses are nested collections, reused through SequenceReference paths. Separately owned assemblies retain their own sequence submodels. The product tree comes from the BoM and is never copied into the sequence. Saving writes native AAS collections, properties and references visible in the normal AAS viewer. Older JSON Definition attachments are readable and retained when migrated; subsequent saves use structured elements.

## Capability matching

Capability meanings come from supplemental semantic IDs. The pharma recipes and stations name capabilities and their properties in the lab's shared vocabulary (`https://smartproductionlab.aau.dk/semantics/<Name>`, kept as an ontology in iec61499-mgmt-py `ontology/Vocabulary`), so a product's requirement matches the offer of any resource that uses the same names, including the IEC 61499 modules. Required/Offered roles use the IDTA boolean role qualifiers. Matching requires one complete offered capability to satisfy each requirement; properties from incompatible station configurations are never combined. Property identities also use supplemental semantic IDs.

A required scalar must lie within an offered numeric interval. A required interval describes acceptable results: an offered scalar must lie within it (for example, maximum permitted absolute fill error). String values must agree. Units must match exactly. Missing properties, unknown datatypes, unverified unit conversions, range-to-range comparisons and additional constraints produce **Needs verification**. Matching does not reserve equipment or execute skills.

The inspector shows station comparisons and can assign a skill through the capability's `CapabilityRealizedBy` relationship. A step can inherit process requirements or override them; an explicit empty override removes requirements for that occurrence. Manual operations have no station assignment.

The blue **Match resources** button in the Capabilities box opens a chooser for all candidate stations. Each match has a visible **Use resource** button; **Comparison details** expands its property checks. When several stations match, choose one explicitly. The plan stores one selected resource/skill per step; it does not store an alternative-resource pool or schedule by station availability. Assignment requires a single skill linked to all matched capabilities. **No resource** clears the assignment, skill reference and bindings, and can be saved for later planning.

Selection details show product, process and resource parameters as branches in a tree, alongside process materials. Process inputs, Capabilities and Resource assignment can each be collapsed without clearing their fields. The matching button stays accessible in the Capabilities header. Section help, parameter datatypes and capability reference paths are available in tooltips. Planning-check summaries are omitted from the panel; structural validation still runs when saving.

## ARSO resource skills

The resource adapter supports `https://smartproductionlab.aau.dk/ARSO/Skills/1/0/Submodel`, including CappingModuleAAS, FillingModuleAAS, InspectionModuleAAS and StopperingModuleAAS. CapabilityRealizedBy selects the skill collection. Recipe inputs come from its Start operation's inputVariables; domain results come from outputVariables. Session, Accepted and ErrorID belong to the control protocol and are excluded from recipe fields. Composite internals stay in the resource model. The older application Skills catalog remains supported.

Both **Match resources** and manual skill selection bind inputs by unambiguous semantic meaning, compatible datatype and matching units. This binds the resource input Volume to the product's FillVolume despite different labels. The old catalog without semantic input identifiers retains exact-name matching. Unmatched inputs show their declared default as an editable constant. No unit conversion is inferred. New bindings store an InputReference to the actual operation variable as well as their source or constant value.

Matching evaluates scalar capability requirements against effective process parameters with the same meaning, including sequence overrides. Ambiguous associations or incompatible types/units need verification. Range requirements remain independent tolerance constraints. The known historical pharma vocabulary has an explicit compatibility mapping; arbitrary namespaces are never equated by suffix. Existing server models are not rewritten. Vial-only offers still reject syringes/cartridges, and the declared accuracy limits still apply.

After choosing a resource skill, expand **Operation outputs** and choose **Add skill results**. Use **Skill result** to map an existing output instead. Outputs such as TopPassed, SidePassed and Weight retain AAS ResultReference paths; their stable output IDs can be used in decisions. Mapped types and units come from the resource. Changing the resource/skill clears its mappings while preserving authored output IDs for review. This describes result wiring; previews still use entered values, and the module does not invoke equipment or collect live results. Weight in g is not converted into volume in mL.

## Persistence and integration

Only this module, its tests and the example environment implement this feature. `index.vue` uses the existing module metadata/autodiscovery convention. The application router, stores, viewers and root build configuration are unchanged. The optional Docker dev optimizer is contained in `dev/vite.config.mts`.

Before saving, all changed assembly definitions are compared with their loaded server versions. Descendants save before parents. Failed saves retain edits. This is optimistic conflict detection, not a repository transaction or atomic compare-and-swap: truly simultaneous writes can still race. Reload after another editor saves. Process inputs and capability submodels remain source data; the plan stores direct references and changed parameter values as overrides, and does not rewrite the sources.

## Demo and checks

See [Docker setup and pharma recipes](../../../../../examples/ProcessSequence/README.md). From `aas-web-ui`:

```sh
pnpm exec eslint src/pages/modules/ProcessSequence tests/pages/modules/ProcessSequence tests/integration/process-*.pw.ts --max-warnings=0
pnpm run type-check
pnpm exec vitest run src/pages/modules/ProcessSequence tests/pages/modules/ProcessSequence
```

Browser tests use the current checkout UI and a disposable repository: set `IT_DISABLE_WEBSERVER=true`, `IT_PORT=3000`, `IT_BASE_PATH=/`, `PS_REPO_URL=http://localhost:8081`, and optionally `IT_BROWSER_CHANNEL=chrome`; run `pnpm exec playwright test tests/integration/process-plan.pw.ts tests/integration/process-hierarchy.pw.ts tests/integration/process-pharma.pw.ts --project integration-core`.


## Periodic inspection and optional flows

Select an inspection step and choose **Optional** from **Step type**. Set **Run every N products** to 5 to inspect products 5, 10, 15, etc. in each production run. The graph shows the inspection path and a skip path that rejoins before the next operation. **Remove condition** removes the condition and preserves its operations. **Add step**, followed by **Step type: Optional**, creates an empty conditional flow; select **Run this flow** to add steps or subprocess calls inside it. Parallel groups and nested optional flows are also supported.

The product number is one-based and belongs to the current production run. Every called subprocess receives the same product number; entering a subprocess or retrying an operation does not advance the counter. Nested intervals must both match. This is a plan definition: the execution system must supply and preserve the product ordinal across retries and reset it when starting a new run. No live equipment counter is simulated by the editor.

In **Combined steps**, change **Product number in run** to preview both paths. Skipped operations do not become required predecessors. The saved condition is an AAS collection with semantic IDs for ConditionType, EveryNProducts and CounterScope. Saved submodels use semantic contract `ProductionSequence/3/0`; the version is not repeated in a PlanSchema property. Earlier scope-based and JSON formats remain readable and migrate on save. See the template contract for details.

The prepared **Vial 2 mL - inspection every 5** recipe demonstrates this flow without changing the existing recipes.


## Material flow

Material cards appear automatically beside operations using their ProcessBoM references. Green dotted arrows show added components/consumables and produced materials. Gray dotted links identify an existing workpiece or an unclassified legacy material. Click a card to inspect its role, quantity and BoM occurrence, or open the part's sequence. Use Hide materials to focus on execution order.

The pharma examples declare one stopper per stoppering cycle and link each dose's liquid quantity to its FillVolume parameter. The packing tray enters at Packing, which also declares the finished product. Material requirements live in Process Parameters; only changed requirements are stored as sequence overrides. See the [material-use contract](templates/README.md#material-use-and-diagram-connections) for semantic IDs and fields.

BoM `BulkCount` is shown on material cards when no step quantity is declared, with a **BoM:** label. Click a card to compare the occurrence count with the step allocation. Two stoppers in the BoM can still mean one at each of two stoppering steps. Counts are read by semantic ID and refresh with **Reload plans**. See the [quantity rules](templates/README.md#bom-count-versus-operation-quantity).
