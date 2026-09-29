import { expect } from 'chai'
import { readFileSync } from 'node:fs'

const root = new URL('../src/components/', import.meta.url)
const page = readFileSync(new URL('world/JuyiHall.vue', root), 'utf8')
const panel = readFileSync(new URL('juyiting/BountyDiscussionPanel.vue', root), 'utf8')

// Static contract guards the actual page→panel boundary, not a mocked presentation function.
describe('Juyi Hall bounty v2 request binding', () => {
  it('feeds the active durable request, turns, negotiated capability and UI flag into bounty discussion', () => {
    const start = page.indexOf('<BountyDiscussionPanel')
    const end = page.indexOf('/>', start)
    expect(start).to.be.greaterThan(-1)
    const bounty = page.slice(start, end)
    for (const prop of [
      ':active-request="activeRequest"', ':active-turns="activeTurns"',
      ':capability-state="capabilityState"', ':deliberation-v2-enabled="multimediaDeliberationUiEnabled"'
    ]) expect(bounty).to.include(prop)
    expect(panel).to.include('request: props.activeRequest')
    expect(panel).to.include('turns: props.activeTurns')
    expect(panel).to.include('enabled: props.deliberationV2Enabled')
  })
})
