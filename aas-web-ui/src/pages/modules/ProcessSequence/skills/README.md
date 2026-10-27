# Skill editor

Two plugins on a resource's Skills submodel (ARSO 0.10):

- **The overview** (`src/components/Plugins/Submodels/ArsoSkills_v1_0.vue`, on the submodel's semantic ID `https://smartproductionlab.aau.dk/ARSO/Skills/1/0/Submodel`): every skill of the module at a glance. The module's skills with what Start and Stop run, what they take (parameters with limits and defaults), what they give, the capabilities they offer (from the Capability Description, with *after a reconfiguration* where a skill is described and not built) and whether the program carries them out (`Deployment`: Built or Described); the components' skills (the building blocks) and which skill of the module uses each; the module's own commands. **New skill** describes one like an existing skill. The settings hold the address of the skill service.
- **The skill editor** (`src/components/Plugins/SubmodelElements/ArsoSkill_v1_0.vue`, on every skill element's semantic ID `https://smartproductionlab.aau.dk/skill`): opens when one skill is selected in the tree, or from the overview. A module level skill shows as a flow: steps added, removed and reordered; per step the component's skill it runs, its name in the program, what each input is handed (a constant, or a parameter of the skill) and which result it gives; the skill's parameters' defaults and limits; **New skill from this**. A building block is shown, not edited (it is a block type of the program). The module's own Reset and Stop show the procedures they run.

A skill's steps are the planner's Production Sequence elements (`NodeId`, `Kind`, `Name`, `Order`, `Skill`, `Bindings`, `Outputs`, `Branches`, `Condition`); the components are the parts in the module's Hierarchical Structures (1/0 or 1/1), and their skills are read from each component's own Skills submodel.

**Save** writes only the skill's own element (a new skill is added as a new element), so a skill edited elsewhere at the same time is not overwritten. Then the editor asks the **skill service** (`modreg serve` of iec61499-mgmt-py, `POST /capabilities/<shell>`) to derive what the module offers from its skills; if it is not reached, the skill is saved and the editor says so. A new skill is `Deployment = Described` until `modsync reconfigure` builds it and marks it Built.

Before saving, the editor refuses what the module could not carry out: a step without a skill, a name that is no identifier or not unique, a constant outside the component skill's limits, and a parameter that allows more than the component skill it is handed to. Parallel, decision and conditional steps are described by the model; the editor does not add them until the module's control runs them.

## How a saved skill reaches the module

`modsync reconfigure <AAS server>` in [iec61499-mgmt-py](https://github.com/AAUSmartProductionLab/iec61499-mgmt-py) compares the Skills submodel with the program running on the module. A new skill and changed values are applied online; a changed order of steps needs a restart, which it refuses. A test there (`test_a_skill_written_in_the_skill_editor_is_built`) builds a skill this editor wrote.

## Files and checks

| File | Role |
| --- | --- |
| `skillFlow.ts` | Reads skills and their steps into the editor's nodes and writes them back; validation; new skill; parameter limits; `Deployment` and `RuleSet` |
| `skillOverview.ts`, `SkillsOverview.vue` | The overview |
| `SkillEditor.vue`, `SkillFlowGraph.vue`, `SkillStepInspector.vue` | The editor of one skill, its graph (the planner's layout, compact step cards) and the step panel |
| `useSkillRepository.ts` | Loads the Skills submodel, the components' skills and the offered capabilities; saves one skill |
| `skillService.ts` | The skill service: its address (kept per browser) and the derivation |
| `fixtures/fillingModule.json` | The filling module's skills as `modreg` builds them (written by iec61499-mgmt-py) |

From `aas-web-ui`:

```sh
npx eslint src/pages/modules/ProcessSequence src/components/Plugins/Submodels/ArsoSkills_v1_0.vue src/components/Plugins/SubmodelElements/ArsoSkill_v1_0.vue --max-warnings=0
npx vitest run src/pages/modules/ProcessSequence/skills
```

In a browser, against a disposable copy of the filling module on a BaSyx repository (removed afterwards), with a dev server of this module on port 4173:

```sh
PS_REPO_URL=http://localhost:8081 IT_DISABLE_WEBSERVER=true IT_BASE_PATH=/ IT_PORT=4173 IT_BROWSER_CHANNEL=chrome \
  npx playwright test tests/integration/skill-editor.pw.ts --project=integration-core
```
