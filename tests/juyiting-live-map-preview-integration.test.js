import { expect } from 'chai'
import { readFileSync } from 'node:fs'

const stage = readFileSync(new URL('../src/components/juyiting/HallStage.vue', import.meta.url), 'utf8')
describe('live map preview integration contract', () => {
  it('keeps preview read-only while deferring the business driver until landscape', () => {
    expect(stage).to.include('readOnlyPreview')
    expect(stage).to.include('!props.readOnlyPreview')
    expect(stage).to.include('publishSimulationReady')
    expect(stage).to.include("setInteractionLocked?.(preview, 'preview')")
  })
})
