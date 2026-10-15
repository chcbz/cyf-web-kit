import test from 'node:test'
import assert from 'node:assert/strict'
import { createTaskSseParser, useTaskEventStream } from '../src/composables/juyiting/useTaskEventStream.js'
const message = (version='9007199254740993') => ({ protocolVersion: 1, requestId: 'request-task', messageType: 'task.event', messageId: `task:task-1:${version}`, data: { version, redacted: true } })
const frame = m => `event:${m.messageType}\nid:${m.messageId}\ndata:${JSON.stringify(m)}\n\n`
test('task SSE unwraps exactly once and retains full Long cursor across chunk boundaries', () => {
  const events=[]; const errors=[]; const parser=createTaskSseParser({ taskId: 'task-1', onEvent: e=>events.push(e), onMalformed: e=>errors.push(e) })
  const bytes=frame(message()); for(let i=0;i<bytes.length;i+=7)parser.push(bytes.slice(i,i+7));parser.finish()
  assert.deepEqual(events,[{ version:'9007199254740993',redacted:true }]);assert.deepEqual(errors,[])
})
test('task SSE rejects wrong scope, duplicate fields, legacy wrapper and mismatched framing', () => {
  for(const wire of [frame({...message(),messageId:'task:other:9007199254740993'}),frame(message()).replace('"protocolVersion":1','"protocolVersion":1,"protocolVersion":1'),
    'event:task_event\nid:1\ndata:{"version":"1"}\n\n',frame(message()).replace('event:task.event','event:task.resync.required')]) {
    const errors=[];const parser=createTaskSseParser({taskId:'task-1',onMalformed:e=>errors.push(e),onEvent:()=>assert.fail('Rejected frame emitted')});parser.push(wire)
    assert.deepEqual(errors,['malformed_sse'])
  }
})
test('resync is a scoped independent event and truncation does not fabricate completion', () => {
  const events=[];const errors=[];const parser=createTaskSseParser({taskId:'task-1',onResync:e=>events.push(e),onMalformed:e=>errors.push(e)})
  parser.push(frame({...message(),messageType:'task.resync.required',messageId:'task:task-1:resync:abc',data:{currentVersion:'5',reason:'gap'}}))
  assert.deepEqual(events,[{currentVersion:'5',reason:'gap'}]);parser.push('data:{');parser.finish();assert.deepEqual(errors,['truncated_sse'])
})
test('reconnect sends scoped Last-Event-ID without rounding query cursor', async () => {
  let request
  const stream=useTaskEventStream({agentApi:{execute:async r=>{request=r}}})
  await stream.open({taskId:'task-1',actorAgentId:'agent-1',sinceVersion:'9223372036854775807',generation:1}).promise
  assert.equal(request.headers['Last-Event-ID'],'task:task-1:9223372036854775807');assert.equal(request.params.sinceVersion,'9223372036854775807');stream.close()
})
