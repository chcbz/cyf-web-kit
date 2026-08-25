import { parseTaskEventVersion } from './taskEventVersion'

const MAX_DATA_UTF8_BYTES = 16 * 1024
const MAX_RECORD_UTF8_BYTES = MAX_DATA_UTF8_BYTES + 4 * 1024
const MAX_UNTERMINATED_LINE_UTF8_BYTES = MAX_RECORD_UTF8_BYTES

export function createTaskSseParser ({ onEvent, onResync, onMalformed } = {}) {
  let line = ''
  let lineBytes = 0
  let record = []
  let recordBytes = 0
  let dataBytes = 0
  let dataLines = 0
  let stopped = false
  const resetRecord = () => {
    record = []
    recordBytes = 0
    dataBytes = 0
    dataLines = 0
  }
  const resetLine = () => {
    line = ''
    lineBytes = 0
  }
  const fail = reason => {
    if (stopped) return
    stopped = true
    resetLine()
    resetRecord()
    onMalformed?.(reason)
  }
  const dispatch = () => {
    if (stopped) return
    const parsed = parseRecord(record)
    resetRecord()
    if (parsed?.kind === 'comment') return
    if (!parsed) return fail('malformed_sse')
    if (parsed.kind === 'resync') return onResync?.(parsed.data)
    onEvent?.(parsed.data)
  }
  const consumeLine = (value, rawBytes) => {
    if (value.includes('\r')) return fail('malformed_sse')
    if (value === '') return dispatch()
    recordBytes += rawBytes
    if (recordBytes > MAX_RECORD_UTF8_BYTES) return fail('oversize_sse')
    const field = sseField(value)
    if (field.key === 'data') {
      const separatorBytes = dataLines > 0 ? 1 : 0
      const remainingDataBytes = MAX_DATA_UTF8_BYTES - dataBytes - separatorBytes
      const valueBytes = utf8ByteLengthAtMost(field.value, remainingDataBytes)
      if (valueBytes == null) return fail('oversize_sse')
      dataBytes += separatorBytes + valueBytes
      dataLines += 1
    }
    record.push(value)
  }
  const finishLine = () => {
    const rawBytes = lineBytes + 1 // LF is one UTF-8 byte.
    let value = line
    resetLine()
    if (value.endsWith('\r')) value = value.slice(0, -1)
    consumeLine(value, rawBytes)
  }
  return {
    push (chunk) {
      if (stopped || typeof chunk !== 'string') return fail('malformed_sse')
      // Scan directly: a transport chunk may contain many records, but only an unterminated line is bounded.
      for (let index = 0; index < chunk.length && !stopped; index += 1) {
        const unit = chunk.charCodeAt(index)
        if (unit === 0x0a) {
          finishLine()
          continue
        }
        const units = utf16CodePointUnits(chunk, index)
        const bytes = utf8WidthAt(chunk, index, units)
        if (lineBytes + bytes > MAX_UNTERMINATED_LINE_UTF8_BYTES) return fail('oversize_sse')
        line += units === 2 ? chunk[index] + chunk[index + 1] : chunk[index]
        lineBytes += bytes
        if (units === 2) index += 1
      }
    },
    finish () {
      // A final line without its empty record delimiter (including a split CRLF) is truncated.
      if (!stopped && (lineBytes > 0 || record.length > 0)) fail('truncated_sse')
      resetLine()
      resetRecord()
    },
    stop () {
      stopped = true
      resetLine()
      resetRecord()
    }
  }
}

export function useTaskEventStream ({ agentApi, onOpen, onEvent, onResync, onEnd, onError } = {}) {
  let active = null

  function open ({ taskId, actorAgentId, sinceVersion, generation }) {
    close()
    if (typeof taskId !== 'string' || typeof actorAgentId !== 'string' || parseTaskEventVersion(sinceVersion) == null) throw new TypeError('Task stream requires explicit task, actor, and canonical cursor')
    const controller = new AbortController()
    let handle = null
    let terminal = false
    const connection = {
      controller,
      generation,
      promise: null,
      close: () => terminate('closed')
    }
    const stopTransport = () => {
      controller.abort()
      safeCancel(handle)
      parser.stop()
    }
    const terminate = (kind, detail) => {
      if (terminal) return
      terminal = true
      stopTransport()
      if (active === connection) active = null
      if (kind === 'resync') onResync?.({ generation, reason: detail })
      else if (kind === 'error') onError?.({ generation, error: detail })
      else if (kind === 'end') onEnd?.({ generation })
    }
    const parser = createTaskSseParser({
      onEvent: event => onEvent?.({ generation, event }),
      onResync: () => terminate('resync', 'server_resync'),
      onMalformed: reason => terminate('resync', reason)
    })
    active = connection
    connection.promise = agentApi.execute({
      url: `/agent/tasks/${encodeURIComponent(taskId)}/events`,
      method: 'GET',
      params: { actorAgentId, sinceVersion },
      headers: { Accept: 'text/event-stream', 'Last-Event-ID': sinceVersion },
      autoLoading: false,
      needAuth: true,
      responseType: 'stream',
      streamChunks: true,
      signal: controller.signal,
      onStreamOpen: stream => {
        if (terminal || active !== connection) {
          safeCancel(stream)
          return
        }
        handle = stream
        onOpen?.({ generation })
      },
      onStream: chunk => parser.push(chunk),
      onStreamEnd: () => {
        parser.finish()
        terminate('end')
      }
    }).catch(error => {
      if (error?.name !== 'AbortError' && !controller.signal.aborted) terminate('error', error)
    })
    return connection
  }

  function close () {
    active?.close()
  }

  return { open, close, get active () { return active } }
}

function parseRecord (lines) {
  const fields = { id: [], event: [], data: [] }
  for (const line of lines) {
    if (!line || line.startsWith(':')) continue
    const field = sseField(line)
    if (!Object.hasOwn(fields, field.key)) return null
    fields[field.key].push(field.value)
  }
  if (fields.event.length === 0 && fields.data.length === 0 && fields.id.length === 0) return { kind: 'comment' }
  if (fields.event.length !== 1 || fields.data.length === 0 || fields.id.length > 1) return null
  let data
  try { data = JSON.parse(fields.data.join('\n')) } catch { return null }
  if (fields.event[0] === 'resync_required') {
    if (fields.id.length !== 0 || !isRecord(data) || parseTaskEventVersion(data.currentVersion) == null || typeof data.reason !== 'string' || Object.keys(data).some(key => key !== 'currentVersion' && key !== 'reason')) return null
    return { kind: 'resync', data }
  }
  if (fields.event[0] !== 'task_event' || fields.id.length !== 1 || parseTaskEventVersion(fields.id[0]) == null || fields.id[0] === '0' || !isRecord(data) || data.version !== fields.id[0]) return null
  return { kind: 'event', data }
}
function sseField (line) { const separator = line.indexOf(':'); const key = separator < 0 ? line : line.slice(0, separator); let value = separator < 0 ? '' : line.slice(separator + 1); if (value.startsWith(' ')) value = value.slice(1); return { key, value } }
function utf8ByteLengthAtMost (value, limit) {
  if (limit < 0) return null
  let bytes = 0
  for (let index = 0; index < value.length; index += 1) {
    const units = utf16CodePointUnits(value, index)
    bytes += utf8WidthAt(value, index, units)
    if (bytes > limit) return null
    if (units === 2) index += 1
  }
  return bytes
}
function utf16CodePointUnits (value, index) {
  const unit = value.charCodeAt(index)
  return unit >= 0xd800 && unit <= 0xdbff && index + 1 < value.length && value.charCodeAt(index + 1) >= 0xdc00 && value.charCodeAt(index + 1) <= 0xdfff ? 2 : 1
}
function utf8WidthAt (value, index, units) {
  const unit = value.charCodeAt(index)
  if (unit <= 0x7f) return 1
  if (unit <= 0x7ff) return 2
  return units === 2 ? 4 : 3
}
function safeCancel (handle) {
  try {
    const cancellation = handle?.cancel?.()
    if (cancellation && typeof cancellation.then === 'function') Promise.resolve(cancellation).catch(ignoreCancelFailure)
  } catch (cancelError) {
    ignoreCancelFailure(cancelError)
  }
}
function ignoreCancelFailure (cancelError) {
  // Transport cancellation is best-effort and must not interrupt state cleanup/recovery.
  void cancelError
}
function isRecord (value) { return value != null && typeof value === 'object' && !Array.isArray(value) }
