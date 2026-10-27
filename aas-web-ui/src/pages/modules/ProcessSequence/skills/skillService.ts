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

/** Derive the module's offered capabilities anew from its skills and store them on the AAS server. */
export async function deriveCapabilities (shell: string, service = skillServiceUrl(), fetcher: typeof fetch = fetch): Promise<Derived> {
  let response: Response
  try {
    response = await fetcher(`${service}/capabilities/${encodeURIComponent(shell)}`, { method: 'POST' })
  } catch (error) {
    throw new Error(`The skill service at ${service} was not reached (${error instanceof Error ? error.message : String(error)}). `
      + 'Start it with `modreg serve --basyx <AAS server>`, or set its address in the overview\'s settings.', { cause: error })
  }
  const answer = await response.json().catch(() => ({}))
  if (!response.ok) {
    const reasons: string[] = answer.reasons ?? []
    throw new Error(`The skill service could not derive the capabilities: ${[answer.error, ...reasons].filter(Boolean).join('; ') || response.statusText}`)
  }
  return answer as Derived
}

/** One line per capability: what the module offers and through which skill, now or after a reconfiguration. */
export function derivedLines (derived: Derived): string[] {
  return derived.capabilities.map(item => `${item.idShort} (${item.skill})${item.Availability === 'AfterReconfiguration' ? ', after a reconfiguration' : ''}`)
}
