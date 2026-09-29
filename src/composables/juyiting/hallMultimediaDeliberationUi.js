import { safeMediaKind } from './hallMessageParts.js'

const truthyFlag = value => value === true || value === 'true'
const exactRequestId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value)
const text = value => typeof value === 'string' ? value.trim().toUpperCase() : ''

/**
 * This only controls the additive presentation. It never changes admission,
 * dispatch, asset reads, or legacy /chat/stream behavior.
 */
export const isMultimediaDeliberationUiEnabled = value => truthyFlag(value)

const resolvedRoute = ({ request, turns }) => {
  const turnRoute = Array.isArray(turns) ? turns.map(turn => text(turn?.route)).find(Boolean) : ''
  return turnRoute || text(request?.route)
}

const resolvedState = ({ request, turns }) => {
  const pendingTurn = Array.isArray(turns) ? turns.find(turn => ['PLANNING', 'RUNNING'].includes(text(turn?.state))) : null
  return text(pendingTurn?.state) || text(request?.state)
}

/** A displayed image must still be backed by a scoped, ready server asset. */
export const hasVerifiedConversationImage = messages => Array.isArray(messages) && messages.some(message =>
  Array.isArray(message?.parts) && message.parts.some(part =>
    part?.state === 'ready' && typeof part?.assetId === 'string' && part.assetId.length > 0 && safeMediaKind(part) === 'image'
  )
)

/**
 * A deliberately small, default-off v2 surface. The existing durable request
 * projection remains the fact source; this mapper does not infer execution or
 * task completion from a prompt, text final, or media placeholder.
 */
export const bountyDeliberationPresentation = ({ enabled = false, capability, request, turns = [], messages = [] } = {}) => {
  if (!isMultimediaDeliberationUiEnabled(enabled) || capability?.v2 !== true || !exactRequestId(request?.requestId)) return null

  const route = resolvedRoute({ request, turns })
  const state = resolvedState({ request, turns })
  // The frozen v2 contract only grants this minimal UI for the observed
  // CHAT/PLANNING projection. Unknown routes/states keep the legacy surface.
  if (route !== 'CHAT' || state !== 'PLANNING') return null

  const hasImage = hasVerifiedConversationImage(messages)
  return {
    route,
    state,
    title: '悬赏议事 v2',
    phase: '议事规划中',
    mediaNotice: hasImage
      ? '已收到可领取的会话图片资产；可在消息中预览或下载。'
      : '尚未收到可领取的会话图片资产，正在等待服务端确认；文字回话或规划状态不代表“画鸟”已完成。'
  }
}
