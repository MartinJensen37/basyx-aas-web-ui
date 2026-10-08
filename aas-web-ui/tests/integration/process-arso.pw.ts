import type { StepNode } from '../../src/pages/modules/ProcessSequence/types/plan'
import { Buffer } from 'node:buffer'
import { expect, test } from '@playwright/test'
import { ARSO_FIXTURE_BASE, buildArsoFixture } from '../../src/pages/modules/ProcessSequence/fixtures/arsoResources'
import { newPlan } from '../../src/pages/modules/ProcessSequence/utils/plan'
import { readPlanProcesses } from '../../src/pages/modules/ProcessSequence/utils/planSources'
import { buildSequenceDocuments, defaultSequenceId } from '../../src/pages/modules/ProcessSequence/utils/sequenceDocuments'
import { normalizeBasePath, toBaseScopedPath } from './basePath'
import { cleanSequenceDocuments, readStoredSequence } from './processSequence'

const repository = process.env.PS_REPO_URL
const prefix = `urn:arso:test:${Date.now()}`
const fixture = JSON.parse(JSON.stringify(buildArsoFixture()).replaceAll(ARSO_FIXTURE_BASE, prefix)) as ReturnType<typeof buildArsoFixture>
const owner = `${prefix}/Vial2mLAAS`
const encode = (value: string) => Buffer.from(value).toString('base64url')
const processes = fixture.submodels.flatMap(model => readPlanProcesses(model, owner))
const plan = newPlan(owner, 'ARSO vial')
plan.scopes[0].nodes = processes.map(process => ({ id: process.processId, kind: 'step', name: process.name, process, resourceAasId: '', skillId: '', bindings: [] }))
const sequence = buildSequenceDocuments(plan, defaultSequenceId(owner), processes)[0]!
fixture.submodels.push(sequence)
fixture.shells.find(shell => shell.id === owner)!.submodels.push({ type: 'ModelReference', keys: [{ type: 'Submodel', value: sequence.id }] })

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
  await cleanSequenceDocuments(request, repository, fixture.shells.map(shell => shell.id))
  for (const [collection, models] of [['shells', fixture.shells], ['submodels', fixture.submodels]] as const) {
    for (const model of models) {
      await request.delete(`${repository}/${collection}/${encode(model.id)}`, { maxRetries: 2 })
    }
  }
})

test('assigns ARSO skills, binds recipe inputs, links results and rechecks changed recipe values', async ({ page, request }) => {
  test.setTimeout(180_000)
  await page.setViewportSize({ width: 1720, height: 1080 })
  await page.route('**/shells?*', async route => {
    const response = await route.fetch()
    const body = await response.json()
    if (Array.isArray(body.result)) {
      body.result = body.result.filter((shell: { id: string }) => shell.id.startsWith(prefix))
    }
    await route.fulfill({ response, json: body })
  })
  await page.addInitScript(repository => {
    localStorage.setItem('basyxInfrastructures', JSON.stringify({ selectedInfrastructureId: 'arso-test', infrastructures: [{ id: 'arso-test', name: 'ARSO test', template: 'mono-repo', isDefault: true, auth: { securityType: 'No Authentication' }, components: Object.fromEntries(['AASDiscovery', 'AASRegistry', 'SubmodelRegistry', 'AASRepo', 'SubmodelRepo', 'ConceptDescriptionRepo', 'CompanyLookup'].map(key => [key, { url: ['AASRepo', 'SubmodelRepo', 'ConceptDescriptionRepo'].includes(key) ? repository : '' }])) }] }))
  }, repository!)
  await page.goto(toBaseScopedPath(normalizeBasePath(process.env.IT_BASE_PATH ?? '/ui/'), 'modules/processsequence'))
  const picker = page.getByRole('combobox', { name: 'Product to plan', exact: true })
  await expect(picker).toBeEnabled({ timeout: 60_000 })
  await picker.fill('Vial2mLAAS')
  await page.getByRole('option', { name: 'Vial2mLAAS', exact: true }).click()
  for (const operation of ['Capping', 'Stoppering', 'Filling', 'Inspection']) {
    await page.getByRole('button', { name: operation, exact: true }).click()
    await page.getByRole('button', { name: 'Match resources', exact: true }).click()
    await page.getByRole('button', { name: `Use ${operation}ModuleAAS`, exact: true }).click()
    await expect(page.getByLabel('Matching resources', { exact: true })).toBeHidden()
    if (operation === 'Filling') {
      await page.getByRole('button', { name: 'Expand Resource assignment', exact: true }).click()
      await expect(page.getByRole('combobox', { name: 'Resource skill', exact: true })).toHaveValue('Dispensing')
      await expect(page.getByRole('combobox', { name: 'Value source', exact: true })).toHaveValue('ProductParameters / FillVolume')
      await expect(page.getByText('Session', { exact: true })).toHaveCount(0)
      await page.getByRole('button', { name: 'Collapse Resource assignment', exact: true }).click()
    }
  }
  await page.getByRole('button', { name: 'Expand Operation outputs', exact: true }).click()
  await page.getByRole('button', { name: 'Add skill results', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Output name', exact: true }).first()).toHaveValue('TopPassed')
  await expect(page.getByRole('textbox', { name: 'Output name', exact: true }).nth(1)).toHaveValue('SidePassed')
  await page.getByRole('button', { name: 'Save draft', exact: true }).click()
  await expect(page.getByText('Process plan saved with the product.', { exact: true })).toBeVisible()
  const saved = await readStoredSequence(await (await request.get(`${repository}/submodels/${encode(sequence.id)}`)).json(), request, repository!)
  const steps = saved.scopes[0].nodes as StepNode[]
  const fill = steps.find(node => node.id === 'Filling')!
  expect(fill.bindings[0]).toMatchObject({ name: 'Volume', value: '', source: { path: ['Processes', 'Filling', 'ProductParameters', 'FillVolume'] }, target: { keys: expect.arrayContaining([{ type: 'Property', value: 'Volume' }]) } })
  const inspection = steps.find(node => node.id === 'Inspection')!
  expect(inspection.outputs).toHaveLength(2)
  expect(inspection.outputs![0].source!.keys.at(-1)).toEqual({ type: 'Property', value: 'TopPassed' })
  await page.getByRole('button', { name: 'Reload plans', exact: true }).click()
  await page.getByRole('button', { name: 'Inspection', exact: true }).click()
  await page.getByRole('button', { name: 'Expand Operation outputs', exact: true }).click()
  await expect(page.getByRole('combobox', { name: 'Skill result', exact: true }).first()).toHaveValue('TopPassed')
  // Change only the process source, leaving the required capability's old 2 mL scalar intact.
  const source = structuredClone(fixture.submodels.find(model => model.idShort === 'ProcessParameters')!)
  const operation = source.submodelElements[0].value.find((element: any) => element.idShort === 'Filling')
  operation.value.find((element: any) => element.idShort === 'ProductParameters').value.find((element: any) => element.idShort === 'FillVolume').value = '12'
  expect((await request.put(`${repository}/submodels/${encode(source.id)}`, { data: source })).ok()).toBe(true)
  await page.getByRole('button', { name: 'Reload plans', exact: true }).click()
  await page.getByRole('button', { name: 'Filling', exact: true }).click()
  await page.getByRole('button', { name: 'Match resources', exact: true }).click()
  const comparison = page.getByLabel('FillingModuleAAS', { exact: true })
  await expect(comparison.getByText('Outside requirements', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Use FillingModuleAAS', exact: true })).toHaveCount(0)
  await comparison.getByRole('button', { name: 'Comparison details', exact: true }).click()
  await expect(page.getByText(/FillVolume: required 12/)).toBeVisible()
})
