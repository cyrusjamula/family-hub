import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Worker} from 'node:worker_threads';
import {createD1ConsentClaims} from '../src/integrations/mcp-consent-claims.js';
const schema=readFileSync(new URL('../scripts/mcp-consent-claim-schema.sql',import.meta.url),'utf8');
const request=(handleDigest='a'.repeat(64))=>({handleDigest,memberId:'synthetic-member',clientId:'synthetic-client',decision:'allow',expiresAt:2000});
const wrap=db=>({prepare(sql){return {bind(...args){return {sql,args};}};},async batch(rows){db.exec('BEGIN');try{const results=rows.map(row=>{const r=db.prepare(row.sql).run(...row.args);return {success:true,meta:{changes:Number(r.changes)}};});db.exec('COMMIT');return results;}catch(error){db.exec('ROLLBACK');throw error;}}});
function fixture(t){const dir=mkdtempSync(join(tmpdir(),'consent-claim-')),path=join(dir,'consent.sqlite'),db=new DatabaseSync(path);db.exec(schema);t.after(()=>{db.close();rmSync(dir,{recursive:true,force:true});});return {path,db,claims:createD1ConsentClaims({enabled:true,db:wrap(db),now:()=>1000})};}
test('consumption is immutable across decisions, member/client changes and store reopen',async t=>{
 const f=fixture(t);assert.equal(await f.claims.claim(request()),true);
 const other=new DatabaseSync(f.path);t.after(()=>other.close());const reopened=createD1ConsentClaims({enabled:true,db:wrap(other),now:()=>1000});
 for(const change of [{},{memberId:'other'},{clientId:'other'},{decision:'deny'}])assert.equal(await reopened.claim({...request(),...change}),false);
 assert.deepEqual({...other.prepare('SELECT * FROM mcp_consent_claims').get()},{handle_digest:'a'.repeat(64),member_id:'synthetic-member',client_id:'synthetic-client',decision:'allow',state:'consumed',expires_at:2000});
 assert.equal(await reopened.claim(request('b'.repeat(64))),true);
 assert.equal(typeof reopened.release,'undefined');
});
for(const sameHandle of [true,false])test(sameHandle?'concurrent connections consume one handle only once':'concurrent distinct handles cannot exceed the bounded store cap',async t=>{
 const f=fixture(t),gate=new Int32Array(new SharedArrayBuffer(4)),url=new URL('../src/integrations/mcp-consent-claims.js',import.meta.url).href;
 const code=`import {parentPort,workerData} from 'node:worker_threads';import {DatabaseSync} from 'node:sqlite';import {createD1ConsentClaims} from ${JSON.stringify(url)};
  const db=new DatabaseSync(workerData.path);db.exec('PRAGMA busy_timeout=5000');
  const store={prepare(sql){return {bind(...args){return {sql,args};}};},async batch(rows){db.exec('BEGIN');try{const results=rows.map(row=>{const r=db.prepare(row.sql).run(...row.args);return {success:true,meta:{changes:Number(r.changes)}};});db.exec('COMMIT');return results;}catch(error){db.exec('ROLLBACK');throw error;}}};
  const flag=new Int32Array(workerData.gate);parentPort.postMessage('ready');Atomics.wait(flag,0,0);
  try{const claims=createD1ConsentClaims({enabled:true,db:store,now:()=>1000,maxClaims:1});parentPort.postMessage(await claims.claim(workerData.request));}finally{db.close();}`;
 const workers=Array.from({length:4},(_,i)=>new Worker(code,{eval:true,workerData:{path:f.path,gate:gate.buffer,request:{...request((sameHandle?'a':String(i+1)).repeat(64)),decision:i%2?'deny':'allow'}}}));
 t.after(async()=>{await Promise.all(workers.map(w=>w.terminate()));});let ready=0;
 const results=await Promise.all(workers.map(worker=>new Promise((resolve,reject)=>{worker.on('error',reject);worker.on('message',value=>{if(value==='ready'){if(++ready===workers.length){Atomics.store(gate,0,1);Atomics.notify(gate,0,workers.length);}}else resolve(value);});})));
 assert.equal(results.filter(Boolean).length,1);assert.equal(f.db.prepare('SELECT count(*) AS n FROM mcp_consent_claims').get().n,1);
});
test('disabled store, invalid inputs, full capacity and missing schema fail closed',async t=>{
 const disabled=createD1ConsentClaims({db:{prepare(){throw Error('must not touch storage');}}});assert.equal(await disabled.claim(request()),false);
 const f=fixture(t);for(const change of [{handleDigest:'bad'},{memberId:'bad space'},{clientId:''},{decision:'retry'},{expiresAt:1000},{expiresAt:301001}])await assert.rejects(f.claims.claim({...request(),...change}),/Consent claim unavailable/);
 assert.equal(f.db.prepare('SELECT count(*) AS n FROM mcp_consent_claims').get().n,0);
 const capped=createD1ConsentClaims({enabled:true,db:wrap(f.db),now:()=>1000,maxClaims:1});assert.equal(await capped.claim(request()),true);assert.equal(await capped.claim(request('b'.repeat(64))),false);
 const missing=new DatabaseSync(':memory:');t.after(()=>missing.close());await assert.rejects(createD1ConsentClaims({enabled:true,db:wrap(missing),now:()=>1000}).claim(request()),/Consent claim unavailable/);
});
test('an ambiguous committed write remains consumed and cannot be retried',async t=>{
 const f=fixture(t),normal=wrap(f.db);
 const ambiguous={prepare:normal.prepare,async batch(rows){await normal.batch(rows);return [{success:true},{success:true}];}};
 await assert.rejects(createD1ConsentClaims({enabled:true,db:ambiguous,now:()=>1000}).claim(request()),/Consent claim unavailable/);
 assert.equal(await f.claims.claim(request()),false);assert.equal(f.db.prepare('SELECT state FROM mcp_consent_claims').get().state,'consumed');
});
test('expired cleanup is bounded, preserves live claims, and expired requests never consume again',async t=>{
 const f=fixture(t);let time=1000;const claims=createD1ConsentClaims({enabled:true,db:wrap(f.db),now:()=>time,maxClaims:1});
 assert.equal(await claims.claim(request()),true);assert.equal(await claims.claim(request('b'.repeat(64))),false);
 time=2000;await assert.rejects(claims.claim(request()),/Consent claim unavailable/);
 assert.equal(await claims.claim({...request('b'.repeat(64)),expiresAt:3000}),true);
 assert.equal(f.db.prepare('SELECT count(*) AS n FROM mcp_consent_claims').get().n,1);assert.equal(f.db.prepare('SELECT handle_digest FROM mcp_consent_claims').get().handle_digest,'b'.repeat(64));
 const insert=f.db.prepare("INSERT INTO mcp_consent_claims VALUES(?,?,?,'allow','consumed',?)");
 for(let i=0;i<150;i++)insert.run(i.toString(16).padStart(64,'0'),'synthetic-member','synthetic-client',1000);
 const before=f.db.prepare('SELECT count(*) AS n FROM mcp_consent_claims').get().n;
 assert.equal(await claims.claim({...request('c'.repeat(64)),expiresAt:3000}),false);
 assert.equal(f.db.prepare('SELECT count(*) AS n FROM mcp_consent_claims').get().n,before-100);
 assert.equal(f.db.prepare('SELECT expires_at FROM mcp_consent_claims WHERE handle_digest=?').get('b'.repeat(64)).expires_at,3000);
});
test('failed insertion rolls back cleanup in the same transaction',async t=>{
 const f=fixture(t);await f.claims.claim(request());f.db.exec("CREATE TRIGGER reject_new_claim BEFORE INSERT ON mcp_consent_claims BEGIN SELECT RAISE(ABORT,'synthetic insertion failure'); END");
 const claims=createD1ConsentClaims({enabled:true,db:wrap(f.db),now:()=>2000});
 await assert.rejects(claims.claim({...request('b'.repeat(64)),expiresAt:3000}),/Consent claim unavailable/);
 assert.equal(f.db.prepare('SELECT handle_digest FROM mcp_consent_claims').get().handle_digest,'a'.repeat(64));
});
