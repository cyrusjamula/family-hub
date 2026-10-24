import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';
import {directory,member,people,allowRoom} from '../src/policy.js';
import worker,{authenticate,api,auditIdentity} from '../src/worker.js';
import {seal,open,accessToken,googleRoleAllowed,readPrivateRecord} from '../src/google.js';
import {actionAPI,digest,validateAction} from '../src/actions.js';
import {pushAPI} from '../src/push.js';
import {reminderAPI} from '../src/reminders.js';

const aliases=JSON.stringify({'owner.alias@example.test':'cyrus','adult.alias@example.test':'anhaita','child.alias@example.test':'iyanah'});
const resolve=email=>directory(aliases).resolve(email);
const owner=resolve('owner.alias@example.test');
const req=(path,body)=>new Request('https://hub.test/api/'+path,body===undefined?{}:{method:'POST',headers:{origin:'https://hub.test','content-type':'application/json'},body:JSON.stringify(body)});
function fixture(){
 const sql=new DatabaseSync(':memory:');
 for(const name of readdirSync(new URL('../migrations/',import.meta.url)).sort())sql.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
 const DB={prepare(query){
  function bound(args=[]){return {query,args,first:async()=>sql.prepare(query).get(...args)??null,all:async()=>({results:sql.prepare(query).all(...args)}),run:async()=>sql.prepare(query).run(...args)};}
  return {...bound(),bind:(...args)=>bound(args)};
 },async batch(statements){
  sql.exec('BEGIN');try{const results=statements.map(s=>sql.prepare(s.query).run(...s.args));sql.exec('COMMIT');return results;}catch(e){sql.exec('ROLLBACK');throw e;}
 }};
 return {sql,env:{DB,GOOGLE_ENABLED:'true',GOOGLE_CLIENT_ID:'synthetic',GOOGLE_CLIENT_SECRET:'synthetic',GOOGLE_VAULT_KEY:btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))),PUSH_VAPID_JWK:'configured'}};
}

test('approved aliases share stable identity/storage key while retaining actual sign-in provenance',()=>{
 const canonical=member(people.cyrus.email);
 assert.equal(owner.id,canonical.id);assert.equal(owner.email,canonical.email);assert.equal(owner.role,'owner');
 assert.equal(owner.signInEmail,'owner.alias@example.test');
 assert.deepEqual(resolve('OWNER.ALIAS@EXAMPLE.TEST'),owner);
 assert.equal(resolve('cyrus+unknown@example.test'),undefined);
 assert.equal(resolve('owner.alias@example.test '),undefined);
 assert.equal(resolve('__proto__'),undefined);
 assert.equal(directory().resolve('owner.alias@example.test'),undefined);
 assert.equal(Object.isFrozen(owner),true);
});
test('invalid, ambiguous, conflicting and unknown alias configurations fail closed',()=>{
 for(const raw of ['','null','[]','true','{bad',JSON.stringify({'bad address':'cyrus'}),JSON.stringify({'x@example.test':'owner'}),JSON.stringify({'x@example.test':{role:'owner'}}),JSON.stringify({[people.iyanah.email]:'cyrus'}),JSON.stringify({'X@example.test':'cyrus','x@example.test':'iyanah'}),JSON.stringify(Object.fromEntries(Array.from({length:33},(_,i)=>['alias'+i+'@example.test','cyrus'])))])assert.throws(()=>directory(raw));
 assert.equal(member('naannaa.bear@gmail.com'),undefined);
 const removed=directory(JSON.stringify({'adult.alias@example.test':'anhaita'}));
 assert.equal(removed.resolve(owner.signInEmail),undefined);
 assert.equal(removed.resolve(people.cyrus.email).id,'cyrus');
});
test('raw duplicate JSON aliases cannot silently change identity, including escaped spellings',()=>{
 for(const raw of [
  '{"child.alias@example.test":"iyanah","child.alias@example.test":"cyrus"}',
  '{"child.alias@example.test":"iyanah","child.alias@example.test":"iyanah"}',
  String.raw`{"child.alias@example.test":"iyanah","child.alias@\u0065xample.test":"cyrus"}`,
  '{"CHILD.alias@example.test":"iyanah","child.alias@example.test":"cyrus"}',
  '{"child.alias@example.test":{},"child.alias@example.test":"cyrus"}',
  '{"child.alias@example.test":"cyrus",}',
  '{"child.alias@example.test":"cyrus"} null'
 ])assert.throws(()=>directory(raw));
 assert.equal(directory(' { "owner.alias@example.test" : "cyrus" } \n').resolve('owner.alias@example.test').id,'cyrus');
});
test('aliases preserve each person\'s role and cannot claim another person\'s privileges',async()=>{
 const child=resolve('child.alias@example.test'),adult=resolve('adult.alias@example.test');
 for(const user of [child,adult]){
  assert.equal(googleRoleAllowed(user),false);
  for(const path of ['google/status','google/records','actions','reminders','private-ai'])assert.equal((await api(req(path),{},user)).status,403);
 }
 assert.equal(allowRoom(child,'parents'),false);assert.equal(allowRoom(adult,'parents'),true);
 assert.equal(allowRoom({role:'unexpected'},'parents'),false);
 assert.equal(allowRoom(owner,'unknown'),false);
 assert.equal(googleRoleAllowed(owner),true);
});
test('existing encrypted credentials and private records work through an alias without rewriting storage',async()=>{
 const {sql,env}=fixture();const key=people.cyrus.email;
 const credentials=await seal(env,{access_token:'synthetic-token',expires:Date.now()+3600000},'google:'+key);
 const record=await seal(env,{content:'Synthetic harmless record'},'record:'+key+':source-test');
 sql.prepare('INSERT INTO google_connections(owner,credentials,scopes) VALUES(?,?,?)').run(key,credentials,'synthetic');
 sql.prepare('INSERT INTO private_records(id,owner,source_id,title,encrypted_content,source_modified) VALUES(?,?,?,?,?,?)').run('record-test',key,'source-test','Synthetic',record,'version-1');
 assert.equal(await accessToken(env,owner),'synthetic-token');
 const original=globalThis.fetch;
 try{
  globalThis.fetch=async url=>{assert.match(url,/\/drive\/v3\/files\/source-test\?/);return Response.json({parents:['1uRQtQdhwHUIdCZVneu1mlPIn0zb8KHIw'],modifiedTime:'version-1'});};
  assert.equal((await readPrivateRecord(env,owner,'record-test')).content,'Synthetic harmless record');
  await assert.rejects(readPrivateRecord(env,resolve('child.alias@example.test'),'record-test'),/Owner required/);
 }finally{globalThis.fetch=original;}
 // Additive migration is repeatable and never rewrites existing ciphertext or owners.
 const migration=readFileSync(new URL('../migrations/0006_identity_audit.sql',import.meta.url),'utf8');sql.exec(migration);sql.exec(migration);
 assert.equal(sql.prepare('SELECT credentials FROM google_connections WHERE owner=?').get(key).credentials,credentials);
 assert.equal(sql.prepare('SELECT encrypted_content FROM private_records').get().encrypted_content,record);
 await assert.rejects(open(env,credentials,'google:'+owner.signInEmail));sql.close();
});
test('approvals, reminders, and devices remain owned by the same person across aliases',async()=>{
 const {sql,env}=fixture(),canonical=member(people.cyrus.email);
 const payload=validateAction('email',{to:[people.cyrus.email],subject:'Synthetic','body':'No real email'}),hash=await digest(payload);
 sql.prepare('INSERT INTO google_connections(owner,credentials,scopes) VALUES(?,?,?)').run(canonical.email,'unused','https://www.googleapis.com/auth/gmail.send');
 sql.prepare('INSERT INTO actions(id,owner,kind,room,payload,digest,expires) VALUES(?,?,?,?,?,?,?)').run('action-test',canonical.email,'email','parents',JSON.stringify(payload),hash,Date.now()+60000);
 let calls=0;const execute=async(_env,user)=>{assert.equal(user.id,'cyrus');calls++;return 'mock-id';};
 const body={id:'action-test',digest:hash,confirmExactAction:true};
 assert.equal((await actionAPI(req('actions/execute',body),env,owner,execute)).status,200);
 assert.equal((await actionAPI(req('actions/execute',body),env,canonical,execute)).status,409);assert.equal(calls,1);
 await reminderAPI(req('reminders',{room:'parents',content:'Synthetic',due:new Date(Date.now()+60000).toISOString(),confirmRoomVisibility:true}),env,owner);
 assert.equal((await (await reminderAPI(req('reminders'),env,canonical)).json()).length,1);
 const endpoint='https://fcm.googleapis.com/fcm/send/synthetic';
 assert.equal((await pushAPI(req('push/subscribe',{endpoint,confirmNotifications:true}),env,canonical)).status,200);
 assert.equal((await pushAPI(req('push/subscribe',{endpoint,confirmNotifications:true}),env,owner)).status,200);
 assert.equal(sql.prepare('SELECT count(*) AS n FROM push_devices').get().n,1);
 assert.equal((await pushAPI(req('push/subscribe',{endpoint,confirmNotifications:true}),env,resolve('child.alias@example.test'))).status,409);
 await pushAPI(req('push/disable',{endpoint}),env,owner);assert.equal(sql.prepare('SELECT count(*) AS n FROM push_devices').get().n,0);
 // Sign-in aliases do not silently expand the separately reviewed outbound recipient allowlist.
 assert.throws(()=>validateAction('email',{...payload,to:[owner.signInEmail]}));sql.close();
});
test('expired legacy Google credentials refresh through an alias under the same encryption key',async()=>{
 const {sql,env}=fixture(),canonical=member(people.cyrus.email);
 const credentials=await seal(env,{access_token:'expired',refresh_token:'synthetic-refresh',expires:0},'google:'+canonical.email);
 sql.prepare('INSERT INTO google_connections(owner,credentials,scopes) VALUES(?,?,?)').run(canonical.email,credentials,'synthetic');
 const original=globalThis.fetch;let requests=0;
 try{
  globalThis.fetch=async(url,init)=>{requests++;assert.equal(url,'https://oauth2.googleapis.com/token');assert.equal(init.body.get('refresh_token'),'synthetic-refresh');return Response.json({access_token:'refreshed-synthetic',expires_in:3600});};
  assert.equal(await accessToken(env,owner),'refreshed-synthetic');
  assert.equal(await accessToken(env,canonical),'refreshed-synthetic');assert.equal(requests,1);
  const rows=sql.prepare('SELECT * FROM google_connections').all();assert.equal(rows.length,1);assert.equal(rows[0].owner,canonical.email);
  const refreshed=await open(env,rows[0].credentials,'google:'+canonical.email);assert.equal(refreshed.refresh_token,'synthetic-refresh');
 }finally{globalThis.fetch=original;sql.close();}
});
test('identity audit records only verified attempt metadata, never content or OAuth query values',async()=>{
 const {sql,env}=fixture();
 await auditIdentity(req('chat',{content:'PRIVATE TEST CONTENT'}),env,owner);
 await auditIdentity(new Request('https://hub.test/api/google/callback?code=SECRET_CODE&state=SECRET_STATE'),env,owner);
 await auditIdentity(req('messages'),env,owner);
 const rows=sql.prepare('SELECT * FROM identity_audit ORDER BY rowid').all();assert.equal(rows.length,2);
 assert.equal(rows[0].member_id,'cyrus');assert.equal(rows[0].sign_in_email,owner.signInEmail);
 assert.equal(rows[1].route,'/api/google/callback');
 for(const secret of ['PRIVATE TEST CONTENT','SECRET_CODE','SECRET_STATE'])assert.equal(JSON.stringify(rows).includes(secret),false);
 assert.equal((await (await api(req('me'),{},owner)).json()).signInEmail,undefined);sql.close();
});
test('real JWT verification resolves aliases and denies forged, revoked, unknown and wrong-audience identities',async()=>{
 const {privateKey,publicKey}=await generateKeyPair('RS256'),jwk=await exportJWK(publicKey);jwk.kid='synthetic-key';
 const issuer='https://identity-tests.cloudflareaccess.com',audience='synthetic-audience';
 const {sql,env}=fixture();Object.assign(env,{ACCESS_TEAM_DOMAIN:issuer,ACCESS_AUD:audience,MEMBER_ALIASES:aliases});
 const sign=(email,aud=audience,expiration='5m')=>new SignJWT({email}).setProtectedHeader({alg:'RS256',kid:jwk.kid}).setIssuer(issuer).setAudience(aud).setIssuedAt().setExpirationTime(expiration).sign(privateKey);
 const original=globalThis.fetch;
 try{
  globalThis.fetch=async url=>{assert.equal(String(url),issuer+'/cdn-cgi/access/certs');return Response.json({keys:[jwk]});};
  const token=await sign(owner.signInEmail);
  const signedRequest=(path,jwt=token)=>new Request('https://hub.test/api/'+path,{headers:{'Cf-Access-Jwt-Assertion':jwt}});
  assert.deepEqual(await authenticate(signedRequest('me'),env),owner);
  assert.equal((await (await worker.fetch(signedRequest('me'),env)).json()).id,'cyrus');
  for(const [email,aud,expiration] of [['unknown@example.test',audience,'5m'],[owner.signInEmail,'wrong','5m'],[owner.signInEmail,audience,1]])assert.equal((await worker.fetch(signedRequest('me',await sign(email,aud,expiration)),env)).status,401);
  assert.equal((await worker.fetch(signedRequest('me',token.slice(0,-8)+'tampered'),env)).status,401);
  assert.equal((await worker.fetch(signedRequest('me'),{...env,MEMBER_ALIASES:undefined})).status,401);
  assert.equal((await worker.fetch(signedRequest('me'),{...env,MEMBER_ALIASES:'bad-json'})).status,401);
  const childToken=await sign('child.alias@example.test');
  for(const path of ['messages?room=parents','briefs?room=parents','approvals?room=parents','notifications?room=parents','google/status','google/records','actions','reminders','private-ai'])assert.equal((await worker.fetch(signedRequest(path,childToken),env)).status,403,path);
  for(const email of ['child.alias@example.test','adult.alias@example.test']){
   const jwt=await sign(email);
   for(const path of ['actions/propose','actions/execute','reminders','reminders/cancel','private-ai','google/connect','google/import','google/disconnect','approve']){
    const post=new Request('https://hub.test/api/'+path,{method:'POST',headers:{'Cf-Access-Jwt-Assertion':jwt,origin:'https://hub.test','content-type':'application/json'},body:JSON.stringify({state:'approved',content:'Synthetic',confirmExactAction:true})});
    assert.equal((await worker.fetch(post,env)).status,403,email+': '+path);
   }
  }
  // Audit failure must prevent a mutation before any AI or provider call.
  let modelCalls=0;const ai={run(){modelCalls++;return {response:'Synthetic response'};}};
  const failedEnv={...env,AI_ENABLED:'true',AI:ai,DB:{...env.DB,prepare(query){if(query.startsWith('INSERT INTO identity_audit'))throw Error('audit unavailable');return env.DB.prepare(query);}}};
  const post=new Request('https://hub.test/api/chat',{method:'POST',headers:{'Cf-Access-Jwt-Assertion':token,origin:'https://hub.test','content-type':'application/json'},body:JSON.stringify({content:'Synthetic'})});
  const retry=post.clone();
  assert.equal((await worker.fetch(post,failedEnv)).status,503);assert.equal(modelCalls,0);
  assert.equal(sql.prepare("SELECT count(*) AS n FROM messages WHERE content='Synthetic'").get().n,0);
  assert.equal((await worker.fetch(retry,{...env,AI_ENABLED:'true',AI:ai})).status,200);assert.equal(modelCalls,1);
 }finally{globalThis.fetch=original;sql.close();}
});
