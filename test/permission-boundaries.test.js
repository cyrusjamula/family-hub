import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';
import worker from '../src/worker.js';

const origin='https://permissions.example.test',issuer='https://permission-matrix.cloudflareaccess.com',audience='synthetic-matrix-audience';
const ids=['cyrus','anhaita','iyanah','aarish'];
const addresses=Object.fromEntries(ids.map(id=>[id,id+'.matrix@example.test']));
const aliases=JSON.stringify({...Object.fromEntries(ids.map(id=>[addresses[id],id])),'alternate.owner@example.test':'cyrus'});
function guarded(){
 const audit=[],unexpected=[];
 const DB={prepare(query){
  if(query.startsWith('INSERT INTO identity_audit'))return {bind(...args){return {async run(){audit.push(args);}};}};
  unexpected.push(query);throw Error('Protected data was accessed');
 }};
 return {audit,unexpected,env:{ACCESS_TEAM_DOMAIN:issuer,ACCESS_AUD:audience,MEMBER_ALIASES:aliases,DB,FEEDBACK_ENABLED:'true',GOOGLE_ENABLED:'true',GOOGLE_CLIENT_ID:'synthetic',GOOGLE_CLIENT_SECRET:'synthetic',GOOGLE_VAULT_KEY:btoa('s'.repeat(32)),AI_ENABLED:'true',AI:{run(){throw Error('No model request allowed');}}}};
}
function database(){
 const sql=new DatabaseSync(':memory:');
 for(const file of readdirSync(new URL('../migrations/',import.meta.url)).sort())sql.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
 for(const room of ['family','parents'])sql.prepare('INSERT INTO messages(id,room,author,content) VALUES(?,?,?,?)').run(room,room,'Synthetic member',room==='family'?'FAMILY_FIXTURE':'PARENTS_ONLY_FIXTURE');
 const prepare=query=>{const bound=(args=[])=>({query,args,first:async()=>sql.prepare(query).get(...args)??null,all:async()=>({results:sql.prepare(query).all(...args)}),run:async()=>sql.prepare(query).run(...args)});return {...bound(),bind:(...args)=>bound(args)};};
 return {sql,DB:{prepare}};
}
test('signed-request permission matrix for every family role',async t=>{
 const {privateKey,publicKey}=await generateKeyPair('RS256'),jwk=await exportJWK(publicKey);jwk.kid='matrix-fixture-key';
 const sign=(email,extra={},aud=audience,expiry='5m')=>new SignJWT({email,...extra}).setProtectedHeader({alg:'RS256',kid:jwk.kid}).setIssuer(issuer).setAudience(aud).setIssuedAt().setExpirationTime(expiry).sign(privateKey);
 const tokens=Object.fromEntries(await Promise.all(ids.map(async id=>[id,await sign(addresses[id],{role:'owner',id:'cyrus'})])));
 const original=globalThis.fetch;let providers=0;
 globalThis.fetch=async url=>{if(String(url)===issuer+'/cdn-cgi/access/certs')return Response.json({keys:[jwk]});providers++;throw Error('External providers are forbidden in permission tests');};
 const request=(path,token,body)=>new Request(origin+path,{method:body===undefined?'GET':'POST',headers:{'Cf-Access-Jwt-Assertion':token,origin,'content-type':'application/json','Cf-Access-Authenticated-User-Email':addresses.cyrus},...(body===undefined?{}:{body:JSON.stringify(body)})});
 try{
  await t.test('all four verified identities retain their server-defined roles despite forged role claims',async()=>{
   const fixture=guarded();
   for(const id of ids){const response=await worker.fetch(request('/api/me',tokens[id]),fixture.env);assert.equal(response.status,200);const me=await response.json();assert.equal(me.id,id);assert.equal(me.role,id==='cyrus'?'owner':id==='anhaita'?'parent':'child');}
   assert.deepEqual(fixture.unexpected,[]);assert.deepEqual(fixture.audit,[]);
  });
  await t.test('parent and both children cannot read any owner-only connection, record, action or diagnostics route',async()=>{
   const paths=['/api/google/status','/api/google/verify','/api/google/calendar','/api/google/records','/api/google/record?id=synthetic','/api/google/callback?code=synthetic&state=synthetic','/api/actions','/api/reminders','/api/private-ai','/api/diagnostics?id=00000000-0000-4000-8000-000000000000'];
   for(const id of ids.slice(1))for(const path of paths){const f=guarded();assert.equal((await worker.fetch(request(path,tokens[id]),f.env)).status,403,id+': '+path);assert.deepEqual(f.unexpected,[]);assert.equal(f.audit.length,path.startsWith('/api/google/callback')?1:0);}
  });
  await t.test('non-owner mutations deny before protected data or providers while recording only attempt provenance',async()=>{
   const paths=['/api/google/connect','/api/google/disconnect','/api/google/import','/api/actions/propose','/api/actions/execute','/api/reminders','/api/reminders/cancel','/api/private-ai','/api/approve','/api/feedback/preview','/api/feedback/publish','/api/feedback/reject'];
   const body={id:crypto.randomUUID(),state:'approved',content:'PRIVATE_FIXTURE_DO_NOT_AUDIT',recordId:'synthetic',question:'PRIVATE_FIXTURE_DO_NOT_AUDIT',confirmPrivateAI:true,confirmExactAction:true,confirmPublicIssue:true};
   for(const id of ids.slice(1))for(const path of paths){const f=guarded();assert.equal((await worker.fetch(request(path,tokens[id],body),f.env)).status,403,id+': '+path);assert.deepEqual(f.unexpected,[]);assert.equal(f.audit.length,1);assert.equal(f.audit[0][1],id);assert.equal(f.audit[0][2],addresses[id]);assert.equal(f.audit[0][3],path);assert.ok(!JSON.stringify(f.audit).includes('PRIVATE_FIXTURE_DO_NOT_AUDIT'));}
  });
  await t.test('both children are denied every Parents-room read and write before data/model access',async()=>{
   for(const id of ['iyanah','aarish']){
    for(const route of ['messages','briefs','approvals','notifications']){const f=guarded();assert.equal((await worker.fetch(request('/api/'+route+'?room=parents',tokens[id]),f.env)).status,403);assert.deepEqual(f.unexpected,[]);}
    for(const route of ['chat','propose','approve']){const f=guarded();assert.equal((await worker.fetch(request('/api/'+route+'?room=parents',tokens[id],{content:'Synthetic',state:'approved'}),f.env)).status,403);assert.deepEqual(f.unexpected,[]);}
   }
  });
  await t.test('positive room reads prove Family and Parents fixtures stay separated',async()=>{
   const {sql,DB}=database();
   try{for(const id of ids){const env={...guarded().env,DB};const family=await worker.fetch(request('/api/messages?room=family',tokens[id]),env);assert.equal(family.status,200);assert.deepEqual((await family.json()).map(m=>m.content),['FAMILY_FIXTURE']);const privateRoom=await worker.fetch(request('/api/messages?room=parents',tokens[id]),env);assert.equal(privateRoom.status,['cyrus','anhaita'].includes(id)?200:403);if(privateRoom.ok)assert.deepEqual((await privateRoom.json()).map(m=>m.content),['PARENTS_ONLY_FIXTURE']);}}
   finally{sql.close();}
  });
  await t.test('removed aliases, unknown users, expired/wrong-audience/tampered tokens and forged headers fail before data access',async()=>{
   const f=guarded(),alternate=await sign('alternate.owner@example.test');
   assert.equal((await worker.fetch(request('/api/me',alternate),f.env)).status,200);
   const revoked={...f.env,MEMBER_ALIASES:JSON.stringify(Object.fromEntries(ids.map(id=>[addresses[id],id])))};
   for(const [token,env] of [[alternate,revoked],[await sign('unknown@example.test'),f.env],[await sign(addresses.cyrus,{},'wrong-audience'),f.env],[await sign(addresses.cyrus,{},audience,1),f.env],[tokens.cyrus.slice(0,-8)+'tampered',f.env]])assert.equal((await worker.fetch(request('/api/google/records',token),env)).status,401);
   const forged=new Request(origin+'/api/google/records',{headers:{'Cf-Access-Authenticated-User-Email':addresses.cyrus}});assert.equal((await worker.fetch(forged,f.env)).status,401);assert.deepEqual(f.unexpected,[]);assert.deepEqual(f.audit,[]);
  });
  assert.equal(providers,0);
 }finally{globalThis.fetch=original;}
});
