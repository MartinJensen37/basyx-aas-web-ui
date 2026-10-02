import type { Plugin } from 'vite'
import { defineConfig, loadConfigFromFile } from 'vite'
import Vuetify from 'vite-plugin-vuetify'
import vuetifyImportMap from 'vuetify/dist/json/importMap.json' with { type: 'json' }
import packageJson from '../../../../../package.json' with { type: 'json' }

/** Optional Docker demo tuning; the host application's Vite configuration stays unchanged. */
export default defineConfig(async env => {
  const loaded = await loadConfigFromFile(env, 'vite.config.mts')
  if (!loaded) {
    throw new Error('The application Vite config could not be loaded.')
  }
  const config = loaded.config
  const plugins = ((config.plugins ?? []) as unknown[]).flat(Infinity) as Plugin[]
  return {
    ...config,
    plugins: [...plugins.filter(plugin => !plugin?.name?.startsWith('vuetify:')), Vuetify({ autoImport: true, styles: true })],
    optimizeDeps: {
      noDiscovery: true, holdUntilCrawlEnd: false,
      include: [
        ...Object.keys(packageJson.dependencies).filter(name => !['@fontsource/roboto', '@mdi/font'].includes(name)),
        ...new Set(Object.values(vuetifyImportMap.components).map(component => `vuetify/${component.from}`)),
        'vuetify/directives', 'vuetify/iconsets/mdi',
        ...['controls/OrbitControls', 'effects/OutlineEffect', 'helpers/ViewHelper', 'loaders/GLTFLoader', 'loaders/OBJLoader', 'loaders/STLLoader'].map(path => `three/examples/jsm/${path}.js`),
      ],
    },
  }
})
