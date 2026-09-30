import { expect } from 'chai'
import { outputCatalogItems, outputItemKey, previewKind, scopedExecutionSteps, downloadMimeType, outputDownloadName, outputAssetPart } from '../src/composables/juyiting/bountyOutputCatalog.js'

const requestId = 'request-1'
const stepId = 'step-1'
const prefix = `/chat/requests/${requestId}/steps/${stepId}/outputs/`
const output = overrides => ({
  outputId: 'output-1', contentMimeType: 'image/png', sha256: 'a'.repeat(64), byteLength: 15,
  previewUrl: prefix + 'output-1', downloadUrl: prefix + 'output-1?download=true', ...overrides
})

describe('scoped bounty output catalog', () => {
  it('requires owner-scoped request conversation and a bound execution step', () => {
    const request = { requestId, conversationId: 'conversation-1', steps: [
      { stepId, kind: 'EXECUTE', executionId: 'execution-1' },
      { stepId: 'step-2', kind: 'CHAT', executionId: 'execution-2' },
      { stepId: 'step-3', kind: 'EXECUTE', executionId: null }
    ] }
    expect(scopedExecutionSteps(request, 'conversation-1')).to.deep.equal([{ requestId, stepId }])
    expect(scopedExecutionSteps(request, 'other-conversation')).to.deep.equal([])
    expect(scopedExecutionSteps({ ...request, requestId: '../escape' }, 'conversation-1')).to.deep.equal([])
  })

  it('accepts only byte-backed owner-auth URLs with exact step/output IDs', () => {
    expect(outputCatalogItems([output()], requestId, stepId)).to.have.length(1)
    for (const forged of [
      output({ previewUrl: 'https://foreign.invalid/bird.png' }),
      output({ downloadUrl: '/other-owner/file' }),
      output({ byteLength: Number.MAX_SAFE_INTEGER + 1 }),
      output({ sha256: 'not-a-sha' }),
      output({ outputId: '../secret' }),
      output({ contentMimeType: 'text/html', previewUrl: prefix + 'output-1' })
    ]) expect(outputCatalogItems([forged], requestId, stepId)).to.deep.equal([])
    expect(outputCatalogItems([output(), output()], requestId, stepId)).to.have.length(1)
  })

  it('isolates preview keys for outputs reused across steps and colon-bearing ids', () => {
    expect(outputItemKey({ requestId, stepId: 'step-1', outputId: 'output_1' }))
      .not.to.equal(outputItemKey({ requestId, stepId: 'step-2', outputId: 'output_1' }))
    expect(outputItemKey({ requestId: 'a:b', stepId: 'c', outputId: 'output_1' }))
      .not.to.equal(outputItemKey({ requestId: 'a', stepId: 'b:c', outputId: 'output_1' }))
  })

  it('never previews active content as media', () => {
    expect(previewKind('image/png')).to.equal('image')
    expect(previewKind('audio/mpeg')).to.equal('audio')
    expect(previewKind('text/plain')).to.equal('text')
    expect(previewKind('text/html')).to.equal('file')
    expect(previewKind('image/svg+xml')).to.equal('file')
  })
  it('shares the passive attachment MIME policy and gives downloads usable extensions', () => {
    for (const [mime, extension] of [
      ['image/png', 'png'], ['image/jpeg', 'jpg'], ['audio/mp4', 'm4a'], ['audio/webm', 'webm'],
      ['application/pdf', 'pdf'], ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'docx']
    ]) {
      expect(downloadMimeType(mime)).to.equal(mime)
      expect(outputDownloadName({ outputId: 'output_1', contentMimeType: mime })).to.equal(`output_1.${extension}`)
    }
    expect(downloadMimeType('image/svg+xml')).to.equal('application/octet-stream')
    expect(outputDownloadName({ outputId: '../escape', contentMimeType: 'image/svg+xml' })).to.equal('output.bin')
    for (const mime of ['audio/mp4', 'audio/webm']) {
      expect(previewKind(mime)).to.equal('audio')
      expect(outputCatalogItems([output({ contentMimeType: mime })], requestId, stepId)).to.have.length(1)
    }
  })

  it('accepts only an exact persisted optional assetRef, keeping legacy unprojected media readable', () => {
    const base = output()
    expect(outputCatalogItems([base], requestId, stepId)[0].assetRef).to.equal(null)
    expect(outputAssetPart(base)).to.equal(null)
    const ready = outputCatalogItems([output({ assetRef: { assetId: 'ast_1', revision: '1' } })], requestId, stepId)[0]
    expect(outputAssetPart(ready)).to.deep.equal({ state: 'ready', kind: 'image', assetId: 'ast_1', revision: '1' })
    expect(Object.isFrozen(ready.assetRef)).to.equal(true)
    for (const ref of [
      { assetId: '../foreign', revision: '1' }, { assetId: 'ast_1', revision: 1 },
      { assetId: 'ast_1', revision: '0' }, { assetId: 'ast_1', revision: '01' },
      { assetId: 'ast_1', revision: '9223372036854775808' },
      { assetId: 'ast_1', revision: '1', sha256: 'a'.repeat(64) }, 'ast_1'
    ]) {
      expect(outputCatalogItems([output({ assetRef: ref })], requestId, stepId)).to.deep.equal([])
      expect(outputAssetPart(output({ assetRef: ref }))).to.equal(null)
    }
  })

})
