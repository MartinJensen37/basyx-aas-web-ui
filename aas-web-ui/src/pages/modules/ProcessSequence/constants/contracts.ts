export const PROCESS_SEQUENCE_IRI_BASE = 'https://smartproductionlab.aau.dk'

export const PROCESS_PARAMETERS_SUBMODEL = {
  idShort: 'ProcessParameters',
  semanticId: 'https://admin-shell-io/idta/SubmodelTemplate/ProcessParameters/1/0',
} as const

const PROCESS_PARAMETERS_SEMANTIC_ID_BASE = 'https://admin-shell.io/idta/ProcessParameters'

export const PROCESS_PARAMETERS_ELEMENT_SEMANTIC_IDS = {
  processes: `${PROCESS_PARAMETERS_SEMANTIC_ID_BASE}/Processes/1/0`,
  process: `${PROCESS_PARAMETERS_SEMANTIC_ID_BASE}/Process/1/0`,
  processId: `${PROCESS_PARAMETERS_SEMANTIC_ID_BASE}/ProcessId/1/0`,
  processName: `${PROCESS_PARAMETERS_SEMANTIC_ID_BASE}/ProcessName/1/0`,
  processDescription: `${PROCESS_PARAMETERS_SEMANTIC_ID_BASE}/ProcessDescription/1/0`,
  plannedProcessTime: `${PROCESS_PARAMETERS_SEMANTIC_ID_BASE}/PlannedProcessTime/1/0`,
  productParameters: `${PROCESS_PARAMETERS_SEMANTIC_ID_BASE}/ProductParameters/1/0`,
  processParameters: `${PROCESS_PARAMETERS_SEMANTIC_ID_BASE}/ProcessParameters/1/0`,
  resourceParameters: `${PROCESS_PARAMETERS_SEMANTIC_ID_BASE}/ResourceParameters/1/0`,
  processBom: `${PROCESS_PARAMETERS_SEMANTIC_ID_BASE}/ProcessBoM/1/0`,
} as const

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
