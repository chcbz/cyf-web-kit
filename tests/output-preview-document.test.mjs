import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../src/composables/useOutputs.js', import.meta.url), 'utf8')

assert.match(source, /const documentPreviewMimeTypes = new Set\(\[/)
assert.match(source, /const previewPartMimeTypes = new Set\(\[TEXT_PREVIEW_MIME, 'image\/png'\]\)/)
assert.match(source, /const structuredPreviewMimeTypes = new Set\(\[\.\.\.documentPreviewMimeTypes, 'application\/pdf'\]\)/)
assert.match(source, /if \(!structuredPreviewMimeTypes\.has\(contentMimeType\)\)/)
assert.match(source, /deliverables\/\$\{encodeURIComponent\(artifactId\)\}\/versions\/\$\{artifactVersion\}/)
assert.match(source, /personal-workspace\/files\/\$\{encodeURIComponent\(fileId\)\}\/versions\/\$\{fileVersion\}/)
assert.match(source, /\$\{base\}\/preview/)
assert.match(source, /\$\{base\}\/preview\/parts\/\$\{encodeURIComponent\(part\.partId\)\}/)
assert.match(source, /value\.representation != null && !PREVIEW_REPRESENTATIONS\.has\(value\.representation\)/)
assert.match(source, /params: \{ view: 'parts' \}/)
assert.match(source, /validPreviewView\(preview\)/)
assert.match(source, /displayPreviewParts\(preview\)/)
assert.match(source, /preview\.parts\.some\(part => part\.partId !== 'content'\)/)
assert.match(source, /preview\.parts\.filter\(part => part\.partId !== 'content'\)/)
assert.match(source, /exactId\(part\.partId\) && previewPartMimeTypes\.has\(part\.contentMimeType\)/)
assert.match(source, /new Set\(value\.parts\.map\(part => part\.partId\)\)\.size !== value\.parts\.length/)
assert.match(source, /blob\.type !== part\.contentMimeType/)
assert.match(source, /Object\.freeze\(\{ parts: Object\.freeze\(parts\)/)
assert.doesNotMatch(source, /value\.representation === 'EXTRACTED_TEXT'/)
assert.match(source, /if \(documentPreviewMimeTypes\.has\(item\.mimeType\)\) return 'text'/)
assert.match(source, /if \(item\.byteLength > 1024 \* 1024\) return 'none'/)
assert.doesNotMatch(source, /storageUri/)

console.log('Output multi-part preview static contract passed')
