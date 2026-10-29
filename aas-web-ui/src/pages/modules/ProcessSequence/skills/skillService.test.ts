import { describe, expect, it } from 'vitest'
import { checkSkill, findingLine, planSkill, processLine, writeProcess } from './skillService'

const service = 'http://service'
const shell = 'https://smartproductionlab.aau.dk/aas/FillingModuleAAS'

/** A fetch that records the request and answers with ``status`` and ``body``. */
function answering (status: number, body: unknown) {
  const sent: { url: string, init: RequestInit }[] = []
  const fetcher = (async (url: string, init: RequestInit) => {
    sent.push({ url, init })
    return Response.json(body, { status })
  }) as unknown as typeof fetch
  return { sent, fetcher }
}

describe('skill service', () => {
  it('has a skill checked as the editor holds it, and says each finding in words', async () => {
    const { sent, fetcher } = answering(200, { shell, skills: { Dispensing: [{ step: 'Dispense', what: 'the needle is not down', fix: ['MoveAxis'] }] } })
    const checked = await checkSkill(shell, { idShort: 'Dispensing' }, service, fetcher)
    expect(sent[0]!.url).toBe(`${service}/check/${encodeURIComponent(shell)}`)
    expect(JSON.parse(sent[0]!.init.body as string)).toEqual({ skill: { idShort: 'Dispensing' } })
    expect(checked.skills.Dispensing!.map(finding => findingLine(finding))).toEqual(['Dispense: the needle is not down (run MoveAxis before it)'])
    expect(findingLine({ step: 'end', what: 'Weighed does not hold', fix: [] })).toBe('At the end: Weighed does not hold')
  })

  it('plans a skill for a capability, and raises what the service refused with its reasons', async () => {
    const planned = answering(200, { shell, capability: 'Filling', steps: [{ skill: 'Dispense', capability: 'Dosing', component: 'FillingPump', args: {} }], name: 'FillTwo' })
    const found = await planSkill(shell, { capability: 'Filling', values: { FillVolume: 2 }, name: 'FillTwo', write: true }, service, planned.fetcher)
    expect(JSON.parse(planned.sent[0]!.init.body as string)).toEqual({ capability: 'Filling', values: { FillVolume: 2 }, name: 'FillTwo', write: true })
    expect(found.name).toBe('FillTwo')

    const refused = answering(422, { error: 'refused', step: 'plan', reasons: ['no plan reaches FillVolume = 99'] })
    const refusal = planSkill(shell, { capability: 'Filling', values: { FillVolume: 99 } }, service, refused.fetcher)
    await expect(refusal).rejects.toThrow('The skill service could not plan the skill: refused; no plan reaches FillVolume = 99')
  })

  it('has a product\'s process AAS written on a line, and says whether the recipe fits it', async () => {
    const product = 'https://smartproductionlab.aau.dk/aas/Vial2mLAAS'
    const line = 'https://smartproductionlab.aau.dk/aas/FillingLineAAS'
    const { sent, fetcher } = answering(200, { product, process: 'urn:process', idShort: 'Vial2mLOnFillingLineAAS', result: 'Fits', findings: [] })
    const written = await writeProcess(product, { line }, service, fetcher)
    expect(sent[0]!.url).toBe(`${service}/process/${encodeURIComponent(product)}`)
    expect(JSON.parse(sent[0]!.init.body as string)).toEqual({ line })
    expect(processLine(written)).toBe('Its process AAS Vial2mLOnFillingLineAAS is written: the recipe fits the line.')
    expect(processLine({ ...written, result: 'DoesNotFit', findings: ['Inspection: not bound'] }))
      .toBe('Its process AAS Vial2mLOnFillingLineAAS is written, but the recipe does not fit the line: Inspection: not bound.')
  })
})
