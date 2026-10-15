import test from 'node:test'
import assert from 'node:assert/strict'
import { validMaterialVersion } from '../src/composables/juyiting/materialVersion.js'
test('material selectors preserve exact public int32 decimal strings', () => {
  for (const value of ['1', '2147483647']) assert.equal(validMaterialVersion(value), true)
  for (const value of [1, 2147483647, '0', '01', '+1', '1.0', ' 1', '2147483648', '9007199254740993', null, undefined]) assert.equal(validMaterialVersion(value), false)
})
