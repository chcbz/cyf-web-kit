import { expect } from 'chai'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

describe('E13 native raster', () => {
  it('requires gcc native acceleration and remains byte-exact to the scalar raster', function () {
    this.timeout(30000)
    const result = spawnSync('python3', [join(process.cwd(), 'tests/test_juyiting_e13_native_raster.py'), '--require-native'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 30000
    })
    const output = `${result.stdout}\n${result.stderr}`
    expect(result.error, output).to.equal(undefined)
    expect(result.status, output).to.equal(0)
    expect(output).to.include('Ran 6 tests')
    expect(output).to.include('OK')
  })
})
