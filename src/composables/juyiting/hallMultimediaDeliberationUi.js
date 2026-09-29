import { safeMediaKind } from './hallMessageParts.js'

const truthyFlag = value => value === true || value === 'true'
const exactRequestId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value)
const positiveRevision = value => (typeof value === 'number' && Number.isSafeInteger(value) ? value > 0 : typeof value === 'string' && /^[1-9][0-9]*$/.test(value))
const text = value => typeof value === 'string' ? value.trim().toUpperCase() : ''
const executeStep = step => text(step?.kind) === 'EXECUTE'

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
 * A deliberately small, default-off v2 surface. requestRevision and server
 * steps are controlled projection markers; without either, legacy CHAT stays
 * on its existing limited surface instead of being inferred as v2.
 */
export const bountyDeliberationPresentation = ({ enabled = false, capability, request, turns = [], messages = [] } = {}) => {
  if (!isMultimediaDeliberationUiEnabled(enabled) || capability?.v2 !== true || !exactRequestId(request?.requestId)) return null

  const requestState = text(request?.state)
  const requestIsV2 = positiveRevision(request?.requestRevision)
  const steps = Array.isArray(request?.steps) ? request.steps : []
  const hasExecuteStep = steps.some(executeStep)
  if (!requestIsV2 && !hasExecuteStep) return null

  const chatTurn = Array.isArray(turns) ? turns.find(turn => text(turn?.route) === 'CHAT' && text(turn?.state) === 'RECEIVED') : null
  if (requestState === 'RUNNING' && chatTurn && requestIsV2) {
    return {
      route: 'CHAT',
      routeLabel: 'CHAT 回话',
      state: 'RUNNING',
      title: '悬赏议事 v2',
      phase: '回话已受理，正在进行议事。',
      mediaNotice: mediaNotice(messages)
    }
  }

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
