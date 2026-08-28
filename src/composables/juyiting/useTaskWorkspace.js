import { getCurrentInstance, onUnmounted, ref, shallowRef } from 'vue'
import { agentApi as defaultAgentApi } from '../useHttp.js'
import { applyTaskWorkspaceEvent, createEmptyTaskWorkspace, validateTaskWorkspaceSnapshot } from './taskWorkspaceReducer'
import { useTaskEventStream } from './useTaskEventStream'

const TERMINAL_STATUSES = new Set([400, 401, 403, 404])

export function useTaskWorkspace ({ agentApi = defaultAgentApi, setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout, documentRef = globalThis.document, windowRef = globalThis.window, jitter = Math.random, retryBaseMs = 500, retryCapMs = 15000, retryFailureThreshold = 3, pollIntervalMs = 15000, snapshotTimeoutMs = 30000 } = {}) {
  const workspace = shallowRef(createEmptyTaskWorkspace())
  const connectionState = ref('idle')
  const error = ref(null)
  const subject = ref(null)
  let generation = 0
  let snapshotController = null
  let snapshotTimeout = null
  let retryTimer = null
  let pollTimer = null
  let polling = null
  let failures = 0
  let disabled = false
  let closed = false

  const stream = useTaskEventStream({
    agentApi,
    onOpen: ({ generation: callbackGeneration }) => {
      if (isCurrent(callbackGeneration)) connectionState.value = 'live'
    },
    onEvent: ({ generation: callbackGeneration, event }) => {
      if (!isCurrent(callbackGeneration)) return
      const outcome = applyTaskWorkspaceEvent(workspace.value, event)
      if (outcome.kind === 'applied') {
        workspace.value = outcome.workspace
        failures = 0
        connectionState.value = 'live'
        return
      }
      if (outcome.kind === 'resync') reloadSnapshot(callbackGeneration, { resume: true, resync: true })
    },
    onResync: ({ generation: callbackGeneration }) => {
      if (isCurrent(callbackGeneration)) reloadSnapshot(callbackGeneration, { resume: true, resync: true })
    },
    onEnd: ({ generation: callbackGeneration }) => {
      if (isCurrent(callbackGeneration)) failedConnection(callbackGeneration, new Error('Task event stream ended'))
    },
    onError: ({ generation: callbackGeneration, error: streamError }) => {
      if (isCurrent(callbackGeneration)) failedConnection(callbackGeneration, streamError)
    }
  })

  function open ({ taskId, actorAgentId } = {}) {
    if (!canonicalIdentifier(taskId) || !canonicalIdentifier(actorAgentId)) return rejectOpen()
    const nextSubject = { taskId, actorAgentId }
    if (!closed && subject.value?.taskId === taskId && subject.value?.actorAgentId === actorAgentId) return Promise.resolve(workspace.value)
    resetGeneration(nextSubject)
    connectionState.value = 'loading'
    return reloadSnapshot(generation, { resume: true })
  }

  function rejectOpen () {
    close()
    connectionState.value = 'error'
    error.value = { status: 400, message: 'Task workspace subject is invalid' }
    return Promise.resolve(null)
  }

  function close () {
    generation += 1
    subject.value = null
    closed = true
    abortSnapshot()
    stream.close()
    clearTimers()
    polling = null
    failures = 0
    disabled = false
    error.value = null
    workspace.value = createEmptyTaskWorkspace()
    connectionState.value = 'idle'
  }

  function retry () {
    if (!subject.value) return Promise.resolve()
    disabled = false
    clearTimers()
    return reloadSnapshot(generation, { resume: true, resync: true })
  }

  function resetGeneration (nextSubject) {
    generation += 1
    closed = false
    subject.value = Object.freeze({ taskId: nextSubject.taskId, actorAgentId: nextSubject.actorAgentId })
    abortSnapshot()
    stream.close()
    clearTimers()
    polling = null
    failures = 0
    disabled = false
    error.value = null
    workspace.value = createEmptyTaskWorkspace()
  }

  async function reloadSnapshot (requestGeneration, { resume, resync = false } = {}) {
    if (!isCurrent(requestGeneration) || snapshotController || disabled) return null
    const activeSubject = subject.value
    if (!activeSubject) return null
    stream.close()
    clearRetry()
    connectionState.value = resync ? 'resyncing' : 'loading'
    const controller = new AbortController()
    const timeoutMarker = {}
    let signalTimeout
    let resolveTimeout
    snapshotController = controller
    if (Number.isFinite(snapshotTimeoutMs) && snapshotTimeoutMs > 0) {
      const timeoutPromise = new Promise(resolve => { resolveTimeout = resolve })
      const timer = setTimeoutFn(() => {
        if (snapshotTimeout?.controller !== controller || snapshotController !== controller || !isCurrent(requestGeneration)) return
        snapshotTimeout = null
        snapshotController = null
        controller.abort()
        handleSnapshotFailure(requestGeneration, new Error('Task workspace snapshot timed out'))
        resolveTimeout(timeoutMarker)
      }, snapshotTimeoutMs)
      snapshotTimeout = { controller, timer }
      signalTimeout = timeoutPromise
    }
    try {
      const request = Promise.resolve(agentApi.execute({
        url: `/agent/tasks/${encodeURIComponent(activeSubject.taskId)}/workspace`,
        method: 'GET',
        params: { actorAgentId: activeSubject.actorAgentId },
        autoLoading: false,
        needAuth: true,
        signal: controller.signal
      }))
      const result = signalTimeout ? await Promise.race([request, signalTimeout]) : await request
      if (result === timeoutMarker || !isCurrent(requestGeneration) || controller.signal.aborted) return null
      const snapshot = validateTaskWorkspaceSnapshot(unwrapSnapshot(result), { taskId: activeSubject.taskId })
      if (!snapshot) throw new Error('Task workspace snapshot violates the C04 contract')
      clearSnapshotTimeout(controller)
      workspace.value = snapshot
      error.value = null
      // Stream callbacks may synchronously demand another snapshot; release only this
      // controller before opening so the replacement can acquire single-flight ownership.
      if (snapshotController === controller) snapshotController = null
      if (resume && isVisible(documentRef)) openStream(requestGeneration)
      else connectionState.value = 'reconnecting'
      return snapshot
    } catch (snapshotError) {
      if (!isCurrent(requestGeneration) || controller.signal.aborted || snapshotError?.name === 'AbortError') return null
      handleSnapshotFailure(requestGeneration, snapshotError)
      return null
    } finally {
      clearSnapshotTimeout(controller)
      if (snapshotController === controller) snapshotController = null
    }
  }

  function openStream (streamGeneration) {
    if (!isCurrent(streamGeneration) || !subject.value || disabled || !isVisible(documentRef)) return
    stream.open({ taskId: subject.value.taskId, actorAgentId: subject.value.actorAgentId, sinceVersion: workspace.value.currentVersion, generation: streamGeneration })
  }

  function handleSnapshotFailure (failedGeneration, snapshotError) {
    error.value = observableError(snapshotError)
    if (TERMINAL_STATUSES.has(snapshotError?.status)) {
      workspace.value = createEmptyTaskWorkspace()
      connectionState.value = 'error'
      disabled = true
      stream.close()
      clearTimers()
      return
    }
    if (snapshotError?.status === 503) {
      connectionState.value = 'degraded'
      disabled = true
      stream.close()
      clearTimers()
      return
    }
    failedConnection(failedGeneration, snapshotError)
  }

  function failedConnection (failedGeneration, failure) {
    if (!isCurrent(failedGeneration) || disabled) return
    error.value = observableError(failure)
    if (TERMINAL_STATUSES.has(failure?.status)) {
      workspace.value = createEmptyTaskWorkspace()
      connectionState.value = 'error'
      disabled = true
      stream.close()
      clearTimers()
      return
    }
    failures += 1
    stream.close()
    if (failures >= retryFailureThreshold) {
      connectionState.value = 'degraded'
      schedulePoll(failedGeneration)
      return
    }
    connectionState.value = 'reconnecting'
    scheduleRetry(failedGeneration)
  }

  function scheduleRetry (timerGeneration) {
    if (!isCurrent(timerGeneration) || retryTimer != null || !isVisible(documentRef)) return
    const exponent = failures > 0 ? failures - 1 : 0
    const base = Math.min(retryCapMs, retryBaseMs * (2 ** exponent))
    const random = typeof jitter === 'function' ? jitter() : 0
    const bounded = typeof random === 'number' && random >= 0 && random <= 1 ? random : 0
    const delay = Math.min(retryCapMs, base + Math.floor(base * bounded))
    retryTimer = setTimeoutFn(() => {
      retryTimer = null
      if (isCurrent(timerGeneration)) reloadSnapshot(timerGeneration, { resume: true })
    }, delay)
  }

  function schedulePoll (timerGeneration) {
    if (!isCurrent(timerGeneration) || pollTimer != null || !isVisible(documentRef) || disabled) return
    pollTimer = setTimeoutFn(async () => {
      pollTimer = null
      if (!isCurrent(timerGeneration) || polling || disabled) return
      const pollToken = Symbol('task-workspace-poll')
      polling = pollToken
      try {
        await reloadSnapshot(timerGeneration, { resume: true })
      } finally {
        if (polling === pollToken && isCurrent(timerGeneration)) {
          polling = null
          if (connectionState.value === 'degraded' && !disabled) schedulePoll(timerGeneration)
        }
      }
    }, pollIntervalMs)
  }

  function handleForeground () {
    if (!subject.value || !isVisible(documentRef)) return
    clearRetry()
    clearPoll()
    if (!disabled) reloadSnapshot(generation, { resume: true, resync: true })
  }
  function handleVisibility () {
    if (!isVisible(documentRef)) {
      stream.close()
      clearRetry()
      clearPoll()
      return
    }
    handleForeground()
  }
  function abortSnapshot () {
    clearSnapshotTimeout()
    snapshotController?.abort()
    snapshotController = null
  }
  function clearSnapshotTimeout (controller) {
    if (!snapshotTimeout || controller && snapshotTimeout.controller !== controller) return
    clearTimeoutFn(snapshotTimeout.timer)
    snapshotTimeout = null
  }
  function clearRetry () {
    if (retryTimer != null) {
      clearTimeoutFn(retryTimer)
      retryTimer = null
    }
  }
  function clearPoll () {
    if (pollTimer != null) {
      clearTimeoutFn(pollTimer)
      pollTimer = null
    }
  }
  function clearTimers () {
    clearRetry()
    clearPoll()
  }
  function isCurrent (candidate) { return !closed && candidate === generation && subject.value != null }

  documentRef?.addEventListener?.('visibilitychange', handleVisibility)
  windowRef?.addEventListener?.('focus', handleForeground)
  const dispose = () => {
    documentRef?.removeEventListener?.('visibilitychange', handleVisibility)
    windowRef?.removeEventListener?.('focus', handleForeground)
    close()
  }
  if (getCurrentInstance()) onUnmounted(dispose)

  return { workspace, connectionState, error, subject, open, close, retry, reload: () => reloadSnapshot(generation, { resume: true, resync: true }), dispose }
}

function unwrapSnapshot (result) {
  const outer = result?.data ?? result
  return outer && typeof outer === 'object' && outer.data && typeof outer.data === 'object' ? outer.data : outer
}
function observableError (failure) { return { status: failure?.status ?? null, message: failure?.message || 'Task workspace connection failed' } }
function isVisible (documentRef) { return !documentRef || documentRef.visibilityState !== 'hidden' }
function canonicalIdentifier (value) {
  if (typeof value !== 'string' || hasUnpairedSurrogate(value)) return false
  const points = Array.from(value)
  return points.length > 0 && points.length <= 100 && !isJavaPaddingCharacter(points[0]) && !isJavaPaddingCharacter(points.at(-1)) && !points.some(isIsoControlCharacter)
}
function hasUnpairedSurrogate (value) {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index)
    if (unit >= 0xd800 && unit <= 0xdbff) { if (++index >= value.length || value.charCodeAt(index) < 0xdc00 || value.charCodeAt(index) > 0xdfff) return true } else if (unit >= 0xdc00 && unit <= 0xdfff) return true
  }
  return false
}
function isJavaPaddingCharacter (value) { const point = value.codePointAt(0); return isJavaWhitespaceCodePoint(point) || isJavaSpaceCharCodePoint(point) }
function isJavaWhitespaceCodePoint (point) { return point >= 0x0009 && point <= 0x000d || point >= 0x001c && point <= 0x001f || point === 0x0020 || point === 0x1680 || point >= 0x2000 && point <= 0x2006 || point >= 0x2008 && point <= 0x200a || point === 0x2028 || point === 0x2029 || point === 0x205f || point === 0x3000 }
function isJavaSpaceCharCodePoint (point) { return point === 0x0020 || point === 0x00a0 || point === 0x1680 || point >= 0x2000 && point <= 0x200a || point === 0x2028 || point === 0x2029 || point === 0x202f || point === 0x205f || point === 0x3000 }
function isIsoControlCharacter (value) { const point = value.codePointAt(0); return point >= 0x0000 && point <= 0x001f || point >= 0x007f && point <= 0x009f }
