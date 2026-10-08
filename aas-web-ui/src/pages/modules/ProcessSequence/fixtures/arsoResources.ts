import { CAPABILITY_SUBMODEL, capabilitySemantic } from '../constants/capabilities'
import { ARSO_SKILLS_SUBMODEL, PROCESS_PARAMETERS_SUBMODEL, PROCESS_STEP_CAPABILITY_SEMANTIC_ID, processParameterSemantic } from '../constants/contracts'

// Reduced fixtures from the four resource models and Vial2mLAAS reviewed on 2026-10-08.
// Preserve the semantic IDs, nesting, operation variables, limits and reference paths.
// Execution endpoints, composite internals and unrelated submodels are intentionally excluded.
export const ARSO_FIXTURE_BASE = 'https://smartproductionlab.aau.dk/aas'
const domain = 'https://smartproductionlab.aau.dk'
const meaning = (name: string) => `${domain}/semantics/${name}`
const sem = (value: string) => ({ type: 'ExternalReference', keys: [{ type: 'GlobalReference', value }] })
const modelRef = (keys: { type: string, value: string }[]) => ({ type: 'ModelReference', keys })
const smId = (owner: string, name: string) => `${ARSO_FIXTURE_BASE}/${owner}/submodels/${name}`
const collection = (idShort: string, value: any[], semanticId?: string): Record<string, any> => ({ modelType: 'SubmodelElementCollection', idShort, ...(value.length > 0 ? { value } : {}), ...(semanticId ? { semanticId: sem(semanticId) } : {}) })
const units = (name: string, unit?: string) => unit ? { embeddedDataSpecifications: [{ dataSpecification: sem('https://admin-shell.io/DataSpecificationTemplates/DataSpecificationIEC61360/3/0'), dataSpecificationContent: { modelType: 'DataSpecificationIec61360', preferredName: [{ language: 'en', text: name }], unit } }] } : {}
const property = (idShort: string, value: string | undefined, valueType = 'xs:string', semanticId?: string): Record<string, any> => ({ modelType: 'Property', idShort, valueType, ...(value === undefined ? {} : { value }), ...(semanticId ? { semanticId: sem(semanticId) } : {}) })
const submodel = (owner: string, name: string, semanticId: string, submodelElements: any[]) => ({ modelType: 'Submodel', id: smId(owner, name), idShort: name, semanticId: sem(semanticId), submodelElements })
function capabilityRef (owner: string, operation: string, required = false) {
  return modelRef([
    { type: 'Submodel', value: smId(owner, 'CapabilityDescription') },
    ...[required ? 'RequiredCapabilities' : 'OfferedCapabilities', operation].map(value => ({ type: 'SubmodelElementCollection', value })),
    { type: 'Capability', value: 'Capability' },
  ])
}
type Limit = { name: string, value?: string, required?: string, min?: string, max?: string, unit?: string }
const configurations: { operation: string, skill: string, limits: Limit[] }[] = [
  { operation: 'Capping', skill: 'Capping', limits: [{ name: 'CapDiameter', min: '13.0', max: '20.0', unit: 'mm', required: '13.0' }] },
  { operation: 'Filling', skill: 'Dispensing', limits: [{ name: 'FillVolume', min: '0.5', max: '10.0', unit: 'mL', required: '2.0' }, { name: 'AbsoluteFillError', value: '0.05', unit: 'mL' }] },
  { operation: 'Inspection', skill: 'Inspection', limits: [{ name: 'InspectionMethod', value: 'vision', required: 'vision' }] },
  { operation: 'Stoppering', skill: 'Stoppering', limits: [{ name: 'StopperDiameter', min: '6.0', max: '20.0', unit: 'mm', required: '13.0' }] },
]
export function buildArsoFixture () {
  const submodels: Record<string, any>[] = []
  const shells: Record<string, any>[] = []
  const requiredCapabilities: Record<string, any>[] = []
  const processes: Record<string, any>[] = []
  for (const configuration of configurations) {
    const { operation, skill } = configuration
    const owner = `${operation}ModuleAAS`
    const skillRef = modelRef([{ type: 'Submodel', value: smId(owner, 'Skills') }, ...['Skills', skill].map(value => ({ type: 'SubmodelElementCollection', value }))])
    const limits: Limit[] = [{ name: 'ContainerType', value: 'vial', required: 'vial' }, { name: 'GraspDiameter', min: '6.0', max: '30.0', required: '16.0', unit: 'mm' }, ...configuration.limits]
    for (const required of [false, true]) {
      const capability = { modelType: 'Capability', idShort: 'Capability', semanticId: sem(capabilitySemantic('Capability')), supplementalSemanticIds: [sem(meaning(operation))], qualifiers: [{ type: `CapabilityRoleQualifier/${required ? 'Required' : 'Offered'}`, kind: 'ConceptQualifier', valueType: 'xs:boolean', value: 'true', semanticId: sem(capabilitySemantic(`CapabilityRoleQualifier/${required ? 'Required' : 'Offered'}`)) }] }
      const fields = [capability, collection('PropertySet', limits.filter(limit => !required || limit.required !== undefined).map(limit => {
        const numeric = limit.unit !== undefined
        const element = !required && limit.min !== undefined
          ? { modelType: 'Range', idShort: 'Value', valueType: 'xs:double', min: limit.min, max: limit.max, semanticId: sem('https://admin-shell.io/idta/CapabilityPropertyEnumType/Range/1/0') }
          : property('Value', required ? limit.required : limit.value, numeric ? 'xs:double' : 'xs:string', 'https://admin-shell.io/idta/CapabilityPropertyType/Property/1/0')
        return collection(limit.name, [{ ...element, ...units(limit.name, limit.unit), supplementalSemanticIds: [sem(meaning(limit.name))] }], capabilitySemantic('PropertyContainer'))
      }), capabilitySemantic('PropertySet'))]
      if (!required) {
        fields.push(collection('CapabilityRelations', [{ modelType: 'RelationshipElement', idShort: 'RealizedBy', semanticId: sem(capabilitySemantic('CapabilityRealizedBy')), first: capabilityRef(owner, operation), second: skillRef }], capabilitySemantic('CapabilityRelations')))
      }
      const container = collection(operation, fields, capabilitySemantic('CapabilityContainer'))
      if (required) {
        requiredCapabilities.push(container)
      } else {
        submodels.push(submodel(owner, 'CapabilityDescription', CAPABILITY_SUBMODEL, [collection('OfferedCapabilities', [container], capabilitySemantic('CapabilitySet'))]))
      }
    }
    const protocol = (name: string, type: string) => ({ value: property(name, undefined, type, `${domain}/ControlComponent/Skill/OperationVariable/1/0`) })
    const inputs = [protocol('Session', 'xs:string')]
    const outputs = [protocol('Accepted', 'xs:boolean'), protocol('ErrorID', 'xs:unsignedShort')]
    if (operation === 'Filling') {
      inputs.push({ value: { ...property('Volume', '1.0', 'xs:double', `${domain}/skills/Dispensing/Parameters/Volume`), ...units('Volume', 'mL'), supplementalSemanticIds: [sem(meaning('FillVolume'))], qualifiers: ['Minimum', 'Maximum', 'Default'].map((type, index) => ({ type, kind: 'ConceptQualifier', valueType: 'xs:string', value: ['0.5', '10.0', '1.0'][index] })) } })
      outputs.push({ value: { ...property('Weight', undefined, 'xs:double', `${domain}/skills/Dispensing/Results/Weight`), ...units('Weight', 'g') } })
    }
    if (operation === 'Inspection') {
      for (const name of ['TopPassed', 'SidePassed']) {
        outputs.push({ value: property(name, undefined, 'xs:boolean', `${domain}/skills/Inspection/Results/${name}`) })
      }
    }
    const startMeaning = `${domain}/skill/Start`
    submodels.push(submodel(owner, 'Skills', ARSO_SKILLS_SUBMODEL, [collection('Skills', [collection(skill, [collection('Start', [{ modelType: 'Operation', idShort: 'Start', semanticId: sem(startMeaning), inputVariables: inputs, outputVariables: outputs }], startMeaning)], `${domain}/skill/Composite`)])]))
    shells.push({ modelType: 'AssetAdministrationShell', id: `${ARSO_FIXTURE_BASE}/${owner}`, idShort: owner, assetInformation: { assetKind: 'Instance', globalAssetId: `urn:fixture:asset:${owner}` }, submodels: ['Skills', 'CapabilityDescription'].map(name => modelRef([{ type: 'Submodel', value: smId(owner, name) }])) })
    processes.push(collection(operation, [property('ProcessId', operation, 'xs:string', processParameterSemantic('ProcessId')), property('ProcessName', operation, 'xs:string', processParameterSemantic('ProcessName')), collection('ProductParameters', limits.filter(limit => limit.required !== undefined).map(limit => ({ ...property(limit.name, limit.required, limit.unit ? 'xs:double' : 'xs:string', meaning(limit.name)), ...units(limit.name, limit.unit) })), processParameterSemantic('ProductParameters')), { modelType: 'ReferenceElement', idShort: 'RequiredCapability', semanticId: sem(PROCESS_STEP_CAPABILITY_SEMANTIC_ID), value: capabilityRef('Vial2mLAAS', operation, true) }], processParameterSemantic('Process')))
  }
  submodels.push(submodel('Vial2mLAAS', 'ProcessParameters', PROCESS_PARAMETERS_SUBMODEL.semanticId, [collection('Processes', processes, processParameterSemantic('Processes'))]), submodel('Vial2mLAAS', 'CapabilityDescription', CAPABILITY_SUBMODEL, [collection('RequiredCapabilities', requiredCapabilities, capabilitySemantic('CapabilitySet'))]))
  shells.push({ modelType: 'AssetAdministrationShell', id: `${ARSO_FIXTURE_BASE}/Vial2mLAAS`, idShort: 'Vial2mLAAS', assetInformation: { assetKind: 'Type', globalAssetId: 'urn:fixture:asset:Vial2mL' }, submodels: ['ProcessParameters', 'CapabilityDescription'].map(name => modelRef([{ type: 'Submodel', value: smId('Vial2mLAAS', name) }])) })
  return { submodels, shells }
}
