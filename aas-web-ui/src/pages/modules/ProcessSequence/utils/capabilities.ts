import type { CapabilityReference, CapabilityRequirement } from '../types/plan'
import type { CapabilityProperty } from './capabilityMatching'
import { CAPABILITY_SUBMODEL, capabilitySemantic } from '../constants/capabilities'
import { capabilityReferenceSchema } from '../types/plan'
import { readCapabilityProperties } from './capabilityMatching'
import { canonicalMeaning } from './parameterSemantics'
import { childrenOf, semanticId } from './planSources'

export type CapabilityDescription = CapabilityRequirement & {
  aasId: string
  role: 'Required' | 'Offered' | 'NotAssigned'
  semanticIds: string[]
  realizedBy: CapabilityReference[]
  properties: CapabilityProperty[]
  hasConstraints: boolean
}

export function referenceKey (reference: CapabilityReference): string {
  return JSON.stringify([reference.type, reference.keys.map(key => [key.type, key.value])])
}

/** Resolve only standard containers, role qualifiers and full model references, never display names. */
export function readCapabilities (submodel: Record<string, any>, aasId: string): CapabilityDescription[] {
  if (semanticId(submodel) !== CAPABILITY_SUBMODEL) {
    return []
  }
  return childrenOf(submodel).filter(set => semanticId(set) === capabilitySemantic('CapabilitySet')).flatMap(set => childrenOf(set).filter(container => semanticId(container) === capabilitySemantic('CapabilityContainer')).flatMap(container => childrenOf(container).filter(capability => capability.modelType === 'Capability'
    && semanticId(capability) === capabilitySemantic('Capability')).map(capability => {
    const roles = (['Required', 'Offered', 'NotAssigned'] as const).filter(role =>
      (capability.qualifiers ?? []).some((qualifier: Record<string, any>) =>
        semanticId(qualifier) === capabilitySemantic(`CapabilityRoleQualifier/${role}`)
        && qualifier.valueType === 'xs:boolean' && ['true', '1'].includes(String(qualifier.value))))
    const reference: CapabilityReference = {
      type: 'ModelReference', keys: [
        { type: 'Submodel', value: String(submodel.id) },
        { type: 'SubmodelElementCollection', value: String(set.idShort) },
        { type: 'SubmodelElementCollection', value: String(container.idShort) },
        { type: 'Capability', value: String(capability.idShort) },
      ],
    }
    return {
      name: capability.displayName?.find((name: Record<string, string>) => name.language === 'en')?.text ?? container.displayName?.find((name: Record<string, string>) => name.language === 'en')?.text ?? container.idShort ?? capability.idShort,
      reference, aasId, role: roles.length === 1 ? roles[0] : 'NotAssigned',
      properties: readCapabilityProperties(container),
      hasConstraints: childrenOf(container).some(child => semanticId(child) === capabilitySemantic('CapabilityRelations')
        && childrenOf(child).some(item => ['ConstraintSet', 'ComposedOfSet', 'GeneralizedBySet'].some(name => semanticId(item) === capabilitySemantic(name)))),
      semanticIds: (capability.supplementalSemanticIds ?? []).flatMap((ref: CapabilityReference) =>
        ref.keys?.length === 1 && ref.keys[0].value ? [canonicalMeaning(ref.keys[0].value)] : []),
      realizedBy: childrenOf(container).filter(child => semanticId(child) === capabilitySemantic('CapabilityRelations')).flatMap(relations => childrenOf(relations).filter(relation => relation.modelType === 'RelationshipElement'
        && semanticId(relation) === capabilitySemantic('CapabilityRealizedBy')).flatMap(relation => {
        const first = capabilityReferenceSchema.safeParse(relation.first)
        const second = capabilityReferenceSchema.safeParse(relation.second)
        return first.success && second.success && referenceKey(first.data) === referenceKey(reference) ? [second.data] : []
      })),
    }
  })))
}

/** Identity candidates only: properties, constraints, composition and availability still need evaluation. */
export function capabilityCandidates (requirements: CapabilityRequirement[], catalog: CapabilityDescription[]): string[] {
  if (requirements.length === 0) {
    return []
  }
  const meanings = requirements.map(requirement => requirement.reference.type === 'ExternalReference'
    ? (requirement.reference.keys.length === 1 ? [canonicalMeaning(requirement.reference.keys[0].value)] : [])
    : catalog.find(item => item.role === 'Required' && referenceKey(item.reference) === referenceKey(requirement.reference))?.semanticIds ?? [])
  const offered = catalog.filter(item => item.role === 'Offered')
  return [...new Set(offered.map(item => item.aasId))].filter(aasId => meanings.every(ids => ids.length > 0
    && offered.some(item => item.aasId === aasId && item.semanticIds.some(id => ids.includes(id)))))
}
