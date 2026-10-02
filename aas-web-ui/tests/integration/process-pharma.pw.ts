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
const fixture = JSON.parse(JSON.stringify(original).replaceAll(PHARMA_BASE, prefix)) as typeof original
test.use({ channel: process.env.IT_BROWSER_CHANNEL || undefined, video: 'off' })
test.skip(!repository, 'Set PS_REPO_URL to a disposable BaSyx repository.')

test.beforeAll(async ({ request }) => {
  for (const [collection, models] of [['submodels', fixture.submodels], ['shells', fixture.shells]] as const) {
    for (let index = 0; index < models.length; index += 10) {
      await Promise.all(models.slice(index, index + 10).map(async data => {
        const response = await request.post(`${repository}/${collection}`, { data })
        expect(response.ok(), await response.text()).toBe(true)
      }))
    }
  }
})

test.afterAll(async ({ request }) => {
  if (!repository) {
    return
  }
  for (const [collection, models] of [['shells', fixture.shells], ['submodels', fixture.submodels]] as const) {
    for (let index = 0; index < models.length; index += 10) {
      await Promise.all(models.slice(index, index + 10).map(async model => {
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
          expect(response.ok() || response.status() === 404).toBe(true)
          break
        }
      }))
    }
  }
})

test('reviews all pharma recipes, checks station limits and reads the native AAS sequence', async ({ page, request }) => {
  test.setTimeout(180_000)
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
    const comparison = page.getByRole('button', { name: /Filling station.*Within declared limits/ })
    await expect(comparison).toBeVisible({ timeout: 30_000 })
    await comparison.click()
    await expect(page.getByText(new RegExp(`FillVolume: required ${recipe.volume.at(-1)}`))).toBeVisible()
    await page.getByRole('button', { name: 'Use matching station skill', exact: true }).click()
    await expect(page.getByText(`Filling ${recipe.format}`, { exact: true })).toBeVisible()
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
