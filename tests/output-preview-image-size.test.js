import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// Execute the real exported policy; composable dependencies are irrelevant to this pure function.
const source = readFileSync(new URL('../src/composables/useOutputs.js', import.meta.url), 'utf8')
const policy = new Function(source.replace(/^import .*\n/gm, '').replace(/^export /gm, '') + '\nreturn outputPreviewKind')()

describe('Formal raster image preview size policy', () => {
  it('previews the real revised PNG and JPEG above the text threshold', () => {
    for (const mimeType of ['image/png', 'image/jpeg']) {
      assert.equal(policy({ mimeType, byteLength: 1429926 }), 'image')
      assert.equal(policy({ mimeType, byteLength: 64 * 1024 * 1024 }), 'image')
    }
  })
  it('rejects invalid or out-of-contract lengths before choosing a decoder', () => {
    for (const byteLength of [undefined, null, -1, 1.5, NaN, Infinity, '1429926', 64 * 1024 * 1024 + 1]) {
      assert.equal(policy({ mimeType: 'image/png', byteLength }), 'none')
    }
  })
  it('keeps small text and PDF limits and structured Office preview unchanged', () => {
    for (const mimeType of ['text/plain', 'application/pdf']) {
      assert.notEqual(policy({ mimeType, byteLength: 1024 * 1024 }), 'none')
      assert.equal(policy({ mimeType, byteLength: 1024 * 1024 + 1 }), 'none')
    }
    assert.equal(policy({ mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', byteLength: 1429926 }), 'text')
  })
  it('does not enable SVG or unknown formats as raster images', () => {
    for (const mimeType of ['image/svg+xml', 'application/octet-stream']) assert.equal(policy({ mimeType, byteLength: 1429926 }), 'none')
  })
  it('retains MIME, dimension, cancellation and URL cleanup in the actual renderer', () => {
    const renderer = readFileSync(new URL('../src/components/outputs/OutputPreview.vue', import.meta.url), 'utf8')
    assert.match(renderer, /width > 4096 \|\| height > 4096 \|\| width \* height > 16_000_000/)
    assert.match(renderer, /part\.blob\.type !== part\.contentMimeType/)
    assert.match(renderer, /controller\?\.abort\(\)/)
    assert.match(renderer, /URL\.revokeObjectURL/)
  })
})
