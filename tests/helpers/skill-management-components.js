import { readFileSync } from 'node:fs'
import { compileScript, parse } from '@vue/compiler-sfc'
import * as Vue from 'vue'
import * as market from '../../src/composables/useSkillMarket.js'
import * as roster from '../../src/utils/skillMarketRoster.js'
import * as silver from '../../src/utils/silverAmount.js'
import { economyApi } from '../../src/composables/useHttp.js'
import * as identity from '../../src/utils/identityLifecycle.js'
import * as contract from '../../src/utils/skillManagementContract.js'
// Evaluate the actual utility with its Vite alias linked to the real HTTP module.
const capabilitySource = readFileSync(new URL('../../src/utils/economyPreviewCapability.js', import.meta.url), 'utf8')
  .replace(/^import[^\n]*\n/gm, '').replace(/export const /g, 'const ')
const capability = new Function('economyApi', capabilitySource + '\nreturn { loadEconomyPreviewCapability, isSkillMarketplaceCapability }')(economyApi)
const compile = (path, id, imports) => {
  const filename = new URL(`../../${path}`, import.meta.url)
  const { descriptor } = parse(readFileSync(filename, 'utf8'), { filename: filename.pathname })
  const code = compileScript(descriptor, { id, inlineTemplate: true }).content
    .replace(/^import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?\s*$/gm, (_m, names, path) => `const { ${names.split(',').map(x => x.trim().replace(/\s+as\s+/, ': ')).join(', ')} } = imports[${JSON.stringify(path)}]`)
    .replace(/^import\s+([^\s]+)\s+from\s+['"]([^'"]+)['"];?\s*$/gm, (_m, name, path) => `const ${name} = imports[${JSON.stringify(path)}]`)
    .replace('export default', 'return')
  return new Function('imports', code)({ vue: Vue, ...imports })
}
export const skillComponents = ({ useApiStore } = {}) => {
  const Management = compile('src/components/economy/SkillManagement.vue', 'sm-management', { '@/composables/useSkillMarket.js': market, '@/utils/skillManagementContract.js': contract })
  const Market = compile('src/components/economy/SkillMarket.vue', 'sm-market', { './SkillManagement.vue': Management })
  const AgentPanel = compile('src/components/juyiting/AgentPanel.vue', 'sm-agent-panel', { '../economy/SkillManagement.vue': Management })
  const Route = compile('src/components/economy/SkillMarketRoute.vue', 'sm-route', { '@/stores/api': { useApiStore }, '@/utils/identityLifecycle.js': identity, './SkillMarket.vue': Market, '@/utils/skillMarketRoster.js': roster, '@/utils/silverAmount': silver, '@/utils/economyPreviewCapability': capability })
  return { Management, Market, AgentPanel, Route }
}
export const settle = async () => { await new Promise(r => setTimeout(r, 5)); await Vue.nextTick() }
export const until = async predicate => {
  for (let i = 0; i < 100; i++) { await settle(); if (predicate()) return }
  throw new Error('UI condition not reached')
}
export const button = (wrapper, text) => wrapper.findAll('button').find(button => button.text() === text)
