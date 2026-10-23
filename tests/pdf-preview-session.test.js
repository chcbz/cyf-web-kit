import assert from 'node:assert/strict'
import { describe, it } from 'mocha'
import { createPdfPreviewSession } from '../src/utils/pdfPreviewSession.js'
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
const canvas = () => ({ style: {}, getContext: () => ({}) })
const tick = () => new Promise(resolve => setImmediate(resolve))
const source = new Blob(['pdf'], { type: 'application/pdf' })
describe('PDF preview session lifecycle', () => {
  it('serializes rapid page changes and fences stale renders', async () => {
  const states = [], jobs = []; let destroyed = 0
  const document = { numPages: 3, getPage: async number => ({ getViewport: ({ scale }) => ({ width: 100 * scale, height: 200 * scale }), render: () => {
    const job = deferred(); job.cancel = () => job.reject(Object.assign(new Error('cancel'), { name: 'RenderingCancelledException' })); jobs.push({ number, job }); return job
  } }) }
  const session = createPdfPreviewSession({ onState: state => states.push(state), loadDocument: async () => ({ promise: Promise.resolve(document), destroy: async () => { destroyed++ } }) })
  assert.equal(await session.open(source), true)
  const target = canvas(), old = session.render(target, 300, 1, 2)
  await tick()
  const latest = session.render(target, 300, 3, 2)
  await tick(); jobs.at(-1).job.resolve()
  assert.equal(await old, false); assert.equal(await latest, true)
  assert.equal(target.width, 600); assert.equal(target.height, 1200)
  assert.deepEqual(states.filter(s => s.status === 'ready').map(s => s.page), [3])
  assert.equal(await session.render(target, 300, 4), false)
  session.close(); assert.equal(destroyed, 1)
  })
  it('destroys an old source and ignores late loading completion', async () => {
  const pending = deferred(), states = []; let destroyed = 0
  const session = createPdfPreviewSession({ onState: value => states.push(value), loadDocument: async () => ({ promise: pending.promise, destroy: async () => { destroyed++ } }) })
  const open = session.open(source); await tick(); session.close(); pending.resolve({ numPages: 2 })
  assert.equal(await open, false); assert.equal(destroyed, 1)
  assert.equal(states.some(s => s.status === 'loaded'), false)
  })
  it('reports password protection instead of silently accepting', async () => {
  const states = [], session = createPdfPreviewSession({ onState: s => states.push(s), loadDocument: async () => ({ promise: Promise.reject(Object.assign(new Error('password'), { name: 'PasswordException' })), destroy: async () => {} }) })
  assert.equal(await session.open(source), false); assert.match(states.at(-1).message, /密码/)
  })
})
