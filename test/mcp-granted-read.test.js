import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {generateKeyPair,SignJWT} from 'jose';
import {createMcpTaskGrants} from '../src/integrations/mcp-task-grants.js';
import {createGrantedMcpReadGateway} from '../src/integrations/mcp-granted-read.js';
const resource='https://fixture.example/mcp',issuer='https://issuer.example/';
const task='12345678-1234-4123-8123-123456789abc';
const meta={'io.modelcontextprotocol/protocolVersion':'2026-07-28','io.modelcontextprotocol/clientCapabilities':{}};
function request(token,method='tools/call',name='task_read',args={taskId:task}){
 return new Request(resource,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json',
  'mcp-protocol-version':'2026-07-28','mcp-method':method,...(method==='tools/call'?{'mcp-name':name}:{})},
  body:JSON.stringify({jsonrpc:'2.0',id:1,method,params:method==='tools/call'?{_meta:meta,name,arguments:args}:{_meta:meta}})});
}
async function fixture(t){
 const sql=new DatabaseSync(':memory:');t.after(()=>sql.close());
 sql.exec(readFileSync(new URL('../migrations/0009_tasks.sql',import.meta.url),'utf8'));
 sql.exec(readFileSync(new URL('../scripts/mcp-task-grant-schema.sql',import.meta.url),'utf8'));
 sql.prepare('INSERT INTO tasks(id,room,creator_id,assignee_id,assistant,title,details,provenance,approval_required) VALUES(?,?,?,?,?,?,?,?,?)')
  .run(task,'family','owner','child','synthetic','Synthetic task','Synthetic detail','Synthetic source',0);
 const db={async batch(statements){sql.exec('BEGIN');try{const result=[];for(const s of statements)result.push(await s.run());sql.exec('COMMIT');return result;}catch(e){sql.exec('ROLLBACK');throw e;}},
  prepare(q){return {bind(...args){return {async run(){const r=sql.prepare(q).run(...args);return {success:true,meta:{changes:Number(r.changes)}};},async first(){return sql.prepare(q).get(...args)||null;}};}};}};
 let memberActive=true,connected=true,clock=1000,disconnectAtRead=false,clientCalls=0,reads=0;
 const resolveMember=async sub=>sub==='owner'?{id:'owner',role:'owner'}:memberActive&&sub==='child'?{id:'child',role:'child'}:null;
 const resolveClient=async (member,client)=>{
  clientCalls++;if(disconnectAtRead&&clientCalls>1)return false;
  return connected&&member==='child'&&['client-a','client-b'].includes(client);
 };
 const grants=createMcpTaskGrants({db,resolveOwner:async s=>s==='verified-owner'?{id:'owner',role:'owner'}:null,resolveMember,resolveClient,now:()=>clock,
  verifyApproval:async (_s,_a,details,evidence)=>evidence===JSON.stringify(details)});
 const details={grantId:'grant-1',task,version:1,memberId:'child',clientId:'client-a',expiresAt:1100};
 assert.equal(await grants.approve('verified-owner',{...details,confirmation:JSON.stringify(details)}),true);clientCalls=0;
 const keys=await generateKeyPair('ES256');
 const gateway=createGrantedMcpReadGateway({enabled:true,resource,issuer,verificationKey:keys.publicKey,resolveMember,resolveClient,
  grants:{async read(...args){reads++;return grants.read(...args);}}});
 const sign=(claims={},key=keys.privateKey)=>new SignJWT({scope:'tasks:read',client_id:'client-a',...claims})
  .setProtectedHeader({alg:'ES256',typ:'at+jwt'}).setIssuer(issuer).setAudience(resource).setSubject('child').setIssuedAt().setExpirationTime('5m').sign(key);
 return {sql,gateway,sign,grants,reads:()=>reads,revokeMember:()=>{memberActive=false;},disconnect:()=>{connected=false;},expire:()=>{clock=1100;},raceDisconnect:()=>{disconnectAtRead=true;clientCalls=0;}};
}
async function call(f,token){return (await (await f.gateway.handle(request(token))).json()).result.structuredContent;}
test('default-disabled composition makes no resolver or storage call',async()=>{
 const gateway=createGrantedMcpReadGateway({resolveClient(){throw Error('must not run');},grants:{read(){throw Error('must not run');}}});
 assert.equal((await gateway.handle(new Request(resource))).status,503);
 assert.throws(()=>createGrantedMcpReadGateway({enabled:'true'}),/Invalid/);
});
test('signed client plus exact owner grant reads real task schema through MCP transport',async t=>{
 const f=await fixture(t),token=await f.sign();
 const metadata=await f.gateway.handle(new Request('https://fixture.example/.well-known/oauth-protected-resource/mcp'));
 assert.deepEqual((await metadata.json()).scopes_supported,['tasks:read']);
 const list=await f.gateway.handle(request(token,'tools/list'));
 assert.deepEqual((await list.json()).result.tools.map(x=>x.name),['task_read']);
 const values=await Promise.all(Array.from({length:4},()=>call(f,token)));
 for(const v of values){assert.equal(v.ok,true);assert.deepEqual(Object.keys(v.task).sort(),['approval','details','id','provenance','status','title','version']);}
 assert.equal((await call(f,await f.sign({client_id:'client-b'}))).ok,false);
 assert.equal((await f.gateway.handle(request(token,'tools/call','task_read',{taskId:task,clientId:'client-b'}))).status,400);
 assert.equal((await f.gateway.handle(request(token,'tools/call','task_propose',{taskId:task,requestId:'x',expectedVersion:1,option:'park-a'}))).status,400);
});
test('unattested client identity, forged token and invalid scope never reach task storage',async t=>{
 const f=await fixture(t),other=await generateKeyPair('ES256');
 for(const token of [await f.sign({client_id:undefined}),await f.sign({client_id:'bad space'}),await f.sign({client_id:'unknown'}),await f.sign({},other.privateKey)]){
  assert.equal((await f.gateway.handle(request(token))).status,401);
 }
 assert.equal((await f.gateway.handle(request(await f.sign({scope:'tasks:write'})))).status,403);
 assert.equal(f.reads(),0);
 f.revokeMember();assert.equal((await f.gateway.handle(request(await f.sign()))).status,401);assert.equal(f.reads(),0);
});
test('changed audience, task version, expiration and owner revocation deny existing tokens',async t=>{
 const f=await fixture(t),token=await f.sign();
 f.sql.exec("UPDATE tasks SET room='parents'");assert.equal((await call(f,token)).ok,false);
 f.sql.exec("UPDATE tasks SET room='family',version=2");assert.equal((await call(f,token)).ok,false);
 f.sql.exec('UPDATE tasks SET version=1');assert.equal((await call(f,token)).ok,true);
 f.expire();assert.equal((await call(f,token)).ok,false);
 await f.grants.revoke('verified-owner','grant-1');assert.equal((await call(f,token)).ok,false);
});
test('client disconnected between token verification and storage read is denied',async t=>{
 const f=await fixture(t),token=await f.sign();f.raceDisconnect();
 assert.equal((await call(f,token)).ok,false);
 f.disconnect();assert.equal((await f.gateway.handle(request(token))).status,401);
});
