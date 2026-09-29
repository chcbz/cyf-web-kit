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

const mediaNotice = messages => hasVerifiedConversationImage(messages)
  ? '已收到可领取的会话图片资产；可在消息中预览或下载，但这不等于办理、验收或悬赏完成。'
  : '尚未收到可领取的会话图片资产，正在等待服务端确认；文字回话、议事规划或执行状态不代表“画鸟”已完成。'

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
      routeLabel: '执行办理',
      state: 'PLANNING',
      title: '悬赏议事 v2',
      phase: '执行办理正在规划；尚未产生可领取媒体。',
      mediaNotice: mediaNotice(messages)
    }
  }

  return null
}
