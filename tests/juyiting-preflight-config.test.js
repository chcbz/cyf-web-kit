import { expect } from 'chai'
import { readFileSync } from 'fs'

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
})
