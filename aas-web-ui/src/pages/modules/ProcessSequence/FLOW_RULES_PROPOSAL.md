# Production flow rules proposal

Status: design proposal. The running editor currently supports operations, subprocess calls, parallel blocks and periodic optional blocks. General decisions, event handling, repetition and execution are not implemented by this document. The current storage contract remains [Application Production Sequence 1.0](templates/README.md).

## Authoring model

Use one **Add step** action, inserting an unconfigured Operation at the selected position. Its inspector has a **Type** selector. Keep rounded rectangular cards, with a type icon and short label; decision branches carry visible conditions. Containers can collapse to one card, while expanded containers expose their children and a generated merge marker.

The graph is a view of a structured definition: an ordered sequence containing nested blocks and calls. Insertion on an edge, moving a card and adding a branch edit that structure. Arbitrary connections across block boundaries are disallowed. Split and merge belong to the same block; users do not have to pair gateways manually. This extends the existing recursive model without creating a second, contradictory edge model.

### Types and completion rules

| Type | Meaning | When the following step becomes eligible |
| --- | --- | --- |
| Operation | Perform one manual or station task, using process parameters and capability requirements. | The task reports successful completion and its outputs are accepted. |
| Subprocess | Invoke a local or shared sequence with explicit inputs. | The invocation returns an outcome accepted by the caller. |
| Decision | Evaluate available data once; choose exactly one branch. Initially Yes/No, later named cases with Otherwise. | The selected branch completes. |
| Optional | Decision preset with one Run branch and an empty Skip branch. Presets include Every N products and a custom condition. | The Run branch completes, or Skip is selected. |
| Parallel | Enable all branches. Advanced mode enables every branch whose condition is true. | All enabled branches complete successfully. |
| Repeat | Execute a body for each recipe item, a fixed count, or until a condition is met. | The configured repetition completes; reaching an unmet limit is an explicit outcome. |
| Wait | Wait for a correlated event, a duration, or a condition to become true. Include timeout handling. | One configured outcome path completes. |
| Finish | Return a named outcome from this invocation, such as Completed, Rejected or Needs review. | Control returns to the caller; a root invocation ends. |

Sequence itself is the containing list, not another card. Optional is a useful authoring type but shares decision semantics. Manual work is an Operation mode, not a separate flow mechanism. Start and normal completion are implicit; explicit Finish is useful for named outcomes.

Failure handlers and monitors attach to a task or a container. They are not ordinary sequential steps: an interruption may happen while a task is active. Keep them in an advanced inspector section.

## Decision, wait and monitor are different

- **Decision:** `inspection.passed == true` checks a completed inspection result now. It does not subscribe to future changes or reverse its choice later.
- **Wait:** `fixture.ready == true` waits for valid readiness data, then proceeds. A timeout takes a separate outcome path.
- **Monitor:** an equipment fault while filling requests interruption of the active operation and enters its recovery policy after the equipment state is established.

These distinctions follow the useful separation between [data-based exclusive branching](https://docs.camunda.io/docs/components/modeler/bpmn/exclusive-gateways/) and [event-based waiting](https://docs.camunda.io/docs/components/modeler/bpmn/event-based-gateways/). This proposal is an application language, not a claim of full BPMN compatibility.

### Conditions

1. Build conditions from typed references and operators, not executable JavaScript. Initial operators: equals, not equals, numeric comparisons, in a set, AND, OR and NOT. Provide a dedicated periodic predicate rather than requiring users to enter modulo expressions.
2. References point to recipe inputs, completed task outputs, explicit subprocess inputs or execution context. Use stable IDs and semantic references; display names are labels. An AAS source reference identifies meaning and provenance, not a live variable subscription.
3. Values include datatype and, where relevant, unit and validity. No implicit string-to-number conversion. Unit conversion requires an explicit supported conversion. Missing, invalid or stale values produce **Unresolved**, never an automatic No or Otherwise.
4. Evaluate against a recorded input snapshot when entering the block. Record the selected branch and evaluated values. A later recipe edit cannot change an active decision.
5. Yes/No uses one Boolean expression. Named cases use unique-match semantics: one true case wins, zero true cases takes Otherwise, and multiple true cases are an error. Every runnable decision requires Otherwise or a provably exhaustive case set. Unresolved cases hold evaluation. Do not derive priority from visual position. An explicitly ordered first-match mode can be added later; it is not the default proposed here.
6. A downstream reference must be available on every path reaching it. Optional and alternative paths export explicit outputs, such as `inspectionStatus = skipped | passed | failed`, with a mapping for every successful path. Never invent `passed = true` when inspection was skipped.
7. Parallel branches have isolated outputs. A block explicitly collects or reduces them before use downstream; branches cannot race to overwrite one shared variable.

## Branching and synchronization

A Decision or Optional merges only its selected path. A Parallel waits for every enabled branch, consistent with the essential synchronization behavior of a [parallel gateway](https://docs.camunda.io/docs/components/modeler/bpmn/parallel-gateways/). For conditional parallelism, evaluate and freeze the enabled set at entry, wait only for that set, and define an explicit Skip or Error policy when the set is empty.

Parallel means eligible to progress concurrently. Actual overlap depends on resource and material availability. Two branches cannot simultaneously own the same exclusive fixture or physical item. Transport, handover, buffer occupancy and assembly consumption need explicit operations or material bindings; graph proximity does not establish a physical route.

A failed branch cannot count as successful arrival at the join. Default policy holds the enclosing block, prevents new dispatch and requests supported stops for active siblings. Recovery or an explicitly configured collect-all-results policy determines what happens next. Never promise an instantaneous stop of physical equipment.

Finish terminates only its invocation. It cannot jump from a parallel branch into a parent sequence or bypass a join. Branches return branch outcomes; the containing block settles active work before returning an invocation outcome. A call must explicitly handle unsuccessful outcomes rather than continue on its normal path.

## Repetition, sampling and execution identity

Keep three concepts separate:

- **Recipe repetition:** planned work, such as filling and stoppering for each dose. A two-dose syringe has two recipe items with their own liquid, volume and stopper parameters. A cartridge recipe constrains the list to one item.
- **Retry:** another attempt after a technical failure. Retrying a command with an unknown physical result requires reconciliation; replaying a fill command may add liquid twice.
- **Rework:** a named recovery sequence following a product result, with an explicit limit and exit outcome. It is not a hidden backward edge.

Repeat has a finite maximum and an explicit condition timing: before each iteration for While, after each iteration for Until. For-each snapshots its finite input list at entry. Record iteration and attempt separately. No unbounded back edges or recursive call cycles. A physically irreversible operation needs an explicit recovery action; software cannot roll it back.

Sampling retains the current meaning of Every N products: a production run allocates a one-based product ordinal at admission; ordinals N, 2N and so on select inspection. Retries and rework retain the ordinal, all child calls inherit it, and a new production run resets it. Allocation must be atomic across concurrent products. A skipped or rejected product does not renumber later products. This is deterministic sampling, not random sampling.

Distinguish production run ID, product-instance ID, definition revision, material occurrence, subprocess invocation, iteration and attempt. A definition can be reused many times without sharing mutable execution state. A batch operation declares a batch work unit and members; an item operation declares one item. Setup once per batch belongs in a batch sequence, not an optional item task with an accidental counter scope. Cross-item batching requires a coordinator beyond the first editor increment.

## Events, failures and outcomes

Wait declares its event source, payload schema, correlation keys and timeout. Events correlate to the intended product/invocation/attempt, not just a station name. Delivery is durable and deduplicated; an event/timeout race commits one winner. Late events cannot restart the losing path. Timeouts are persisted deadlines, so restarting an executor does not restart a timer.

A condition wait states whether an already-true value satisfies it immediately, or whether a new transition is required. A monitor declares its active scope, interrupting or notification-only behavior, and recovery handler. Subscription lifetime and cancellation are part of the contract.

Separate technical failure from product outcome. A successful inspection may report a failed product. A failed inspection command may provide no usable quality result. Author-defined policies handle timeout, retryable failure, unknown physical result, rejection and operator hold separately. Never automatically retry every station action.

These are future execution requirements. The web editor currently authors and previews plans; it does not provide event delivery, station control, resource reservations or execution guarantees.

## Resources and capabilities

Keep resource selection independent of flow branching. Two stations able to fill a vial are alternatives for one Operation, not two parallel filling branches.

Proposed assignment modes:

- **Unassigned:** valid draft; a station operation needs a binding before dispatch.
- **Fixed:** use the selected resource and skill, subject to capability validation.
- **Eligible pool:** retain compatible resource/skill alternatives; execution chooses and reserves one using an explicit allocation policy.

Requirements describe what the process needs. Offered capabilities describe what stations can do; skills provide the invocation and input/output interface. All alternatives must satisfy the same requirement set and expose compatible logical outputs, through explicit mappings if necessary. Matching does not prove current availability. Reservation and revalidation happen before dispatch; availability changes never silently redirect work already in progress.

The current matcher can compare several resources, but each saved operation currently has one fixed assignment. Pools and allocation are proposed additions.

## Hierarchy and AAS ownership

Preserve one canonical sequence per product or assembly AAS. Parent plans call an occurrence of that definition; they do not copy its steps. Opening a child directly or through a parent edits the same owner. Merely listing a BoM component does not execute its plan; a call or explicit repetition does. Material quantities and invocation counts are separate declarations.

Subprocesses expose typed inputs, outputs and outcomes. Bind a parent's recipe values at the call boundary. Avoid expressions that reach through a particular parent tree path: the same assembly must work independently and in several products. Each invocation has its own local state.

Authoring may follow the latest saved child definition. Execution must resolve and pin the complete set of root and child revisions before starting, and preserve retrievable snapshots. Editing a shared definition affects subsequent executions, not an active run. A standalone assembly execution receives its own explicit run context.

Keep responsibilities separate in storage:

| Contract | Responsibility |
| --- | --- |
| Process Parameters | Process definitions and recipe parameter meaning/source. |
| Capability Description | Required/offered capability descriptions and skill links. |
| Production Sequence | Calls, control flow, typed conditions, input/output bindings, requirements and assignment policy. |
| Future execution record | Pinned definitions, product identities, selected branches, measurements, attempts, reservations and outcomes. |

Use native AAS collections, properties and references for every proposed field. Conditions have a typed expression tree containing operator, operands and source references, rather than opaque scripts. New element concepts need documented application semantic IDs. Do not invent standard IDTA meanings for application extensions.

A future PlanSchema version gates new node shapes. Keep existing semantic identities for unchanged concepts; unsupported versions must fail clearly without dropping branches. Migrate existing periodic conditional nodes without changing counter semantics. Publish the revised template and migrations alongside the implementation, not by changing today's template to advertise unsupported features. Runtime state stays outside the reusable plan definition.

## Changing a node's type

One Type selector is practical, but some changes are structural transformations:

| Change | Preserve work by |
| --- | --- |
| Empty Operation to another type | Replacing the placeholder with that type's empty structure. |
| Configured Operation to Optional or Decision | Wrapping the operation in Run or Yes; adding an empty alternative. |
| Configured Operation to Parallel | Keeping it in the first branch and adding a second draft branch. |
| Operation or selection to Subprocess | Extracting into a local definition and replacing it with a call; retaining bindings through explicit inputs. |
| Optional to Decision | Keeping its condition and Run body; exposing Skip as the editable No branch. |
| Container to Operation, or removing branches | Requiring an explicit keep/extract/delete choice when content would otherwise be lost. |

Retained operations keep their IDs and references; new wrappers receive new IDs. Show a concise transformation preview when meaning or content changes, and support Undo. Never silently delete branch contents, clear resource bindings or change all-branch synchronization into one-branch selection. A single selector does not imply every conversion is lossless.

Keep inspector sections collapsible. Show conditions and branch labels on the graph; keep source metadata and explanations in tooltips. Validation belongs on the affected node and in an on-demand issues view. Drafts may be incomplete, but a runnable plan cannot contain unresolved types, missing outputs, unhandled outcomes or unsupported executor features.

## Pharma example and verification

An illustrative reusable recipe sequence is:

1. Unpack and load.
2. For each recipe dose: Fill, then Stopper. Per-dose parameters bind to those operations.
3. Optional Capping when the format is Vial.
4. Optional Inspection every N products, or always when the recipe requires it. Record Skipped explicitly on the other path.
5. If inspected and failed, route through the defined reject/unload operation and return Rejected. Otherwise unload and pack according to the recipe's release rule. Skipped inspection must not be presented as a measured pass.

Vial, syringe and cartridge recipes can reuse definitions while retaining product-specific constraints. This illustrates flow semantics; actual acceptance and sampling rules remain explicit recipe inputs.

Required behavioral checks for implementation:

- Product ordinals 1 through 10 with N=5 inspect only 5 and 10; retrying 5 does not change its sampling choice.
- False chooses No, missing data holds, and overlapping named cases report ambiguity.
- An unused optional output cannot be read downstream without an explicit alternative mapping.
- Parallel waits for slow enabled branches, ignores disabled branches and does not treat failures as success.
- Two compatible filling stations result in one reserved execution, never duplicate filling.
- Two-dose syringe executes Fill/Stopper twice; a cartridge rejects a two-dose recipe.
- Timeout and matching event produce one committed outcome; a late event has no effect.
- Editing a shared child updates both authoring views; an already-started execution retains its pinned revision.
- Changing type preserves IDs, contents and bindings or explicitly identifies removal; Undo restores the original structure.
- AAS round-tripping preserves expressions, branch order, references and defaults; older schemas migrate without changing behavior.

## Delivery order

1. One Add step action, safe transformations, Boolean Decision, condition-based Optional, typed inputs/outputs, explicit merges and branch-aware simulation. Keep current parallel and periodic behavior compatible.
2. Bounded Repeat, Wait definitions, named outcomes and recovery policies. Simulation supplies outputs/events and advances time without calling equipment.
3. Conditional parallelism, eligible resource pools, scoped monitors and batch coordination, implemented with an executor contract and integration tests.

This set targets discrete and batch orchestration. Continuous control loops, motion timing and interlocks remain responsibilities of station control systems. More flow shapes alone do not supply those execution semantics.
