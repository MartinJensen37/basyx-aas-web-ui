import type { Page } from '@playwright/test'
import { Buffer } from 'node:buffer'
import { expect, test } from '@playwright/test'
import { buildPharmaDemo, PHARMA_BASE, PHARMA_RECIPES } from '../../src/pages/modules/ProcessSequence/demo/pharma'
import { readSequenceSubmodel, SEQUENCE_SEMANTIC_ID } from '../../src/pages/modules/ProcessSequence/utils/sequenceModel'
import { normalizeBasePath, toBaseScopedPath } from './basePath'

const repository = process.env.PS_REPO_URL
const prefix = `urn:pharma:test:${Date.now()}`
const encode = (value: string) => Buffer.from(value).toString('base64url')
const planId = (value: string) => `https://smartproductionlab.aau.dk/sm/process-plan/${encode(value)}`
const original = buildPharmaDemo(id => planId(id.replace(PHARMA_BASE, prefix)))
const fillingStation = original.shells.find(shell => shell.id.endsWith('/aas/filling-station'))!
const backup = JSON.parse(JSON.stringify({
  shell: fillingStation,
  submodels: original.submodels.filter(model => fillingStation.submodels.some((reference: { keys: { value: string }[] }) => reference.keys[0].value === model.id)),
}).replaceAll('/filling-station', '/backup-filling-station').replaceAll('Filling station', 'Backup filling station'))
original.shells.push(backup.shell)
original.submodels.push(...backup.submodels)
const fixture = JSON.parse(JSON.stringify(original).replaceAll(PHARMA_BASE, prefix)) as typeof original
test.use({ channel: process.env.IT_BROWSER_CHANNEL || undefined, video: 'off' })
test.skip(!repository, 'Set PS_REPO_URL to a disposable BaSyx repository.')

test.beforeAll(async ({ request }) => {
  for (const [collection, models] of [['submodels', fixture.submodels], ['shells', fixture.shells]] as const) {
    for (const data of models) {
      const response = await request.post(`${repository}/${collection}`, { data })
      expect(response.ok(), await response.text()).toBe(true)
    }
  }
})

test.afterAll(async ({ request }) => {
  if (!repository) {
    return
  }
  for (const [collection, models] of [['shells', fixture.shells], ['submodels', fixture.submodels]] as const) {
    for (const model of models) {
      // A dev server can close idle pooled connections while the browser test runs.
      // DELETE is idempotent, so a bounded transport retry is safe for fixture cleanup.
      for (let attempt = 0; attempt < 3; attempt++) {
        let response
        try {
          response = await request.delete(`${repository}/${collection}/${encode(model.id)}`, { timeout: 5000, maxRetries: 2 })
        } catch (error) {
          if (attempt === 2) {
            throw error
          }
          continue
        }
        expect(response.ok() || response.status() === 404, `${collection}/${model.id}: ${response.status()} ${await response.text()}`).toBe(true)
        break
      }
    }
  }
})

async function openWorkspace (page: Page): Promise<void> {
  await page.setViewportSize({ width: 1720, height: 1080 })
  // Restrict the picker catalog to this test's objects while using the actual repository for every model.
  await page.route('**/shells?*', async route => {
    const response = await route.fetch()
    const body = await response.json()
    if (Array.isArray(body.result)) {
      body.result = body.result.filter((shell: { id: string }) => shell.id.startsWith(prefix))
    }
    await route.fulfill({ response, json: body })
  })
  await page.addInitScript(repository => {
    localStorage.setItem('basyxInfrastructures', JSON.stringify({
      selectedInfrastructureId: 'pharma-test', infrastructures: [{
        id: 'pharma-test', name: 'Pharma test', template: 'mono-repo', isDefault: true, auth: { securityType: 'No Authentication' },
        components: Object.fromEntries(['AASDiscovery', 'AASRegistry', 'SubmodelRegistry', 'AASRepo', 'SubmodelRepo', 'ConceptDescriptionRepo', 'CompanyLookup']
          .map(key => [key, { url: ['AASRepo', 'SubmodelRepo', 'ConceptDescriptionRepo'].includes(key) ? repository : '' }])),
      }],
    }))
  }, repository!)
  await page.goto(toBaseScopedPath(normalizeBasePath(process.env.IT_BASE_PATH ?? '/ui/'), 'modules/processsequence'))
}

test('reviews all pharma recipes, checks station limits and reads the native AAS sequence', async ({ page, request }) => {
  test.setTimeout(180_000)
  await openWorkspace(page)
  for (const recipe of PHARMA_RECIPES) {
    const picker = page.getByRole('combobox', { name: 'Product to plan', exact: true })
    await expect(picker).toBeEnabled({ timeout: 60_000 })
    await picker.fill(recipe.name)
    await page.getByRole('option', { name: recipe.name, exact: true }).click()
    await expect(page.getByRole('textbox', { name: 'Sequence name', exact: true })).toHaveValue(recipe.name)
    await expect(page.getByRole('button', { name: 'Unpacking', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Capping', exact: true })).toHaveCount(recipe.format === 'vial' ? 1 : 0)
    const fillName = recipe.volume.length === 2 ? 'Filling — dose 2' : 'Filling'
    await page.getByRole('button', { name: fillName, exact: true }).click()
    await page.getByRole('button', { name: 'Match resources', exact: true }).click()
    const comparison = page.getByLabel('Filling station', { exact: true })
    await expect(comparison.getByText('Within declared limits', { exact: true })).toBeVisible({ timeout: 30_000 })
    await comparison.getByRole('button', { name: 'Comparison details', exact: true }).click()
    await expect(page.getByText(new RegExp(`FillVolume: required ${recipe.volume.at(-1)}`))).toBeVisible()
    await page.getByRole('button', { name: 'Use Filling station', exact: true }).click()
    await expect(page.getByText(`Filling ${recipe.format}`, { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Complete', exact: true })).toHaveAttribute('aria-pressed', 'false')
    await page.getByRole('button', { name: 'Save draft', exact: true }).click()
    await expect(page.getByText('Process plan saved with the product.', { exact: true })).toBeVisible()
    const response = await request.get(`${repository}/submodels/${encode(planId(`${prefix}/aas/${recipe.id}`))}`)
    expect(response.ok()).toBe(true)
    const model = await response.json()
    expect(model.semanticId.keys[0].value).toBe(SEQUENCE_SEMANTIC_ID)
    expect(model.submodelElements.some((element: { modelType: string }) => element.modelType === 'File')).toBe(false)
    expect(readSequenceSubmodel(model).scopes[0].nodes).toHaveLength(recipe.format === 'vial' ? 8 : (recipe.volume.length === 2 ? 9 : 7))
    await expect(page.getByRole('tab', { name: /BPMN/i })).toHaveCount(0)
    await expect(page.getByText(/download.*draft.*before|recovered.*draft/i)).toHaveCount(0)
  }
  const picker = page.getByRole('combobox', { name: 'Product to plan', exact: true })
  await picker.fill('Packing tray')
  await page.getByRole('option', { name: 'Packing tray', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Sequence name', exact: true })).toHaveValue('Packing tray')
  await expect(page.getByText('Saved revision 0', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Save draft', exact: true }).click()
  await expect(page.getByText('Saved revision 0', { exact: true })).toBeVisible()
})

test('makes inspection optional, saves its interval and previews the inspection and skip paths', async ({ page, request }) => {
  test.setTimeout(180_000)
  await openWorkspace(page)
  const picker = page.getByRole('combobox', { name: 'Product to plan', exact: true })
  await expect(picker).toBeEnabled({ timeout: 60_000 })
  await picker.fill('Vial 2 mL')
  await page.getByRole('option', { name: 'Vial 2 mL', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Sequence name', exact: true })).toHaveValue('Vial 2 mL')
  await page.getByRole('button', { name: 'Inspection', exact: true }).click()
  await page.getByRole('button', { name: 'Make optional', exact: true }).click()
  const interval = page.getByRole('spinbutton', { name: 'Run every N products', exact: true })
  await expect(interval).toHaveValue('5')
  await interval.fill('0')
  await expect(page.getByText('Enter a positive whole number of products.', { exact: true })).toBeVisible()
  await interval.fill('7')
  await expect(page.getByText('Every 7 products', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Skip this flow', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Save draft', exact: true }).click()
  await expect(page.getByText('Process plan saved with the product.', { exact: true })).toBeVisible()
  const endpoint = `${repository}/submodels/${encode(planId(`${prefix}/aas/vial-2ml`))}`
  const stored = readSequenceSubmodel(await (await request.get(endpoint)).json())
  expect(stored.schema).toBe('process-sequence-plan/4.0')
  expect(stored.scopes[0].nodes.find(node => node.kind === 'conditional')).toMatchObject({ condition: { kind: 'everyNthProduct', every: 7 }, nodes: [{ name: 'Inspection', resourceAasId: `${prefix}/aas/inspection-station` }] })
  await page.getByRole('button', { name: 'Combined steps', exact: true }).click()
  const number = page.getByRole('spinbutton', { name: 'Product number in run', exact: true })
  await expect(page.getByRole('row', { name: /^\d+\. Inspection / })).toHaveCount(0)
  await expect(page.getByRole('row', { name: /^6\. Unloading / })).toBeVisible()
  await number.fill('7')
  await expect(page.getByRole('row', { name: /^6\. Inspection / })).toBeVisible()
  await number.fill('8')
  await expect(page.getByRole('row', { name: /^\d+\. Inspection / })).toHaveCount(0)
  await page.getByRole('button', { name: 'Edit sequence', exact: true }).click()
  await page.getByRole('button', { name: 'Reload plans', exact: true }).click()
  await page.getByRole('button', { name: 'Optional Inspection', exact: true }).click()
  await expect(interval).toHaveValue('7')
  await page.getByRole('button', { name: 'Run every product', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Skip this flow', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Save draft', exact: true }).click()
  await expect(page.getByText('Process plan saved with the product.', { exact: true })).toBeVisible()
  const restored = readSequenceSubmodel(await (await request.get(endpoint)).json())
  expect(restored.scopes[0].nodes.some(node => node.kind === 'conditional')).toBe(false)
  expect(restored.scopes[0].nodes.find(node => node.id === 'Inspection')).toMatchObject({ name: 'Inspection', process: { processId: 'Inspection' } })
})

test('chooses between matching resources and persists an unassigned step', async ({ page, request }) => {
  test.setTimeout(180_000)
  await openWorkspace(page)
  const picker = page.getByRole('combobox', { name: 'Product to plan', exact: true })
  await expect(picker).toBeEnabled({ timeout: 60_000 })
  await picker.fill('Vial 2 mL')
  await page.getByRole('option', { name: 'Vial 2 mL', exact: true }).click()
  await page.getByRole('button', { name: 'Filling', exact: true }).click()
  await expect(page.getByText('Planning checks', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Match resources', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Use Filling station', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Use Backup filling station', exact: true }).click()
  const resource = page.getByRole('combobox', { name: 'Resource (optional)', exact: true })
  await expect(resource).toHaveValue('Backup filling station')
  await page.getByRole('button', { name: 'Save draft', exact: true }).click()
  await expect(page.getByText('Process plan saved with the product.', { exact: true })).toBeVisible()
  const endpoint = `${repository}/submodels/${encode(planId(`${prefix}/aas/vial-2ml`))}`
  const assigned = readSequenceSubmodel(await (await request.get(endpoint)).json())
  expect(assigned.scopes[0].nodes.find(node => node.id === 'Filling_1')).toMatchObject({ resourceAasId: `${prefix}/aas/backup-filling-station` })
  await resource.fill('No resource')
  await page.getByRole('option', { name: 'No resource', exact: true }).click()
  await expect(page.getByRole('combobox', { name: 'Resource skill', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Save draft', exact: true }).click()
  await expect(page.getByText('Process plan saved with the product.', { exact: true })).toBeVisible()
  const cleared = readSequenceSubmodel(await (await request.get(endpoint)).json())
  const step = cleared.scopes[0].nodes.find(node => node.id === 'Filling_1')!
  expect(step).toMatchObject({ resourceAasId: '', skillId: '', bindings: [] })
  expect(step).not.toHaveProperty('skillReference')
  await page.getByRole('button', { name: 'Reload plans', exact: true }).click()
  await page.getByRole('button', { name: 'Filling', exact: true }).click()
  await expect(resource).toHaveValue('No resource')
})
