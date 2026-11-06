// These durable events can change the existing request/output catalogue. Preview
// text is intentionally absent: accepting a delta must never cause a REST read.
const projectionEvents = new Set([
  'agent_message', 'part.processing', 'part.ready', 'part.failed', 'typed_question_answered',
  'interaction.state_changed',
  'delivery_submission_completed', 'delivery_review_changed', 'execution_abandoned', 'execution_terminal',
  'action_started', 'action_failed', 'target_capability_unavailable', 'cancel_requested',
  'resync_required'
])
export const isAcceptanceProjectionEvent = event => projectionEvents.has(event?.type)
