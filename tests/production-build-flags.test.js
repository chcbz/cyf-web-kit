import assert from 'node:assert/strict'
import { it as test } from 'mocha'
import { fileURLToPath } from 'node:url'
import { loadEnv } from 'vite'

const root = fileURLToPath(new URL('../', import.meta.url))
const keys = ['VITE_ECONOMY_PREVIEW_ENABLED', 'VITE_JUYITING_VOICE_ENABLED']

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

test('production defaults keep economy UI visible and voice disabled', () => {
  withFlags({}, flags => assert.deepEqual(flags, {
    VITE_ECONOMY_PREVIEW_ENABLED: 'true',
    VITE_JUYITING_VOICE_ENABLED: 'false'
  }))
})

test('explicit environment overrides retain precedence over production defaults', () => {
  const overrides = {
    VITE_ECONOMY_PREVIEW_ENABLED: 'false',
    VITE_JUYITING_VOICE_ENABLED: 'true'
  }
  withFlags(overrides, flags => assert.deepEqual(flags, overrides))
})
