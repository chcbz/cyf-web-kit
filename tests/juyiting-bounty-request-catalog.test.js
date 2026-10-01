import { expect } from 'chai'
import { catalogPage, mergeCatalogEntries } from '../src/composables/juyiting/bountyRequestCatalog.js'
const scope={conversationId:'conversation_1',conversationGeneration:'1',taskId:'task_1'}
const request=id=>({requestId:id,requestRevision:'1',conversationId:'conversation_1',conversationGeneration:'1',userMessageId:'1',state:'COMPLETED',stateVersion:'1',turns:[],steps:[{stepId:`step_${id}`,stepNumber:'1',taskId:'task_1',assignmentRevision:'0',targetAgentId:'agent_1',kind:'EXECUTE',state:'COMPLETED',stateVersion:'1',executionIntentId:`intent_${id}`,executionId:`execution_${id}`,executionState:'OUTPUT_COMMITTED'}]})
const page=(after,through,entries,hasMore=false,nextAfter=null)=>({schemaVersion:1,scope,after,through,nextAfter,hasMore,entries})
describe('bounty request catalog contract',()=>{
 it('merges two pages without confusing request state and step state versions',()=>{
  const first=catalogPage(page('0','101',[{ordinal:'1',request:request('one')}],true,'1')); const second=catalogPage(page('1','101',[{ordinal:'101',request:request('two')}]))
  const merged=mergeCatalogEntries([],first); expect(mergeCatalogEntries(merged,second).map(v=>v.request.requestId)).to.deep.equal(['one','two'])
 })
 it('rejects unsafe pagination and scope drift',()=>{
  expect(catalogPage(page('01','1',[]))).to.equal(null)
  expect(catalogPage({...page('0','1',[]),scope:{...scope,conversationGeneration:'0'}})).to.equal(null)
 })
})
import { ref } from 'vue'
import { useHallBountyRequestCatalog } from '../src/composables/juyiting/useHallBountyRequestCatalog.js'
it('reads every page through a fixed bound without storage', async()=>{
 const calls=[]; const context=ref({conversationId:'conversation_1',taskId:'task_1',targetAgentId:'agent_1',assignmentRevision:'0'}); const generation=ref(1)
 const entries=Array.from({length:101},(_,i)=>({ordinal:String(i+1),request:request(`req_${i+1}`)}))
 const api={get:async(_path,params)=>{calls.push(params); const after=Number(params.after||0); const rows=entries.filter(v=>Number(v.ordinal)>after).slice(0,100); return {data:{data:page(String(after),'101',rows,after===0,after===0?'100':null)}}}}
 const lane=useHallBountyRequestCatalog({chatApi:api,enabled:()=>true,identityScope:ref('owner'),authorizationGeneration:ref(1),getContext:()=>context.value,getContextGeneration:()=>generation.value})
 expect(await lane.refresh()).to.equal(true); expect(lane.entries.value).to.have.length(101); expect(calls).to.deep.equal([{after:'0'},{expectedGeneration:'1',after:'100',through:'101'}]); lane.dispose()
})
