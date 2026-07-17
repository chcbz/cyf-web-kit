import { expect } from 'chai'
import { readFileSync } from 'fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { runNpmScript } from './juyiting-public-beta-preflight.mjs'

describe('juyiting public beta preflight config', () => {
  it('passes a configurable agent id during websocket handshake', () => {
    const source = readFileSync('tests/juyiting-public-beta-preflight.mjs', 'utf8')

    expect(source).to.include('JIA_AGENT_WS_AGENT_ID')
    expect(source).to.match(/agent_id=\$\{encodeURIComponent\(agentId\)\}/)
  })

  it('runs map and sprite validation before network checks', () => {
    const source = readFileSync('tests/juyiting-public-beta-preflight.mjs', 'utf8')
    const mapGate = source.indexOf("await record('validate Juyiting map assets'")
    const spriteGate = source.indexOf("await record('validate Juyiting sprite assets'")
    const firstNetworkCheck = source.indexOf("await record('backend login works'")

    expect(mapGate).to.be.greaterThan(-1)
    expect(spriteGate).to.be.greaterThan(mapGate)
    expect(firstNetworkCheck).to.be.greaterThan(spriteGate)
    expect(source).to.include("runNpmScript('validate:juyiting-map')")
    expect(source).to.include("runNpmScript('validate:juyiting-sprites')")
  })

  it('executes the npm_execpath-free fallback successfully', async () => {
    await runNpmScript('validate:juyiting-map', { npmExecPath: null })
  })

  it('propagates a nonzero exit from the npm_execpath-free fallback', async () => {
    const emptyDirectory = await mkdtemp(join(tmpdir(), 'juyiting-preflight-'))
    try {
      let failure
      try {
        await runNpmScript('validate:juyiting-map', { cwd: emptyDirectory, npmExecPath: null })
      } catch (error) {
        failure = error
      }
      expect(failure).to.be.instanceOf(Error)
      expect(failure).to.have.property('code').that.is.not.equal(0)
    } finally {
      await rm(emptyDirectory, { recursive: true, force: true })
    }
  })
})
