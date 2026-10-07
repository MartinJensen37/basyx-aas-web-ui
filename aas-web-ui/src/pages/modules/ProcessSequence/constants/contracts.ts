export const PROCESS_SEQUENCE_IRI_BASE = 'https://smartproductionlab.aau.dk'

export const PROCESS_PARAMETERS_SUBMODEL = {
  idShort: 'ProcessParameters',
  semanticId: 'https://admin-shell-io/idta/SubmodelTemplate/ProcessParameters/1/0',
} as const

/** Element meanings use admin-shell.io; the published submodel identifier above uses admin-shell-io. */
export const processParameterSemantic = (name: string) => `https://admin-shell.io/idta/ProcessParameters/${name}/1/0`

export const SKILLS_SUBMODEL_SEMANTIC_ID = `${PROCESS_SEQUENCE_IRI_BASE}/SubmodelTemplate/Skills/1/0`
export const skillSemantic = (name: string) => `${PROCESS_SEQUENCE_IRI_BASE}/Skills/${name}/1/0`

/**
 * Repeatable ReferenceElement extension added to an IDTA 02031 process collection.
 *
 * Each ModelReference points to a Required-role Capability in IDTA 02020. Multiple references
 * use distinct idShorts and this same semantic ID. The extension is our application contract,
 * not a mandatory field of IDTA 02031. ExternalReference meanings remain readable for legacy data.
 */
export const PROCESS_STEP_CAPABILITY_SEMANTIC_ID
  = `${PROCESS_SEQUENCE_IRI_BASE}/ProcessParameters/RequiredCapability/1/0`

/** IDTA 02011 Hierarchical Structures, the bill of material. Read only, already rendered elsewhere. */
export const HIERARCHICAL_STRUCTURES_SUBMODEL = {
  idShort: 'HierarchicalStructures',
  semanticId: 'https://admin-shell.io/idta/HierarchicalStructures/1/0/Submodel',
  entryNodeSemanticId: 'https://admin-shell.io/idta/HierarchicalStructures/EntryNode/1/0',
} as const
