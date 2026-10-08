import type { CapabilityRequirement, PlanParameter } from '../types/plan'
import type { CapabilityDescription } from './capabilities'
import { capabilitySemantic } from '../constants/capabilities'
import { canonicalMeaning, compatibleType, numericTypes } from './parameterSemantics'
import { childrenOf, semanticId } from './planSources'

export type CapabilityProperty = {
  name: string
  semanticId: string
  unit: string
  dataType: string
  kind: 'value' | 'range'
  value: string
  min: string
  max: string
}
export type CapabilityMatch = { aasId: string, status: 'match' | 'mismatch' | 'unknown', reasons: string[], capabilities: CapabilityDescription[] }
const identity = (reference: CapabilityRequirement['reference']) => JSON.stringify([reference.type, reference.keys.map(key => [key.type, key.value])])

export function readCapabilityProperties (container: Record<string, any>): CapabilityProperty[] {
  return childrenOf(container).filter(set => semanticId(set) === capabilitySemantic('PropertySet')).flatMap(set => childrenOf(set).filter(item => semanticId(item) === capabilitySemantic('PropertyContainer'))).flatMap(item => childrenOf(item).map(property => ({
    name: property.displayName?.find((name: { language: string }) => name.language === 'en')?.text ?? item.displayName?.find((name: { language: string }) => name.language === 'en')?.text ?? item.idShort ?? property.idShort,
    semanticId: canonicalMeaning(property.supplementalSemanticIds?.[0]?.keys?.[0]?.value ?? ''),
    unit: property.embeddedDataSpecifications?.[0]?.dataSpecificationContent?.unit ?? '',
    dataType: property.valueType ?? '', kind: property.modelType === 'Range' ? 'range' as const : 'value' as const,
    value: String(property.value ?? ''), min: String(property.min ?? ''), max: String(property.max ?? ''),
  })))
}

function compareProperty (required: CapabilityProperty, offered?: CapabilityProperty): { status: CapabilityMatch['status'], reason: string } {
  const unknown = (reason: string) => ({ status: 'unknown' as const, reason: `${required.name}: ${reason}` })
  if (!required.semanticId || !offered) {
    return unknown('property not described by the station')
  }
  if (!required.dataType || !offered.dataType) {
    return unknown('unsupported property type')
  }
  if (required.unit !== offered.unit) {
    return unknown('units differ; conversion has not been verified')
  }
  let matches: boolean
  if (numericTypes.has(required.dataType) && numericTypes.has(offered.dataType)) {
    const number = (value: string) => value.trim() === '' ? Number.NaN : Number(value)
    if (required.kind === 'value' && offered.kind === 'range') {
      const values = [number(required.value), number(offered.min), number(offered.max)]
      if (!values.every(value => Number.isFinite(value)) || values[1] > values[2]) {
        return unknown('invalid numeric value or range')
      }
      matches = values[0] >= values[1] && values[0] <= values[2]
    } else if (required.kind === 'range' && offered.kind === 'value') {
      const values = [number(offered.value), number(required.min), number(required.max)]
      if (!values.every(value => Number.isFinite(value)) || values[1] > values[2]) {
        return unknown('invalid numeric value or range')
      }
      matches = values[0] >= values[1] && values[0] <= values[2]
    } else if (required.kind === 'value' && offered.kind === 'value') {
      if (![number(required.value), number(offered.value)].every(value => Number.isFinite(value))) {
        return unknown('invalid numeric value')
      }
      matches = number(required.value) === number(offered.value)
    } else {
      return unknown('range-to-range constraints require an explicit comparison rule')
    }
  } else {
    if (required.dataType !== offered.dataType || required.kind !== 'value' || offered.kind !== 'value') {
      return unknown('unsupported datatype comparison')
    }
    if (!['xs:string', 'xs:boolean', 'xs:anyURI'].includes(required.dataType)) {
      return unknown('unsupported datatype comparison')
    }
    matches = required.value === offered.value
  }
  const offer = offered.kind === 'range' ? `${offered.min}–${offered.max}` : offered.value
  const need = required.kind === 'range' ? `${required.min}–${required.max}` : required.value
  return { status: matches ? 'match' : 'mismatch', reason: `${required.name}: required ${need}, offered ${offer} ${required.unit}`.trim() }
}

/** Each required capability must be satisfied by one complete offered capability, including its properties. */
export function matchCapabilities (requirements: CapabilityRequirement[], catalog: CapabilityDescription[], parameters: PlanParameter[] = []): CapabilityMatch[] {
  if (requirements.length === 0) {
    return []
  }
  const offered = catalog.filter(item => item.role === 'Offered')
  return [...new Set(offered.map(item => item.aasId))].map(aasId => {
    const reasons: string[] = []
    const capabilities: CapabilityDescription[] = []
    const statuses = new Set(requirements.map(requirement => {
      const required = catalog.find(item => item.role === 'Required' && identity(item.reference) === identity(requirement.reference))
      const meanings = required?.semanticIds ?? (requirement.reference.type === 'ExternalReference' && requirement.reference.keys.length === 1 ? [requirement.reference.keys[0].value] : [])
      if (meanings.length === 0) {
        reasons.push(`${requirement.name}: unresolved requirement`)
        return 'unknown'
      }
      const candidates = offered.filter(item => item.aasId === aasId && item.semanticIds.some(id => meanings.some(meaning => canonicalMeaning(meaning) === canonicalMeaning(id))))
      if (candidates.length === 0) {
        reasons.push(`${requirement.name}: capability not offered`)
        return 'mismatch'
      }
      const checked = candidates.map(candidate => {
        const checks = (required?.properties ?? []).map(property => {
          // Scalar requirements with the same domain meaning follow effective recipe values.
          // Ranges describe tolerances and must not be replaced by a process setpoint.
          const sources = property.kind === 'value' ? parameters.filter(parameter => parameter.semanticIds?.some(id => canonicalMeaning(id) === canonicalMeaning(property.semanticId))) : []
          if (sources.length > 1 || (sources.length === 1 && ((sources[0].unit ?? '') !== property.unit || !compatibleType(sources[0].dataType, property.dataType)))) {
            return { status: 'unknown' as const, reason: `${property.name}: recipe association is ambiguous or has incompatible type/units` }
          }
          const effective = sources.length === 1 ? { ...property, value: sources[0].value } : property
          return compareProperty(effective, candidate.properties.find(item => canonicalMeaning(item.semanticId) === canonicalMeaning(property.semanticId)))
        })
        const unsupported = required?.hasConstraints || candidate.hasConstraints
        const status = checks.some(check => check.status === 'mismatch') ? 'mismatch' : (unsupported || checks.some(check => check.status === 'unknown') ? 'unknown' : 'match')
        return { candidate, status, reasons: [...checks.map(check => check.reason), ...(unsupported ? ['Additional constraints need evaluation'] : [])] }
      })
      const best = checked.find(item => item.status === 'match') ?? checked.find(item => item.status === 'unknown') ?? checked[0]
      capabilities.push(best.candidate)
      reasons.push(...best.reasons)
      return best.status
    }))
    return { aasId, status: statuses.has('mismatch') ? 'mismatch' : (statuses.has('unknown') ? 'unknown' : 'match'), reasons, capabilities }
  })
}
