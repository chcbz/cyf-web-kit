import { expect } from 'chai'
import { readFileSync } from 'node:fs'
import { compileScript, parse } from '@vue/compiler-sfc'

const source = readFileSync(new URL('../src/components/juyiting/HallStage.vue', import.meta.url), 'utf8')
describe('live map preview Stage business gate', () => {
  it('compiles the same Stage adapter with preview-first business gating', () => {
    const { descriptor } = parse(source, { filename: 'HallStage.vue' })
    const result = compileScript(descriptor, { id: 'live-preview-stage' })
    expect(result.content).to.include('businessReadyGeneration === attemptId')
    expect(result.content).to.include('props.readOnlyPreview')
    expect(result.content).to.include('setPreviewDrawPolicy')
    expect(result.content).to.include("businessReadyGeneration = attemptId")
  })
})
