import test from 'node:test';
import assert from 'node:assert/strict';
import {request} from 'node:http';
import {startCapabilitySpike,SPIKE_PROTOCOL} from '../scripts/ai-capability-spike.mjs';
const prefix='io.modelcontextprotocol/';
const metadata=()=>({[prefix+'protocolVersion']:SPIKE_PROTOCOL,[prefix+'clientCapabilities']:{},[prefix+'clientInfo']:{name:'synthetic-test-client',version:'1'}});
const rpc=(method,params={})=>({jsonrpc:'2.0',id:1,method,params:{...params,_meta:metadata()}});
async function fixture(t){const server=await startCapabilitySpike();t.after(server.close);assert.match(server.url,/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);return server;}
async function post(server,message,headers={}){
 const response=await fetch(server.url,{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream','mcp-protocol-version':message.params?._meta?.[prefix+'protocolVersion']||SPIKE_PROTOCOL,'mcp-method':message.method||'unknown',...(message.method==='tools/call'?{'mcp-name':message.params.name}:{}),...headers},body:JSON.stringify(message),signal:AbortSignal.timeout(2000)});
 return {status:response.status,headers:response.headers,body:await response.json()};
}
const call=(server,name,args,headers)=>post(server,rpc('tools/call',{name,arguments:args}),headers);
const read=server=>call(server,'synthetic_task_get',{taskId:'synthetic-task-1'});
const proposal=(requestId='synthetic-one',expectedVersion=0,option='park-a')=>({taskId:'synthetic-task-1',requestId,expectedVersion,option});

test('modern discovery and deterministic tool schemas work over real loopback HTTP',async t=>{
 const server=await fixture(t),discover=await post(server,rpc('server/discover'));
 assert.equal(discover.status,200);assert.deepEqual(discover.body.result.supportedVersions,[SPIKE_PROTOCOL]);assert.deepEqual(discover.body.result.capabilities,{tools:{}});assert.equal(discover.body.result.resultType,'complete');
 assert.equal(discover.headers.get('mcp-session-id'),null);assert.equal(discover.headers.get('cache-control'),'no-store');
 const first=await post(server,rpc('tools/list')),second=await post(server,rpc('tools/list'));
 assert.deepEqual(first.body.result,second.body.result);assert.equal(first.body.result.tools.length,3);
 assert.equal(first.body.result.tools.find(x=>x.name==='synthetic_task_propose').annotations.readOnlyHint,false);
 assert.equal(first.body.result.tools.find(x=>x.name==='synthetic_task_get').annotations.readOnlyHint,true);
 assert.equal((await read(server)).body.result.structuredContent.task.version,0);
});
test('synthetic write receipt, replay and independent HTTP reads prove only local plumbing',async t=>{
 const server=await fixture(t),args=proposal();
 const write=await call(server,'synthetic_task_propose',args);assert.equal(write.body.result.isError,false);
 const receipt=write.body.result.structuredContent.receipt;assert.equal(receipt.version,1);assert.equal(receipt.status,'recorded');
 assert.deepEqual(JSON.parse(write.body.result.content[0].text),write.body.result.structuredContent);
 assert.deepEqual((await call(server,'synthetic_task_propose',args)).body.result.structuredContent.receipt,receipt);
 assert.deepEqual((await call(server,'synthetic_receipt_get',{requestId:args.requestId})).body.result.structuredContent.receipt,receipt);
 assert.equal((await read(server)).body.result.structuredContent.task.option,'park-a');
 const conflict=await call(server,'synthetic_task_propose',{...args,option:'park-b'});assert.equal(conflict.body.result.structuredContent.error,'idempotency-conflict');assert.equal(conflict.body.result.isError,true);
 const other=await startCapabilitySpike();t.after(other.close);assert.equal((await read(other)).body.result.structuredContent.task.version,0);
});
test('concurrent same-version proposals produce one mutation and preserve a recoverable receipt',async t=>{
 const server=await fixture(t);
 const writes=await Promise.all([call(server,'synthetic_task_propose',proposal('synthetic-a')),call(server,'synthetic_task_propose',proposal('synthetic-b',0,'park-b'))]);
 assert.equal(writes.filter(x=>x.body.result.isError===false).length,1);assert.equal(writes.find(x=>x.body.result.isError).body.result.structuredContent.error,'version-conflict');
 assert.equal((await read(server)).body.result.structuredContent.task.version,1);
});
test('unknown tools, malformed arguments and invented approval/identity cause no mutation',async t=>{
 const server=await fixture(t);
 assert.equal((await call(server,'send_email',{recipient:'synthetic'})).body.error.code,-32602);
 for(const args of [null,[],{...proposal(),owner:true},{...proposal(),option:'book-now'},{...proposal(),expectedVersion:'0'},{...proposal(),taskId:'other'},{...proposal(),requestId:'private-value'}]){
  const response=await call(server,'synthetic_task_propose',args);assert.ok(response.body.error||response.body.result.isError);
 }
 assert.equal((await read(server)).body.result.structuredContent.task.version,0);
 assert.equal((await call(server,'synthetic_receipt_get',{requestId:'synthetic-missing'})).body.result.structuredContent.error,'receipt-unavailable');
});
test('modern metadata, mirrored headers and protocol revision are validated per request',async t=>{
 const server=await fixture(t);
 for(const change of [message=>delete message.params._meta,message=>delete message.params._meta[prefix+'clientCapabilities'],message=>message.params._meta[prefix+'clientCapabilities']=[]]){
  const message=rpc('server/discover');change(message);const response=await post(server,message);assert.equal(response.status,400);assert.equal(response.body.error.code,-32602);
 }
 for(const headers of [{'mcp-method':'tools/call'},{'mcp-protocol-version':'wrong'}]){const response=await post(server,rpc('server/discover'),headers);assert.equal(response.body.error.code,-32020);}
 assert.equal((await call(server,'synthetic_task_propose',proposal(),{'mcp-name':'synthetic_task_get'})).body.error.code,-32020);
 const encoded='=?base64?'+Buffer.from('synthetic_task_get').toString('base64')+'?=';
 assert.equal((await call(server,'synthetic_task_get',{taskId:'synthetic-task-1'},{'mcp-name':encoded})).body.result.isError,false);
 const older=rpc('server/discover');older.params._meta[prefix+'protocolVersion']='2025-11-25';const unsupported=await post(server,older);assert.equal(unsupported.status,400);assert.equal(unsupported.body.error.code,-32022);assert.deepEqual(unsupported.body.error.data.supported,[SPIKE_PROTOCOL]);
 assert.equal((await post(server,rpc('initialize'))).status,404);
 assert.equal((await read(server)).body.result.structuredContent.task.version,0);
});
test('host/origin, content negotiation and framing fail before a synthetic write',async t=>{
 const server=await fixture(t);
 const spoofed=await new Promise((resolve,reject)=>{const req=request(server.url,{method:'POST',headers:{host:'attacker.invalid'}},response=>{response.resume();resolve(response.statusCode);});req.on('error',reject);req.end();});assert.equal(spoofed,403);
 for(const headers of [{origin:'https://attacker.invalid'},{origin:'null'}])assert.equal((await call(server,'synthetic_task_propose',proposal(),headers)).status,403);
 assert.equal((await post(server,rpc('server/discover'),{origin:new URL(server.url).origin})).status,200);
 for(const accept of ['application/json','*/*','application/json;q=0, text/event-stream'])assert.equal((await post(server,rpc('server/discover'),{accept})).status,406);
 assert.equal((await post(server,rpc('server/discover'),{'content-type':'text/plain'})).status,415);
 for(const method of ['GET','DELETE','OPTIONS']){const response=await fetch(server.url,{method});assert.equal(response.status,405);assert.equal(response.headers.get('allow'),'POST');assert.equal(response.headers.get('access-control-allow-origin'),null);}
 for(const message of [[rpc('server/discover')],{jsonrpc:'2.0',id:null,method:'tools/list',params:{_meta:metadata()}},{jsonrpc:'2.0',method:'notifications/initialized'}])assert.equal((await post(server,message)).status,400);
 assert.equal((await read(server)).body.result.structuredContent.task.version,0);
});
test('invalid UTF-8 and oversized bodies are rejected with fixed responses',async t=>{
 const server=await fixture(t);
 for(const body of [Buffer.from([0xff]),'{',' '.repeat(8193)]){
  const response=await fetch(server.url,{method:'POST',headers:{'content-type':'application/json',accept:'application/json,text/event-stream'},body});assert.equal(response.status,400);assert.equal((await response.json()).error.message,'Invalid or oversized JSON');
 }
 assert.equal((await read(server)).body.result.structuredContent.task.version,0);
});
test('bounded in-memory capacity rejects additional writes without discarding old receipts',async t=>{
 const server=await fixture(t);
 for(let i=0;i<64;i++)assert.equal((await call(server,'synthetic_task_propose',proposal(`synthetic-${i}`,i))).body.result.isError,false);
 const overflow=await call(server,'synthetic_task_propose',proposal('synthetic-overflow',64));assert.equal(overflow.body.result.structuredContent.error,'synthetic-capacity-reached');
 assert.equal((await call(server,'synthetic_receipt_get',{requestId:'synthetic-0'})).body.result.structuredContent.receipt.version,1);
 assert.equal((await read(server)).body.result.structuredContent.task.version,64);
});
