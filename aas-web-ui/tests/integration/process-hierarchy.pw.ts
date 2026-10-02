import type { APIRequestContext, Page } from '@playwright/test'
import { Buffer } from 'node:buffer'
import { expect, test } from '@playwright/test'
import { readSequenceSubmodel } from '../../src/pages/modules/ProcessSequence/utils/sequenceModel'
import { normalizeBasePath, toBaseScopedPath } from './basePath'

const repository = process.env.PS_REPO_URL
const prefix = `urn:shared-plan:test:${Date.now()}`
const robot = `${prefix}:robot`
const drive = `${prefix}:drive`
const encode = (value: string) => Buffer.from(value).toString('base64url')
const planId = (id: string) => `https://smartproductionlab.aau.dk/sm/process-plan/${encode(id)}`
const reference = (type: string, value: string) => ({ type: 'ModelReference', keys: [{ type, value }] })
const semantic = (value: string) => ({ type: 'ExternalReference', keys: [{ type: 'GlobalReference', value }] })
const attachment = (id: string) => `${repository}/submodels/${encode(planId(id))}/submodel-elements/Definition/attachment`

test.use({ channel: process.env.IT_BROWSER_CHANNEL || undefined, video: 'off' })
test.skip(!repository, 'Set PS_REPO_URL to run against the current Docker UI and repository.')

async function post (request: APIRequestContext, collection: string, data: unknown): Promise<void> {
  const response = await request.post(`${repository}/${collection}`, { data })
  expect(response.ok(), await response.text()).toBe(true)
}

test.beforeAll(async ({ request }) => {
  if (!repository) {
    return
  }
  for (const [id, name] of [[robot, 'SharedRobotTest'], [drive, 'SharedDriveTest']]) {
    const root = {
      id: 'product', name, parentId: null, material: null,
      nodes: id === robot
        ? [{ id: 'call-drive', kind: 'call', name: 'Build shared drive', scopeId: 'drive' }]
        : [{ id: 'assemble', kind: 'step', name: 'Assemble drive', process: null, resourceAasId: '', skillId: '', bindings: [] }],
    }
    const scopes: unknown[] = [root]
    if (id === robot) {
      scopes.push({
        id: 'drive', name: 'SharedDriveTest', parentId: 'product', nodes: [], planAasId: drive,
        material: { aasId: robot, submodelId: `${robot}:bom`, path: ['Product', 'Drive'], globalAssetId: `${drive}:asset` },
      })
    }
    await post(request, 'submodels', {
      modelType: 'Submodel', id: `${id}:inputs`, idShort: 'ProcessParameters',
      semanticId: semantic('https://admin-shell-io/idta/SubmodelTemplate/ProcessParameters/1/0'),
      submodelElements: [{ modelType: 'SubmodelElementCollection', idShort: 'Processes', value: [], semanticId: semantic('https://admin-shell.io/idta/ProcessParameters/Processes/1/0') }],
    })
    await post(request, 'submodels', {
      modelType: 'Submodel', id: `${id}:bom`, idShort: 'HierarchicalStructures',
      semanticId: semantic('https://admin-shell.io/idta/HierarchicalStructures/1/0/Submodel'),
      submodelElements: [{
        modelType: 'Entity', idShort: 'Product', entityType: 'SelfManagedEntity', globalAssetId: `${id}:asset`,
        statements: id === robot ? [{ modelType: 'Entity', idShort: 'Drive', entityType: 'SelfManagedEntity', globalAssetId: `${drive}:asset`, statements: [] }] : [],
      }],
    })
    await post(request, 'submodels', {
      modelType: 'Submodel', id: planId(id), idShort: 'ProcessSequencePlan',
      semanticId: semantic('https://smartproductionlab.aau.dk/SubmodelTemplate/ProcessSequence/2/0'),
      submodelElements: [{ modelType: 'File', idShort: 'Definition', contentType: 'application/json', value: '' }],
    })
    const data = { schema: 'process-sequence-plan/3.0', productAasId: id, revision: 1, rootScopeId: 'product', scopes }
    const upload = await request.put(attachment(id), { multipart: {
      fileName: 'process-plan.json', file: { name: 'process-plan.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) },
    } })
    expect(upload.ok(), await upload.text()).toBe(true)
    await post(request, 'shells', {
      modelType: 'AssetAdministrationShell', id, idShort: name,
      assetInformation: { assetKind: 'Type', globalAssetId: `${id}:asset` },
      submodels: [planId(id), `${id}:inputs`, `${id}:bom`].map(sm => reference('Submodel', sm)),
    })
  }
})

test.afterAll(async ({ request }) => {
  if (!repository) {
    return
  }
  for (const id of [robot, drive]) {
    await request.delete(`${repository}/shells/${encode(id)}`)
    for (const sm of [planId(id), `${id}:inputs`, `${id}:bom`]) {
      await request.delete(`${repository}/submodels/${encode(sm)}`)
    }
  }
})

async function selectProduct (page: Page, name: string): Promise<void> {
  const picker = page.getByRole('combobox', { name: 'Product to plan', exact: true })
  await expect(picker).toBeEnabled({ timeout: 60_000 })
  await picker.fill(name)
  await page.keyboard.press('ArrowDown')
  await page.getByRole('option', { name, exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Sequence name', exact: true })).toHaveValue(name)
}

test('edits one assembly definition directly and through a parent, including a new nested subprocess', async ({ page, request }) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1720, height: 1080 })
  await page.addInitScript(repository => {
    localStorage.setItem('basyxInfrastructures', JSON.stringify({
      selectedInfrastructureId: 'shared-plan-test', infrastructures: [{
        id: 'shared-plan-test', name: 'Shared plans', template: 'mono-repo', isDefault: true,
        auth: { securityType: 'No Authentication' },
        components: Object.fromEntries(['AASDiscovery', 'AASRegistry', 'SubmodelRegistry', 'AASRepo', 'SubmodelRepo', 'ConceptDescriptionRepo', 'CompanyLookup']
          .map(key => [key, { url: ['AASRepo', 'SubmodelRepo', 'ConceptDescriptionRepo'].includes(key) ? repository : '' }])),
      }],
    }))
  }, repository!)
  await page.goto(toBaseScopedPath(normalizeBasePath(process.env.IT_BASE_PATH ?? '/ui/'), 'modules/processsequence'))
  await selectProduct(page, 'SharedDriveTest')
  await expect(page.getByRole('treeitem', { name: 'SharedRobotTest', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Assemble drive', exact: true }).click()
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Edited from assembly')
  await page.getByRole('button', { name: 'Save draft', exact: true }).click()
  await expect(page.getByText('Process plan saved with the product.', { exact: true })).toBeVisible()
  expect((await (await request.get(attachment(robot))).json()).revision).toBe(1)

  await selectProduct(page, 'SharedRobotTest')
  await page.getByRole('treeitem', { name: 'SharedDriveTest', exact: true }).click()
  await page.getByRole('button', { name: 'Edited from assembly', exact: true }).click()
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Edited through robot')
  await page.getByRole('button', { name: 'New subprocess', exact: true }).click()
  await page.getByRole('textbox', { name: 'Subprocess name', exact: true }).fill('Shared diagnostics')
  await page.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Sequence name', exact: true })).toHaveValue('Shared diagnostics')
  await page.getByRole('button', { name: 'Add step', exact: true }).click()
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Check shared motor')
  await page.getByRole('button', { name: 'Save draft', exact: true }).click()
  await expect(page.getByText('Process plan saved with the product.', { exact: true })).toBeVisible()

  const storedChild = readSequenceSubmodel(await (await request.get(`${repository}/submodels/${encode(planId(drive))}`)).json())
  expect(storedChild.scopes.some((scope: { name: string }) => scope.name === 'Shared diagnostics')).toBe(true)
  const storedParent = await (await request.get(attachment(robot))).json()
  expect(storedParent.scopes).toHaveLength(2)
  expect(storedParent.scopes[1].nodes).toEqual([])
  expect(storedParent.scopes[1].planAasId).toBe(drive)

  await selectProduct(page, 'SharedDriveTest')
  await expect(page.getByRole('button', { name: 'Edited through robot', exact: true })).toBeVisible()
  await page.getByRole('treeitem', { name: 'Shared diagnostics', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Check shared motor', exact: true })).toBeVisible()
  await page.evaluate(() => sessionStorage.clear())
  await page.reload()
  await expect(page.getByRole('treeitem', { name: 'Shared diagnostics', exact: true })).toBeVisible()
})
