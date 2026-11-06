// Display projection over the already validated review context, not new acceptance authority.
export const exactReviewOutput = (outputs, item) => outputs.find(output => output.artifactId === item.artifactId &&
  String(output.artifactVersion) === String(item.artifactVersion) && output.sha256 === item.contentHash)
export function completedReviewRecords (context, taskId) {
  const empty = { accepted: [], history: [], acceptedBatches: [], complete: false }
  if (!context || context.taskId !== taskId || !['COMPLETED', 'ARCHIVED'].includes(context.taskState)) return empty
  const batches = [context.currentDelivery, ...(context.history || [])].filter(Boolean)
  const rows = batch => batch.items.filter(item => item.displayRole === 'RESULT').map(item => ({
    key: JSON.stringify([batch.deliveryId, item.artifactId, item.artifactVersion, item.contentHash]), batch, item
  }))
  const acceptedBatches = batches.filter(batch => batch.state === 'ACCEPTED')
  const fixedKey = row => JSON.stringify([row.item.artifactId, row.item.artifactVersion, row.item.contentHash])
  const unique = values => [...new Map(values.map(row => [fixedKey(row), row])).values()]
  const accepted = unique(acceptedBatches.flatMap(rows))
  const acceptedKeys = new Set(accepted.map(fixedKey))
  return { acceptedBatches, accepted, history: unique(batches.filter(batch => batch.state !== 'ACCEPTED').flatMap(rows)).filter(row => !acceptedKeys.has(fixedKey(row))),
    complete: accepted.length > 0 && (context.currentDelivery?.state === 'ACCEPTED' || context.taskState === 'ARCHIVED') }
}

// Labels come from the exact historical source, never from another version with the same name/hash.
export function completedRecordTitle (row, index, outputs) {
  const source = row.item.source
  const title = row.item.display?.title || exactReviewOutput(outputs, row.item)?.title
  if (title?.trim() && title.trim() !== source?.outputId) return title
  return `成果 ${index + 1}`
}

/** Already authorized fixed-version metadata; content access remains in outputReadAdapter. */
export function reviewItemOutput (item) {
  const display = item.display
  if (!display || display.unavailableReason || item.unavailableReason || !display.title ||
      !display.contentMimeType || !Number.isSafeInteger(display.contentByteLength) || display.contentByteLength < 0) return null
  return Object.freeze({
    artifactId: item.artifactId, artifactVersion: item.artifactVersion, title: display.title,
    mimeType: display.contentMimeType, byteLength: display.contentByteLength, sha256: item.contentHash,
    artifactType: '正式交付', state: 'AVAILABLE', fileRef: null,
    artifactRef: Object.freeze({ artifactId: item.artifactId, artifactVersion: item.artifactVersion }),
    canDownload: true, canPreview: true
  })
}
