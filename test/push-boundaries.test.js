import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {generateKeyPair,exportJWK} from 'jose';
import {pushAPI,publishNotices} from '../src/push.js';
import {open} from '../src/google.js';
import {people} from '../src/policy.js';
const endpoint='https://wns2.notify.windows.com/synthetic-device';
const person=id=>({...people[id],email:people[id].email});
const req=(path,body)=>new Request('https://hub.test/api/push/'+path,{method:'POST',headers:{origin:'https://hub.test','content-type':'application/json'},body:JSON.stringify(body)});
async function fixture(){
 const sql=new DatabaseSync(':memory:');for(const name of readdirSync(new URL('../migrations/',import.meta.url)).sort())sql.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
 const DB={prepare(query){const bound=(args=[])=>({query,args,first:async()=>sql.prepare(query).get(...args)??null,all:async()=>({results:sql.prepare(query).all(...args)}),run:async()=>sql.prepare(query).run(...args)});return {...bound(),bind:(...args)=>bound(args)};}};
 const {privateKey}=await generateKeyPair('ES256',{extractable:true});return {sql,env:{DB,GOOGLE_VAULT_KEY:btoa('z'.repeat(32)),PUSH_VAPID_JWK:JSON.stringify(await exportJWK(privateKey))}};
}
test('device subscription requires opt-in, encrypts endpoint, and cannot transfer between accounts',async()=>{
 const {sql,env}=await fixture();try{
  const owner=person('cyrus'),child=person('iyanah');assert.equal((await pushAPI(req('subscribe',{endpoint}),env,owner)).status,400);assert.equal(sql.prepare('SELECT count(*) AS n FROM push_devices').get().n,0);
  assert.equal((await pushAPI(req('subscribe',{endpoint,confirmNotifications:true}),env,owner)).status,200);const row=sql.prepare('SELECT * FROM push_devices').get();assert.ok(!row.endpoint.includes(endpoint));assert.equal((await open(env,row.endpoint,'push:'+owner.email+':'+row.id)).endpoint,endpoint);
  assert.equal((await pushAPI(req('subscribe',{endpoint,confirmNotifications:true}),env,child)).status,409);assert.equal((await pushAPI(req('disable',{endpoint}),env,child)).status,200);assert.equal(sql.prepare('SELECT count(*) AS n FROM push_devices').get().n,1);
  assert.equal((await pushAPI(req('test',{endpoint}),env,child)).status,429);assert.equal((await pushAPI(req('disable',{endpoint}),env,owner)).status,200);assert.equal(sql.prepare('SELECT count(*) AS n FROM push_devices').get().n,0);
  assert.equal((await pushAPI(req('subscribe',{endpoint,confirmNotifications:true}),env,child)).status,200);assert.equal(sql.prepare('SELECT owner FROM push_devices').get().owner,child.email);
 }finally{sql.close();}
});
test('five-device cap allows renewal of an existing device and rejects a sixth',async()=>{
 const {sql,env}=await fixture();try{const user=person('aarish');for(let i=0;i<5;i++)assert.equal((await pushAPI(req('subscribe',{endpoint:endpoint+i,confirmNotifications:true}),env,user)).status,200);assert.equal((await pushAPI(req('subscribe',{endpoint:endpoint+0,confirmNotifications:true}),env,user)).status,200);assert.equal((await pushAPI(req('subscribe',{endpoint:endpoint+5,confirmNotifications:true}),env,user)).status,409);assert.equal(sql.prepare('SELECT count(*) AS n FROM push_devices').get().n,5);}finally{sql.close();}
});
test('concurrent cron runs deliver each eligible generic notice once and never send Parents to children',async()=>{
 const {sql,env}=await fixture(),original=globalThis.fetch;let sends=0;try{
  for(const id of ['cyrus','anhaita','iyanah','aarish'])assert.equal((await pushAPI(req('subscribe',{endpoint:endpoint+id,confirmNotifications:true}),env,person(id))).status,200);
  for(const room of ['family','parents'])sql.prepare('INSERT INTO notifications(id,room,content) VALUES(?,?,?)').run(room,room,'Synthetic private content must not leave server');
  globalThis.fetch=async(_url,init)=>{sends++;assert.equal(init.body.byteLength,0);assert.equal(init.redirect,'manual');return new Response(null,{status:201});};
  await Promise.all([publishNotices(env),publishNotices(env)]);await publishNotices(env);assert.equal(sends,6);const deliveries=sql.prepare('SELECT notice,device,state FROM push_deliveries').all();assert.equal(deliveries.length,6);assert.ok(deliveries.every(d=>d.state==='accepted'));
  assert.equal(sql.prepare('SELECT count(*) AS n FROM push_deliveries p JOIN push_devices d ON p.device=d.id WHERE p.notice=? AND d.owner IN (?,?)').get('parents',people.iyanah.email,people.aarish.email).n,0);
 }finally{globalThis.fetch=original;sql.close();}
});
test('failed and retired push endpoints are not retried or exposed',async()=>{
 for(const status of [410,500]){const {sql,env}=await fixture(),original=globalThis.fetch;let sends=0;try{
  await pushAPI(req('subscribe',{endpoint,confirmNotifications:true}),env,person('cyrus'));sql.prepare('INSERT INTO notifications(id,room,content) VALUES(?,?,?)').run('notice','parents','Synthetic private');
  globalThis.fetch=async()=>{sends++;return new Response(null,{status});};await publishNotices(env);await publishNotices(env);assert.equal(sends,1);assert.equal(sql.prepare('SELECT state FROM push_deliveries').get().state,'failed');assert.equal(sql.prepare('SELECT count(*) AS n FROM push_devices').get().n,status===410?0:1);
 }finally{globalThis.fetch=original;sql.close();}}
});
