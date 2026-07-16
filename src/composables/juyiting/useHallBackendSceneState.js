import { ref } from 'vue'

const SCENE_ID = 'juyiting-main'
const SNAPSHOT_URL = `/agent/scenes/${SCENE_ID}/snapshot`
const EVENTS_URL = `/agent/scenes/${SCENE_ID}/events`
const PHASES_URL = `/agent/scenes/${SCENE_ID}/phases`
const POLL_INTERVAL = 15_000

export const useHallBackendSceneState = ({
  agentApi,
  streamFactory,
  now = Date.now,
  sseEnabled = true,
  onSnapshot = () => {},
  onEvent = () => {},
  sleep = delay => new Promise(resolve => setTimeout(resolve, delay)),
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

  let active = false
  let stream = null
  let streamGeneration = 0
  let reconnectTimer = null
  let pollTimer = null
  let resyncPromise = null
  let startPromise = null
  const pendingRequests = new Set()

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

  const fetchSnapshot = async () => {
    const response = await request({ url: SNAPSHOT_URL, method: 'GET' })
    const value = unwrapPayload(response)
    if (!value || value.sceneId !== SCENE_ID || !validVersion(value.sceneVersion)) {
      throw new Error('Invalid Juyiting scene snapshot')
    }
    if (snapshotReady.value && value.sceneVersion < sceneVersion.value) {
      throw new Error('Stale Juyiting scene snapshot')
    }
    latestSnapshot.value = value
    sceneVersion.value = value.sceneVersion
    snapshotReady.value = true
    degraded.value = false
    onSnapshot(value)
    return value
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

  const scheduleReconnect = () => {
    if (!active || !sseEnabled || reconnectTimer != null || resyncPromise) return
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
    resyncPromise = fetchSnapshot()
      .then(() => {
        resyncPromise = null
        if (active && sseEnabled) openStream()
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
    const version = parsed.id ?? parsed.data?.sceneVersion
    if (!validVersion(version)) {
      void resync()
      return
    }
    if (parsed.event === 'resync-required' || parsed.data?.eventType === 'resync-required') {
      void resync()
      return
    }
    if (version <= sceneVersion.value) return
    if (version !== sceneVersion.value + 1) {
      void resync()
      return
    }
    const eventValue = parsed.data && typeof parsed.data === 'object'
      ? { ...parsed.data, sceneVersion: version, eventType: parsed.event || parsed.data.eventType }
      : null
    if (!eventValue) {
      void resync()
      return
    }
    sceneVersion.value = version
    lastEventAt.value = now()
    lastEvent.value = eventValue
    degraded.value = false
    onEvent(eventValue)
  }

  const openStream = () => {
    if (!active || !sseEnabled || resyncPromise) return
    clearReconnect()
    closeStream()
    const generation = streamGeneration
    const parser = createSseParser(record => {
      if (active && generation === streamGeneration) applySseRecord(record)
    })
    const options = {
      url: EVENTS_URL,
      method: 'GET',
      params: { sinceVersion: sceneVersion.value },
      headers: { 'Last-Event-ID': String(sceneVersion.value) },
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
      onError: () => {
        if (active && generation === streamGeneration) {
          sseConnected.value = false
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
    } catch {
      options.onError()
    }
  }

  const onFocus = () => {
    if (!active) return
    if (sseEnabled) {
      if (!sseConnected.value && !resyncPromise) openStream()
    } else {
      void fetchSnapshot().catch(() => { degraded.value = true })
    }
  }

  const start = async () => {
    if (active) return startPromise || latestSnapshot.value
    active = true
    browserWindow()?.addEventListener?.('focus', onFocus)
    startPromise = (async () => {
      try {
        const value = await fetchSnapshot()
        if (!active) return value
        if (sseEnabled) {
          openStream()
        } else {
          pollTimer = setIntervalFn(() => fetchSnapshot()
            .catch(() => { degraded.value = true }), POLL_INTERVAL)
        }
        return value
      } catch (error) {
        degraded.value = true
        throw error
      } finally {
        startPromise = null
      }
    })()
    return startPromise
  }

  const stop = () => {
    if (!active) return
    active = false
    browserWindow()?.removeEventListener?.('focus', onFocus)
    clearReconnect()
    if (pollTimer != null) {
      clearIntervalFn(pollTimer)
      pollTimer = null
    }
    for (const controller of pendingRequests) controller.abort()
    pendingRequests.clear()
    closeStream()
  }

  const retry = async () => {
    if (!active) return null
    clearReconnect()
    closeStream()
    const value = await fetchSnapshot()
    if (active && sseEnabled) openStream()
    return value
  }

  const reportPhase = async (phaseReport) => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await request({
          url: PHASES_URL,
          method: 'POST',
          data: phaseReport
        })
        return unwrapPayload(response)
      } catch {
        if (attempt < 2) await sleep((attempt + 1) * 1000)
      }
    }
    warnings.value = [...warnings.value, {
      code: 'PHASE_REPORT_FAILED',
      message: 'Failed to report scene phase after 3 attempts'
    }]
    degraded.value = true
    return null
  }

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
    onStreamEnd: options.onClose,
    onError: (_message, error) => {
      if (error?.name !== 'AbortError') options.onError(error)
    }
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
    return { id, event, data: JSON.parse(data.join('\n')) }
  } catch {
    return null
  }
}

function parseVersion (value) {
  if (!/^\d+$/.test(value)) return null
  const version = Number(value)
  return validVersion(version) ? version : null
}

function validVersion (value) {
  return Number.isSafeInteger(value) && value >= 0
}

function unwrapPayload (response) {
  const body = response?.data ?? response
  if (body && typeof body === 'object' && Object.hasOwn(body, 'data')) return body.data
  return body
}

function browserWindow () {
  return typeof window === 'undefined' ? null : window
}
