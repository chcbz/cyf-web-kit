import { expect } from 'chai'
import { readFileSync } from 'node:fs'
import { ref } from 'vue'
import { selectionKey } from '../src/composables/juyiting/hallSelectedOutputs.js'

const hall = readFileSync(new URL('../src/components/world/JuyiHall.vue', import.meta.url), 'utf8')
const gallery = readFileSync(new URL('../src/components/juyiting/BountyExecutionOutputs.vue', import.meta.url), 'utf8')
const item = n => ({ requestId: `request-${n}`, stepId: 'step', outputId: 'output_1', sha256: String(n).repeat(64), contentMimeType: 'image/png' })
const routing = load => {
  const preview = ref(null), open = ref(true)
  const code = hall.slice(hall.indexOf('const acceptSelectedOutputPreview ='), hall.indexOf('watch(() => selectedOutputReview.open.value'))
  const api = new Function('selectedOutputPreview', 'selectedOutputReview', 'selectionKey', 'bountyDiscussionRef', `${code};return { accept: acceptSelectedOutputPreview, preview: previewSelectedOutput }`)(preview, { open }, selectionKey, { value: { previewSelected: load } })
  return { ...api, state: preview, open }
}

describe('actual selected preview routing and late-result isolation', () => {
  it('never attaches a late A image or mismatched digest to B, and collapse discards late completion', async () => {
    const jobs = []; const h = routing(value => new Promise(resolve => jobs.push({ value, resolve })))
    const a = item(1), b = item(2)
    const first = h.preview(a), second = h.preview(b)
    expect(h.state.value.loading).to.equal(true)
    h.accept({ item: a, url: 'blob:a' }); expect(h.state.value.item.requestId).to.equal(b.requestId)
    h.accept({ item: { ...b, sha256: 'wrong' }, url: 'blob:wrong' }); expect(h.state.value.loading).to.equal(true)
    h.accept({ item: b, url: 'blob:b' }); expect(h.state.value.url).to.equal('blob:b')
    jobs[0].resolve(); jobs[1].resolve(); await Promise.all([first, second])
    expect(h.state.value.url).to.equal('blob:b')
    await h.preview(null); h.accept({ item: b, url: 'blob:late' }); expect(h.state.value).to.equal(null)
  })
  it('shows missing/failed-loader feedback and ignores results after close', async () => {
    const h = routing(async () => { throw Error('network') })
    await h.preview(item(1)); expect(h.state.value.loading).to.equal(false); expect(h.state.value.error).to.include('不会换用其他版本')
    h.open.value = false; h.accept({ item: item(1), url: 'blob:old' }); expect(h.state.value.url).to.equal(undefined)
  })
  it('only the latest gallery preview emits, even when earlier work completes later', async () => {
    const items = [item(1), item(2)], jobs = [], emitted = [], urls = ref({})
    const code = gallery.slice(gallery.indexOf('let selectedPreviewGeneration'), gallery.indexOf('defineExpose({ previewSelected'))
    const api = new Function('allItems', 'outputItemKey', 'loadPreview', 'previewUrls', 'textPreviews', 'itemErrors', 'emit',
      `let epoch=0; ${code}; return { previewSelected, invalidate:()=>epoch++ }`)(ref(items), selectionKey,
      value => new Promise(resolve => jobs.push({ value, resolve })), urls, ref({}), ref({}), (...args) => emitted.push(args))
    const first = api.previewSelected(items[0]), second = api.previewSelected(items[1])
    urls.value[selectionKey(items[1])] = 'blob:b'; jobs[1].resolve(); await second
    jobs[0].resolve(); await first
    expect(emitted).to.have.length(1); expect(emitted[0][1].item.requestId).to.equal('request-2')
    const third = api.previewSelected(items[0]); api.invalidate(); jobs[2].resolve(); await third
    expect(emitted).to.have.length(1)
  })
})
