import { expect } from 'chai'
import { outputCatalogItems, outputItemKey, previewKind, scopedExecutionSteps, downloadMimeType, outputDownloadName, outputAssetPart, currentOutputDelivery, applyOutputReplacements } from '../src/composables/juyiting/bountyOutputCatalog.js'

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

describe('explicit output replacement projection', () => {
  const item = (requestId, outputId, sha256, replaces = null) => Object.freeze({ requestId, stepId: 'step-1', outputId, sha256, contentMimeType: 'image/png', replaces })
  const first = item('first', 'bird', 'a'.repeat(64))
  const other = item('first', 'tree', 'b'.repeat(64))
  const edit = item('edit', 'blue-bird', 'c'.repeat(64), { requestId: 'first', stepId: 'step-1', outputId: 'bird', sha256: first.sha256 })
  it('replaces just the exact edited item, retaining other outputs and historical bytes', () => {
    const original = Object.freeze([first, other])
    const result = applyOutputReplacements(original, [edit])
    expect(result).to.deep.equal([edit, other])
    expect(original).to.deep.equal([first, other])
    expect(Object.isFrozen(result)).to.equal(true)
  })
  it('reconstructs multi-round edits from persisted refs after refresh without latest-by-type inference', () => {
    const later = item('later', 'green-bird', 'd'.repeat(64), { requestId: edit.requestId, stepId: edit.stepId, outputId: edit.outputId, sha256: edit.sha256 })
    const sources = JSON.parse(JSON.stringify({ initial: [first, other], edits: [edit, later] }))
    expect(applyOutputReplacements(sources.initial, sources.edits)).to.deep.equal([later, other])
    const accepted = applyOutputReplacements([first, other], [edit])
    applyOutputReplacements([first, other], [edit, later])
    expect(accepted).to.deep.equal([edit, other])
  })
  it('never unions history, accepts an ambiguous branch, or silently substitutes changed bytes', () => {
    for (const edits of [[first], [{ ...edit, replaces: { ...edit.replaces, sha256: 'f'.repeat(64) } }], [edit, { ...edit, requestId: 'branch' }], [edit, edit]]) {
      expect(() => applyOutputReplacements([first, other], edits)).to.throw()
    }
    expect(() => applyOutputReplacements([], [edit])).to.throw()
    expect(applyOutputReplacements([first, other], [])).to.deep.equal([first, other])
  })
  it('pins the displayed source bytes independently of mutable network records', () => {
    const initial = JSON.parse(JSON.stringify([first, other]))
    const edits = JSON.parse(JSON.stringify([edit]))
    const displayed = applyOutputReplacements(initial, edits)
    initial[1].sha256 = 'f'.repeat(64)
    edits[0].sha256 = 'e'.repeat(64)
    edits[0].replaces.sha256 = 'd'.repeat(64)
    expect(displayed).to.deep.equal([edit, other])
    expect(Object.isFrozen(displayed[0])).to.equal(true)
    expect(Object.isFrozen(displayed[0].replaces)).to.equal(true)
    expect(() => applyOutputReplacements([{ ...first, sha256: [first.sha256] }], [])).to.throw()
  })
  it('accepts only exact optional server replacement refs in the existing catalog', () => {
    const replacement = { requestId: 'prior-request', stepId: 'prior-step', outputId: 'prior-output', sha256: 'b'.repeat(64) }
    const parsed = outputCatalogItems([output({ replaces: replacement })], requestId, stepId)[0]
    expect(parsed.replaces).to.deep.equal(replacement)
    expect(Object.isFrozen(parsed.replaces)).to.equal(true)
    for (const replaces of [ { ...replacement, requestId }, { ...replacement, sha256: 'bad' }, { ...replacement, outputId: '../escape' }, { ...replacement, runId: 'invented' }, 'output-1' ]) {
      expect(outputCatalogItems([output({ replaces })], requestId, stepId)).to.deep.equal([])
    }
  })
})

describe('current manifest delivery projection', () => {
  const root = (outputId, mime = 'image/png') => ({ requestId: 'root', stepId: 'batch', outputId,
    sha256: 'a'.repeat(64), contentMimeType: mime, replaces: null })
  const replace = (parent, requestId) => ({ ...parent, requestId, outputId: `${requestId}-output`, sha256: 'b'.repeat(64),
    replaces: { requestId: parent.requestId, stepId: parent.stepId, outputId: parent.outputId, sha256: parent.sha256 } })
  it('reconstructs a shuffled exact edit chain while retaining every unaffected mixed-format output', () => {
    const image = root('bird'); const audio = root('audio', 'audio/mpeg'); const file = root('document', 'application/pdf')
    const edit = replace(image, 'blue'); const later = replace(edit, 'green')
    expect(currentOutputDelivery([later, image, audio, edit, file])).to.deep.equal([later, audio, file])
    expect(currentOutputDelivery(JSON.parse(JSON.stringify([later, image, audio, edit, file])))).to.deep.equal([later, audio, file])
    expect(Object.isFrozen(currentOutputDelivery([image]))).to.equal(true)
  })
  it('has no deliverables for an empty catalog and never unions unrelated root manifests', () => {
    expect(currentOutputDelivery([])).to.deep.equal([])
    const first = root('one')
    for (const second of [{ ...root('two'), requestId: 'other' }, { ...root('two'), stepId: 'other-batch' }]) {
      expect(() => currentOutputDelivery([first, second])).to.throw('本次交付范围尚不明确')
    }
  })
  it('refuses sibling drafts, broken hashes, missing parents, cycles and duplicate source keys', () => {
    const first = root('one'); const edit = replace(first, 'blue')
    for (const catalog of [[first, edit, replace(first, 'green')], [first, { ...edit, replaces: { ...edit.replaces, sha256: 'f'.repeat(64) } }],
      [edit], [first, first], [first, { ...edit, replaces: { ...edit.replaces, requestId: 'missing' } }]]) {
      expect(() => currentOutputDelivery(catalog)).to.throw()
    }
  })
})
