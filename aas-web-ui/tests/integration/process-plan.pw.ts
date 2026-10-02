import type { APIRequestContext } from '@playwright/test'
import { Buffer } from 'node:buffer'
import { expect, test } from '@playwright/test'
import { readSequenceSubmodel } from '../../src/pages/modules/ProcessSequence/utils/sequenceModel'
import { normalizeBasePath, toBaseScopedPath } from './basePath'

const repository = process.env.PS_REPO_URL
const basePath = normalizeBasePath(process.env.IT_BASE_PATH ?? '/ui/')
const id = `urn:process-plan:test:${Date.now()}`
const bomId = `${id}:bom`
const inputsId = `${id}:inputs`
const resourceId = `${id}:resource`
const skillsId = `${id}:skills`
const requiredId = `${id}:required`
const offeredId = `${id}:offered`
const encode = (value: string) => Buffer.from(value).toString('base64url')
const definitionId = `https://smartproductionlab.aau.dk/sm/process-plan/${encode(id)}`
const reference = (type: string, value: string) => ({ type: 'ModelReference', keys: [{ type, value }] })
const semantic = (value: string) => ({ type: 'ExternalReference', keys: [{ type: 'GlobalReference', value }] })
const property = (idShort: string, value: string) => ({ modelType: 'Property', idShort, valueType: 'xs:string', value })
const collection = (idShort: string, value: unknown[]) => ({ modelType: 'SubmodelElementCollection', idShort, value })
const pp = (name: string) => semantic(`https://admin-shell.io/idta/ProcessParameters/${name}/1/0`)
const cap = (name: string) => semantic(`https://admin-shell.io/idta/CapabilityDescription/${name}/1/0`)
function requirementReference (name: string) {
  return { type: 'ModelReference', keys: [
    { type: 'Submodel', value: requiredId }, { type: 'SubmodelElementCollection', value: 'Capabilities' },
    { type: 'SubmodelElementCollection', value: name }, { type: 'Capability', value: 'Function' },
  ] }
}

function capabilityModel (id: string, role: 'Required' | 'Offered') {
  return {
    modelType: 'Submodel', id, idShort: 'RenamedCapabilities',
    semanticId: semantic('https://admin-shell.io/idta/SubmodelTemplate/CapabilityDescription/1/0'),
    submodelElements: [{
      ...collection('Capabilities', ['Inspect', 'Prepare'].map(name => ({
        ...collection(name, [{
          modelType: 'Capability', idShort: 'Function', displayName: [{ language: 'en', text: name }],
          semanticId: cap('Capability'), supplementalSemanticIds: [semantic(`urn:capability:${name}`)],
          qualifiers: [{ type: role, kind: 'ValueQualifier', semanticId: cap(`CapabilityRoleQualifier/${role}`), valueType: 'xs:boolean', value: 'true' }],
        }]), semanticId: cap('CapabilityContainer'),
      }))), semanticId: cap('CapabilitySet'),
    }],
  }
}

test.use({ channel: process.env.IT_BROWSER_CHANNEL || undefined, video: 'off' })
test.skip(!repository, 'Set PS_REPO_URL to a disposable BaSyx repository to run the save/reload test.')

async function post (request: APIRequestContext, path: string, data: unknown): Promise<void> {
  const response = await request.post(`${repository}/${path}`, { data })
  expect(response.ok(), await response.text()).toBe(true)
}

test.beforeAll(async ({ request }) => {
  if (!repository) {
    return
  }
  await post(request, 'submodels', capabilityModel(requiredId, 'Required'))
  await post(request, 'submodels', capabilityModel(offeredId, 'Offered'))
  await post(request, 'submodels', {
    modelType: 'Submodel', id: bomId, idShort: 'HierarchicalStructures',
    semanticId: semantic('https://admin-shell.io/idta/HierarchicalStructures/1/0/Submodel'),
    submodelElements: [{
      modelType: 'Entity', idShort: 'Product', entityType: 'CoManagedEntity', statements: ['Drive', 'Control'].map(idShort => ({
        modelType: 'Entity', idShort, entityType: 'CoManagedEntity', statements: [],
      })),
    }],
  })
  await post(request, 'submodels', {
    modelType: 'Submodel', id: inputsId, idShort: 'ProcessParameters',
    semanticId: semantic('https://admin-shell-io/idta/SubmodelTemplate/ProcessParameters/1/0'),
    submodelElements: [{ ...collection('Operations', [{ ...collection('Inspection', [
      { ...property('Identity', 'inspect'), semanticId: pp('ProcessId') },
      { ...property('Title', 'Inspect assembly'), semanticId: pp('ProcessName') },
      { modelType: 'MultiLanguageProperty', idShort: 'Description', semanticId: pp('ProcessDescription'), value: [{ language: 'en', text: 'Inspect an assembly' }] },
      { ...property('Duration', 'PT30S'), valueType: 'xs:duration', semanticId: pp('PlannedProcessTime') },
      ...['ProductParameters', 'ProcessParameters', 'ResourceParameters'].map(group => ({ ...collection(group, [property('Setpoint', group)]), semanticId: pp(group) })),
      { ...collection('ProcessBoM', []), semanticId: pp('ProcessBoM') },
      { modelType: 'ReferenceElement', idShort: 'NeedsInspection', displayName: [{ language: 'en', text: 'Inspect' }], semanticId: semantic('https://smartproductionlab.aau.dk/ProcessParameters/RequiredCapability/1/0'), value: requirementReference('Inspect') },
    ]), semanticId: pp('Process') }]), semanticId: pp('Processes') }],
  })
  await post(request, 'shells', {
    modelType: 'AssetAdministrationShell', id, idShort: 'PlanIntegrationProduct',
    assetInformation: { assetKind: 'Type', globalAssetId: `${id}:asset` },
    submodels: [reference('Submodel', bomId), reference('Submodel', inputsId), reference('Submodel', requiredId)],
  })
  await post(request, 'submodels', {
    modelType: 'Submodel', id: skillsId, idShort: 'Skills',
    semanticId: semantic('https://smartproductionlab.aau.dk/SubmodelTemplate/Skills/1/0'),
    submodelElements: [collection('Skill__00__', [
      property('SkillId', 'Inspect'), property('SkillName', 'Inspection station'),
      collection('Parameters', [collection('Parameter__00__', [
        property('ParameterId', 'setpoint'), property('DataType', 'xs:string'),
      ])]),
    ])],
  })
  await post(request, 'shells', {
    modelType: 'AssetAdministrationShell', id: resourceId, idShort: 'PlanIntegrationResource',
    assetInformation: { assetKind: 'Instance', globalAssetId: `${resourceId}:asset` },
    submodels: [reference('Submodel', skillsId), reference('Submodel', offeredId)],
  })
})

test.afterAll(async ({ request }) => {
  if (repository) {
    await request.delete(`${repository}/shells/${encode(id)}`)
    await request.delete(`${repository}/shells/${encode(resourceId)}`)
    for (const submodel of [bomId, inputsId, skillsId, definitionId, requiredId, offeredId]) {
      await request.delete(`${repository}/submodels/${encode(submodel)}`)
    }
  }
})

test('authors assembly sequences and parallel subprocesses, then reloads the server plan', async ({ page, request }) => {
  test.setTimeout(180_000)
  await page.setViewportSize({ width: 1720, height: 1080 })
  await page.addInitScript(repository => {
    localStorage.setItem('theme', 'light')
    localStorage.setItem('basyxInfrastructures', JSON.stringify({
      selectedInfrastructureId: 'process-plan-test',
      infrastructures: [{
        id: 'process-plan-test', name: 'Process plan test', template: 'mono-repo', isDefault: true,
        auth: { securityType: 'No Authentication' },
        components: Object.fromEntries(['AASDiscovery', 'AASRegistry', 'SubmodelRegistry', 'AASRepo', 'SubmodelRepo', 'ConceptDescriptionRepo', 'CompanyLookup']
          .map(key => [key, { url: ['AASRepo', 'SubmodelRepo', 'ConceptDescriptionRepo'].includes(key) ? repository : '' }])),
      }],
    }))
  }, repository!)
  await page.goto(toBaseScopedPath(basePath, 'modules/processsequence'))
  const productPicker = page.getByRole('combobox', { name: 'Product to plan', exact: true })
  await expect(productPicker).toBeEnabled({ timeout: 60_000 })
  await productPicker.fill('PlanIntegrationProduct')
  await page.keyboard.press('ArrowDown')
  await expect(page.getByRole('option', { name: 'PlanIntegrationResource', exact: true })).toHaveCount(0)
  await page.getByRole('option', { name: 'PlanIntegrationProduct', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Sequence name', exact: true })).toHaveValue('PlanIntegrationProduct')
  // A cold Docker dev server compiles the module after the initial document loads.
  await expect(page.getByText('Product structure', { exact: true })).toBeVisible({ timeout: 60_000 })
  await expect(page.getByRole('treeitem', { name: 'Drive', exact: true })).toBeVisible()
  await page.getByRole('treeitem', { name: 'Drive', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Sequence name', exact: true })).toHaveValue('Drive')
  await page.getByRole('button', { name: 'Add step', exact: true }).click()
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Prepare drive')
  const process = page.getByRole('combobox', { name: 'Process Parameters entry' })
  await process.focus()
  await page.keyboard.press('ArrowDown')
  await expect(page.getByRole('option', { name: 'Inspect assembly', exact: true })).toBeVisible()
  await expect(page.getByRole('option', { name: 'Inspect assembly', exact: true })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByText('Process ID: inspect')).toBeVisible()
  await expect(page.getByText('Semantic resource candidates: PlanIntegrationResource', { exact: true })).toBeVisible()
  const requirements = page.getByRole('combobox', { name: 'Required capabilities', exact: true })
  await requirements.focus()
  await page.keyboard.press('ArrowDown')
  await page.getByRole('option', { name: /^Prepare \(/ }).click()
  await page.keyboard.press('Escape')
  await expect(page.getByText('Requirements for this step in the plan.', { exact: true })).toBeVisible()
  await expect(page.getByText(`${requiredId} / Capabilities / Prepare / Function`, { exact: true })).toBeVisible()
  await expect(page.getByText(`${requiredId} / Capabilities / Inspect / Function`, { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Resource Parameters', exact: true })).toBeVisible()
  await page.getByRole('combobox', { name: 'Resource (optional while planning)' }).fill('PlanIntegrationResource')
  await page.keyboard.press('ArrowDown')
  await page.getByRole('option', { name: 'PlanIntegrationResource', exact: true }).click()
  const skill = page.getByRole('combobox', { name: 'Resource skill', exact: true })
  await expect(skill).toBeEnabled()
  await skill.focus()
  await page.keyboard.press('ArrowDown')
  await expect(page.getByRole('option', { name: 'Inspection station', exact: true })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('combobox', { name: 'Value source' })).toBeVisible()
  await page.getByRole('textbox', { name: 'Constant value' }).fill('torque-target')
  await page.getByRole('button', { name: 'New subprocess', exact: true }).click()
  await page.getByRole('textbox', { name: 'Subprocess name' }).fill('Inspection')
  await page.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Sequence name', exact: true })).toHaveValue('Inspection')
  await page.getByRole('button', { name: 'Add step', exact: true }).click()
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Check torque')
  await page.getByRole('button', { name: 'PlanIntegrationProduct', exact: true }).click()
  await page.getByRole('button', { name: 'Run in parallel', exact: true }).click()
  await page.getByRole('button', { name: 'Branch 1', exact: true }).click()
  await page.getByRole('button', { name: 'Call subprocess', exact: true }).click()
  await expect(page.getByText('The next step waits for this entire subprocess to complete.', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Branch 2', exact: true }).click()
  await page.getByRole('button', { name: 'Add step', exact: true }).click()
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Prepare control')
  await page.getByRole('button', { name: 'Add step', exact: true }).click()
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Temporary step')
  await page.getByRole('button', { name: 'Move step earlier', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Move step earlier', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Move step later', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Move step later', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Remove selected', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Temporary step', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Save draft', exact: true }).click()
  await expect(page.getByText('Process plan saved with the product.', { exact: true })).toBeVisible()

  const saved = await request.get(`${repository}/submodels/${encode(definitionId)}`)
  expect(saved.ok()).toBe(true)
  const plan = readSequenceSubmodel(await saved.json())
  expect(plan.revision).toBe(1)
  expect(plan.scopes).toHaveLength(4)
  const parallel = plan.scopes[0].nodes[0]
  if (parallel.kind !== 'parallel') {
    throw new Error('Missing parallel group')
  }
  const driveStep = plan.scopes.find(scope => scope.name === 'Drive')!.nodes[0]
  if (driveStep.kind !== 'step') {
    throw new Error('Missing drive operation')
  }
  expect(parallel.branches[0].nodes[0].kind).toBe('call')
  expect(parallel.branches[1].nodes[0].name).toBe('Prepare control')
  expect(driveStep.process!.parameters).toHaveLength(3)
  expect(driveStep).toMatchObject({
    resourceAasId: resourceId, skillId: 'Inspect', bindings: [{ name: 'setpoint', value: 'torque-target', source: null }],
    requiredCapabilities: [
      { name: 'Inspect', reference: requirementReference('Inspect') },
      { name: 'Prepare', reference: requirementReference('Prepare') },
    ],
    process: { source: { path: ['Operations', 'Inspection'] } },
  })

  await page.evaluate(() => sessionStorage.clear())
  await page.reload()
  await expect(page.getByText('Saved revision 1', { exact: true })).toBeVisible()
  await expect(page.getByText('Wait for all branches', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Prepare control', exact: true })).toBeVisible()
  await page.screenshot({ path: test.info().outputPath('assembly-process-editor.png'), fullPage: true })
  await page.getByRole('button', { name: 'Combined steps', exact: true }).click()
  await expect(page.getByRole('cell', { name: '1. Prepare drive', exact: true })).toBeVisible()
  await expect(page.getByRole('cell', { name: '2. Prepare control', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Edit sequence', exact: true }).click()
  await page.getByRole('treeitem', { name: 'Inspection', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Check torque', exact: true })).toBeVisible()
  await page.getByRole('treeitem', { name: 'Drive', exact: true }).click()
  await page.getByRole('button', { name: 'Prepare drive', exact: true }).click()
  await expect(page.getByText('Requirements for this step in the plan.', { exact: true })).toBeVisible()
  await expect(page.getByText('Semantic resource candidates: PlanIntegrationResource', { exact: true })).toBeVisible()
})
