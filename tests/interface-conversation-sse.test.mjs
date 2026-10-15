import test from 'node:test'
import assert from 'node:assert/strict'
import { createHallSseParser } from '../src/composables/juyiting/hallConversationSse.js'
import { eventMessage } from '../src/utils/messageEnvelope.js'
const message = (sequence = '9007199254740993') => eventMessage('request-test','conversation.event',`conversation:42:${sequence}`,
  { type:'interaction.state_changed',conversationId:'42',eventSequence:sequence,eventVersion:sequence,occurredAt:1000 })
const frame = m => `event: ${m.messageType}\nid: ${m.messageId}\ndata: ${JSON.stringify(m)}\n\n`
function run(wire) { const events=[], cursors=[], errors=[];const parser=createHallSseParser({conversationId:'42',requestId:'request-test',onEvent:e=>events.push(e),onCursor:c=>cursors.push(c),onInvalid:e=>errors.push(e)});parser.push(wire);parser.finish();return {events,cursors,errors} }
test('conversation stream preserves scoped Long sequence and public epoch timestamp',()=>{
  const result=run(frame(message()));assert.deepEqual(result.cursors,['9007199254740993']);assert.equal(result.events[0].occurredAt,'1000');assert.deepEqual(result.errors,[])
})
test('ready event keeps distinct message ID and authoritative replay cursor',()=>{
  const result=run(frame(eventMessage('request-test','conversation.stream.ready','conversation:42:ready:fixture',{type:'stream_ready',conversationId:'42',cursor:'0',nextCursor:'0'})))
  assert.deepEqual(result.cursors,['0']);assert.deepEqual(result.errors,[])
})
test('wrong scope, correlation, timestamp types, duplicate framing and old roots fail closed',()=>{
  for(const wire of [frame({...message(),requestId:'wrong'}),frame({...message(),messageId:'conversation:43:9007199254740993'}),
    frame({...message(),data:{...message().data,occurredAt:'1000'}}),frame(message()).replace('event: conversation.event','event: conversation.event\nevent: conversation.event'),
    frame(message()).replace('id: conversation:42:','id: '), 'id:1\ndata:{"eventSequence":"1"}\n\n']) {
    const result=run(wire);assert.equal(result.errors.length,1,wire);assert.equal(result.events.length,0)
  }
})
