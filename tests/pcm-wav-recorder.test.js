import { expect } from 'chai'
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
})
