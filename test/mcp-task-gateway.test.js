import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPair,SignJWT} from 'jose';
import {createMcpResourceBoundary} from '../src/integrations/mcp-resource.js';
import {createMcpTaskGateway} from '../src/integrations/mcp-task-gateway.js';
const resource='https://fixture.example/mcp',issuer='https://issuer.example/';
const meta={'io.modelcontextprotocol/protocolVersion':'2026-07-28','io.modelcontextprotocol/clientCapabilities':{}};
const jwt=(key,sub,scope='tasks:read tasks:write')=>new SignJWT({scope}).setProtectedHeader({alg:'ES256',typ:'at+jwt'}).setIssuer(issuer).setAudience(resource).setSubject(sub).setIssuedAt().setExpirationTime('5m').sign(key);
const makeRequest=(bearer,method,name,args)=>new Request(resource,{method:'POST',headers:{authorization:bearer?'Bearer '+bearer:'',
 'content-type':'application/json','mcp-protocol-version':'2026-07-28','mcp-method':method,...(name?{'mcp-name':name}:{})},
 body:JSON.stringify({jsonrpc:'2.0',id:1,method,params:name?{_meta:meta,name,arguments:args}:{_meta:meta}})});
async function fixture(){
 const {publicKey,privateKey}=await generateKeyPair('ES256');let current=true,calls=[];
 const boundary=createMcpResourceBoundary({resource,issuer,verificationKey:publicKey,resolveMember:async sub=>current&&sub==='fictional-child'?{id:sub,role:'child'}:null});
 const backend={read:async(member,args)=>{calls.push({member,args});return {ok:true,taskId:args.taskId,version:1};},
  propose:async(member,args)=>{calls.push({member,args});return {ok:true,receipt:'fictional'};}};
 const gateway=createMcpTaskGateway({resource,boundary,backend});return {gateway,privateKey,calls,revoke:()=>{current=false;}};
}
test('metadata is public; discovery and task reads require a verified current member',async()=>{
 const f=await fixture();const m=await f.gateway.handle(new Request('https://fixture.example/.well-known/oauth-protected-resource/mcp'));
 assert.equal((await m.json()).resource,resource);
 assert.equal((await f.gateway.handle(makeRequest(null,'tools/list'))).status,401);
 const signed=await jwt(f.privateKey,'fictional-child');const list=await f.gateway.handle(makeRequest(signed,'tools/list'));
 assert.deepEqual((await list.json()).result.tools.map(x=>x.name),['task_read','task_propose']);
 const result=await f.gateway.handle(makeRequest(signed,'tools/call','task_read',{taskId:'fictional-task'}));
 assert.equal((await result.json()).result.structuredContent.taskId,'fictional-task');
 assert.deepEqual(f.calls[0].member,{id:'fictional-child',role:'child'});
 f.revoke();assert.equal((await f.gateway.handle(makeRequest(signed,'tools/call','task_read',{taskId:'fictional-task'}))).status,401);assert.equal(f.calls.length,1);
});
test('writes require write scope and pass only verified identity and exact args to backend',async()=>{
 const f=await fixture(),args={taskId:'fictional-task',requestId:'request-1',expectedVersion:1,option:'park-a'};
 assert.equal((await f.gateway.handle(makeRequest(await jwt(f.privateKey,'fictional-child','tasks:read'),'tools/call','task_propose',args))).status,403);
 assert.equal(f.calls.length,0);
 const signed=await jwt(f.privateKey,'fictional-child');
 assert.equal((await f.gateway.handle(makeRequest(signed,'tools/call','task_propose',{...args,role:'owner'}))).status,400);
 assert.equal(f.calls.length,0);
 const value=await f.gateway.handle(makeRequest(signed,'tools/call','task_propose',args));assert.equal((await value.json()).result.structuredContent.receipt,'fictional');
 assert.deepEqual(f.calls[0],{member:{id:'fictional-child',role:'child'},args});
});
test('wrong resource, malformed JSON, oversized body and forged token fail before backend',async()=>{
 const f=await fixture(),other=await generateKeyPair('ES256');
 assert.equal((await f.gateway.handle(new Request('https://elsewhere.example/mcp',{method:'POST'}))).status,404);
 assert.equal((await f.gateway.handle(new Request(resource,{method:'POST',headers:{'content-type':'application/json'},body:'x'.repeat(8193)}))).status,400);
 assert.equal((await f.gateway.handle(makeRequest(await jwt(other.privateKey,'fictional-child'),'tools/call','task_read',{taskId:'x'}))).status,401);
 assert.equal(f.calls.length,0);
});
test('backend failures produce sanitized errors without exposing internal details',async()=>{
 const f=await fixture();const boundary={metadata:()=>new Response(),authorize:async()=>({member:{id:'fictional',role:'parent'},scope:'tasks:read'})};
 const gateway=createMcpTaskGateway({resource,boundary,backend:{read:async()=>{throw Error('private synthetic diagnostics');},propose:async()=>({ok:true})}});
 const r=await gateway.handle(makeRequest('synthetic','tools/call','task_read',{taskId:'t'}));assert.equal(r.status,503);assert.ok(!(await r.text()).includes('private synthetic'));
});
test('oversized unfinished stream returns promptly and cancels without backend access',async()=>{
 const f=await fixture();let cancelled=false;
 const stream=new ReadableStream({start(c){c.enqueue(new Uint8Array(8193));},cancel(){cancelled=true;}});
 const req=new Request(resource,{method:'POST',headers:{'content-type':'application/json'},body:stream,duplex:'half'});
 const response=await f.gateway.handle(req);assert.equal(response.status,400);assert.equal(cancelled,true);assert.equal(f.calls.length,0);
});
test('encoded MCP names work and invalid names are rejected before storage',async()=>{
 const f=await fixture(),signed=await jwt(f.privateKey,'fictional-child');
 const req=makeRequest(signed,'tools/call','task_read',{taskId:'t'});req.headers.set('mcp-name','=?base64?dGFza19yZWFk?=');
 assert.equal((await f.gateway.handle(req)).status,200);assert.equal(f.calls.length,1);
 const wrong=makeRequest(signed,'tools/call','task_read',{taskId:'t'});wrong.headers.set('mcp-name','task_propose');
 assert.equal((await f.gateway.handle(wrong)).status,400);assert.equal(f.calls.length,1);
});

test('read-only backend advertises no writes and rejects direct writes before dispatch',async()=>{
 const calls=[];const boundary={metadata:()=>new Response(),authorize:async(_request,scope)=>({member:{id:'fictional',role:'child'},scope})};
 const gateway=createMcpTaskGateway({resource,boundary,backend:{read:async(m,a)=>{calls.push([m,a]);return {ok:true};}}});
 const list=await gateway.handle(makeRequest('synthetic','tools/list'));
 assert.deepEqual((await list.json()).result.tools.map(t=>t.name),['task_read']);
 const attempt=await gateway.handle(makeRequest('synthetic','tools/call','task_propose',{taskId:'a',requestId:'r',expectedVersion:1,option:'park-a'}));
 assert.equal(attempt.status,400);assert.equal(calls.length,0);
 const read=await gateway.handle(makeRequest('synthetic','tools/call','task_read',{taskId:'a'}));
 assert.equal((await read.json()).result.structuredContent.ok,true);assert.equal(calls.length,1);
 assert.throws(()=>createMcpTaskGateway({resource,boundary,backend:{read:async()=>({ok:true}),propose:null}}));
});
