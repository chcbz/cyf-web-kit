import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../src/components/outputs/OutputPreview.vue', import.meta.url), 'utf8')
const outputs = readFileSync(new URL('../src/composables/useOutputs.js', import.meta.url), 'utf8')
const script = source.match(/<script setup>\n([\s\S]*?)\n<\/script>/)?.[1]

assert.ok(script, 'OutputPreview must contain a script setup block')
assert.match(source, /output-preview-navigation/)
assert.match(source, /selectedPartIndex/)
assert.match(source, /第 \{\{ selectedPartIndex \+ 1 \}\} \/ \{\{ parts\.length \}\}/)
assert.match(source, /v-text="currentPart\.text"/)
assert.match(source, /class="output-preview-pdf"/)
assert.match(source, /sandbox/)
assert.match(source, /referrerpolicy="no-referrer"/)
assert.match(source, /const PDF_MIME = 'application\/pdf'/)
assert.match(script, /part\.blob\.size > MAX_PREVIEW_BYTES/)
assert.match(script, /part\.blob\.type !== part\.contentMimeType/)
assert.ok(script.indexOf('part.blob.type !== part.contentMimeType') < script.indexOf('URL.createObjectURL(part.blob)'), 'part MIME must be checked before a Blob URL is created')
assert.match(script, /URL\.revokeObjectURL/)
assert.match(script, /controller\?\.abort\(\)/)
assert.match(script, /onBeforeUnmount\(reset\)/)
assert.match(script, /documentPreviewMimeTypes = new Set/)
assert.match(source, /版式、分页与公式计算请以下载原文件为准/)
assert.doesNotMatch(source, /v-html/)
assert.match(outputs, /structuredPreviewMimeTypes/)
assert.doesNotMatch(outputs, /storageUri/)

console.log('OutputPreview multi-part navigation static contract passed')
