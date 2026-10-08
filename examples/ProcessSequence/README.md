# Process Sequence demo

This runs the current checkout's web UI with BaSyx repositories, registries, discovery, and an example
assembly process and pharma recipes. It uses Docker Compose project `ps-demo` and ports 3000 and 8081–8084.

From the repository root:

For development with **hot reload** (including Docker Desktop on Windows):

```sh
docker compose -f examples/ProcessSequence/docker-compose.yml -f examples/ProcessSequence/docker-compose.dev.yml up -d --build
docker compose -f examples/ProcessSequence/docker-compose.yml -f examples/ProcessSequence/docker-compose.dev.yml watch --no-up aas-web-ui
```

Keep the watch command running while editing. The UI at <http://localhost:3000> runs Vite inside Docker.
Compose Watch synchronizes saved Vue, TypeScript, and CSS changes into the container's Linux filesystem,
then Vite hot reloads the browser. This avoids slow source reads through Windows bind mounts. No image
rebuild is needed for source changes. Stopping Watch stops synchronization; the containers keep running.
Start both the containers and Watch again after a Docker/host restart.

Dependency files trigger an image rebuild automatically; dependencies stay inside the image, separate
from Windows `node_modules`. The dev optimizer prepares declared packages and known deep imports in
one batch (`src/pages/modules/ProcessSequence/dev/vite.config.mts`). Add new CommonJS deep imports there if needed. The first page
load after a dependency change prepares Vite's cache; subsequent source edits use hot reload.
The dev container uses Vuetify's precompiled styles for faster startup (`settings.scss` currently has
no overrides). Adjust the module-local dev config if you introduce Sass overrides.

To switch an existing demo to hot reload while preserving the running backend, use the first command above
with `--no-deps aas-web-ui` appended. To run a production build instead:

```sh
docker compose -f examples/ProcessSequence/docker-compose.yml up -d --build
```

Open <http://localhost:3000/modules/processsequence> and select **PSDemoRobot** in **Product to plan**.
The module opens directly to the product tree and prepared graph.
Selecting **PSDemoDriveAssembly** or **PSDemoControlAssembly** opens that assembly's shared plan and
its descendants. Edits saved there also appear when opening **PSDemoRobot**. Editing an assembly
inside the robot tree saves to that same assembly owner. Save before switching views; **Reload plans**
loads server changes and archives the current browser draft.

[Open the prepared robot plan directly](http://localhost:3000/modules/processsequence?aas=http%3A%2F%2Flocalhost%3A8081%2Fshells%2FaHR0cHM6Ly9zbWFydHByb2R1Y3Rpb25sYWIuYWF1LmRrL2RlbW8vcHJvY2Vzcy1wbGFuL2Fhcy9wcm9kdWN0).

The center canvas shows process nodes, subprocess calls, and parallel split/join connections. Pan or
zoom to explore; **Fit graph** restores the overview. Click a node for its parameters in the right
inspector, or **Open subprocess** to descend into that plan. The left tree selects product/assembly scopes.
Select a node to insert after it, a branch header to insert its first step, or **Complete** to append.
Use **Add step**, then the node's **Step type** selector to choose an operation, subprocess call,
decision, parallel group or optional flow. Reorder the selected step with the toolbar arrows. Branch
names and extra branches are managed in the split node's inspector. Edges follow this structured order automatically.
**Save draft** stores the plan with the product; **Combined steps** expands subprocesses into a table.

The example includes:

- A robot product with drive and control assemblies, each with two material components.
- Process Parameters submodels for the product and both assemblies, with all three parameter groups
  and material references.
- Drive, control, and final assembly resource cells, each with a skill catalog.
- IDTA 02020 Capability Description submodels: required capabilities for the product/assemblies and
  offered capabilities for the cells, with explicit process references and realization links to skills.
- A saved plan: build the two assemblies in parallel, wait for both, perform final assembly, and
  run a functional test. Drive inspection is a nested subprocess. The combined view has seven steps.
- Separate shared drive/control plans and their own material hierarchies; the robot references them.

The `seed-process-plan` service creates missing demo objects, adds capability references and corrects
the known demo inputs' semantic IDs while preserving edited parameter values, custom elements and
the stored plan. Its normal state after success is **Exited (0)**. The main services remain running.
Older combined demo plans are migrated into shared assembly definitions. The original attachment is
retained as `BeforeReferencedSequences` on the robot's plan submodel. Existing nonempty assembly plans
remain authoritative, and repeated seeding preserves their edits. See
[the sequence ownership contract](../../aas-web-ui/src/pages/modules/ProcessSequence/templates/README.md).

The backend uses in-memory storage. Restarting it clears its data. To restore missing examples:

```sh
docker compose -f examples/ProcessSequence/docker-compose.yml run --rm --no-deps seed-process-plan
```

To rebuild just the UI while keeping the backend running:

```sh
docker compose -f examples/ProcessSequence/docker-compose.yml up -d --build --no-deps aas-web-ui
```

Git attributes keep linted sources and shell scripts in LF format on Windows and in Docker. The
demo Dockerfile uses `pnpm build-only`; lint, type checks and tests are separate verification steps.
Run them before handing off changes:

```sh
cd aas-web-ui
pnpm exec eslint src/pages/modules/ProcessSequence --max-warnings=0
pnpm run type-check
pnpm exec vitest run src/pages/modules/ProcessSequence tests/pages/modules/ProcessSequence
```

This is an authoring demo. It does not operate equipment or generate execution-history records.


## Pharma example

Select **Vial 2 mL**, **Vial 10 mL**, **Prefilled syringe 1 mL**, **Prefilled syringe - two doses**, **Cartridge 3 mL**, or **Cartridge 5 mL** in Product to plan. All values are illustrative engineering examples, not validated pharmaceutical recipes.

Vials run Unpacking, Loading, Filling, Stoppering, Capping, Inspection, Unloading and Packing. Syringes omit Capping; the two-dose variant repeats Filling and Stoppering with separate liquids and two rubber stoppers. Cartridges have one filling/stoppering cycle. Unpacking and Packing are manual operations.

Each recipe has its own container, quantities, liquid/material references, diameter, volume and stopper parameters. Shared stoppers, liquids, caps and trays have their own AASs, Process Parameters, BoM and empty shared sequence. They can acquire subprocesses later and be edited either directly or through a product tree.

Six station AASs provide format-specific capabilities and linked skills: loading, filling, stoppering, capping, inspection and unloading. Capability properties include container type, grasp diameter, fill volume, absolute fill error, stopper/cap diameter and inspection method. Select a Filling node and choose **Match resources** in Capabilities to compare the required and offered values.

The normal AAS viewer exposes **ProductionSequence > Steps** as collections and properties. Each assembly stores only its own steps. Calls reference the next sequence submodel directly; local subprocesses appear inside **ProductionSequence > Subprocesses** and calls point to their collection paths. Process inputs inherit their Process Parameters definitions, with only edited values saved under **ParameterOverrides**. Required capabilities and station skills remain references. Save draft writes this structure. The [AAS template](../../aas-web-ui/src/pages/modules/ProcessSequence/templates/ProductionSequence.json) and [contract](../../aas-web-ui/src/pages/modules/ProcessSequence/templates/README.md) document it.

Seeding creates missing pharma objects and preserves existing objects and edits. The original robot parallel example remains available. Legacy robot JSON plans are converted to structured AAS elements without discarding the original attachment.


### Periodic inspection

Select **Vial 2 mL - inspection every 5** for a prepared optional inspection flow. Products 5, 10, 15, etc. take the inspection path; other products go directly to Unloading. Use **Combined steps > Product number in run** to preview the difference. The original six recipes remain unchanged; seeding adds this seventh recipe and preserves existing edits.

For any recipe, select an operation and choose **Optional** from **Step type**, or use **Add step** and change its type to **Optional**. Place operations or subprocess calls in its Run path and set the interval in the inspector. **Remove condition** removes the wrapper without discarding its contents. The rule is saved in the native ProductionSequence submodel; an execution system must provide the product counter when running the plan.

## Material flow

Material cards appear automatically from each operation's ProcessBoM references. Filling uses the
recipe's effective fill volume; each stoppering cycle adds one stopper. The tray enters at Packing,
which declares the finished product. Click a card for its BoM reference or to open the part's sequence.
Use **Hide materials** to focus on execution order.

Seeding upgrades known demo material links while preserving authored requirements. Unclassified
legacy links remain visible as Linked material with unspecified quantity. The
[material-use contract](../../aas-web-ui/src/pages/modules/ProcessSequence/templates/README.md#material-use-and-diagram-connections)
documents roles, quantities and the distinction between a workpiece and an added component.
