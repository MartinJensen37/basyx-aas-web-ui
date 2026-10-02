import { describe, expect, it } from 'vitest'
import ProcessSequence from '@/pages/modules/ProcessSequence/index.vue'
import { buildModuleRouteMeta, buildValidatedModuleChildRoutes } from '@/utils/ModuleRouteUtils'

/**
 * The module has to look like every other module in the app, because the shell discovers it from the
 * folder and its `defineOptions` rather than from a registration list. These assertions cover the
 * parts of that contract which are easy to get quietly wrong: a missing `inheritAttrs`, a module
 * title that does not reach the route metadata, or a child route that would escape the namespace.
 */

const moduleName = 'ProcessSequence'

describe('module registration', () => {
  it('declares the options the shell needs to show and route the module', () => {
    const meta = buildModuleRouteMeta(moduleName, ProcessSequence as never)

    expect(meta.name).toBe(moduleName)
    expect(meta.title).toBe('Process Sequence')
    expect(meta.isDesktopModule).toBe(true)
    expect(meta.isMobileModule).toBe(false)
    expect(meta.isVisibleModule).toBe(true)
  })

  it('is offered without a selection, and preserves the selected product route query', () => {
    const meta = buildModuleRouteMeta(moduleName, ProcessSequence as never)

    expect(meta.isOnlyVisibleWithSelectedAas).toBe(false)
    // Selecting the product is a route query, so the module has to keep it or come back empty.
    expect(meta.preserveRouteQuery).toBe(true)
  })

  it('needs no extra infrastructure endpoints, environment variables or authentication', () => {
    // It reads the AAS and submodel repositories, which every template provides. Declaring
    // something that does not exist would hide the module on a working setup.
    const meta = buildModuleRouteMeta(moduleName, ProcessSequence as never)

    expect(meta.supportedInfrastructureTemplates).toEqual([])
    expect(meta.needsInfrastructureEndpoints).toEqual([])
    expect(meta.needsEnvVariables).toEqual([])
    expect(meta.needsAuthentication).toBe(false)
  })

  it('does not set inheritAttrs, so the layout does not leak attributes onto the root card', () => {
    // Every other module in the app sets this; without it the app's own class and style land on the
    // module root and fight its layout.
    expect((ProcessSequence as unknown as { inheritAttrs?: boolean }).inheritAttrs).toBe(false)
  })

  it('is a single view module, so it declares no child routes', () => {
    const meta = buildModuleRouteMeta(moduleName, ProcessSequence as never)
    const children = buildValidatedModuleChildRoutes(moduleName, `/modules/${moduleName.toLowerCase()}`, meta, undefined)

    expect(children).toEqual([])
  })

  it('would give a child route, if one were ever added, the module defaults', () => {
    const meta = buildModuleRouteMeta(moduleName, ProcessSequence as never)
    const children = buildValidatedModuleChildRoutes(
      moduleName,
      `/modules/${moduleName.toLowerCase()}`,
      meta,
      { children: [{ path: 'settings' }] } as never,
    )

    expect(children).toHaveLength(1)
    expect(children[0].name).toBe('ProcessSequence__settings')
    expect(children[0].meta?.isOnlyVisibleWithSelectedAas).toBe(false)
    expect(children[0].meta?.preserveRouteQuery).toBe(true)
  })
})
