# Skill editor

A submodel plugin (`src/components/Plugins/Submodels/ArsoSkills_v1_0.vue`). It opens when a Skills submodel of a resource is selected (semantic ID `https://smartproductionlab.aau.dk/ARSO/Skills/1/0/Submodel`, ARSO 0.8) and shows a skill as a flow of steps, in the style of the product's production sequence.

A resource's skill is its commands. What **Start** and **Stop** run are `Steps` in the Production Sequence elements (`NodeId`, `Kind`, `Name`, `Order`, `Skill`, `Bindings`, `Outputs`, `Branches`, `Condition`). In place of processes and materials, a step runs a skill of one of the module's components. The components are the parts in the module's Hierarchical Structures; their skills are read from each component's own Skills submodel.

## What it does

- **Skill** lists the skills the module composes and the module's own commands that run steps (Reset, Stop).
- The graph adds, removes and reorders steps. Selecting a step opens what it runs: the component's skill, the name of the step's block in the control program, what each input is handed (a constant, or a parameter of the skill), and which result of the skill it gives.
- With no step selected, the default and limits of the skill's parameters can be changed.
- **New skill from this** describes a new skill under another name. It has no interface action yet: it is described, not built.
- **Save** writes the Skills submodel. Steps that were not edited are left untouched.

Before saving, the editor refuses what the module could not carry out: a step without a skill, a name that is no identifier or not unique, a constant outside the component skill's limits, and a parameter that allows more than the component skill it is handed to. The model also describes parallel, decision and conditional steps; the module's control runs steps one after the other only, so the editor does not add them yet.

## How a saved skill reaches the module

`modsync reconfigure <AAS server>` in [iec61499-mgmt-py](https://github.com/AAUSmartProductionLab/iec61499-mgmt-py) compares the Skills submodel with the program running on the module. A new skill and changed values are applied online; a changed order of steps needs a restart, which it refuses. A test there (`test_a_skill_written_in_the_skill_editor_is_built`) builds the skill this folder's test writes.

## Files and checks

| File | Role |
| --- | --- |
| `skillFlow.ts` | Reads skills and their steps into the editor's nodes and writes them back; validation; new skill; parameter limits |
| `useSkillRepository.ts` | Loads the Skills submodel and the components' skills, saves the submodel |
| `SkillFlowEditor.vue`, `SkillFlowGraph.vue`, `SkillStepInspector.vue` | The editor, its graph (the planner's layout) and the step panel |
| `fixtures/fillingModule.json` | The filling module's skills as `modreg` builds them (written by iec61499-mgmt-py) |

From `aas-web-ui`:

```sh
pnpm exec eslint src/pages/modules/ProcessSequence/skills src/components/Plugins/Submodels/ArsoSkills_v1_0.vue --max-warnings=0
pnpm exec vitest run src/pages/modules/ProcessSequence/skills
```

Not checked in a browser yet: the tests mount the editor in jsdom with the fixture, which does not show layout or styling.
