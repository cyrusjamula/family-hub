import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createMcpTaskGrants} from '../src/integrations/mcp-task-grants.js';
import {createD1ConsentClaims} from '../src/integrations/mcp-consent-claims.js';
// Node has no Workers entrypoint base class. Only that runtime shell is shimmed;
// the installed provider's registration, consent, PKCE, storage and token code run.
registerHooks({resolve(specifier,context,next){if(specifier==='cloudflare:workers')return {url:'data:text/javascript,export class WorkerEntrypoint {}',shortCircuit:true};return next(specifier,context);}});
const {createFamilyOAuthProvider}=await import('../src/integrations/mcp-oauth-provider.js');
const issuer='https://fixture.example/',resource=issuer+'mcp',redirect='https://client.example/callback';
const task='12345678-1234-4123-8123-123456789abc';
const verifier='a'.repeat(43),wrongVerifier='b'.repeat(43);
const meta={'io.modelcontextprotocol/protocolVersion':'2026-07-28','io.modelcontextprotocol/clientCapabilities':{}};
const b64=bytes=>Buffer.from(bytes).toString('base64url');
function kv(){
 const rows=new Map();return {rows,async get(key,type){const r=rows.get(key);if(!r||r.expires&&r.expires<=Date.now())return null;return (type==='json'||type?.type==='json')?JSON.parse(r.value):r.value;},
  async put(key,value,options={}){rows.set(key,{value,metadata:options.metadata,expires:options.expirationTtl?Date.now()+options.expirationTtl*1000:options.expiration?options.expiration*1000:null});},
  async delete(key){rows.delete(key);},async list({prefix='' }={}){return {keys:[...rows.keys()].filter(name=>name.startsWith(prefix)).map(name=>({name,metadata:rows.get(name).metadata})),list_complete:true,cursor:''};}};
}
async function fixture(t){
 const sql=new DatabaseSync(':memory:');t.after(()=>sql.close());sql.exec(readFileSync(new URL('../migrations/0009_tasks.sql',import.meta.url),'utf8'));
 sql.exec(readFileSync(new URL('../scripts/mcp-task-grant-schema.sql',import.meta.url),'utf8'));
 sql.exec(readFileSync(new URL('../scripts/mcp-consent-claim-schema.sql',import.meta.url),'utf8'));
 sql.prepare('INSERT INTO tasks(id,room,creator_id,assignee_id,assistant,title,details,provenance,approval_required) VALUES(?,?,?,?,?,?,?,?,?)').run(task,'family','owner','child','synthetic','Synthetic task','Synthetic detail','Synthetic source',0);
 let queue=Promise.resolve();const db={batch(statements){const next=queue.then(async()=>{sql.exec('BEGIN');try{const a=[];for(const s of statements)a.push(await s.run());sql.exec('COMMIT');return a;}catch(e){sql.exec('ROLLBACK');throw e;}});queue=next.catch(()=>{});return next;},prepare(q){return {bind(...args){return {async run(){const r=sql.prepare(q).run(...args);return {success:true,meta:{changes:Number(r.changes)}};},async first(){return sql.prepare(q).get(...args)||null;}};}};}};
 let active=true,connected=true,session='child';const registry=new Map();
 const resolveMember=async id=>id==='owner'?{id,role:'owner'}:active&&id==='child'?{id,role:'child'}:null;
 const grants=createMcpTaskGrants({db,resolveOwner:async s=>s==='owner'?{id:'owner',role:'owner'}:null,resolveMember,
  resolveClient:async (member,id)=>connected&&member==='child'&&id==='client-a',verifyApproval:async (_s,_a,d,v)=>v===JSON.stringify(d)});
 const details={grantId:'grant-1',task,version:1,memberId:'child',clientId:'client-a',expiresAt:Math.floor(Date.now()/1000)+3600};
 assert.equal(await grants.approve('owner',{...details,confirmation:JSON.stringify(details)}),true);
 const consentClaims=createD1ConsentClaims({enabled:true,db});
 const provider=createFamilyOAuthProvider({enabled:true,issuer,resource,allowDynamicRegistration:true,grants,resolveMember,consentClaims,
  authenticate:async()=>session?{id:session}:null,resolveRegisteredClient:async(member,external)=>connected&&member==='child'&&registry.has(external)?{id:registry.get(external)}:null});
 const env={OAUTH_KV:kv()},pending=[],ctx={waitUntil(p){pending.push(p);},passThroughOnException(){}};
 const send=request=>provider.fetch(request,env,ctx);
 const registration=await send(new Request(issuer+'oauth/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({client_name:'<synthetic client>',redirect_uris:[redirect],token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],response_types:['code']})}));
 assert.equal(registration.status,201,await registration.clone().text());const client=(await registration.json()).client_id;registry.set(client,'client-a');
 const challenge=b64(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier)));
 const url=new URL(issuer+'authorize');Object.entries({client_id:client,redirect_uri:redirect,response_type:'code',scope:'tasks:read',resource,state:'synthetic-state',code_challenge:challenge,code_challenge_method:'S256'}).forEach(([k,v])=>url.searchParams.set(k,v));
 async function begin(){const r=await send(new Request(url));const html=await r.text();return {response:r,html,handle:/name="handle" value="([^"]+)"/.exec(html)?.[1],cookie:r.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ')};}
 const approve=(page,{cookie=page.cookie,origin='https://fixture.example',decision='allow'}={})=>send(new Request(issuer+'authorize',{method:'POST',headers:{origin,cookie,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({handle:page.handle,decision})}));
 const exchange=(code,v=verifier)=>send(new Request(issuer+'oauth/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',client_id:client,redirect_uri:redirect,code,code_verifier:v,resource})}));
 const read=token=>send(new Request(resource,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json','mcp-protocol-version':'2026-07-28','mcp-method':'tools/call','mcp-name':'task_read'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{_meta:meta,name:'task_read',arguments:{taskId:task}}})}));
 return {provider,send,env,sql,client,begin,approve,exchange,read,registry,grants,consentClaims,authUrl:url,disconnect:()=>{connected=false;},deactivate:()=>{active=false;},session:id=>{session=id;}};
}
test('official provider performs discovery, consent, PKCE exchange and granted task read',async t=>{
 const f=await fixture(t);
 const discovery=await f.send(new Request(issuer+'.well-known/oauth-authorization-server'));assert.equal(discovery.status,200);assert.equal((await discovery.json()).token_endpoint,issuer+'oauth/token');
 const metadata=await f.send(new Request(issuer+'.well-known/oauth-protected-resource/mcp'));assert.deepEqual((await metadata.json()).scopes_supported,['tasks:read']);
 const page=await f.begin();assert.equal(page.response.status,200,page.html);assert.ok(page.html.includes('&lt;synthetic client&gt;'));assert.ok(!page.html.includes('<synthetic client>'));assert.ok(page.handle);
 assert.equal(page.response.headers.get('content-security-policy'),"default-src 'none'; form-action 'self' https://client.example; frame-ancestors 'none'; base-uri 'none'");
 const approved=await f.approve(page);assert.equal(approved.status,302,await approved.clone().text());const callback=new URL(approved.headers.get('location'));assert.equal(callback.origin,'https://client.example');assert.equal(callback.searchParams.get('state'),'synthetic-state');
 const tokens=await f.exchange(callback.searchParams.get('code'));assert.equal(tokens.status,200,await tokens.clone().text());const token=(await tokens.json()).access_token;
 const response=await f.read(token);assert.equal(response.status,200,await response.clone().text());assert.equal((await response.json()).result.structuredContent.task.title,'Synthetic task');
 assert.equal(await f.grants.revoke('owner','grant-1'),true);assert.equal((await (await f.read(token)).json()).result.structuredContent.ok,false);
 f.disconnect();assert.equal((await f.read(token)).status,403);
});
test('consent is bound to browser, origin and current member; sequential replay is denied',async t=>{
 const f=await fixture(t),page=await f.begin();
 assert.equal((await f.approve(page,{origin:'https://evil.example'})).status,403);
 assert.notEqual((await f.approve(page,{cookie:''})).status,302);
 f.session('owner');assert.equal((await f.approve(page)).status,403);f.session('child');
 const allowed=await f.approve(page);assert.equal(allowed.status,302);
 assert.notEqual((await f.approve(page)).status,302);
});
test('wrong PKCE cannot redeem code; unknown client mapping and denied membership prevent consent',async t=>{
 const f=await fixture(t),page=await f.begin(),approved=await f.approve(page),code=new URL(approved.headers.get('location')).searchParams.get('code');
 assert.equal((await f.exchange(code,wrongVerifier)).status,400);
 f.registry.delete(f.client);assert.equal((await f.begin()).response.status,403);
 f.session(null);assert.equal((await f.begin()).response.status,401);
});
test('the installed library enforces token revocation and denies sequential code replay',async t=>{
 const f=await fixture(t),page=await f.begin(),approved=await f.approve(page),code=new URL(approved.headers.get('location')).searchParams.get('code');
 const tokens=await f.exchange(code);assert.equal(tokens.status,200);const token=(await tokens.json()).access_token;
 assert.equal((await f.read(token)).status,200);
 f.registry.set(f.client,'client-b');assert.equal((await f.read(token)).status,403);
 f.registry.set(f.client,'client-a');assert.equal((await f.read(token)).status,200);
 const revoked=await f.send(new Request(issuer+'oauth/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token,client_id:f.client,token_type_hint:'access_token'})}));
 assert.equal(revoked.status,200);assert.equal((await f.read(token)).status,401);
 assert.equal((await f.exchange(code)).status,400);
});
test('deny creates no code; unsafe redirect and unsupported scopes cannot reach consent',async t=>{
 const f=await fixture(t),page=await f.begin(),denied=await f.approve(page,{decision:'deny'});
 assert.equal(denied.status,302);assert.equal(new URL(denied.headers.get('location')).searchParams.get('error'),'access_denied');
 const altered=new URL(f.authUrl);altered.searchParams.set('redirect_uri','https://evil.example/callback');
 assert.equal((await f.send(new Request(altered))).status,400);
 altered.searchParams.set('redirect_uri',redirect);altered.searchParams.set('scope','tasks:write');
 assert.equal((await f.send(new Request(altered))).status,400);
});
test('disabled official provider does not touch identity, KV or network',async()=>{
 const provider=createFamilyOAuthProvider({authenticate(){throw Error('must not run');}});
 assert.equal((await provider.fetch(new Request(resource))).status,503);assert.equal(await provider.validateToken(resource,'synthetic',{}),null);
});
test('corrupted consent binding and storage failure fail closed without private diagnostics',async t=>{
 const f=await fixture(t),page=await f.begin();
 const key=[...f.env.OAUTH_KV.rows.keys()].find(k=>k.startsWith('family-consent:'));
 const original=JSON.parse(f.env.OAUTH_KV.rows.get(key).value);
 for(const expiry of [undefined,'not-a-time',Date.now()+600000]){
  await f.env.OAUTH_KV.put(key,JSON.stringify({...original,expiresAt:expiry}));
  assert.equal((await f.approve(page)).status,403);
 }
 f.env.OAUTH_KV.get=async()=>{throw Error('private synthetic KV diagnostic');};
 const unavailable=await f.approve(page);assert.equal(unavailable.status,503);assert.equal((await unavailable.json()).error,'OAuth service unavailable');
});
test('concurrent Allow and Deny requests have exactly one consumed decision and one callback',async t=>{
 for(const decisions of [['allow','allow'],['allow','deny']]){
  const f=await fixture(t),page=await f.begin();
  const responses=await Promise.all(decisions.map(decision=>f.approve(page,{decision})));
  assert.deepEqual(responses.map(r=>r.status).sort(),[302,409]);
  const index=responses.findIndex(r=>r.status===302),callback=new URL(responses[index].headers.get('location'));
  assert.equal(f.sql.prepare('SELECT decision FROM mcp_consent_claims').get().decision,decisions[index]);
  assert.equal(callback.searchParams.has('code'),decisions[index]==='allow');
 }
});
test('wrong, duplicate or malformed host cookie and changed session/client consume no claim',async t=>{
 const f=await fixture(t),page=await f.begin(),host=page.cookie.split('; ').find(c=>c.startsWith('__Host-family-consent-'));
 for(const cookie of [page.cookie.replace(host,''),page.cookie+'; '+host,page.cookie.replace(host,host.split('=')[0]+'=bad'),page.cookie.replace(host,host.split('=')[0]+'='+'a'.repeat(43))])assert.equal((await f.approve(page,{cookie})).status,403);
 f.session('owner');assert.equal((await f.approve(page)).status,403);f.session('child');
 f.registry.set(f.client,'client-b');assert.equal((await f.approve(page)).status,403);f.registry.set(f.client,'client-a');
 assert.equal(f.sql.prepare('SELECT count(*) AS n FROM mcp_consent_claims').get().n,0);
 assert.equal((await f.approve(page)).status,302);
});
test('SDK failure after consumption blocks the old handle while a fresh authorization succeeds',async t=>{
 const f=await fixture(t),page=await f.begin(),remove=f.env.OAUTH_KV.delete.bind(f.env.OAUTH_KV);let failed=false;
 f.env.OAUTH_KV.delete=async key=>{if(!failed&&!key.startsWith('family-consent:')){failed=true;throw Error('synthetic storage unavailable');}return remove(key);};
 assert.equal((await f.approve(page)).status,503);assert.equal(f.sql.prepare('SELECT state FROM mcp_consent_claims').get().state,'consumed');
 f.env.OAUTH_KV.delete=remove;assert.equal((await f.approve(page)).status,409);
 const fresh=await f.begin();assert.equal((await f.approve(fresh)).status,302);assert.equal(f.sql.prepare('SELECT count(*) AS n FROM mcp_consent_claims').get().n,2);
});
test('separate browser tabs retain independent nonce-bound consent handles',async t=>{
 const f=await fixture(t),first=await f.begin(),second=await f.begin(),cookie=first.cookie+'; '+second.cookie;
 const responses=await Promise.all([f.approve(first,{cookie}),f.approve(second,{cookie})]);assert.deepEqual(responses.map(r=>r.status),[302,302]);
 assert.equal(new Set(responses.map(r=>new URL(r.headers.get('location')).searchParams.get('code'))).size,2);
 assert.equal(f.sql.prepare('SELECT count(*) AS n FROM mcp_consent_claims').get().n,2);
});
