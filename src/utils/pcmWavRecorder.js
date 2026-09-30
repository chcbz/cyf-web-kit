const TARGET_SAMPLE_RATE = 24_000
const PCM16_BYTES_PER_SAMPLE = 2
const WAV_HEADER_BYTES = 44

const asUint8Array = value => {
  if (value instanceof Uint8Array) return value
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  throw new TypeError('PCM data must be binary')
}

export const createPcm16MonoResampler = ({ inputRate, outputRate = TARGET_SAMPLE_RATE } = {}) => {
  if (!Number.isFinite(inputRate) || inputRate <= 0 || !Number.isFinite(outputRate) || outputRate <= 0) throw new TypeError('sample rates must be positive')
  const ratio = inputRate / outputRate
  let pending = new Float32Array(0)
  let position = 0
  return {
    process (input) {
      const samples = input instanceof Float32Array ? input : new Float32Array(input)
      const merged = new Float32Array(pending.length + samples.length)
      merged.set(pending)
      merged.set(samples, pending.length)
      const output = []
      while (position + 1 < merged.length) {
        const lower = Math.floor(position)
        const fraction = position - lower
        const value = merged[lower] + ((merged[lower + 1] - merged[lower]) * fraction)
        output.push(Math.max(-1, Math.min(1, value)))
        position += ratio
      }
      const consumed = Math.floor(position)
      pending = merged.slice(consumed)
      position -= consumed
      return Float32Array.from(output)
    },
    flush () {
      // A final unpaired sample cannot be linearly resampled without inventing audio.
      pending = new Float32Array(0)
      position = 0
      return new Float32Array(0)
    }
  }
}

export const float32ToPcm16 = samples => {
  const source = samples instanceof Float32Array ? samples : new Float32Array(samples)
  const output = new Uint8Array(source.length * PCM16_BYTES_PER_SAMPLE)
  const view = new DataView(output.buffer)
  source.forEach((sample, index) => {
    const bounded = Math.max(-1, Math.min(1, Number.isFinite(sample) ? sample : 0))
    view.setInt16(index * PCM16_BYTES_PER_SAMPLE, bounded < 0 ? Math.round(bounded * 0x8000) : Math.round(bounded * 0x7fff), true)
  })
  return output
}

export const createPcm16MonoWav = (pcm, sampleRate = TARGET_SAMPLE_RATE) => {
  const data = asUint8Array(pcm)
  if (!data.byteLength || data.byteLength % PCM16_BYTES_PER_SAMPLE) throw new TypeError('PCM16 data must be non-empty and sample-aligned')
  const output = new Uint8Array(WAV_HEADER_BYTES + data.byteLength)
  const view = new DataView(output.buffer)
  output.set([0x52, 0x49, 0x46, 0x46], 0)
  view.setUint32(4, output.byteLength - 8, true)
  output.set([0x57, 0x41, 0x56, 0x45, 0x66, 0x6d, 0x74, 0x20], 8)
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * PCM16_BYTES_PER_SAMPLE, true)
  view.setUint16(32, PCM16_BYTES_PER_SAMPLE, true)
  view.setUint16(34, 16, true)
  output.set([0x64, 0x61, 0x74, 0x61], 36)
  view.setUint32(40, data.byteLength, true)
  output.set(data, WAV_HEADER_BYTES)
  return output
}

const ascii = (bytes, offset, text) => text.split('').every((character, index) => bytes[offset + index] === character.charCodeAt(0))

export const validatePcm16MonoWav = (value, { sampleRate = TARGET_SAMPLE_RATE, maxBytes = Infinity } = {}) => {
  const bytes = asUint8Array(value)
  if (bytes.byteLength < WAV_HEADER_BYTES || bytes.byteLength > maxBytes || !ascii(bytes, 0, 'RIFF') || !ascii(bytes, 8, 'WAVE') || !ascii(bytes, 12, 'fmt ') || !ascii(bytes, 36, 'data')) return false
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return view.getUint32(4, true) + 8 === bytes.byteLength &&
    view.getUint32(16, true) === 16 &&
    view.getUint16(20, true) === 1 &&
    view.getUint16(22, true) === 1 &&
    view.getUint32(24, true) === sampleRate &&
    view.getUint32(28, true) === sampleRate * PCM16_BYTES_PER_SAMPLE &&
    view.getUint16(32, true) === PCM16_BYTES_PER_SAMPLE &&
    view.getUint16(34, true) === 16 &&
    view.getUint32(40, true) > 0 &&
    view.getUint32(40, true) % PCM16_BYTES_PER_SAMPLE === 0 &&
    view.getUint32(40, true) + WAV_HEADER_BYTES === bytes.byteLength
}

const workletUrl = new URL('./pcmWavCaptureWorklet.js', import.meta.url).href

export const supportsPcmWavCapture = browser => Boolean(browser?.AudioContext && browser?.AudioWorkletNode)

export const createPcmWavRecorder = async ({ stream, browser = globalThis, onPcmData, workletModuleUrl = workletUrl } = {}) => {
  const AudioContextClass = browser.AudioContext || browser.webkitAudioContext
  const AudioWorkletNodeClass = browser.AudioWorkletNode
  if (!stream || !AudioContextClass || !AudioWorkletNodeClass) throw new Error('当前浏览器不支持 PCM/WAV 录音，仍可使用文字传令')
  const context = new AudioContextClass()
  let closed = false
  let stopped = false
  let source
  let node
  let gain
  const chunks = []
  let stopResolve
  let stopReject
  const close = async () => {
    if (closed) return
    closed = true
    if (stopReject) {
      const reject = stopReject
      stopResolve = stopReject = null
      reject(new DOMException('PCM/WAV recording cancelled', 'AbortError'))
    }
    try { source?.disconnect?.() } catch {}
    try { node?.disconnect?.() } catch {}
    try { gain?.disconnect?.() } catch {}
    try { node?.port?.close?.() } catch {}
    try { await context.close?.() } catch {}
  }
  try {
    await context.audioWorklet.addModule(workletModuleUrl)
    source = context.createMediaStreamSource(stream)
    node = new AudioWorkletNodeClass(context, 'cyf-pcm-wav-capture')
    gain = context.createGain()
    gain.gain.value = 0
    node.port.onmessage = event => {
      if (closed) return
      if (event.data?.type === 'pcm') {
        const chunk = asUint8Array(event.data.data)
        if (!chunk.byteLength || chunk.byteLength % PCM16_BYTES_PER_SAMPLE) return
        onPcmData?.(chunk)
        chunks.push(new Uint8Array(chunk))
      } else if (event.data?.type === 'flushed' && stopResolve) {
        const resolve = stopResolve
        stopResolve = stopReject = null
        resolve()
      }
    }
    source.connect(node)
    node.connect(gain)
    gain.connect(context.destination)
    return {
      async start () { await context.resume?.() },
      async stop () {
        if (stopped) throw new Error('录音已停止')
        stopped = true
        await new Promise((resolve, reject) => {
          stopResolve = resolve
          stopReject = reject
          try { node.port.postMessage({ type: 'flush' }) } catch (cause) { reject(cause) }
        })
        const total = chunks.reduce((size, chunk) => size + chunk.byteLength, 0)
        const pcm = new Uint8Array(total)
        let offset = 0
        chunks.forEach(chunk => { pcm.set(chunk, offset); offset += chunk.byteLength })
        const wav = createPcm16MonoWav(pcm)
        await close()
        return new Blob([wav], { type: 'audio/wav' })
      },
      dispose: close
    }
  } catch (cause) {
    await close()
    throw cause
  }
}
