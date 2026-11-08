import assert from 'node:assert/strict'
import { it as test } from 'mocha'
import { fileURLToPath } from 'node:url'
import { loadEnv, loadConfigFromFile } from 'vite'

const root = fileURLToPath(new URL('../', import.meta.url))
const keys = [
  'VITE_ECONOMY_PREVIEW_ENABLED',
  'VITE_JUYITING_VOICE_ENABLED',
  'VITE_JUYITING_MULTIMEDIA_DELIBERATION_V2_UI',
  'VITE_JUYITING_FOLLOWUP_EXECUTE_V3_UI',
  'VITE_JUYITING_TYPED_DELIBERATION_UI'
]

const withFlags = (overrides, verify) => {
  const before = keys.map(key => [key, process.env[key]])
  try {
    for (const key of keys) {
      if (Object.hasOwn(overrides, key)) process.env[key] = overrides[key]
      else delete process.env[key]
    }
    const loaded = loadEnv('production', root, keys)
    verify(Object.fromEntries(keys.map(key => [key, loaded[key]])))
  } finally {
    for (const [key, value] of before) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

test('production defaults preserve the published multimedia, follow-up and typed discussion flow', () => {
  withFlags({}, flags => {
    assert.equal(flags.VITE_ECONOMY_PREVIEW_ENABLED, 'true')
    assert.equal(flags.VITE_JUYITING_VOICE_ENABLED, 'true')
    assert.equal(flags.VITE_JUYITING_MULTIMEDIA_DELIBERATION_V2_UI, 'true')
    assert.equal(flags.VITE_JUYITING_FOLLOWUP_EXECUTE_V3_UI, 'true')
    assert.equal(flags.VITE_JUYITING_TYPED_DELIBERATION_UI, 'true')
  })
})

test('explicit candidate overrides retain precedence for all multimedia UI flags', () => {
  const overrides = {
    VITE_ECONOMY_PREVIEW_ENABLED: 'false',
    VITE_JUYITING_VOICE_ENABLED: 'true',
    VITE_JUYITING_MULTIMEDIA_DELIBERATION_V2_UI: 'true',
    VITE_JUYITING_FOLLOWUP_EXECUTE_V3_UI: 'true',
    VITE_JUYITING_TYPED_DELIBERATION_UI: 'true'
  }
  withFlags(overrides, flags => assert.deepEqual(flags, overrides))
})


test('runner loading preserves config-relative aliases and LESS imports with shared dependencies', async () => {
  const loaded = await loadConfigFromFile(
    { command: 'build', mode: 'production' },
    fileURLToPath(new URL('../vite.config.js', import.meta.url)), root,
    'silent', undefined, 'runner'
  )
  assert.ok(loaded)
  for (const [alias, folder] of Object.entries({
    '@': 'src', '@assets': 'src/assets', '@components': 'src/components',
    '@stores': 'src/stores', '@router': 'src/router', '@i18n': 'src/i18n'
  })) {
    assert.equal(loaded.config.resolve.alias[alias], fileURLToPath(new URL(`../${folder}`, import.meta.url)))
  }
  assert.equal(loaded.config.css.preprocessorOptions.less.additionalData,
    `@import "${fileURLToPath(new URL('../src/styles/theme.less', import.meta.url))}";`)
})
