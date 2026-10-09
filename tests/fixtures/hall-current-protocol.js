export const hallCapabilities = Object.freeze({
  schemaVersion: '2', requestId: true, requestRevision: true, contextSnapshot: true,
  durableTurns: true, deltaSequence: true, cancel: true, interactionHints: ['chat', 'inspect']
})

export const getHallCapabilities = async path => {
  if (path !== '/capabilities') throw new Error(`Unexpected Hall GET: ${path}`)
  return { data: { data: hallCapabilities } }
}
