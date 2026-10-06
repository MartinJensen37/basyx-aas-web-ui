import { writeFileSync } from 'node:fs'
import { buildPharmaDemo } from '../demo/pharma.ts'
import { buildSequenceSubmodel, sequenceSemantic } from '../utils/sequenceModel.ts'

// Concrete defaults demonstrate the conditional shapes. Instances start with an empty root scope.
const plan = buildPharmaDemo(id => `${id}/sequence`).plans.find(plan => plan.productAasId.endsWith('/aas/vial-2ml'))!
const filling = plan.scopes[0].nodes.find(node => node.id === 'Filling_1')!
plan.productAasId = 'urn:example:product'
plan.revision = 0
plan.schema = 'process-sequence-plan/5.0'
if (filling.kind === 'step') {
  filling.outputs = [{ id: 'measured-volume', name: 'Measured volume', type: 'number', unit: 'mL' }]
}
plan.scopes = [
  { id: 'product', name: 'Product', parentId: null, material: null, nodes: [
    filling,
    { id: 'decision', kind: 'decision', name: 'Volume decision', condition: {
      kind: 'comparison', operand: { kind: 'output', stepId: filling.id, outputId: 'measured-volume' }, operator: 'gte', expected: { type: 'number', value: 2 }, unit: 'mL',
    }, branches: [{ id: 'yes', name: 'Yes', nodes: [] }, { id: 'no', name: 'No', nodes: [] }] },
    { id: 'optional', kind: 'conditional', name: 'Periodic inspection', condition: { kind: 'everyNthProduct', every: 5 }, nodes: [] },
    { id: 'call', kind: 'call', name: 'Subprocess', scopeId: 'subprocess' },
    { id: 'parallel', kind: 'parallel', name: 'Parallel work', branches: [
      { id: 'a', name: 'Branch A', nodes: [] }, { id: 'b', name: 'Branch B', nodes: [] },
    ] },
  ] },
  { id: 'subprocess', name: 'Subprocess', parentId: 'product', material: null, nodes: [] },
  { ...plan.scopes[1], parentId: 'product' },
]
const template = buildSequenceSubmodel(plan, 'https://smartproductionlab.aau.dk/templates/ProductionSequence/1/0')
template.kind = 'Template'
template.description = [{ language: 'en', text: 'Application Production Sequence 1.0. See README.md for cardinalities, conditional node shapes, ownership and matching rules. Example values are illustrative defaults, not production prescriptions.' }]
const optional = new Set(['ParentScope', 'Material', 'SharedPlanOwner', 'Process', 'RequiredCapabilities', 'Resource', 'Skill', 'ExecutionMode', 'SourceAas', 'SourceElement', 'Outputs', 'Operand'])
const repeatable = new Set(['Scope', 'Step', 'Branch', 'Parameter', 'Binding', 'RequiredCapability', 'Output'])
function annotate (element: Record<string, any>, parentMeaning = ''): void {
  const name = String(element.semanticId?.keys?.[0]?.value ?? '').replace('https://smartproductionlab.aau.dk/ProductionSequence/', '').replace('/1/0', '')
  if (element !== template && element.semanticId?.keys?.[0]?.value === sequenceSemantic(name)) {
    const isOptional = optional.has(name) || (name === 'Unit' && parentMeaning === 'Parameter')
    element.qualifiers = [{ type: 'SMT/Cardinality', kind: 'TemplateQualifier', valueType: 'xs:string', value: repeatable.has(name) ? 'ZeroToMany' : (isOptional ? 'ZeroToOne' : 'One'), semanticId: { type: 'ExternalReference', keys: [{ type: 'GlobalReference', value: 'https://admin-shell.io/SubmodelTemplates/Cardinality/1/0' }] } }]
  }
  for (const child of element.submodelElements ?? (Array.isArray(element.value) ? element.value : [])) {
    annotate(child, name)
  }
}
annotate(template)
writeFileSync(new URL('ProductionSequence.json', import.meta.url), JSON.stringify(template, null, 2) + '\n')
