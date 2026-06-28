import { expect } from 'chai'
import { readFileSync } from 'fs'

describe('juyiting public beta preflight config', () => {
  it('passes a configurable agent id during websocket handshake', () => {
    const source = readFileSync('tests/juyiting-public-beta-preflight.mjs', 'utf8')

    expect(source).to.include('JIA_AGENT_WS_AGENT_ID')
    expect(source).to.match(/agent_id=\$\{encodeURIComponent\(agentId\)\}/)
  })
})
