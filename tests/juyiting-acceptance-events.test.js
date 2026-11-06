import { expect } from 'chai'
import { isAcceptanceProjectionEvent } from '../src/composables/juyiting/hallAcceptanceEvents.js'

describe('shared conversation projection refresh classification', () => {
  it('does not turn streamed text or connection control into outcome reads', () => {
    for (const type of ['agent_message_delta', 'agent_message_preview', 'stream_ready', 'ping', 'unknown'])
      expect(isAcceptanceProjectionEvent({ type }), type).to.equal(false)
    expect(isAcceptanceProjectionEvent(null)).to.equal(false)
  })
  it('refreshes committed messages, outcomes and actual lifecycle changes through the primary stream', () => {
    for (const type of ['agent_message', 'part.ready', 'part.failed', 'typed_question_answered', 'interaction.state_changed',
      'delivery_submission_completed', 'delivery_review_changed', 'execution_terminal', 'execution_abandoned', 'action_started',
      'action_failed', 'target_capability_unavailable', 'cancel_requested', 'resync_required'])
      expect(isAcceptanceProjectionEvent({ type }), type).to.equal(true)
  })
})
