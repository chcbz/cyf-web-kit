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
test('CRLF split across chunks and multiline JSON preserve event and commit cursor only after validation',()=>{
 const events=[],cursors=[],errors=[];const parser=createHallSseParser({conversationId:'42',requestId:'request-test',onEvent:e=>events.push(e),onCursor:c=>cursors.push(c),onInvalid:e=>errors.push(e)})
 const m=message('8'), wire=`event: ${m.messageType}\r\nid: ${m.messageId}\r\ndata: ${JSON.stringify(m)}\r\n\r\n`
 for(const char of wire) parser.push(char)
 parser.finish();assert.deepEqual(errors,[]);assert.equal(events.length,1);assert.deepEqual(cursors,['8'])
})
test('conflicting scope or cursor and rejected reducer never advance replay cursor',()=>{
 for(const patch of [{conversationId:'43'},{cursor:'9'},{eventSequence:'9'}]){
  const m=message('8');const result=run(frame({...m,data:{...m.data,...patch}}));assert.equal(result.events.length,0);assert.deepEqual(result.cursors,[]);assert.equal(result.errors.length,1)
 }
 const cursors=[],errors=[];const parser=createHallSseParser({conversationId:'42',requestId:'request-test',onEvent:()=>false,onCursor:c=>cursors.push(c),onInvalid:e=>errors.push(e)});parser.push(frame(message('8')));assert.deepEqual(cursors,[]);assert.equal(errors.length,1)
})
