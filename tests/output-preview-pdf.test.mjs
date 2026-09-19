import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../src/components/outputs/OutputPreview.vue', import.meta.url), 'utf8')
const script = source.match(/<script setup>\n([\s\S]*?)\n<\/script>/)?.[1]

assert.ok(script, 'OutputPreview must contain a script setup block')
assert.match(source, /v-else-if="pdfUrl"/)
assert.match(source, /class="output-preview-pdf"/)
assert.match(source, /sandbox/)
assert.match(source, /referrerpolicy="no-referrer"/)
assert.match(source, /const PDF_MIME = 'application\/pdf'/)
assert.match(script, /blob\.size > MAX_PREVIEW_BYTES/)
assert.match(script, /blob\.type !== item\.mimeType/)
assert.ok(script.indexOf('blob.type !== item.mimeType') < script.indexOf('URL.createObjectURL(blob)'), 'MIME must be checked before a Blob URL is created')
assert.match(script, /item\?\.mimeType === PDF_MIME/)
assert.match(script, /if \(pdfUrl\.value\) URL\.revokeObjectURL\(pdfUrl\.value\)/)
assert.match(script, /controller\?\.abort\(\)/)
assert.match(script, /onBeforeUnmount\(reset\)/)
assert.match(source, /DOCX、XLSX、PPTX 暂不提供网页预览/)
assert.doesNotMatch(source, /v-html/)

console.log('OutputPreview PDF static contract passed')
