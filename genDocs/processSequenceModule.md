# Process Sequence module — state, decisions and outstanding work

> Architecture review (2026-09-30): see [the redesign proposal](processSequenceRedesign.md).
> The historical assumptions below that `Processes` collection order defines execution order and
> that `ProcessId` is a standard BoM join key are not supported by the supplied IDTA 02031 documents.
> The proposal also covers assembly navigation and the missing parameter groups. Historical
> verification notes below remain historical. The new assembly editor is now the default tab;
> its implementation and limitations are recorded in the redesign document. The legacy SDK test
> failure was an assertion against `submodelElements` instead of collection `value`; its corrected
> round-trip test passes. This does not constitute a new browser verification of legacy skill saving.

> Docker demo (2026-09-30): the current UI is deployed in `ps-aas-web-ui` at
> `http://localhost:3000`. Use the checked-in
> [Process Sequence demo](../examples/ProcessSequence/README.md) to build and run it.
> Select `PSDemoRobot` to open the prepared product/assembly plan. The new example supplies six
> shells and eight submodels; its seed service preserves existing edits. The backend is in-memory,
> so the demo README includes the command to restore missing examples after a backend restart.

Written for an LLM picking this work up cold. It states what exists, what was decided and why, what is
verified, what is **not** working, and what to do next, in an order that can be followed literally.

Repository: `basyx-aas-web-ui` (Eclipse BaSyx AAS Web UI). Module lives at
`aas-web-ui/src/pages/modules/ProcessSequence/`.

Everything marked **VERIFIED** was observed running in a browser against a real BaSyx stack.
Everything marked **NOT VERIFIED** or **BROKEN** has not been observed working. Do not assume a
feature works because its code is present.

---

## 1. What the module does

`/modules/processsequence` — a custom application module for editing the BPMN process sequence that
reconfigures a resource for a given product.

It reads three things and writes one:

| Role | Submodel | Standard | Direction |
| --- | --- | --- | --- |
| Product: bill of process | `ProcessParameters` | IDTA 02031-1 | read only |
| Product: bill of material | `HierarchicalStructures` | IDTA 02011 | read only |
| Resource: skill catalog | `Skills` | defined by this module | read only |
| Process: the sequence | `ProcessSequence` | defined by this module | read/write |

The process shell is one AAS per product, created on demand, holding a `ProcessSequence` submodel
with three elements:

- `Diagram` — `File`, `application/bpmn20-xml`, untouched BPMN 2.0 XML
- `Bindings` — `File`, `application/json`, generated from the diagram on every save, never authored
- `Skills` — collection of skills **this product defines for itself**, see §6

A BPMN task carries the skill it calls inside `bpmn:extensionElements`, so the binding travels in the
diagram file itself rather than in a side channel that could drift:

```xml
<bpmn:task id="Task_Step20" name="Fill the vial">
  <bpmn:extensionElements>
    <ps:taskBinding skill="Dispense" processId="Step20">
      <ps:parameter name="volume" source="product" value="FillVolume"/>
    </ps:taskBinding>
  </bpmn:extensionElements>
</bpmn:task>
```

The namespace is `https://smartproductionlab.aau.dk/ProcessSequence/1/0`, prefix `ps`, described in
`utils/bpmnModdleExtension.ts`.

---

## 2. File map

```
aas-web-ui/src/pages/modules/ProcessSequence/
├── index.vue                    module shell, layout, orchestration of the three panes
├── README.md                    user-facing documentation of the module
├── constants/contracts.ts       every semanticId and idShort the module relies on
├── types/index.ts               domain types; no Vue, no bpmn-js
├── templates/skills.json        the skill catalog template the resource component must implement
├── utils/
│   ├── readers.ts               skill catalog + bill of process, from fetched submodels
│   ├── readBillOfMaterial.ts    bill of material, from HierarchicalStructures
│   ├── bpmnModdleExtension.ts   the `ps` moddle extension
│   ├── bpmnAdapter.ts           bpmn-js moddle <-> plain data bridge
│   ├── sequenceGraph.ts         flattens a diagram; decides what runs when and what is concurrent
│   ├── sequenceChecks.ts        the client-side checks
│   ├── draftGenerator.ts        bill of process + catalog -> starting diagram
│   └── emptyDiagram.ts          the diagram a product starts with
├── composables/
│   ├── useBpmnModeler.ts        owns the bpmn-js Modeler instance
│   ├── useProcessSequenceSources.ts  loads BoM / BoP / skill catalog from AAS
│   └── useProcessSequenceRepository.ts  creates the process shell; reads and writes its submodel
├── stores/useProcessSequenceStore.ts   state shared by the three panes
└── components/
    ├── SplitPanes.vue           three resizable columns, collapsible right column
    ├── BpmnCanvas.vue           bpmn-js host, drag-and-drop target
    ├── SkillPalette.vue         searchable skill list, shows each skill's parameters
    ├── TaskInspector.vue        edits the selected task's skill and parameters
    ├── ChecksPanel.vue          the findings list
    ├── ResourcePicker.vue       chooses the resource AAS
    └── DefineSkillDialog.vue    defines a product-local skill
```

Tests sit next to the code (`*.test.ts`) plus one registration test at
`aas-web-ui/tests/pages/modules/ProcessSequence/moduleRegistration.test.ts`.

---

## 3. Build, run, verify

### Toolchain

The repo pins `engine-strict=true` and requires Node `>=24.5.0 <25`. If the machine has a different
Node, pnpm will refuse to install. A portable Node 24 was used here:

```
https://nodejs.org/dist/v24.21.0/node-v24.21.0-win-x64.zip
```

`pnpm` is not on `PATH` by default on this machine either; it is a devDependency of the project.

### Checks that must pass before handing work back

```sh
cd aas-web-ui
pnpm run type-check
pnpm exec eslint "src/pages/modules/ProcessSequence" --max-warnings=0
pnpm exec vitest run src/pages/modules/ProcessSequence tests/pages/modules/ProcessSequence
pnpm exec vite build          # NOT `pnpm build`, see below
```

### Two traps in this working copy

1. **`pnpm build` fails on Windows checkouts.** It runs `prebuild` → `lint:check`, whose
   `linebreak-style` rule rejects CRLF. The working tree has CRLF because `core.autocrlf=true`
   overrides `.gitattributes` (`* text=lf`). This is an artifact of the local checkout, not of the
   code: a single untouched file such as `src/utils/InfrastructureUtils.ts` already produces 343 of these errors, and `vite.config.mts` produces 161.
   `.gitattributes` normalises on commit, so CI and Linux checkouts are unaffected.
2. **`entrypoint.sh` cannot be executed from a CRLF checkout.** Its shebang becomes `#!/bin/sh\r`, so
   the container exits 255 with `exec /usr/src/app/entrypoint.sh: no such file or directory`.

Both are worked around in a **temporary, uncommitted** `aas-web-ui/Dockerfile.local`, which is a copy
of the repo `Dockerfile` with `pnpm build-only` instead of `pnpm build`, and a `sed -i 's/\r$//'` over
`entrypoint.sh` and `nginx.conf`. The repository `Dockerfile` is deliberately untouched. **Delete
`Dockerfile.local` before committing, or move it to `examples/` deliberately.**

### Running against a real stack

The repo's compose files all pin `eclipsebasyx/aas-gui:SNAPSHOT`, which does **not** contain this
module. A local image built from this tree is required. `AGENTS.md` states the same rule.

The demo stack used for verification lives outside the repo, under the machine temp directory:
`docker-compose.yml` plus `seed-processsequence-demo.ps1` and `clear-processsequence-demo.ps1`.
They start `aas-registry` (8082), `sm-registry` (8083), `aas-discovery` (8084), `aas-environment`
(8081) and `aas-web-ui` (3000), then seed a `PSDemoProduct` and a `PSDemoResource`.

If those scripts are missing, recreate them from §7 and the submodel shapes below; the module needs
no other infrastructure.

### Live verification

Two Playwright scripts were used. Playwright's bundled browser download failed on this machine, so
both launch the system Chrome:

```js
chromium.launch({ channel: 'chrome' })
```

To reach the module in a script: open the AAS viewer, click `PSDemoProduct`, then in the app bar open
the module dialog and click the **Modules** tab — the module is listed there under the label
`Process Sequence`, not under the standard `AAS Viewer` dropdown.

### Reading IRI ids over HTTP

Ids of the form `https://…` cannot be sent literally in a path segment: the slashes split the path
(404) and percent-encoding is rejected (400, Tomcat disallows encoded slashes). The web UI works
around this by **base64url** encoding the id into the path. Every script and every new integration
must do the same:

```js
const enc = s => Buffer.from(s, 'utf8').toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
fetch(`${repo}/submodels/${enc(id)}`)
```

---

## 4. Architecture decisions

Read these before changing anything; several look like mistakes but are deliberate.

### 4.1 The bill of process is IDTA 02031-1, not an invention

`work.md` asked for a bill of process that is "derived from the product BoM, BoP and resources".
IDTA 02031-1 Process Parameters turned out to be exactly this shape, and its own documentation says it
is meant to be combined with HierarchicalStructures. `Processes` in list order is the execution
order; `ProcessId` is the join key to the BoM entity and to the BPMN task.

IDTA 02031 says nothing about what a step needs from a machine, so exactly one element was **added**
rather than reshaping the template:

```
RequiredCapability -> ReferenceElement
  https://smartproductionlab.aau.dk/ProcessParameters/RequiredCapability/1/0
```

Adding an extension keeps a stock IDTA 02031 instance valid and readable by anything else that
understands the template.

### 4.2 Elements are matched on idShort, never on semanticId — **do not "fix" this**

A BaSyx server normalises semanticIds against the metamodel it was built with, and it does not
normalise them the way the published template is written:

| element | template says | live server returns |
| --- | --- | --- |
| `Processes` | `.../ProcessParameters/Processes/1/0` | `.../ProcessParameters/1.0/Processes/1/0` |
| `Process__00__` | `.../ProcessParameters/Process/1/0` | `.../ProcessParameters/1.0/Process/1.0/…` |

Matching on semanticId therefore read an empty bill of process against a live server while unit
fixtures still passed. The readers in `utils/readers.ts` key on **idShort**, which is mandated by the
templates, stable across server and template, and what an author edits.

`isFamily()` accepts `Process__00__` and also `Process__01__`, `Process__02__`, … , because
deployed instances are expected to number repeated children (see §7).

### 4.3 The bill of material entry node is found structurally

A server does **not** preserve the semanticId on a HierarchicalStructures entry entity. Matching on
it yields an empty bill of material. `readBillOfMaterial` therefore looks for an `Entity` that has
`statements`. It deliberately takes no composable: an earlier version called `useReferableUtils()`,
which needs an active Pinia, so the reader could not be tested at all.

### 4.4 Submodel-level lookup is still by semanticId

`getSmIdOfAasIdBySemanticId` matches against the **submodel registry descriptor**, so the submodel's
own semanticId is what associates a product with its bill of process. The repository registers each
posted submodel automatically when registry integration is on; do not post descriptors by hand, that
is what produced two entries per AAS in the list.

### 4.5 A product-sourced parameter stores a name, not a value

For `source="product"` (or `process`, `resource`), `ParameterBinding.value` holds the **idShort of
the parameter to read**, never the number in it. The number lives in the bill of process. The diagram
says what to read; the compiler reads it. A product arriving with a different quantity therefore needs
no edit to the diagram.

Consequences that look wrong but are not:
- the checks skip range and type validation for non-`constant` sources — the "value" is a name;
- the task inspector offers a dropdown of product parameter idShorts for those sources.

An earlier version stored the number, which produced findings like
`"Setpoint" expects xs:double but is set to "Setpoint"`.

### 4.6 The module watches the selected AAS instead of reading it once

The app restores the last visited module at startup, so the module component is often mounted
*before* a product is chosen. Reading `aasStore.getSelectedAAS` in `onMounted` left the module
permanently saying "No product selected". `initializeForSelectedProduct` is wired to `onMounted`
**and** to a watcher on the selected AAS.

### 4.7 Contract operators are a closed set

`work.md` requires that nothing from a BPMN file is ever evaluated as code. Conditions accept only
`== != < <= > >=`, effects only `:= +=`. A condition using anything else is **dropped, not run**.

---

## 5. Bugs found in this module, and their fixes

These were all found by running the real UI, not by unit tests. They are recorded because the same
mistakes are easy to make again, and because the unit tests originally *passed while the feature was
completely broken*.

### 5.1 `readDiagram` was blind to the whole diagram (four separate defects)

All four were in `utils/bpmnAdapter.ts`. Together they made the module render a diagram it could not
read, which surfaced as "no start event", "unreachable task", a Task inspector that never populated,
click-to-bind doing nothing, and deriving a diagram that looked empty.

1. `if (element?.di) continue` — **every** bpmn-js shape carries a `di` pointer to its BPMNShape, so
   this discarded the entire diagram.
2. Reading `$type` off the registry element. diagram-js keeps the BPMN type on
   `businessObject.$type`; the element's own `$type` is `undefined`.
3. Reading `sourceRef`/`targetRef` for flow ends. Those are the **moddle** names; the element has
   `source`/`target`. Every flow therefore had empty ends, so no task was reachable.
4. `elementRegistry.get()` with no argument returns `undefined` — diagram-js looks up
   `this._elements[undefined]`. The only supported enumeration is `filter(fn)`.

The unit test passed throughout because the mock put `$type` and `sourceRef` in the same wrong places
as the code. The mock now mirrors the real registry exactly and asserts each of these.

### 5.2 The generated diagram was rejected by bpmn-js 18

`unicorn/prefer-https` in this repo's ESLint config rewrites `http://` to `https://` in string
literals, **including during `lint --fix`**. The generator emitted `https://www.omg.org/spec/BPMN/…`;
the BPMN moddle registry keys on `http://`, so every diagram failed to open with the unhelpful message
*failed to parse document as `<bpmn:Definitions>`*. The namespace constants are now wrapped in
`eslint-disable unicorn/prefer-https` with the reason, and a test pins the spelling.

### 5.3 `ps:taskBinding` needs the right element names

With `xml: { tagAlias: 'lowerCase' }` the serialised tag is the **lowercase type name**, so the type
is `Parameter` and the tag is `ps:parameter` — not `ps:parameterBinding`.

### 5.4 The draft generator produced structurally broken XML

- With no steps it emitted **no sequence flow at all**, leaving the start and end events referencing
  a flow that did not exist.
- With one task the single flow went start→end *around* the task.
- `FIRST_FLOW_ID` and `Flow_1` were both assigned to different edges, producing duplicate ids.

Now one edge is emitted between each consecutive pair of the chain `[start, …tasks, end]`.

### 5.5 A parallel **join** was treated as a split

A gateway with one outgoing flow is a join, not a split. Counting it as a split made every task after
it look concurrent with everything else, which produced bogus equipment conflicts. A split now
requires more than one outgoing flow.

### 5.6 A wrong `continue`/`return` in the parameter checks

Skipping numeric validation for product-sourced parameters was first written as `return` inside the
loop over parameters, which abandoned the remaining parameters. It is `continue`. There is a test for
exactly that.

---

## 6. Current state

### VERIFIED working in a browser against a real stack

- Module discovered, routed and reachable; shows only with a product selected.
- Bill of process read: "3 steps from IDTA 02031". Bill of material: "4 components from IDTA 02011".
- Skill catalog read and grouped by capability; search reaches parameter names.
- Derive from bill of process produces 3 tasks wired to the right skills, each carrying the right
  `ProcessId` and product parameter binding.
- Task inspector populates: task name, skill, bill of process step, parameters with unit and range,
  source selector and product parameter selector.
- Checks panel: no spurious findings; a genuine `unknown-contract-variable` is reported.
- Drag-and-drop from palette to canvas creates a bound task.
- Resizable panes: drag, keyboard (arrows), double-click reset, sizes remembered.
- Collapsing the right column widens the diagram (818px → 1259px measured).
- "Define a skill" adds a skill; it appears in the palette marked "this product" with its parameters.

### BROKEN — must be fixed before the feature is claimed

**Product-local skills are not persisted.** The dialog adds the skill to the in-memory store, the
palette shows it, but nothing reaches the server: the sequence submodel comes back with only `Diagram`
and `Bindings`. After a page reload the skill is gone.

Root cause, established: `utils/readers.ts::toSkillCollection` renders the collection, but
`jsonization.submodelElementFromJsonable(collection)` **accepts it and then discards its children**.
`composables/useProcessSequenceRepository.ts::toSubmodelElement` therefore routes the collection
through a throwaway wrapper `Submodel` (`submodelFromJsonable`), which is what the AAS creation wizard
does. That route still throws `Target cannot be null or undefined`, and the failing test is
`localSkills.test.ts` → *"survives the AAS SDK, keeping its children"*.

Current status of that path:

| step | state |
| --- | --- |
| `toSkillCollection` emits `value` (template shape, as templates, server and wizard do) | done |
| property values serialised as **strings** (the SDK rejects `Expected a string, but got: number`) | done |
| `submodelElementFromJsonable` keeps children | **impossible**, it does not |
| wrapper-submodel route | **still throws** |
| `saveLocalSkills` post/put | untested, never reached |

Next step: work out what the wrapper route still rejects. Suspects, in order:
1. `Occupies` is emitted even when `equipment` is empty, producing an empty collection — harmless for
   the SDK but worth checking.
2. `ReferenceElement` needs `value` as a full `{ type, keys }` reference — verify against a collection
   the wizard actually posts successfully.
3. `Description` as `MultiLanguageProperty` / `kind` field requirements on nested elements.

Debug by writing the wrapper result through `jsonization.toJsonable` and diffing it against a
collection the creation wizard posts successfully.

### NOT VERIFIED

- **Save** writes the diagram and the bindings. The attachments are written by
  `putAttachmentFile`, the same mechanism the file load uses, and load-after-save has not been
  exercised.
- **Load of a previously saved diagram.** Only the empty-diagram path and the derive path have been
  driven in a browser.
- Drag-and-drop has not been driven by an actual mouse drag; only the click-to-bind path was.
- `liveReaders.test.ts` runs the readers against a live stack and is skipped unless
  `PS_REPO_URL` is set:

  ```sh
  PS_REPO_URL=http://localhost:8081 pnpm vitest run src/pages/modules/ProcessSequence
  ```

  It is the test that proves §4.2. **Keep it**; it catches things no fixture can.

### Uncertain, needs a decision

1. **Where product-local skills should live.** The module `README.md`, section "Adding a skill", says they are stored per
   product, in a `Skills` collection in the sequence submodel, deliberately *not* in the resource's
   shared catalog — so one product cannot quietly give a machine a capability another product lacks.
   The alternative (write to the resource catalog) was considered and not taken. **If the requirement
   is actually that the resource learns new capabilities, this decision is wrong** and
   `saveLocalSkills` should target the resource AAS instead. This is the single most consequential
   open question.
2. **Contract editing.** A locally defined skill is written with empty `requires`/`ensures`; there is
   no UI to author contracts. The reader and writer already handle them, and the round-trip test
   covers them, so only the UI is missing.
3. **Equipment declarations** on a locally defined skill are also not editable in the dialog.
4. **The resource choice is not persisted.** A hard reload drops it and the module asks again.
   Persisting it (keyed by product) would be a small improvement nobody has asked for.
5. **`unreachable-task` semantics.** A task with no incoming flow is unreachable only if it is not
   also a start. Worth revisiting if gateways are added.

---

## 7. Defect in the seeded and shipped submodels: repeated idShorts must increment

**The readers tolerate this, so nothing is broken — but the data is non-conforming and other tools
will trip over it.**

This repository's own convention is in
`aas-web-ui/src/pages/modules/AASCreationWizard/utils/builderUtils.ts::formatIndexedIdShort`:

```ts
export function formatIndexedIdShort (baseIdShort: string, index: number): string {
  const indexedPattern = /__\d{2}__$/
  if (indexedPattern.test(baseIdShort)) {
    return baseIdShort.replace(indexedPattern, `__${String(index).padStart(2, '0')}__`)
  }
  return `${baseIdShort}__${String(index).padStart(2, '0')}__`
}
```

So `X__00__` is the **template placeholder**. A *deployed instance* is expected to hold
`X__00__`, `X__01__`, `X__02__`, … as siblings.

Currently every repeated element in the demo data has the same idShort as its siblings:

| collection | current | expected |
| --- | --- | --- |
| `Processes` children | `Process__00__` ×3 | `Process__00__`, `Process__01__`, `Process__02__` |
| `Skill__00__` children | `Skill__00__` ×3 | `Skill__00__`, `Skill__01__`, `Skill__02__` |
| `Parameters` children | `Parameter__00__` ×3 | `Parameter__00__`, `Parameter__01__`, `Parameter__02__` |

Where this is wrong:

1. **The seed script** `seed-processsequence-demo.ps1` — three skills all written as `Skill__00__`,
   three parameters as `Parameter__00__`. Note it originally used `Skill__01__`/`Skill__02__`; that
   was "correct" by the increment rule but wrong against the template family naming, so the reader was
   taught to accept both. The family reader (`isFamily`) is the right answer; the seed data is what
   needs fixing.
2. **`templates/skills.json`** — this one is a **template**, so `Skill__00__` once is arguably correct
   as a cardinality `ZeroToMany` placeholder. It is ambiguous and must be resolved: if that file is
   meant to be uploaded as a template it is fine; if it is meant to be a worked example instance, it
   needs incrementing. The same question applies to its nested `Parameter__00__`.

Why it matters even though the module reads it correctly:

- the AAS metamodel treats idShort as unique among siblings, and three identical siblings under one
  collection violates that;
- the BaSyx server accepted it without complaint, so nothing warns about it — it will fail silently
  elsewhere;
- any tool that indexes submodel elements by idShort will collapse the three skills into one.

Fixing the data is safe: `utils/readers.ts::isFamily` already matches `X__00__` **and** `X__NN__`, and
`localSkills.test.ts` covers multi-parameter and multi-capability skills. After changing the seed
data, re-run with `PS_REPO_URL` set to confirm.

---

## 8. To-do, in order

1. Fix `toSubmodelElement` so a product-local skill is actually stored (§6, "BROKEN"). The failing
   test names the exact place. Without this, do not ship the "Define a skill" button.
2. Fix the repeated idShorts in the seed script and decide the status of
   `templates/skills.json` (§7).
3. Drive a save-then-reload cycle in the browser. Save and load have never been exercised
   end to end.
4. Drive an actual mouse drag from the palette onto the canvas, not just the click path.
5. Run the live reader tests with `PS_REPO_URL` set as part of the handoff; three tests are skipped
   otherwise and they guard the most important decision (§4.2).
6. Decide §6 "Uncertain, 1" — per-product skills, or resource catalog — before anything else in this
   area is built on.
7. Add contract and equipment authoring to `DefineSkillDialog` if the skills it creates are expected
   to be checked as strictly as the resource's own.
8. Delete `aas-web-ui/Dockerfile.local`, or move it into `examples/` deliberately.
9. Update the module `README.md` if §6 changes any decision.

---

## 9. Conventions not to trip over

- **`unicorn/prefer-https`** rewrites `http://` in string literals during `lint --fix`. This already
  broke BPMN generation once (§5.2). Check any URI constant that must stay `http`.
- **`unicorn/prefer-at`** rewrites `arr[arr.length - 1]` to `arr.at(-1)`, which widens the type and
  then fails `noUncheckedIndexedAccess`-adjacent checks.
- `unplugin-auto-import` and the Vue component auto-import cover `src/components` and
  `src/composables`, **not** module folders. Module components are imported explicitly, which is why
  they do not appear in `src/components.d.ts`. That is correct, not an omission.
- `buildModuleRouteMeta` hardcodes `subtitle: 'Module'`. A `subtitle` in `defineOptions` is dead
  configuration; do not add one. `inheritAttrs: false` is expected by the other modules and prevents
  the app layout from leaking attributes onto the module root.
- `isOnlyVisibleWithSelectedAas: true` implies `preserveRouteQuery: true`, because the selected
  product travels in the route query.
- Submodel element values in the **AAS JSON serialisation are strings**, with `valueType` saying how
  to read them. Emitting a number is rejected by the SDK.
- The AAS SDK's jsonable form for repeated collection children is `value`; `submodelElements` is the
  runtime getter. Templates, the wizard and the server all use `value`.
