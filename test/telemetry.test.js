import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {diagnosticMetadata,storeDiagnostic,instrumentRequest,instrumentScheduled,diagnosticsAPI} from '../src/telemetry.js';
import {member,people} from '../src/policy.js';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';
import worker from '../src/worker.js';
const owner=member(people.cyrus.email),child=member(people.iyanah.email);
function fixture(){
 const sql=new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('../migrations/0008_diagnostics.sql',import.meta.url),'utf8'));
 const DB={prepare(query){const bound=(args=[])=>({query,args,first:async()=>sql.prepare(query).get(...args)??null,run:async()=>sql.prepare(query).run(...args)});return {...bound(),bind:(...args)=>bound(args)};},async batch(rows){sql.exec('BEGIN');try{for(const row of rows)sql.prepare(row.query).run(...row.args);sql.exec('COMMIT');}catch(error){sql.exec('ROLLBACK');throw error;}}};
 const tasks=[],ctx={waitUntil:task=>tasks.push(task)},env={DB,TELEMETRY_ENABLED:'true',TELEMETRY_RELEASE:'abcdef0123456789'};
 return {sql,env,ctx,drain:()=>Promise.all(tasks)};
}
const request=()=>new Request('https://hub.test/api/google/callback?code=SYNTHETIC_SECRET&state=PRIVATE_STATE',{headers:{authorization:'Bearer SYNTHETIC_TOKEN','x-request-id':'client-controlled','cf-connecting-ip':'127.0.0.1'}});
test('server references ignore client headers and sanitized error records omit query, headers, identity and content',async()=>{
 const {sql,env,ctx,drain}=fixture();const response=await instrumentRequest(request(),env,ctx,async()=>Response.json({error:'Safe failure'},{status:502}));await drain();
 const body=await response.json(),id=response.headers.get('x-request-id');assert.match(id,/^[a-f0-9-]{36}$/);assert.notEqual(id,'client-controlled');assert.equal(body.requestId,id);assert.match(body.error,new RegExp(id));
 const row=sql.prepare('SELECT * FROM diagnostics').get();assert.equal(row.id,id);assert.equal(row.route,'/api/google/callback');assert.equal(row.status,502);assert.equal(row.release,env.TELEMETRY_RELEASE);
 for(const value of ['SYNTHETIC_SECRET','PRIVATE_STATE','SYNTHETIC_TOKEN','127.0.0.1','client-controlled',owner.email])assert.equal(JSON.stringify(row).includes(value),false);sql.close();
});
test('unknown paths, methods and malformed release values never become raw telemetry',()=>{
 const event=diagnosticMetadata(new Request('https://hub.test/private/SYNTHETIC_RECORD_ID?email=PRIVATE_EMAIL',{method:'PATCH'}),{TELEMETRY_RELEASE:'SYNTHETIC_SECRET'},{id:crypto.randomUUID(),status:400,duration:-4});
 assert.equal(event.route,'/other');assert.equal(event.method,'OTHER');assert.equal(event.release,'unknown');assert.equal(event.duration_ms,0);assert.equal(JSON.stringify(event).includes('SYNTHETIC_RECORD_ID'),false);
});
test('telemetry failures never change successful or uncertain operation outcomes or retry providers',async()=>{
 let calls=0;const tasks=[];const ctx={waitUntil:p=>tasks.push(p)},env={TELEMETRY_ENABLED:'true',DB:{batch(){throw Error('private database details');}}};
 for(const status of [200,502]){const response=await instrumentRequest(new Request('https://hub.test/api/actions/execute'),env,ctx,async()=>{calls++;return Response.json({state:status===200?'executed':'uncertain',...(status===502?{error:'Check provider before retrying'}:{})},{status});});assert.equal(response.status,status);assert.equal((await response.json()).state,status===200?'executed':'uncertain');}
 await Promise.all(tasks);assert.equal(calls,2);
 const withoutContext=await instrumentRequest(new Request('https://hub.test/api/chat'),env,undefined,async()=>Response.json({error:'Safe'},{status:503}));assert.equal(withoutContext.status,503);
});
test('kill switch, successful requests, unauthenticated traffic and diagnostic lookups do not persist records',async()=>{
 const {sql,env,ctx,drain}=fixture();
 for(const [status,path,enabled] of [[200,'/api/me','true'],[401,'/api/me','true'],[403,'/api/diagnostics','true'],[503,'/api/chat','false']]){
  const response=await instrumentRequest(new Request('https://hub.test'+path),{...env,TELEMETRY_ENABLED:enabled},ctx,async()=>Response.json({error:'Safe'},{status}));assert.ok(response.headers.get('x-request-id'));
 }
 await drain();assert.equal(sql.prepare('SELECT count(*) AS n FROM diagnostics').get().n,0);sql.close();
});
test('unexpected exceptions expose only a safe reference and allowlisted category',async()=>{
 const {sql,env,ctx,drain}=fixture();const response=await instrumentRequest(new Request('https://hub.test/api/chat'),env,ctx,async()=>{throw Error('SYNTHETIC_PRIVATE_DOCUMENT');});await drain();
 assert.equal(response.status,503);assert.equal((await response.text()).includes('SYNTHETIC_PRIVATE_DOCUMENT'),false);const row=sql.prepare('SELECT * FROM diagnostics').get();assert.equal(row.category,'unhandled');assert.equal(JSON.stringify(row).includes('SYNTHETIC_PRIVATE_DOCUMENT'),false);sql.close();
});
test('owner-only exact-reference lookup denies other roles before database access and expires old rows',async()=>{
 const {sql,env}=fixture(),id=crypto.randomUUID(),base={id,created:Date.now(),route:'/api/chat',method:'POST',status:503,duration_ms:1,category:'service_error',release:'unknown'};await storeDiagnostic(env,base);
 const req=new Request('https://hub.test/api/diagnostics?id='+id);
 assert.equal((await diagnosticsAPI(req,env,owner)).status,200);
 const badDB={prepare(){throw Error('must not query');}};
 for(const user of [child,member(people.anhaita.email),{...child,role:'owner'},null])assert.equal((await diagnosticsAPI(req,{...env,DB:badDB},user)).status,403);
 assert.equal((await diagnosticsAPI(new Request('https://hub.test/api/diagnostics?id=invalid'),env,owner)).status,400);
 sql.prepare('UPDATE diagnostics SET created=? WHERE id=?').run(Date.now()-8*86400000,id);assert.equal((await diagnosticsAPI(req,env,owner)).status,404);sql.close();
});
test('retention, atomic daily caps, deduplication and total row caps bound storage',async()=>{
 const {sql,env}=fixture(),now=Date.now();const event=()=>({id:crypto.randomUUID(),created:now,route:'/api/chat',method:'POST',status:503,duration_ms:1,category:'service_error',release:'unknown'});
 const old=event();sql.prepare('INSERT INTO diagnostics VALUES(?,?,?,?,?,?,?,?)').run(old.id,now-8*86400000,old.route,old.method,old.status,1,old.category,old.release);
 const same=event();await Promise.all([storeDiagnostic(env,same),storeDiagnostic(env,same)]);assert.equal(sql.prepare('SELECT count(*) AS n FROM diagnostics').get().n,1);
 await Promise.all(Array.from({length:210},()=>storeDiagnostic(env,event())));assert.equal(sql.prepare('SELECT count(*) AS n FROM diagnostics').get().n,200);
 sql.prepare('UPDATE diagnostics SET created=?').run(now-86400000);
 const insert=sql.prepare('INSERT INTO diagnostics VALUES(?,?,?,?,?,?,?,?)');for(let i=0;i<800;i++){const e=event();insert.run(e.id,now-2*86400000,e.route,e.method,e.status,1,e.category,e.release);}
 await storeDiagnostic(env,event());assert.equal(sql.prepare('SELECT count(*) AS n FROM diagnostics').get().n,1000);sql.close();
});
test('scheduled failures are recorded without raw exception details and preserve job failure',async()=>{
 const {sql,env}=fixture();let runs=0;
 await assert.rejects(instrumentScheduled(env,async()=>{runs++;throw Error('SYNTHETIC_PRIVATE_PUSH_ENDPOINT');}),error=>error.message.startsWith('Scheduled Hub job failed. Reference: ')&&!error.message.includes('SYNTHETIC_PRIVATE_PUSH_ENDPOINT'));
 assert.equal(runs,1);const row=sql.prepare('SELECT * FROM diagnostics').get();assert.equal(row.method,'SCHEDULED');assert.equal(row.category,'scheduled_error');assert.equal(JSON.stringify(row).includes('SYNTHETIC_PRIVATE_PUSH_ENDPOINT'),false);sql.close();
});
test('diagnostic lookup enforces real Access JWT verification and role boundaries through the Worker',async()=>{
 const {sql,env,ctx,drain}=fixture(),id=crypto.randomUUID();await storeDiagnostic(env,{id,created:Date.now(),route:'/api/chat',method:'POST',status:503,duration_ms:1,category:'service_error',release:'unknown'});
 const {privateKey,publicKey}=await generateKeyPair('RS256'),jwk=await exportJWK(publicKey);jwk.kid='synthetic-diagnostic-key';
 const issuer='https://telemetry-tests.cloudflareaccess.com';Object.assign(env,{ACCESS_TEAM_DOMAIN:issuer,ACCESS_AUD:'synthetic-audience'});
 const original=globalThis.fetch;
 try{
  globalThis.fetch=async url=>{assert.equal(String(url),issuer+'/cdn-cgi/access/certs');return Response.json({keys:[jwk]});};
  for(const user of [owner,child]){
   const token=await new SignJWT({email:user.email}).setProtectedHeader({alg:'RS256',kid:jwk.kid}).setIssuer(issuer).setAudience(env.ACCESS_AUD).setExpirationTime('5m').sign(privateKey);
   const response=await worker.fetch(new Request('https://hub.test/api/diagnostics?id='+id,{headers:{'Cf-Access-Jwt-Assertion':token}}),env,ctx);
   assert.equal(response.status,user.role==='owner'?200:403);assert.ok(response.headers.get('x-request-id'));
  }
  assert.equal((await worker.fetch(new Request('https://hub.test/api/diagnostics?id='+id,{headers:{'Cf-Access-Authenticated-User-Email':owner.email}}),env,ctx)).status,401);
  await drain();assert.equal(sql.prepare('SELECT count(*) AS n FROM diagnostics').get().n,1);
 }finally{globalThis.fetch=original;sql.close();}
});
