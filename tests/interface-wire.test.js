import assert from 'node:assert/strict'
import { readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// Keep Node's test isolation, but expose contract regressions to the existing
// Mocha/Flow entry and its report. A child failure must fail the release suite.
describe('unified interface wire contracts', function () {
  this.timeout(0)
  const directory = new URL('./', import.meta.url)
  const files = readdirSync(directory).filter(name => /^interface-.*\.test\.mjs$/.test(name)).sort()
  it('includes the maintained contract suites', () => assert.ok(files.length > 0))
  for (const file of files) {
    it(file, () => {
      const result = spawnSync(process.execPath, ['--test', fileURLToPath(new URL(file, directory))], {
        cwd: fileURLToPath(new URL('../', directory)), encoding: 'utf8'
      })
      assert.ifError(result.error)
      assert.equal(result.status, 0, `${file}\n${result.stdout}\n${result.stderr}`)
    })
  }
})
