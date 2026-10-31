const ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
const MAX_BYTES = 8 * 1024 * 1024
const acceptFileMessages = (event, state) => {
  const items = event?.detail?.data
  if (!Array.isArray(items)) return
  for (const item of items) {
    const message = item?.messageType ? item : item?.data
    const payload = message?.data
    if (message?.protocolVersion !== 1 || message.messageType !== 'file.download' || !ID.test(message.requestId || '') ||
        !payload || typeof payload.name !== 'string' || payload.name.length > 180 ||
        typeof payload.mime !== 'string' || payload.mime.length > 100 ||
        !Number.isInteger(payload.size) || payload.size < 1 || payload.size > MAX_BYTES ||
        typeof payload.base64 !== 'string' || payload.base64.length > Math.ceil(MAX_BYTES / 3) * 4 ||
        !/^[A-Za-z0-9+/]*={0,2}$/.test(payload.base64)) continue
    const now = Date.now()
    for (const [id, pending] of Object.entries(state.pendingDownloads)) if (now - pending.receivedAt > 30000) delete state.pendingDownloads[id]
    for (const [id, usedAt] of Object.entries(state.consumedDownloads)) if (now - usedAt > 5 * 60 * 1000) delete state.consumedDownloads[id]
    if (state.consumedDownloads[message.requestId] != null || state.pendingDownloads[message.requestId]) continue
    if (Object.keys(state.pendingDownloads).length >= 3 || Object.keys(state.consumedDownloads).length >= 100) continue
    state.pendingDownloads[message.requestId] = {
      protocolVersion: 1, requestId: message.requestId, messageType: message.messageType,
      name: payload.name, mime: payload.mime.split(';', 1)[0].trim().toLowerCase(), size: payload.size, base64: payload.base64, receivedAt: now
    }
  }
}
module.exports = { ID, MAX_BYTES, acceptFileMessages }
