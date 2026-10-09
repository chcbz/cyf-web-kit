/* global sampleRate */
class CyfPcmWavCaptureProcessor extends AudioWorkletProcessor {
  constructor () {
    super()
    this.targetRate = 24000
    this.ratio = sampleRate / this.targetRate
    this.pending = new Float32Array(0)
    this.position = 0
    this.stopped = false
    this.port.onmessage = event => {
      if (event.data?.type === 'flush') {
        this.stopped = true
        this.port.postMessage({ type: 'flushed' })
      }
    }
  }

  process (inputs) {
    if (this.stopped) return false
    const input = inputs[0]?.[0]
    if (!input?.length) return true
    const merged = new Float32Array(this.pending.length + input.length)
    merged.set(this.pending)
    merged.set(input, this.pending.length)
    const output = []
    while (this.position + 1 < merged.length) {
      const lower = Math.floor(this.position)
      const fraction = this.position - lower
      const value = Math.max(-1, Math.min(1, merged[lower] + ((merged[lower + 1] - merged[lower]) * fraction)))
      output.push(value < 0 ? Math.round(value * 0x8000) : Math.round(value * 0x7fff))
      this.position += this.ratio
    }
    const consumed = Math.min(Math.floor(this.position), Math.max(0, merged.length - 1))
    this.pending = merged.slice(consumed)
    this.position -= consumed
    if (output.length) {
      const pcm = new Int16Array(output)
      this.port.postMessage({ type: 'pcm', data: pcm.buffer }, [pcm.buffer])
    }
    return true
  }
}
registerProcessor('cyf-pcm-wav-capture', CyfPcmWavCaptureProcessor)
