import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPair,SignJWT} from 'jose';
import {startSyntheticAuthorizedMcp} from '../scripts/ai-synthetic-authorized-mcp.mjs';
import {syntheticAudience,syntheticIssuer} from '../scripts/ai-synthetic-auth.mjs';
import {SPIKE_PROTOCOL} from '../scripts/ai-capability-spike.mjs';

test('loopback MCP enforces synthetic per-member token and room boundaries',async t=>{
 const key=await generateKeyPair('ES256');const attacker=await generateKeyPair('ES256');
 const server=await startSyntheticAuthorizedMcp({verificationKey:key.publicKey});t.after(()=>server.close());
 assert.match(server.url,/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
 const issue=async({subject='synthetic-child',scope='synthetic:read',audience=syntheticAudience,keyPair=key}={})=>new SignJWT({scope})
  .setProtectedHeader({alg:'ES256'}).setSubject(subject).setIssuer(syntheticIssuer).setAudience(audience).setIssuedAt().setExpirationTime('5m').sign(keyPair.privateKey);
 const child=await issue(),parent=await issue({subject:'synthetic-parent'}),writer=await issue({scope:'synthetic:write'});
 const meta={'io.modelcontextprotocol/protocolVersion':SPIKE_PROTOCOL,'io.modelcontextprotocol/clientCapabilities':{}};
 async function call(name,args={},token=child,overrides={}){
  const body={jsonrpc:'2.0',id:1,method:'tools/call',params:{_meta:meta,name,arguments:args}};
  return fetch(server.url,{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream',
   'mcp-protocol-version':SPIKE_PROTOCOL,'mcp-method':'tools/call','mcp-name':name,...(token?{authorization:`Bearer ${token}`}:{}) ,...overrides},body:JSON.stringify(body)});
 }
 const value=async response=>(await response.json()).result.structuredContent;
 assert.deepEqual(await value(await call('synthetic_family_read')),{ok:true,synthetic:true,version:0,option:null});
 assert.deepEqual(await value(await call('synthetic_parents_read')),{ok:false,error:'unauthorized'});
 assert.deepEqual(await value(await call('synthetic_owner_read')),{ok:false,error:'unauthorized'});
 assert.equal((await value(await call('synthetic_parents_read',{},parent))).room,'fictional-parents');
 for(const bad of [null,await issue({audience:'https://wrong.example.test/mcp'}),await issue({keyPair:attacker})]){
  assert.deepEqual(await value(await call('synthetic_family_read',{},bad)),{ok:false,error:'unauthorized'});
 }
 assert.deepEqual(await value(await call('synthetic_family_write',{choice:'park-a'},child)),{ok:false,error:'unauthorized'});
 assert.equal((await value(await call('synthetic_family_read'))).version,0);
 assert.deepEqual(await value(await call('synthetic_family_write',{choice:'park-a'},writer)),{ok:true,synthetic:true,version:1,option:'park-a',author:'synthetic-child'});
 assert.equal((await value(await call('synthetic_family_read',{},parent))).option,'park-a');
 assert.equal((await call('synthetic_family_write',{choice:'park-b',member:'synthetic-owner'},writer)).status,400);
 assert.equal((await call('synthetic_family_read',{},child,{origin:'https://attacker.example.test'})).status,403);
 assert.equal((await call('synthetic_family_read',{},child,{'mcp-name':'synthetic_owner_read'})).status,400);
 assert.equal((await value(await call('synthetic_family_read'))).version,1);
});

test('parallel local writes cannot exceed the synthetic capacity',async t=>{
 const key=await generateKeyPair('ES256');const server=await startSyntheticAuthorizedMcp({verificationKey:key.publicKey});t.after(()=>server.close());
 const token=await new SignJWT({scope:'synthetic:read synthetic:write'}).setProtectedHeader({alg:'ES256'}).setSubject('synthetic-child').setIssuer(syntheticIssuer).setAudience(syntheticAudience).setIssuedAt().setExpirationTime('5m').sign(key.privateKey);
 const meta={'io.modelcontextprotocol/protocolVersion':SPIKE_PROTOCOL,'io.modelcontextprotocol/clientCapabilities':{}};
 async function call(name,args){return fetch(server.url,{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream',authorization:`Bearer ${token}`,'mcp-protocol-version':SPIKE_PROTOCOL,'mcp-method':'tools/call','mcp-name':name},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{_meta:meta,name,arguments:args}})});}
 for(let i=0;i<63;i++)assert.equal((await call('synthetic_family_write',{choice:'park-a'})).status,200);
 const responses=await Promise.all(Array.from({length:2},()=>call('synthetic_family_write',{choice:'park-b'})));
 assert.deepEqual(responses.map(r=>r.status).sort(),[200,429]);
 assert.equal((await (await call('synthetic_family_read',{})).json()).result.structuredContent.version,64);
});
