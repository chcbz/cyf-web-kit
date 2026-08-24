import { ref } from 'vue'
import { registerIdentityCleanup } from '../../utils/identityLifecycle.js'

const SCENE_ID = 'juyiting-main'
const SNAPSHOT_URL = `/agent/scenes/${SCENE_ID}/snapshot`
const EVENTS_URL = `/agent/scenes/${SCENE_ID}/events`
const PHASES_URL = `/agent/scenes/${SCENE_ID}/phases`
const POLL_INTERVAL = 15_000
const JAVA_LONG_MAX = 9223372036854775807n

export const useHallBackendSceneState = ({
  agentApi,
  streamFactory,
  now = Date.now,
  sseEnabled = true,
  onSnapshot = () => {},
  onEvent = () => {},
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval
}) => {
  if (!agentApi?.execute) throw new TypeError('agentApi.execute is required')

  const snapshotReady = ref(false)
  const sceneVersion = ref(0)
  const sseConnected = ref(false)
  const lastEventAt = ref(null)
  const resyncCount = ref(0)
  const degraded = ref(false)
  const latestSnapshot = ref(null)
  const lastEvent = ref(null)
  const warnings = ref([])
  let sceneCursor = '0'

  let active = false
  let stream = null
  let streamGeneration = 0
  let reconnectTimer = null
  let pollTimer = null
  let resyncPromise = null
  let startPromise = null
  let lifecycleGeneration = 0
  let streamModeEnabled = Boolean(sseEnabled)
  let eventsDisabledByBackend = false
  const pendingRequests = new Set()
  const phaseRetryWaiters = new Set()

  const request = async (options) => {
    const controller = new AbortController()
    pendingRequests.add(controller)
    try {
      return await agentApi.execute({
        autoLoading: false,
        needAuth: true,
        signal: controller.signal,
        ...options
      })
    } finally {
      pendingRequests.delete(controller)
    }
  }

  const fetchSnapshot = async (generation = lifecycleGeneration) => {
    const response = await request({ url: SNAPSHOT_URL, method: 'GET', responseType: 'text' })
    const value = unwrapPayload(response)
    const cursor = normalizeVersion(value?.sceneVersion)
    if (!value || value.sceneId !== SCENE_ID || cursor == null) {
      throw new Error('Invalid Juyiting scene snapshot')
    }
    if (snapshotReady.value && compareVersions(cursor, sceneCursor) < 0) {
      throw new Error('Stale Juyiting scene snapshot')
    }
    if (!active || generation !== lifecycleGeneration) return value
    const published = { ...value, sceneVersion: publishVersion(cursor) }
    sceneCursor = cursor
    latestSnapshot.value = published
    sceneVersion.value = published.sceneVersion
    snapshotReady.value = true
    degraded.value = eventsDisabledByBackend
    onSnapshot(published)
    return published
  }

  const closeStream = () => {
    streamGeneration += 1
    sseConnected.value = false
    const closing = stream
    stream = null
    try {
      closing?.close?.()
      closing?.cancel?.()
      closing?.abort?.()
    } catch {
      // Closing is best-effort; generation guards reject late callbacks.
    }
  }

  const clearReconnect = () => {
    if (reconnectTimer != null) {
      clearTimeoutFn(reconnectTimer)
      reconnectTimer = null
    }
  }

  const startPolling = () => {
    if (!active || pollTimer != null) return
    pollTimer = setIntervalFn(() => fetchSnapshot(lifecycleGeneration)
      .catch(() => { degraded.value = true }), POLL_INTERVAL)
  }

  const switchToPolling = () => {
    eventsDisabledByBackend = true
    streamModeEnabled = false
    clearReconnect()
    closeStream()
    degraded.value = true
    startPolling()
  }

  const scheduleReconnect = () => {
    if (!active || !streamModeEnabled || reconnectTimer != null || resyncPromise) return
    reconnectTimer = setTimeoutFn(() => {
      reconnectTimer = null
      if (active && !sseConnected.value) openStream()
    }, 1000)
  }

  const resync = () => {
    if (!active) return Promise.resolve()
    if (resyncPromise) return resyncPromise
    resyncCount.value += 1
    clearReconnect()
    closeStream()
    const generation = lifecycleGeneration
    resyncPromise = fetchSnapshot(generation)
      .then(() => {
        resyncPromise = null
        if (active && generation === lifecycleGeneration && streamModeEnabled) openStream()
      })
      .catch(() => {
        resyncPromise = null
        degraded.value = true
        scheduleReconnect()
      })
    return resyncPromise
  }

  const applySseRecord = (record) => {
    const parsed = parseSseRecord(record)
    if (!parsed) return
    const version = parsed.id ?? normalizeVersion(parsed.data?.sceneVersion)
    if (version == null) {
      void resync()
      return
    }
    if (parsed.event === 'resync-required' || parsed.data?.eventType === 'resync-required') {
      void resync()
      return
    }
    if (compareVersions(version, sceneCursor) <= 0) return
    if (version !== nextVersion(sceneCursor)) {
      void resync()
      return
    }
    const eventValue = parsed.data && typeof parsed.data === 'object'
      ? { ...parsed.data, sceneVersion: publishVersion(version), eventType: parsed.event || parsed.data.eventType }
      : null
    if (!eventValue) {
      void resync()
      return
    }
    sceneCursor = version
    sceneVersion.value = publishVersion(version)
    lastEventAt.value = now()
    lastEvent.value = eventValue
    degraded.value = false
    onEvent(eventValue)
  }

  const openStream = () => {
    if (!active || !streamModeEnabled || resyncPromise) return
    clearReconnect()
    closeStream()
    const generation = streamGeneration
    const parser = createSseParser(record => {
      if (active && generation === streamGeneration) applySseRecord(record)
    })
    const options = {
      url: EVENTS_URL,
      method: 'GET',
      params: { sinceVersion: publishVersion(sceneCursor) },
      headers: { 'Last-Event-ID': sceneCursor },
      onOpen: () => {
        if (active && generation === streamGeneration) {
          sseConnected.value = true
          degraded.value = false
        }
      },
      onChunk: chunk => {
        if (active && generation === streamGeneration) parser.push(String(chunk ?? ''))
      },
      onClose: () => {
        if (active && generation === streamGeneration) {
          parser.finish()
          sseConnected.value = false
          degraded.value = true
          scheduleReconnect()
        }
      },
      onError: error => {
        if (active && generation === streamGeneration) {
          sseConnected.value = false
          if (isEventsDisabled(error)) {
            switchToPolling()
            return
          }
          degraded.value = true
          scheduleReconnect()
        }
      }
    }
    const factory = streamFactory || (streamOptions => authenticatedStream(agentApi, streamOptions))
    try {
      stream = factory(options) || null
      if (stream && typeof stream.then === 'function') {
        stream.catch(options.onError)
      }
    } catch (error) {
      options.onError(error)
    }
  }

  const onFocus = () => {
    if (!active) return
    if (streamModeEnabled) {
      if (!sseConnected.value && !resyncPromise) openStream()
    } else {
      void fetchSnapshot().catch(() => { degraded.value = true })
    }
  }

  const start = async () => {
    if (active) return startPromise || latestSnapshot.value
    active = true
    lifecycleGeneration += 1
    const generation = lifecycleGeneration
    streamModeEnabled = Boolean(sseEnabled)
    eventsDisabledByBackend = false
    browserWindow()?.addEventListener?.('focus', onFocus)
    startPromise = (async () => {
      try {
        const value = await fetchSnapshot(generation)
        if (!active || generation !== lifecycleGeneration) return value
        if (streamModeEnabled) {
          openStream()
        } else {
          startPolling()
        }
        return value
      } catch (error) {
        degraded.value = true
        if (active && generation === lifecycleGeneration) {
          active = false
          lifecycleGeneration += 1
          browserWindow()?.removeEventListener?.('focus', onFocus)
          clearReconnect()
          closeStream()
        }
        throw error
      } finally {
        startPromise = null
      }
    })()
    return startPromise
  }

  const stop = () => {
    const wasActive = active
    active = false
    lifecycleGeneration += 1
    if (wasActive) browserWindow()?.removeEventListener?.('focus', onFocus)
    clearReconnect()
    if (pollTimer != null) {
      clearIntervalFn(pollTimer)
      pollTimer = null
    }
    for (const controller of pendingRequests) controller.abort()
    pendingRequests.clear()
    for (const cancel of [...phaseRetryWaiters]) cancel()
    closeStream()
  }

  const unregisterIdentityCleanup = registerIdentityCleanup(stop)

  const retry = async () => {
    if (!active) return null
    clearReconnect()
    closeStream()
    const generation = lifecycleGeneration
    const value = await fetchSnapshot(generation)
    if (active && generation === lifecycleGeneration && streamModeEnabled) openStream()
    return value
  }

  const reportPhase = async (phaseReport) => {
    const payload = createPhasePayload(phaseReport)
    const generation = lifecycleGeneration
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (generation !== lifecycleGeneration) return null
      try {
        const response = await request({
          url: PHASES_URL,
          method: 'POST',
          data: payload
        })
        if (generation !== lifecycleGeneration) return null
        return unwrapPayload(response)
      } catch (error) {
        if (generation !== lifecycleGeneration || error?.name === 'AbortError') return null
        if (attempt < 2 && !await waitForPhaseRetry((attempt + 1) * 1000, generation)) return null
      }
    }
    warnings.value = [...warnings.value, {
      code: 'PHASE_REPORT_FAILED',
      message: 'Failed to report scene phase after 3 attempts'
    }]
    degraded.value = true
    return null
  }

  const waitForPhaseRetry = (delay, generation) => new Promise(resolve => {
    let settled = false
    const finish = value => {
      if (settled) return
      settled = true
      phaseRetryWaiters.delete(cancel)
      resolve(value)
    }
    const cancel = () => {
      if (settled) return
      clearTimeoutFn(timerId)
      finish(false)
    }
    phaseRetryWaiters.add(cancel)
    const timerId = setTimeoutFn(() => finish(generation === lifecycleGeneration), delay)
  })

  return {
    snapshotReady,
    sceneVersion,
    sseConnected,
    lastEventAt,
    resyncCount,
    degraded,
    latestSnapshot,
    lastEvent,
    warnings,
    start,
    stop,
    dispose: unregisterIdentityCleanup,
    retry,
    reportPhase
  }
}

function authenticatedStream (agentApi, options) {
  const controller = new AbortController()
  let openedHandle = null
  const promise = agentApi.execute({
    url: options.url,
    method: 'GET',
    params: options.params,
    headers: options.headers,
    autoLoading: false,
    needAuth: true,
    responseType: 'stream',
    streamChunks: true,
    signal: controller.signal,
    onStreamOpen: handle => {
      openedHandle = handle
      options.onOpen()
    },
    onStream: options.onChunk,
    onStreamEnd: options.onClose
  }).catch(error => {
    if (error?.name !== 'AbortError') options.onError(error)
  })
  return {
    close () {
      controller.abort()
      openedHandle?.cancel?.()
    },
    promise
  }
}

function createSseParser (onRecord) {
  let buffer = ''
  const drain = () => {
    while (true) {
      const boundary = nextRecordBoundary(buffer)
      if (!boundary) break
      const record = buffer.slice(0, boundary.index)
      buffer = buffer.slice(boundary.index + boundary.length)
      if (record.trim()) onRecord(record)
    }
  }
  return {
    push (chunk) {
      buffer += chunk
      drain()
    },
    finish () {
      buffer = ''
    }
  }
}

function nextRecordBoundary (value) {
  const matches = [
    { index: value.indexOf('\r\n\r\n'), length: 4 },
    { index: value.indexOf('\n\n'), length: 2 },
    { index: value.indexOf('\r\r'), length: 2 }
  ].filter(match => match.index >= 0)
  return matches.sort((left, right) => left.index - right.index)[0] || null
}

function parseSseRecord (record) {
  let id = null
  let event = ''
  const data = []
  for (const line of record.split(/\r\n|\n|\r/)) {
    if (!line || line.startsWith(':')) continue
    const separator = line.indexOf(':')
    const field = separator < 0 ? line : line.slice(0, separator)
    let value = separator < 0 ? '' : line.slice(separator + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    if (field === 'id') id = parseVersion(value)
    else if (field === 'event') event = value
    else if (field === 'data') data.push(value)
  }
  if (data.length === 0) return null
  try {
    return { id, event, data: parseWireJson(data.join('\n')) }
  } catch {
    return null
  }
}

function parseVersion (value) {
  return normalizeVersion(value)
}

function normalizeVersion (value) {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= 0 ? String(value) : null
  }
  if (typeof value === 'bigint') {
    return value >= 0n && value <= JAVA_LONG_MAX ? value.toString() : null
  }
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null
  try {
    const version = BigInt(value)
    return version <= JAVA_LONG_MAX ? version.toString() : null
  } catch {
    return null
  }
}

function publishVersion (value) {
  const version = BigInt(value)
  return version <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(version) : value
}

function compareVersions (left, right) {
  const leftValue = BigInt(left)
  const rightValue = BigInt(right)
  return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0
}

function nextVersion (value) {
  return (BigInt(value) + 1n).toString()
}

function unwrapPayload (response) {
  let body = response?.data ?? response
  if (typeof body === 'string') body = parseWireJson(body)
  if (body && typeof body === 'object' && Object.hasOwn(body, 'data')) return body.data
  return body
}

function parseWireJson (source) {
  return JSON.parse(quoteIntegerFields(source, new Set(['sceneVersion'])))
}

function quoteIntegerFields (source, fields) {
  let result = ''
  let index = 0
  while (index < source.length) {
    if (source[index] !== '"') {
      result += source[index]
      index += 1
      continue
    }
    const start = index
    index += 1
    let escaped = false
    while (index < source.length) {
      const character = source[index]
      index += 1
      if (escaped) {
        escaped = false
      } else if (character === '\\') {
        escaped = true
      } else if (character === '"') {
        break
      }
    }
    const token = source.slice(start, index)
    result += token
    let cursor = index
    while (/\s/.test(source[cursor] ?? '')) cursor += 1
    if (source[cursor] !== ':') continue
    let field
    try {
      field = JSON.parse(token)
    } catch {
      continue
    }
    if (!fields.has(field)) continue
    result += source.slice(index, cursor + 1)
    cursor += 1
    const whitespaceStart = cursor
    while (/\s/.test(source[cursor] ?? '')) cursor += 1
    result += source.slice(whitespaceStart, cursor)
    const numberStart = cursor
    if (source[cursor] === '-') cursor += 1
    const digitsStart = cursor
    while (/\d/.test(source[cursor] ?? '')) cursor += 1
    if (cursor === digitsStart || /[.eE]/.test(source[cursor] ?? '')) {
      index = numberStart
      continue
    }
    result += `"${source.slice(numberStart, cursor)}"`
    index = cursor
  }
  return result
}

function createPhasePayload (source) {
  if (!source || typeof source !== 'object') throw new TypeError('Phase report is required')
  return Object.freeze({
    reportId: source.reportId,
    agentId: source.agentId,
    stateVersion: source.stateVersion,
    phase: source.phase,
    regionId: source.regionId,
    occurredAt: epochMilliseconds(source.occurredAt)
  })
}

function epochMilliseconds (value) {
  const timestamp = typeof value === 'number'
    ? value
    : value instanceof Date
      ? value.getTime()
      : typeof value === 'string' && /^\d+$/.test(value)
        ? Number(value)
        : Date.parse(value)
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
    throw new TypeError('Phase occurredAt must be a nonnegative epoch-millisecond timestamp')
  }
  return timestamp
}

function isEventsDisabled (error) {
  return error?.status === 503 && error?.code === 'SCENE_EVENTS_DISABLED'
}

function browserWindow () {
  return typeof window === 'undefined' ? null : window
}
