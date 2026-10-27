import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createD1FactoryClaims} from '../src/factory-d1-claims.js';

const digest='a'.repeat(64), other='b'.repeat(64);
const d1=db=>({prepare:sql=>({bind:(...args)=>({run:async()=>({success:true,meta:{changes:Number(db.prepare(sql).run(...args).changes)}})})})});

test('cancellation intent is scoped, persistent and does not unlock a paused uncertain operation',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'factory-cancel-')), path=join(dir,'state.sqlite');
 let db=new DatabaseSync(path);
 t.after(()=>{db.close();rmSync(dir,{recursive:true,force:true});});
 db.exec(readFileSync(new URL('../scripts/factory-d1-schema.sql',import.meta.url),'utf8'));
 db.exec('UPDATE factory_claim_slot SET paused=0');
 let claims=createD1FactoryClaims(d1(db));
 assert.equal(await claims.requestCancellation('op',digest),false);
 assert.equal(await claims.claim('op',digest),true);
 assert.equal(await claims.requestCancellation('wrong',digest),false);
 assert.equal(await claims.requestCancellation('op',other),false);
 assert.equal(await claims.markUncertain('op',digest),true);
 assert.equal(await claims.pause(),true);
 assert.equal(await claims.requestCancellation('op',digest),true);
 assert.equal(await claims.requestCancellation('op',digest),false);
 assert.equal(await claims.recordTaskIdentity('op',digest,'task-1'),true);
 db.close();db=new DatabaseSync(path);claims=createD1FactoryClaims(d1(db));
 assert.deepEqual({...db.prepare('SELECT paused,state,operation_id,scope_digest,external_task_id,cancel_requested FROM factory_claim_slot').get()},
  {paused:1,state:'uncertain',operation_id:'op',scope_digest:digest,external_task_id:'task-1',cancel_requested:1});
 assert.equal(await claims.claim('other',digest),false);
 assert.equal(typeof claims.release,'undefined');assert.equal(typeof claims.resume,'undefined');
});

test('ambiguous result fails closed even when the intent was durably written',async t=>{
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 db.exec(readFileSync(new URL('../scripts/factory-d1-schema.sql',import.meta.url),'utf8'));
 db.exec('UPDATE factory_claim_slot SET paused=0');
 assert.equal(await createD1FactoryClaims(d1(db)).claim('op',digest),true);
 const ambiguous={prepare:sql=>({bind:(...args)=>({async run(){db.prepare(sql).run(...args);throw Error('synthetic network failure');}})})};
 await assert.rejects(createD1FactoryClaims(ambiguous).requestCancellation('op',digest),/preserve/);
 assert.equal(db.prepare('SELECT cancel_requested FROM factory_claim_slot').get().cancel_requested,1);
 assert.equal(await createD1FactoryClaims(d1(db)).requestCancellation('op',digest),false);
 assert.equal(db.prepare('SELECT state FROM factory_claim_slot').get().state,'claimed');
 for(const bad of ['',null,'bad space'])await assert.rejects(createD1FactoryClaims(d1(db)).requestCancellation(bad,digest),/preserve/);
});

test('simultaneous workers set cancellation intent exactly once without losing the claim',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'factory-cancel-race-')),path=join(dir,'state.sqlite');
 const db=new DatabaseSync(path);t.after(()=>{db.close();rmSync(dir,{recursive:true,force:true});});
 db.exec(readFileSync(new URL('../scripts/factory-d1-schema.sql',import.meta.url),'utf8'));
 db.exec('UPDATE factory_claim_slot SET paused=0');assert.equal(await createD1FactoryClaims(d1(db)).claim('op',digest),true);
 const {Worker}=await import('node:worker_threads');const gate=new Int32Array(new SharedArrayBuffer(4));
 const moduleUrl=new URL('../src/factory-d1-claims.js',import.meta.url).href;
 const code=`import {parentPort,workerData} from 'node:worker_threads';import {DatabaseSync} from 'node:sqlite';
 import {createD1FactoryClaims} from ${JSON.stringify(moduleUrl)};
 const db=new DatabaseSync(workerData.path);db.exec('PRAGMA busy_timeout=5000');
 const d1={prepare:sql=>({bind:(...args)=>({run:async()=>({success:true,meta:{changes:Number(db.prepare(sql).run(...args).changes)}})})})};
 const flag=new Int32Array(workerData.gate);parentPort.postMessage('ready');Atomics.wait(flag,0,0);
 try{parentPort.postMessage(await createD1FactoryClaims(d1).requestCancellation('op',workerData.digest));}finally{db.close();}`;
 const workers=[0,1].map(()=>new Worker(code,{eval:true,workerData:{path,gate:gate.buffer,digest}}));
 t.after(async()=>{await Promise.all(workers.map(w=>w.terminate()));});let ready=0;
 const results=workers.map(w=>new Promise((resolve,reject)=>{let initialized=false;w.on('error',reject);w.on('message',m=>{
  if(!initialized){if(m!=='ready')return reject(Error('worker initialization failed'));initialized=true;if(++ready===2){Atomics.store(gate,0,1);Atomics.notify(gate,0,2);}return;}resolve(m);
 });}));
 assert.equal((await Promise.all(results)).filter(Boolean).length,1);
 assert.deepEqual({...db.prepare('SELECT state,operation_id,cancel_requested FROM factory_claim_slot').get()},
  {state:'claimed',operation_id:'op',cancel_requested:1});
});

test('cancellation blocks the pre-start uncertain transition without releasing the slot',async t=>{
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 db.exec(readFileSync(new URL('../scripts/factory-d1-schema.sql',import.meta.url),'utf8'));
 db.exec('UPDATE factory_claim_slot SET paused=0');const claims=createD1FactoryClaims(d1(db));
 assert.equal(await claims.claim('op',digest),true);
 assert.equal(await claims.requestCancellation('op',digest),true);
 assert.equal(await claims.markUncertain('op',digest),false);
 assert.deepEqual({...db.prepare('SELECT state,operation_id,cancel_requested FROM factory_claim_slot').get()},
  {state:'claimed',operation_id:'op',cancel_requested:1});
 assert.equal(await claims.claim('another',digest),false);
});

test('cancellation and pre-start transition serialize without dropping intent',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'factory-cancel-start-race-')),path=join(dir,'state.sqlite');
 const db=new DatabaseSync(path);t.after(()=>{db.close();rmSync(dir,{recursive:true,force:true});});
 db.exec(readFileSync(new URL('../scripts/factory-d1-schema.sql',import.meta.url),'utf8'));
 db.exec('UPDATE factory_claim_slot SET paused=0');assert.equal(await createD1FactoryClaims(d1(db)).claim('op',digest),true);
 const {Worker}=await import('node:worker_threads');const gate=new Int32Array(new SharedArrayBuffer(4));
 const moduleUrl=new URL('../src/factory-d1-claims.js',import.meta.url).href;
 const code=`import {parentPort,workerData} from 'node:worker_threads';import {DatabaseSync} from 'node:sqlite';
 import {createD1FactoryClaims} from ${JSON.stringify(moduleUrl)};
 const db=new DatabaseSync(workerData.path);db.exec('PRAGMA busy_timeout=5000');
 const d1={prepare:sql=>({bind:(...args)=>({run:async()=>({success:true,meta:{changes:Number(db.prepare(sql).run(...args).changes)}})})})};
 const flag=new Int32Array(workerData.gate);parentPort.postMessage('ready');Atomics.wait(flag,0,0);
 try{const store=createD1FactoryClaims(d1);parentPort.postMessage(await store[workerData.method]('op',workerData.digest));}finally{db.close();}`;
 const workers=['requestCancellation','markUncertain'].map(method=>new Worker(code,{eval:true,workerData:{path,gate:gate.buffer,digest,method}}));
 t.after(async()=>{await Promise.all(workers.map(w=>w.terminate()));});let ready=0;
 const results=workers.map(w=>new Promise((resolve,reject)=>{let initialized=false;w.on('error',reject);w.on('message',m=>{
  if(!initialized){if(m!=='ready')return reject(Error('worker initialization failed'));initialized=true;if(++ready===2){Atomics.store(gate,0,1);Atomics.notify(gate,0,2);}return;}resolve(m);
 });}));
 const [cancelled,started]=await Promise.all(results);assert.equal(cancelled,true);
 assert.deepEqual({...db.prepare('SELECT state,operation_id,cancel_requested FROM factory_claim_slot').get()},
  {state:started?'uncertain':'claimed',operation_id:'op',cancel_requested:1});
});
