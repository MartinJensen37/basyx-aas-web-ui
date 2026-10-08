/** Explicit aliases for the original pharma demo vocabulary; unrelated namespaces stay distinct. */
const vocabulary = 'https://smartproductionlab.aau.dk/semantics/'
const legacy = 'https://smartproductionlab.aau.dk/demo/pharma/semantics/'
const names = new Set(['Unpacking', 'Loading', 'Filling', 'Stoppering', 'Capping', 'Inspection', 'Unloading', 'Packing', 'ContainerType', 'GraspDiameter', 'FillVolume', 'AbsoluteFillError', 'StopperDiameter', 'CapDiameter', 'InspectionMethod'])
export function canonicalMeaning (id: string): string {
  return id.startsWith(legacy) && names.has(id.slice(legacy.length)) ? vocabulary + id.slice(legacy.length) : id
}
export function parameterMeanings (element: Record<string, any>): string[] {
  return [...new Set([element.semanticId, ...element.supplementalSemanticIds ?? []].flatMap(reference => reference?.keys?.length === 1 ? [canonicalMeaning(String(reference.keys[0].value))] : []))]
}
export const numericTypes = new Set(['xs:double', 'xs:float', 'xs:decimal', 'xs:integer', 'xs:int', 'xs:long', 'xs:short', 'xs:byte', 'xs:unsignedLong', 'xs:unsignedInt', 'xs:unsignedShort', 'xs:unsignedByte', 'xs:nonNegativeInteger', 'xs:positiveInteger'])
export function compatibleType (a: string, b: string): boolean {
  return a === b || (numericTypes.has(a) && numericTypes.has(b))
}
