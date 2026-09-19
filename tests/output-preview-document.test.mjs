import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../src/composables/useOutputs.js', import.meta.url), 'utf8')

assert.match(source, /const documentPreviewMimeTypes = new Set\(\[/)
assert.match(source, /if \(!documentPreviewMimeTypes\.has\(contentMimeType\)\)/)
assert.match(source, /deliverables\/\$\{encodeURIComponent\(artifactId\)\}\/versions\/\$\{artifactVersion\}/)
assert.match(source, /personal-workspace\/files\/\$\{encodeURIComponent\(fileId\)\}\/versions\/\$\{fileVersion\}/)
assert.match(source, /\$\{base\}\/preview/)
assert.match(source, /\$\{base\}\/preview\/parts\/content/)
assert.match(source, /blob\.type !== TEXT_PREVIEW_MIME/)
assert.match(source, /if \(documentPreviewMimeTypes\.has\(item\.mimeType\)\) return 'text'/)
assert.match(source, /if \(item\.byteLength > 1024 \* 1024\) return 'none'/)
assert.doesNotMatch(source, /storageUri/)

console.log('Output document preview static contract passed')
