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


it('keeps preview transitions free of teardown and gates business publication', () => {
  expect(stage).to.include('if (!props.readOnlyPreview) suspendScene()')
  expect(stage).to.include('businessReadyGeneration')
  expect(stage).to.include('previewVisible')
})
