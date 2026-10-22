const defaultLoader = async bytes => (await import('./pdfDocumentLoader.js')).loadPdfDocument(bytes)
const ignore = promise => Promise.resolve(promise).catch(() => {})
const cancelled = error => error?.name === 'RenderingCancelledException' || error?.name === 'AbortException'

/** One document per viewer. Generation fencing and cancellation also protect
 * identity/file/version changes; page rendering is serialized on the canvas. */
export function createPdfPreviewSession({ loadDocument = defaultLoader, onState = () => {} } = {}) {
  let renderGeneration = 0
  let generation = 0, loadingTask = null, document = null, renderTask = null
  let renderQueue = Promise.resolve(), pageNumber = 1
  const close = () => {
    generation++; renderGeneration++
    renderTask?.cancel(); renderTask = null
    if (loadingTask) ignore(loadingTask.destroy())
    loadingTask = null; document = null; pageNumber = 1
  }
  const render = (canvas, width, number = pageNumber, pixelRatio = 1) => {
    const current = generation, request = ++renderGeneration, doc = document
    if (!doc || !Number.isInteger(number) || number < 1 || number > doc.numPages) return Promise.resolve(false)
    renderTask?.cancel()
    onState({ status: 'rendering', page: number, pageCount: doc.numPages, message: '' })
    const operation = async () => {
      if (current !== generation || request !== renderGeneration || document !== doc) return false
      const page = await doc.getPage(number)
      if (current !== generation || request !== renderGeneration || document !== doc) return false
      const natural = page.getViewport({ scale: 1 })
      const scale = width / natural.width
      const viewport = page.getViewport({ scale })
      const ratio = Number.isFinite(pixelRatio) && pixelRatio > 0 ? pixelRatio : 1
      canvas.width = Math.ceil(viewport.width * ratio); canvas.height = Math.ceil(viewport.height * ratio)
      canvas.style.width = `${viewport.width}px`; canvas.style.height = `${viewport.height}px`
      const context = canvas.getContext('2d')
      if (!context) throw new Error('PDF_CANVAS_UNAVAILABLE')
      const task = page.render({ canvasContext: context, viewport, transform: ratio === 1 ? null : [ratio, 0, 0, ratio, 0, 0] })
      renderTask = task
      await task.promise
      if (current !== generation || request !== renderGeneration || document !== doc || renderTask !== task) return false
      renderTask = null; pageNumber = number
      onState({ status: 'ready', page: number, pageCount: doc.numPages, message: '' })
      return true
    }
    renderQueue = renderQueue.catch(() => {}).then(operation).catch(error => {
      if (current === generation && request === renderGeneration && !cancelled(error)) onState({ status: 'error', page: number, pageCount: doc.numPages, message: 'PDF 页面无法显示，请下载原文件查看。' })
      return false
    })
    return renderQueue
  }
  const open = async blob => {
    close()
    const current = generation
    onState({ status: 'loading', page: 1, pageCount: 0, message: '' })
    try {
      const bytes = new Uint8Array(await blob.arrayBuffer())
      if (current !== generation) return false
      const task = await loadDocument(bytes)
      if (current !== generation) { ignore(task.destroy()); return false }
      loadingTask = task
      const doc = await task.promise
      if (current !== generation) return false
      if (!Number.isInteger(doc.numPages) || doc.numPages < 1) throw new Error('PDF_PAGES_INVALID')
      document = doc
      onState({ status: 'loaded', page: 1, pageCount: doc.numPages, message: '' })
      return true
    } catch (error) {
      if (current !== generation) return false
      if (loadingTask) ignore(loadingTask.destroy())
      loadingTask = null; document = null
      onState({ status: 'error', page: 1, pageCount: 0, message: error?.name === 'PasswordException'
        ? '该 PDF 需要密码，请下载原文件查看。' : 'PDF 无法解析，请下载原文件查看。' })
      return false
    }
  }
  return { open, render, close }
}
