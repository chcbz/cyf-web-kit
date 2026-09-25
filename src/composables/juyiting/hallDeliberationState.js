import { canonicalWireString } from './hallConversationMessages.js'

const TERMINAL_TURN_STATES = new Set(['FINAL_PERSISTED', 'PUBLISHED', 'FAILED', 'CANCELLED'])
const TERMINAL_REQUEST_STATES = new Set(['COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED'])
const PENDING_LABELS = {
  RECEIVED: '已受理', QUEUED: '排队中', DISPATCHED: '正在理解', UNDERSTANDING: '正在理解',
  INSPECT: '只读检查中', STREAMING: '生成中', GENERATING: '生成中', FALLBACK: '安全回退处理中',
  RECOVERY_REQUIRED: '需要恢复核对', ACCEPTANCE_UNKNOWN: '结果未知，正在核对', UNKNOWN: '结果未知，正在核对',
  CANCEL_REQUESTED: '正在取消', COMPLETED: '已完成', PARTIAL: '部分回话已完成', FAILED: '回话失败',
  CANCELLED: '已取消', FINAL_PERSISTED: '已完成', PUBLISHED: '已完成'
}

export const normalizeDeliberationState = value => typeof value === 'string' ? value.trim().toUpperCase() : ''
export const isTerminalTurnState = value => TERMINAL_TURN_STATES.has(normalizeDeliberationState(value))
export const isTerminalRequestState = value => TERMINAL_REQUEST_STATES.has(normalizeDeliberationState(value))
export const isPendingTurn = turn => Boolean(turn?.turnId) && !isTerminalTurnState(turn.state)

const stringField = value => typeof value === 'string' ? value : ''
const assignString = (target, key, ...values) => {
  const value = values.map(stringField).find(Boolean)
  if (value) target[key] = value
}
const upsertTurn = (turns, patch) => {
  if (!patch.turnId) return turns
  const index = turns.findIndex(turn => turn.turnId === patch.turnId)
  const previous = index >= 0 ? turns[index] : {}
  const previousVersion = canonicalWireString(previous.stateVersion, { allowZero: true })
  const patchVersion = canonicalWireString(patch.stateVersion, { allowZero: true })
  if (previousVersion) {
    if (!patchVersion || BigInt(patchVersion) < BigInt(previousVersion)) return turns
    if (patchVersion === previousVersion) {
      const idempotentReplay = Object.entries(patch).every(([key, value]) => previous[key] === value)
      // Exact replays are harmless; conflicting same-version fields are rejected as the same no-op.
      if (!idempotentReplay) return turns
      return turns
    }
  }
  if (isTerminalTurnState(previous.state)) {
    const previousState = normalizeDeliberationState(previous.state)
    const nextState = normalizeDeliberationState(patch.state)
    if (!(previousState === 'FINAL_PERSISTED' && nextState === 'PUBLISHED')) return turns
  }
  const next = { ...previous, ...patch }
  if (index < 0) return [...turns, next]
  const copy = turns.slice()
  copy[index] = next
  return copy
}

export const reduceDeliberationEvent = ({ request, turns }, event) => {
  if (!event || typeof event !== 'object') return { request, turns, handled: false }
  const delivery = event.agentDelivery && typeof event.agentDelivery === 'object' ? event.agentDelivery : null
  const requestId = stringField(event.requestId) || stringField(request?.requestId)
  const turnId = stringField(event.turnId) || stringField(delivery?.turnId)
  let state = normalizeDeliberationState(event.state || delivery?.state)
  if (!state) {
    if (event.type === 'agent_message_delta') state = 'STREAMING'
    else if (event.type === 'agent_message') state = 'FINAL_PERSISTED'
    else if (event.type === 'resync_required') state = 'RECOVERY_REQUIRED'
    else if (event.type === 'cancel_requested') state = 'CANCEL_REQUESTED'
  }
  const relevant = Boolean(requestId || turnId || delivery ||
    ['chat_request_replay', 'agent_message_delta', 'agent_message', 'resync_required', 'cancel_requested'].includes(event.type))
  if (!relevant) return { request, turns, handled: false }

  let patch = null
  if (turnId) {
    patch = { turnId }
    assignString(patch, 'requestId', requestId)
    if (state) patch.state = state
    assignString(patch, 'targetAgentId', event.targetAgentId, event.agentId, delivery?.agentId)
    assignString(patch, 'dispatchId', event.dispatchId, delivery?.dispatchId)
    assignString(patch, 'route', event.routeUsed, event.route, delivery?.route)
    assignString(patch, 'engine', event.engine, delivery?.engine)
    assignString(patch, 'profile', event.profile, delivery?.profile)
    assignString(patch, 'sandbox', event.sandbox, delivery?.sandbox)
    const stateVersion = canonicalWireString(event.stateVersion ?? delivery?.stateVersion, { allowZero: true })
    if (stateVersion) patch.stateVersion = stateVersion
  }
  const sourceTurns = turns || []
  const nextTurns = patch ? upsertTurn(sourceTurns, patch) : sourceTurns
  if (patch && nextTurns === sourceTurns) return { request, turns: sourceTurns, handled: true }
  const explicitRequestState = normalizeDeliberationState(event.requestState || event.aggregateState)
  const pending = nextTurns.some(isPendingTurn)
  const anyTerminal = nextTurns.some(turn => isTerminalTurnState(turn.state))
  const nextRequestState = explicitRequestState || (nextTurns.length
    ? (pending ? (anyTerminal ? 'PARTIAL' : 'RUNNING') : aggregateTerminal(nextTurns))
    : normalizeDeliberationState(request?.state) || 'RUNNING')
  return {
    request: requestId ? {
      ...(request || {}),
      requestId,
      state: nextRequestState,
      route: stringField(event.routeUsed) || stringField(event.route) || request?.route,
      engine: stringField(event.engine) || request?.engine,
      profile: stringField(event.profile) || request?.profile,
      sandbox: stringField(event.sandbox) || request?.sandbox,
      fastChat: event.fastChat === true || request?.fastChat === true
    } : request,
    turns: nextTurns,
    handled: true
  }
}

const aggregateTerminal = turns => {
  const states = turns.map(turn => normalizeDeliberationState(turn.state))
  if (states.every(state => state === 'FINAL_PERSISTED' || state === 'PUBLISHED')) return 'COMPLETED'
  if (states.every(state => state === 'CANCELLED')) return 'CANCELLED'
  if (states.every(state => state === 'FAILED')) return 'FAILED'
  return 'PARTIAL'
}

export const deliberationBusy = (request, turns) => {
  if (Array.isArray(turns) && turns.length) return turns.some(isPendingTurn)
  return Boolean(request?.requestId) && !isTerminalRequestState(request.state)
}

export const cancellationTarget = (request, turns) => {
  if (!request?.requestId) return null
  const pending = (turns || []).filter(isPendingTurn)
  if (!pending.length) return null
  if (pending.length > 1) return { allPending: true }
  return canonicalWireString(pending[0].stateVersion, { allowZero: true })
    ? { turnId: pending[0].turnId }
    : null
}

export const deliberationStatusText = (request, turns) => {
  const pending = (turns || []).filter(isPendingTurn)
  const source = pending[0] || request || {}
  const route = stringField(source.route || request?.route).toUpperCase()
  const engine = stringField(source.engine || request?.engine)
  const profile = stringField(source.profile || request?.profile)
  const sandbox = stringField(source.sandbox || request?.sandbox)
  const state = normalizeDeliberationState(source.state || request?.state)
  const fast = source.fastChat === true || request?.fastChat === true || /fast/i.test(`${route} ${engine} ${profile}`)
  const runtime = fast ? 'Fast' : (engine || profile)
  const observedRoute = route.startsWith('CHAT') ? 'CHAT' : route.startsWith('INSPECT') ? 'INSPECT' : ''
  const observed = [runtime, observedRoute, sandbox].filter(Boolean).join(' · ')
  const phase = PENDING_LABELS[state] || ''
  return [observed, phase].filter(Boolean).join(' · ')
}
