import { Buffer } from 'node:buffer'
import { expect, test } from '@playwright/test'
import fixture from '../../src/pages/modules/ProcessSequence/skills/fixtures/fillingModule.json' with { type: 'json' }

/**
 * The skill editor in a browser, on a disposable copy of the filling module (its AAS, its components'
 * AASs) posted to a BaSyx repository under ids of its own and removed afterwards:
 * the Skills submodel opens on the overview, a skill in the editor; a constant is changed and saved
 * as that skill's element alone; a new skill is described (Deployment Described) and opened.
 *
 * Run with a dev server of this module on port 4173 (see the skills README): PS_REPO_URL names the
 * repository, IT_SHOTS a folder for screenshots.
 */
const repository = process.env.PS_REPO_URL
const shots = process.env.IT_SHOTS
const prefix = `urn:skill-editor:test:${Date.now()}`
const copy = JSON.parse(JSON.stringify(fixture)
  .replaceAll('https://smartproductionlab.aau.dk/aas/', `${prefix}/aas/`)
  .replaceAll('https://smartproductionlab.aau.dk/assets/', `${prefix}/assets/`)) as typeof fixture
const encode = (value: string) => Buffer.from(value).toString('base64url')
const moduleId = `${prefix}/aas/FillingModuleAAS`
const skillsId = `${moduleId}/submodels/Skills`

test.use({ channel: process.env.IT_BROWSER_CHANNEL || undefined, video: 'off' })
test.skip(!repository, 'Set PS_REPO_URL to a BaSyx repository the test may add a disposable module to.')
test.beforeAll(async ({ request }) => {
  for (const [collection, models] of [['submodels', copy.submodels], ['shells', copy.assetAdministrationShells]] as const) {
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
  for (const [collection, models] of [['shells', copy.assetAdministrationShells], ['submodels', copy.submodels]] as const) {
    for (const model of models) {
      await request.delete(`${repository}/${collection}/${encode(model.id)}`, { maxRetries: 2 })
    }
  }
})

test('the Skills submodel opens on the overview, a skill in the editor', async ({ page, request }) => {
  test.setTimeout(180_000)
  await page.setViewportSize({ width: 1720, height: 1080 })
  // Only this test's shells, so the module's components are this copy's.
  await page.route('**/shells?*', async route => {
    const response = await route.fetch()
    const body = await response.json()
    if (Array.isArray(body.result)) {
      body.result = body.result.filter((shell: { id: string }) => shell.id.startsWith(prefix))
    }
    await route.fulfill({ response, json: body })
  })
  await page.addInitScript(repository => {
    localStorage.setItem('basyxInfrastructures', JSON.stringify({ selectedInfrastructureId: 'skills-test', infrastructures: [{ id: 'skills-test', name: 'Skills test', template: 'mono-repo', isDefault: true, auth: { securityType: 'No Authentication' }, components: Object.fromEntries(['AASDiscovery', 'AASRegistry', 'SubmodelRegistry', 'AASRepo', 'SubmodelRepo', 'ConceptDescriptionRepo', 'CompanyLookup'].map(key => [key, { url: ['AASRepo', 'SubmodelRepo', 'ConceptDescriptionRepo'].includes(key) ? repository : '' }])) }] }))
    localStorage.setItem('process-sequence.skill-service', 'http://127.0.0.1:9') // nothing answers there
  }, repository!)

  await page.goto(`/aasviewer?aas=${encodeURIComponent(`${repository}/shells/${encode(moduleId)}`)}&path=${encodeURIComponent(`${repository}/submodels/${encode(skillsId)}`)}`)
  // Plugins show in the Visualization tab.
  await page.getByText('Visualization', { exact: true }).click()
  await expect(page.getByText('Skills of FillingModuleAAS')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('Start: NeedleDown → Dispense → Home → Weigh')).toBeVisible()
  await expect(page.getByText('Building blocks: the components\' skills')).toBeVisible()
  await expect(page.getByText('FillingPumpAAS', { exact: false }).first()).toBeVisible()
  if (shots) {
    await page.screenshot({ path: `${shots}/skills-overview.png`, fullPage: true })
  }

  // A skill of the module, from the overview: the editor on its element.
  await page.getByRole('link', { name: 'Dispensing', exact: true }).click()
  await expect(page.getByText('Module level skill')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('button', { name: 'Start runs' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'NeedleDown' })).toBeVisible()
  if (shots) {
    await page.screenshot({ path: `${shots}/skill-editor.png`, fullPage: true })
  }

  // A flow rate the pump does not take is refused before saving; one it takes is saved.
  await page.getByRole('button', { name: 'Dispense', exact: true }).click()
  const flowRate = page.locator('.d-flex', { has: page.getByText('FlowRate', { exact: true }) }).locator('input').last()
  await flowRate.fill('9')
  await expect(page.getByText('is outside what Dispense takes')).toBeVisible()
  await flowRate.fill('2.0')
  await expect(page.getByText('is outside what Dispense takes')).toHaveCount(0)
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText('Saved, but the capabilities were not derived anew.')).toBeVisible({ timeout: 30_000 })
  const dispensing = await (await request.get(`${repository}/submodels/${encode(skillsId)}/submodel-elements/Dispensing`)).json()
  const steps = dispensing.value.find((item: { idShort: string }) => item.idShort === 'Start').value.find((item: { idShort: string }) => item.idShort === 'Steps')
  expect(JSON.stringify(steps)).toContain('"value":"2.0"')

  // A new skill like this one: described, not built, and opened.
  await page.getByRole('button', { name: 'New skill from this' }).click()
  await page.getByLabel('Name', { exact: true }).last().fill('DoubleDose')
  await page.getByRole('button', { name: 'Create' }).click()
  await expect(page.getByText('Described, not built', { exact: true })).toBeVisible({ timeout: 30_000 })
  const made = await (await request.get(`${repository}/submodels/${encode(skillsId)}/submodel-elements/DoubleDose`)).json()
  expect(made.value.find((item: { idShort: string }) => item.idShort === 'Deployment').value).toBe('Described')
  if (shots) {
    await page.screenshot({ path: `${shots}/skill-new.png`, fullPage: true })
  }
})
