/** Only server-persisted, scoped asset IDs are eligible for authenticated media reads. */
const exactId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value)
const canonicalRevision = value => {
  const text = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value
  return typeof text === 'string' && /^[1-9][0-9]*$/.test(text) && BigInt(text) <= 9223372036854775807n ? text : ''
}
const mediaKinds = new Set(['image', 'audio', 'file', 'text'])
const partStates = new Set(['processing', 'ready', 'failed'])
const mimeFor = value => typeof value === 'string' && /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(value.toLowerCase()) ? value.toLowerCase() : ''

export const normalizeMessagePart = (part, { requireMediaAsset = false } = {}) => {
  if (!part || !exactId(part.partId) || !mediaKinds.has(part.kind) || !partStates.has(part.state)) return null
  const revision = canonicalRevision(part.revision)
  if (!revision) return null
  const assetId = exactId(part.assetId) ? part.assetId : ''
  if (requireMediaAsset && part.state === 'ready' && part.kind !== 'text' && !assetId) return null
  const mime = mimeFor(part.mime || part.contentMimeType || '')
  return {
    partId: part.partId,
    revision,
    kind: part.kind,
    state: part.state,
    assetId,
    mime,
    filename: typeof part.filename === 'string' ? part.filename.slice(0, 180) : '',
    text: part.kind === 'text' && typeof part.text === 'string' ? part.text : '',
    errorCode: part.state === 'failed' && typeof part.errorCode === 'string' ? part.errorCode.slice(0, 80) : ''
  }
}

export const mergeMessageParts = (previous = [], incoming = []) => {
  const ordered = new Map()
  for (const raw of previous) {
    const part = normalizeMessagePart(raw)
    if (part) ordered.set(part.partId, part)
  }
  for (const raw of incoming) {
    const part = normalizeMessagePart(raw, { requireMediaAsset: true })
    if (!part) continue
    const prior = ordered.get(part.partId)
    if (prior && BigInt(prior.revision) >= BigInt(part.revision)) continue
    ordered.set(part.partId, part)
  }
  return [...ordered.values()]
}

export const isMessagePartEvent = event => ['part.processing', 'part.ready', 'part.failed'].includes(event?.type)

/** Never create a media card from an arbitrary URL or unscoped model-authored markdown. */
export const applyMessagePartEvent = (state, event) => {
  if (!isMessagePartEvent(event)) return { type: 'ignored' }
  if (!event.conversationId || state.conversationId !== event.conversationId) return { type: 'ignored' }
  const messageId = typeof event.messageId === 'string' && /^(?:[1-9][0-9]*|[A-Za-z][A-Za-z0-9_-]{0,127})$/.test(event.messageId) ? event.messageId : ''
  const part = normalizeMessagePart({ ...(event.part || event), state: event.type.slice(5) }, { requireMediaAsset: true })
  if (!messageId || !part) return { type: 'invalid_part' }
  const message = state.messages.find(item => item.localId === messageId)
  if (!message) return { type: 'missing_message' } // Request authoritative history before consuming the event cursor.
  const current = message.parts?.find(item => item.partId === part.partId)
  if (current && BigInt(current.revision) >= BigInt(part.revision)) return { type: 'duplicate_part' }
  message.parts = mergeMessageParts(message.parts, [part])
  return { type: 'part', message, part }
}

export const conversationAssetContentPath = ({ conversationId, assetId }) => {
  if (!exactId(conversationId) || !exactId(assetId)) throw new Error('会话资产引用无效。')
  return `/conversations/${encodeURIComponent(conversationId)}/assets/${encodeURIComponent(assetId)}/content`
}

export const safeMediaKind = part => {
  const mime = mimeFor(part?.mime || '')
  if (part?.kind === 'image' && ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(mime)) return 'image'
  if (part?.kind === 'audio' && ['audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/wav', 'audio/webm'].includes(mime)) return 'audio'
  return 'file'
}
