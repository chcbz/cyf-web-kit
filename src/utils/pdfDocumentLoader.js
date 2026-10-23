import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'

// Only pinned application assets may be fetched. A document cannot supply an
// external URL, host path or executable attachment to the viewer.
const assets = import.meta.glob('../../node_modules/pdfjs-dist/{cmaps,standard_fonts,wasm}/*.{bcmap,pfb,ttf,otf,wasm,js}', {
  query: '?url', import: 'default'
})
const directories = { cMapUrl: 'cmaps', standardFontDataUrl: 'standard_fonts', wasmUrl: 'wasm' }
class BundledPdfDataFactory {
  async fetch({ kind, filename }) {
    const directory = directories[kind]
    const loadAsset = directory && assets[`../../node_modules/pdfjs-dist/${directory}/${filename}`]
    if (!loadAsset) throw new Error('PDF_SUPPORT_ASSET_UNAVAILABLE')
    const url = await loadAsset()
    const response = await fetch(url, { credentials: 'same-origin' })
    if (!response.ok) throw new Error('PDF_SUPPORT_ASSET_UNAVAILABLE')
    return new Uint8Array(await response.arrayBuffer())
  }
}

export async function loadPdfDocument(bytes) {
  const pdf = await import('pdfjs-dist/legacy/build/pdf.mjs')
  pdf.GlobalWorkerOptions.workerSrc = workerUrl
  return pdf.getDocument({
    data: bytes, isEvalSupported: false, enableXfa: false, stopAtErrors: true,
    useSystemFonts: false, useWorkerFetch: false, BinaryDataFactory: BundledPdfDataFactory
  })
}
