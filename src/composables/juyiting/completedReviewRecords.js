// Display projection over the already validated review context, not new acceptance authority.
export const exactReviewOutput = (outputs, item) => outputs.find(output => output.artifactId === item.artifactId &&
  String(output.artifactVersion) === String(item.artifactVersion) && output.sha256 === item.contentHash)
export function completedReviewRecords (context, taskId) {
  const empty = { accepted: [], history: [], acceptedBatches: [], complete: false }
  if (!context || context.taskId !== taskId || context.taskState !== 'COMPLETED') return empty
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
    complete: accepted.length > 0 && context.currentDelivery?.state === 'ACCEPTED' }
}
