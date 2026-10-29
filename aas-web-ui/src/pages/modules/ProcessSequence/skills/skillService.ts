/**
 * The skill service: iec61499-mgmt-py's registration service (`modreg serve`), which derives a
 * module's offered capabilities from its skills on the AAS server. The skill editor asks it after
 * every save, so what a module offers follows its skills at once.
 *
 * Its address is kept per browser (Settings in the skills overview); the default is the service on
 * this machine.
 */
const KEY = 'process-sequence.skill-service'
export const DEFAULT_SKILL_SERVICE = 'http://localhost:8090'

export type DerivedCapability = { idShort: string, capability: string, skill: string, Derived?: string, Availability?: string }
export type Derived = { shell: string, stored: string, capabilities: DerivedCapability[] }

export function skillServiceUrl (): string {
  try {
    return globalThis.localStorage?.getItem(KEY) || DEFAULT_SKILL_SERVICE
  } catch {
    return DEFAULT_SKILL_SERVICE
  }
}

export function setSkillServiceUrl (url: string): void {
  try {
    if (url.trim() === '' || url.trim() === DEFAULT_SKILL_SERVICE) {
      globalThis.localStorage?.removeItem(KEY)
    } else {
      globalThis.localStorage?.setItem(KEY, url.trim().replace(/\/+$/, ''))
    }
  } catch {
    // Without storage the default is used.
  }
}

/** A request to the skill service; what it did not do is raised with its reasons (``doing``: in words). */
async function ask<T> (path: string, body: unknown, doing: string, service: string, fetcher: typeof fetch): Promise<T> {
  let response: Response
  try {
    response = await fetcher(`${service}${path}`, body === undefined
      ? { method: 'POST' }
      : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  } catch (error) {
    throw new Error(`The skill service at ${service} was not reached (${error instanceof Error ? error.message : String(error)}). `
      + 'Start it with `modreg serve --basyx <AAS server>`, or set its address in the overview\'s settings.', { cause: error })
  }
  const answer = await response.json().catch(() => ({}))
  if (!response.ok) {
    const reasons: string[] = answer.reasons ?? []
    throw new Error(`The skill service could not ${doing}: ${[answer.error, ...reasons].filter(Boolean).join('; ') || response.statusText}`)
  }
  return answer as T
}

/** Derive the module's offered capabilities anew from its skills and store them on the AAS server. */
export async function deriveCapabilities (shell: string, service = skillServiceUrl(), fetcher: typeof fetch = fetch): Promise<Derived> {
  return ask<Derived>(`/capabilities/${encodeURIComponent(shell)}`, undefined, 'derive the capabilities', service, fetcher)
}

/** What does not hold at a step of a skill (modplan's checker), and the skills that would make it hold if run before it. */
export type Finding = { step: string, what: string, fix: string[] }
export type Checked = { shell: string, skills: Record<string, Finding[]> }

/**
 * Run a module level skill through the module's states (modplan's checker): ``skill`` is its element
 * as the editor holds it, checked in place of the saved one. Each finding names the step it is about.
 */
export async function checkSkill (shell: string, skill: unknown, service = skillServiceUrl(), fetcher: typeof fetch = fetch): Promise<Checked> {
  return ask<Checked>(`/check/${encodeURIComponent(shell)}`, { skill }, 'check the skill', service, fetcher)
}

/** A finding in words: ``step: what (run X or Y before it)``; the skill's end is ``At the end``. */
export function findingLine (finding: Finding): string {
  const where = finding.step === 'end' ? 'At the end' : finding.step
  return `${where}: ${finding.what}${finding.fix.length > 0 ? ` (run ${finding.fix.join(' or ')} before it)` : ''}`
}

/** A skill planned for a capability (modplan): its steps, and with ``write`` its name and where it was stored. */
export type PlannedStep = { skill: string, capability: string, component: string, args: Record<string, unknown> }
export type Planned = { shell: string, capability: string, steps: PlannedStep[], name?: string, stored?: string }
export type PlanRequest = { capability: string, values: Record<string, number>, results?: string[], name?: string, write?: boolean }

/**
 * Plan a module level skill that achieves ``capability`` with ``values`` (e.g. FillVolume) and
 * reports ``results``; with ``write`` it is described on the AAS server under ``name``, not built
 * (modsync reconfigure builds it).
 */
export async function planSkill (shell: string, request: PlanRequest, service = skillServiceUrl(), fetcher: typeof fetch = fetch): Promise<Planned> {
  return ask<Planned>(`/plan/${encodeURIComponent(shell)}`, request, 'plan the skill', service, fetcher)
}

/** A product's process AAS on its line, written by the service, and whether the recipe fits the line. */
export type ProcessWritten = { product: string, process: string, idShort: string, result: 'Fits' | 'DoesNotFit', findings: string[] }

/**
 * Have the service write the product's process AAS: the recipe's bindings, as saved, on ``line``
 * (by default the one that holds the modules they name); its Validation is the plan check's
 * (iec61499-mgmt-py, F6). ``status``: Draft unless said otherwise.
 */
export async function writeProcess (product: string, request: { line?: string, status?: string } = {}, service = skillServiceUrl(),
  fetcher: typeof fetch = fetch): Promise<ProcessWritten> {
  return ask<ProcessWritten>(`/process/${encodeURIComponent(product)}`, request, 'write the process AAS', service, fetcher)
}

/** What became of the process AAS, in a sentence. */
export function processLine (written: ProcessWritten): string {
  return written.result === 'Fits'
    ? `Its process AAS ${written.idShort} is written: the recipe fits the line.`
    : `Its process AAS ${written.idShort} is written, but the recipe does not fit the line: ${written.findings.join('; ')}.`
}

/** One line per capability: what the module offers and through which skill, now or after a reconfiguration. */
export function derivedLines (derived: Derived): string[] {
  return derived.capabilities.map(item => `${item.idShort} (${item.skill})${item.Availability === 'AfterReconfiguration' ? ', after a reconfiguration' : ''}`)
}
