import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import vm from 'node:vm'
import { transform } from 'esbuild'
import { fileURLToPath } from 'node:url'

const testDir = path.dirname(fileURLToPath(import.meta.url))
const projectDir = path.resolve(testDir, '..')
const configSource = await fs.readFile(path.join(projectDir, 'vite.config.js'), 'utf8')

const plugin = name => (...args) => ({ name, args })

async function loadConfig () {
  const envByMode = {
    'flags-on': {
      VITE_ANALYZE: 'true',
      VITE_BUILD_SOURCEMAP: 'true',
      VITE_LEGACY_BUILD: 'true'
    }
  }
  const context = vm.createContext({
    __dirname: projectDir,
    JSON,
    process: { env: {}, cwd: () => projectDir }
  })
  const module = new vm.SourceTextModule(configSource, {
    context,
    identifier: path.join(projectDir, 'vite.config.js')
  })
  const synthetic = exports => new vm.SyntheticModule(Object.keys(exports), function () {
    for (const [name, value] of Object.entries(exports)) this.setExport(name, value)
  }, { context })
  const imports = new Map([
    ['vite', synthetic({ defineConfig: value => value, loadEnv: mode => envByMode[mode] || {} })],
    ['@vitejs/plugin-vue', synthetic({ default: plugin('vue') })],
    ['@vitejs/plugin-vue-jsx', synthetic({ default: plugin('vue-jsx') })],
    ['path', synthetic({ default: { resolve: path.resolve } })],
    ['fs', synthetic({ default: { readFileSync: () => 'fixture' } })],
    ['@rollup/plugin-yaml', synthetic({ default: plugin('yaml') })],
    ['rollup-plugin-visualizer', synthetic({ visualizer: plugin('visualizer') })],
    ['vite-plugin-compression', synthetic({ default: plugin('compression') })],
    ['@vitejs/plugin-legacy', synthetic({ default: plugin('legacy') })],
    ['unplugin-auto-import/vite', synthetic({ default: plugin('auto-import') })],
    ['unplugin-vue-components/vite', synthetic({ default: plugin('components') })]
  ])
  await module.link(specifier => {
    const dependency = imports.get(specifier)
    if (!dependency) throw new Error(`unexpected config import: ${specifier}`)
    return dependency
  })
  await module.evaluate()
  return module.namespace.default
}

const configure = await loadConfig()

test('uses bounded esbuild production minification with destructive console argument semantics', () => {
  const config = configure({ mode: 'production' })
  assert.deepEqual([...config.esbuild.drop], ['console', 'debugger'])
  assert.equal(config.esbuild.pure, undefined, 'pure would preserve console argument side effects')
  assert.equal(config.build.minify, 'esbuild')
  assert.equal(config.build.terserOptions, undefined)
  assert.equal(config.css.preprocessorMaxWorkers, 1)
  assert.equal(config.build.reportCompressedSize, false)
})

test('retains nonproduction console behavior and existing feature/build gates', () => {
  const defaultConfig = configure({ mode: 'development' })
  assert.deepEqual([...defaultConfig.esbuild.drop], ['debugger'])
  assert.equal(defaultConfig.build.sourcemap, false)
  assert.deepEqual([...defaultConfig.plugins].map(entry => entry.name), [
    'vue', 'vue-jsx', 'yaml', 'compression', 'auto-import', 'components'
  ])

  const enabledConfig = configure({ mode: 'flags-on' })
  assert.equal(enabledConfig.build.sourcemap, true)
  assert.deepEqual([...enabledConfig.plugins].map(entry => entry.name), [
    'vue', 'vue-jsx', 'yaml', 'legacy', 'compression', 'visualizer', 'auto-import', 'components'
  ])
  assert.deepEqual(Object.keys(enabledConfig.build.rollupOptions.output.manualChunks), [
    'melonjs', 'vue', 'ui', 'markdown', 'utilities'
  ])
})


test('esbuild drop targets remove console arguments and debugger only in production', async () => {
  const source = `
    globalThis.events = []
    const sideEffect = () => { globalThis.events.push('argument'); return 1 }
    console.log(sideEffect())
    debugger
  `
  const production = configure({ mode: 'production' })
  const productionOutput = await transform(source, {
    drop: [...production.esbuild.drop],
    format: 'iife',
    minify: true,
    target: 'es2020'
  })
  const productionContext = vm.createContext({ console: { log: () => { throw new Error('console call survived') } } })
  vm.runInContext(productionOutput.code, productionContext)
  assert.deepEqual([...productionContext.events], [])
  assert.doesNotMatch(productionOutput.code, /\b(?:console|debugger)\b/)

  const development = configure({ mode: 'development' })
  const developmentOutput = await transform(source, {
    drop: [...development.esbuild.drop],
    format: 'iife',
    minify: true,
    target: 'es2020'
  })
  const developmentContext = vm.createContext({})
  developmentContext.console = { log: () => developmentContext.events.push('console') }
  vm.runInContext(developmentOutput.code, developmentContext)
  assert.deepEqual([...developmentContext.events], ['argument', 'console'])
  assert.doesNotMatch(developmentOutput.code, /\bdebugger\b/)
})
