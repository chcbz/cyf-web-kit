import { expect } from 'chai'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import {
  createPcm16MonoResampler,
  createPcm16MonoWav,
  createPcmWavRecorder,
  float32ToPcm16,
  validatePcm16MonoWav
} from '../src/utils/pcmWavRecorder.js'

describe('PCM/WAV recorder', () => {
  it('resamples statefully across device chunks and writes exact PCM16 mono 24k RIFF/WAV', () => {
    const oneChunk = createPcm16MonoResampler({ inputRate: 48_000 })
    const splitChunks = createPcm16MonoResampler({ inputRate: 48_000 })
    const input = Float32Array.from([0, 0.25, 0.5, 0.75, 1, 0.5, 0, -0.5])
    const expected = oneChunk.process(input)
    const actual = Float32Array.from([...splitChunks.process(input.slice(0, 3)), ...splitChunks.process(input.slice(3))])
    expect([...actual]).to.deep.equal([...expected])
    const wav = createPcm16MonoWav(float32ToPcm16(actual))
    expect(validatePcm16MonoWav(wav)).to.equal(true)
    expect(validatePcm16MonoWav(wav.slice(0, -1))).to.equal(false)
    expect(validatePcm16MonoWav(new Uint8Array(wav.buffer.slice(0)), { maxBytes: wav.byteLength - 1 })).to.equal(false)
  })

  it('preserves 96kHz phase across 127-sample boundaries', () => {
    const input = Float32Array.from({ length: 1_000 }, (_value, index) => Math.sin(index * 0.071))
    const oneChunk = createPcm16MonoResampler({ inputRate: 96_000 })
    const splitChunks = createPcm16MonoResampler({ inputRate: 96_000 })
    const expected = oneChunk.process(input)
    const actual = []
    for (let offset = 0; offset < input.length; offset += 127) actual.push(...splitChunks.process(input.slice(offset, offset + 127)))
    expect(expected).to.have.length(250)
    expect(actual).to.have.length(expected.length)
    expect(Math.max(...expected.map((sample, index) => Math.abs(sample - actual[index])))).to.equal(0)
  })

  it('runs the actual worklet at 96kHz without post-flush PCM', () => {
    const source = readFileSync(new URL('../src/utils/pcmWavCaptureWorklet.js', import.meta.url), 'utf8')
    const messages = []
    let Processor
    class FakeAudioWorkletProcessor {
      constructor () { this.port = { onmessage: null, postMessage: (message, transfer) => messages.push({ message, transfer }) } }
    }
    vm.runInNewContext(source, {
      AudioWorkletProcessor: FakeAudioWorkletProcessor,
      Float32Array,
      Int16Array,
      Math,
      sampleRate: 96_000,
      registerProcessor: (_name, processor) => { Processor = processor }
    })
    const processor = new Processor()
    const input = Float32Array.from({ length: 1_000 }, (_value, index) => Math.sin(index * 0.071))
    for (let offset = 0; offset < input.length; offset += 127) processor.process([[input.slice(offset, offset + 127)]])
    const pcmBeforeFlush = messages.filter(({ message }) => message.type === 'pcm')
    expect(pcmBeforeFlush.reduce((total, { message }) => total + (message.data.byteLength / 2), 0)).to.equal(250)
    processor.port.onmessage({ data: { type: 'flush' } })
    expect(messages.at(-1).message).to.deep.equal({ type: 'flushed' })
    expect(processor.process([[new Float32Array([0, 0, 0, 0])]])).to.equal(false)
    expect(messages.filter(({ message }) => message.type === 'pcm')).to.have.length(pcmBeforeFlush.length)
  })

  it('cleans up an injected AudioWorklet recorder and returns WAV only after a flush', async () => {
    let closed = 0
    let port
    class Context {
      constructor () { this.destination = {}; this.audioWorklet = { addModule: async url => expect(url).to.contain('pcmWavCaptureWorklet.js') } }
      createMediaStreamSource () { return { connect: () => {}, disconnect: () => {} } }
      createGain () { return { gain: { value: 1 }, connect: () => {}, disconnect: () => {} } }
      async resume () {}
      async close () { closed += 1 }
    }
    class Node {
      constructor () {
        port = this.port = {
          onmessage: null,
          postMessage: ({ type }) => {
            if (type !== 'flush') return
            this.port.onmessage({ data: { type: 'pcm', data: new Uint8Array([0, 0]).buffer } })
            this.port.onmessage({ data: { type: 'flushed' } })
          },
          close: () => {}
        }
      }
      connect () {}
      disconnect () {}
    }
    const recorder = await createPcmWavRecorder({
      stream: { getTracks: () => [] },
      browser: { AudioContext: Context, AudioWorkletNode: Node },
      onPcmData: data => expect(data.byteLength).to.equal(2)
    })
    await recorder.start()
    const wav = new Uint8Array(await (await recorder.stop()).arrayBuffer())
    expect(validatePcm16MonoWav(wav)).to.equal(true)
    expect(port).to.exist
    expect(closed).to.equal(1)
  })

  it('releases a pending stop when the worklet reports a processor error', async () => {
    let node
    class Context {
      constructor () { this.destination = {}; this.audioWorklet = { addModule: async () => {} } }
      createMediaStreamSource () { return { connect: () => {}, disconnect: () => {} } }
      createGain () { return { gain: { value: 1 }, connect: () => {}, disconnect: () => {} } }
      async close () {}
    }
    class Node {
      constructor () {
        node = this
        this.port = { onmessage: null, postMessage: () => {}, close: () => {} }
      }
      connect () {}
      disconnect () {}
    }
    const recorder = await createPcmWavRecorder({ stream: { getTracks: () => [] }, browser: { AudioContext: Context, AudioWorkletNode: Node } })
    const stopping = recorder.stop()
    node.onprocessorerror()
    let cause
    try { await stopping } catch (error) { cause = error }
    expect(cause?.message).to.equal('录音处理器出错')
    await recorder.dispose()
  })

  it('closes the owned AudioContext promptly when worklet initialization is aborted', async () => {
    let closed = 0
    let releaseModule
    const moduleReady = new Promise(resolve => { releaseModule = resolve })
    class Context {
      constructor () { this.destination = {}; this.audioWorklet = { addModule: () => moduleReady } }
      async close () { closed += 1 }
    }
    const controller = new AbortController()
    const pending = createPcmWavRecorder({
      stream: { getTracks: () => [] },
      browser: { AudioContext: Context, AudioWorkletNode: class {} },
      abortSignal: controller.signal
    })
    controller.abort()
    await Promise.resolve()
    expect(closed).to.equal(1)
    releaseModule()
    let cause
    try { await pending } catch (error) { cause = error }
    expect(cause).to.be.instanceOf(DOMException)
    expect(cause.message).to.equal('PCM/WAV recording cancelled')
  })
})
