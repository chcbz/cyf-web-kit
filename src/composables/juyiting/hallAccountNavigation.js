export const hasMeaningfulHallLeaveWork = ({
  draft = '',
  isAwaitingReply = false,
  isStreaming = false,
  voiceInteractionLocked = false,
  voiceTurnActive = false
} = {}) => (
  Boolean(String(draft || '').trim()) ||
  Boolean(isStreaming) ||
  Boolean(isAwaitingReply) ||
  Boolean(voiceInteractionLocked) ||
  Boolean(voiceTurnActive)
)

export const confirmHallLeave = ({ hasMeaningfulWork = false, confirm = globalThis.window?.confirm } = {}) => {
  if (!hasMeaningfulWork) return true
  if (typeof confirm !== 'function') return false
  return confirm('厅中仍有未保存草稿或进行中的传令/录音。留在聚义厅可继续处理；确定离开吗？') === true
}
