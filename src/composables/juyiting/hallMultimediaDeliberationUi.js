import { safeMediaKind } from './hallMessageParts.js'

const truthyFlag = value => value === true || value === 'true'
const exactRequestId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value)
const text = value => typeof value === 'string' ? value.trim().toUpperCase() : ''
const executeStep = step => text(step?.kind) === 'EXECUTE'
const durableV2Step = step => ['EXECUTE', 'INSPECT'].includes(text(step?.kind))

/**
 * This only controls the additive presentation. It never changes admission,
 * dispatch, asset reads, or legacy /chat/stream behavior.
 */
export const isMultimediaDeliberationUiEnabled = value => truthyFlag(value)

/** A displayed image must still be backed by a scoped, ready server asset. */
export const hasVerifiedConversationImage = messages => Array.isArray(messages) && messages.some(message =>
  Array.isArray(message?.parts) && message.parts.some(part =>
    part?.state === 'ready' && typeof part?.assetId === 'string' && part.assetId.length > 0 && safeMediaKind(part) === 'image'
  )
)

const hasReadyMedia = messages => Array.isArray(messages) && messages.some(message =>
  Array.isArray(message?.parts) && message.parts.some(part =>
    part?.state === 'ready' && typeof part?.assetId === 'string' && part.assetId.length > 0 &&
    ['image', 'audio', 'file'].includes(safeMediaKind(part))
  )
)
const mediaNotice = messages => hasReadyMedia(messages)
  ? '收到的内容可在会话中预览、下载。'
  : '结果会显示在会话中。'

/**
 * A deliberately small, default-off v2 surface. The current request
 * projection has no trusted CHAT schema marker, so CHAT stays on the existing
 * surface. Only durable EXECUTE/INSPECT steps identify a v2 proposal here;
 * requestRevision is deliberately not a marker because legacy /chat/stream uses it.
 */
export const bountyDeliberationPresentation = ({ enabled = false, capability, request, turns = [], messages = [] } = {}) => {
  if (!isMultimediaDeliberationUiEnabled(enabled) || capability?.v2 !== true || !exactRequestId(request?.requestId)) return null

  const requestState = text(request?.state)
  const steps = Array.isArray(request?.steps) ? request.steps : []
  const hasExecuteStep = steps.some(executeStep)
  const hasDurableV2Step = steps.some(durableV2Step)
  if (!hasDurableV2Step) return null

  if (requestState === 'PLANNING' && hasExecuteStep && (!Array.isArray(turns) || turns.length === 0)) {
    return {
      route: 'EXECUTE',
      routeLabel: '处理中',
      state: 'PLANNING',
      title: '悬赏议事',
      phase: 'Agent 正在处理需求。',
      mediaNotice: mediaNotice(messages)
    }
  }

  return null
}
