import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Worker} from 'node:worker_threads';
import {createD1FactoryClaims} from '../src/factory-d1-claims.js';

const schema=readFileSync(new URL('../scripts/factory-d1-schema.sql',import.meta.url),'utf8');
const digest='a'.repeat(64), other='b'.repeat(64);
const wrap=db=>({prepare(sql){return {bind(...args){return {async run(){const x=db.prepare(sql).run(...args);return {success:true,meta:{changes:Number(x.changes)}};}};}};}});
function fixture(t){const dir=mkdtempSync(join(tmpdir(),'factory-claim-'));const path=join(dir,'claims.sqlite');const a=new DatabaseSync(path),b=new DatabaseSync(path);
 a.exec(schema);t.after(()=>{a.close();b.close();rmSync(dir,{recursive:true,force:true});});return {path,a,b,one:createD1FactoryClaims(wrap(a)),two:createD1FactoryClaims(wrap(b))};}

test('initial state is paused and pause is idempotent',async t=>{
 const f=fixture(t);assert.equal(await f.one.claim('op1',digest),false);assert.equal(await f.two.pause(),false);
 assert.deepEqual({...f.a.prepare('SELECT paused,state,operation_id FROM factory_claim_slot').get()},{paused:1,state:'idle',operation_id:null});
});

test('one atomic claim wins across independent SQLite connections and persists across reopen',async t=>{
 const f=fixture(t);f.a.exec('UPDATE factory_claim_slot SET paused=0');
 const results=await Promise.all([f.one.claim('op1',digest),f.two.claim('op2',other)]);
 assert.equal(results.filter(Boolean).length,1);const row=f.b.prepare('SELECT operation_id,scope_digest,state FROM factory_claim_slot').get();
 assert.ok(['op1','op2'].includes(row.operation_id));assert.equal(row.state,'claimed');
 assert.equal(await f.two.claim('op3',digest),false);
 assert.equal(await createD1FactoryClaims(wrap(f.b)).claim('op4',digest),false);
});

test('concurrent workers cannot both claim the same shared slot',async t=>{
 const f=fixture(t);f.a.exec('UPDATE factory_claim_slot SET paused=0');
 const gate=new Int32Array(new SharedArrayBuffer(4));
 const moduleUrl=new URL('../src/factory-d1-claims.js',import.meta.url).href;
 const code=`import {parentPort,workerData} from 'node:worker_threads';
  import {DatabaseSync} from 'node:sqlite';
  import {createD1FactoryClaims} from ${JSON.stringify(moduleUrl)};
  const db=new DatabaseSync(workerData.path);db.exec('PRAGMA busy_timeout=5000');
  const d1={prepare(sql){return {bind(...args){return {async run(){const result=db.prepare(sql).run(...args);return {success:true,meta:{changes:Number(result.changes)}};}};}};}};
  const flag=new Int32Array(workerData.gate);parentPort.postMessage('ready');Atomics.wait(flag,0,0);
  try{parentPort.postMessage(await createD1FactoryClaims(d1).claim(workerData.id,workerData.digest));}finally{db.close();}`;
 const workers=['op1','op2'].map(id=>new Worker(code,{eval:true,workerData:{path:f.path,gate:gate.buffer,id,digest}}));
 t.after(async()=>{await Promise.all(workers.map(w=>w.terminate()));});
 let readyCount=0;
 const outcomes=workers.map(worker=>new Promise((resolve,reject)=>{let ready=false;worker.on('error',reject);worker.on('message',message=>{
  if(!ready){if(message!=='ready')return reject(Error('worker failed to initialize'));ready=true;if(++readyCount===2){Atomics.store(gate,0,1);Atomics.notify(gate,0,2);}return;}
  resolve(message);
 });}));
 // Workers wait on zero; release only after both are ready.
 // Atomics.wait rechecks the value when a worker reaches it after notification.
 assert.equal((await Promise.all(outcomes)).filter(Boolean).length,1);
});

test('pause and digest mismatch prevent transition without releasing a claim',async t=>{
 const f=fixture(t);f.a.exec('UPDATE factory_claim_slot SET paused=0');assert.equal(await f.one.claim('op1',digest),true);
 assert.equal(await f.two.markUncertain('op1',other),false);assert.equal(await f.two.markUncertain('op2',digest),false);
 assert.equal(await f.two.pause(),true);assert.equal(await f.one.markUncertain('op1',digest),false);
 const row=f.a.prepare('SELECT paused,state,operation_id FROM factory_claim_slot').get();
 assert.deepEqual({...row},{paused:1,state:'claimed',operation_id:'op1'});
});

test('uncertain transition is persisted once and cannot release or reclaim the slot',async t=>{
 const f=fixture(t);f.a.exec('UPDATE factory_claim_slot SET paused=0');assert.equal(await f.one.claim('op1',digest),true);
 assert.equal(await f.two.markUncertain('op1',digest),true);assert.equal(await f.one.markUncertain('op1',digest),false);
 assert.equal(await f.two.pause(),true);assert.equal(await f.two.claim('op2',digest),false);
 assert.deepEqual({...f.b.prepare('SELECT paused,state,operation_id FROM factory_claim_slot').get()},{paused:1,state:'uncertain',operation_id:'op1'});
 assert.equal(typeof f.one.release,'undefined');assert.equal(typeof f.one.resume,'undefined');
});

test('invalid inputs, missing schema and ambiguous D1 results fail closed',async t=>{
 const f=fixture(t);for(const v of ['',null,'../op','x'.repeat(129)])await assert.rejects(f.one.claim(v,digest),/preserve/);
 for(const v of ['',null,'A'.repeat(64),digest+'x'])await assert.rejects(f.one.claim('op1',v),/preserve/);
 const missing=new DatabaseSync(':memory:');t.after(()=>missing.close());await assert.rejects(createD1FactoryClaims(wrap(missing)).claim('op1',digest),/preserve/);
 const bad=createD1FactoryClaims({prepare(){return {bind(){return {run:async()=>({success:true})};}};}});
 await assert.rejects(bad.claim('op1',digest),/preserve/);
});

test('late task identity persists while paused without releasing the claim',async t=>{
 const f=fixture(t);f.a.exec('UPDATE factory_claim_slot SET paused=0');
 assert.equal(await f.one.claim('op1',digest),true);
 assert.equal(await f.one.markUncertain('op1',digest),true);
 assert.equal(await f.one.pause(),true);
 assert.equal(await f.two.recordTaskIdentity('op1',digest,'task-123'),true);
 assert.deepEqual({...f.a.prepare('SELECT paused,state,operation_id,external_task_id FROM factory_claim_slot').get()},
  {paused:1,state:'uncertain',operation_id:'op1',external_task_id:'task-123'});
 assert.equal(await createD1FactoryClaims(wrap(f.b)).recordTaskIdentity('op1',digest,'task-123'),false);
 assert.equal(await f.two.claim('op2',digest),false);
});

test('task identity is scoped to the operation and immutable after first write',async t=>{
 const f=fixture(t);f.a.exec('UPDATE factory_claim_slot SET paused=0');
 assert.equal(await f.one.recordTaskIdentity('op1',digest,'task-a'),false);
 assert.equal(await f.one.claim('op1',digest),true);
 assert.equal(await f.two.recordTaskIdentity('op2',digest,'task-a'),false);
 assert.equal(await f.two.recordTaskIdentity('op1',other,'task-a'),false);
 assert.equal(await f.one.recordTaskIdentity('op1',digest,'task-a'),true);
 assert.equal(await f.two.recordTaskIdentity('op1',digest,'task-b'),false);
 assert.equal(f.a.prepare('SELECT external_task_id FROM factory_claim_slot').get().external_task_id,'task-a');
});

test('conflicting task identities have one durable winner across connections',async t=>{
 const f=fixture(t);f.a.exec('UPDATE factory_claim_slot SET paused=0');
 assert.equal(await f.one.claim('op1',digest),true);
 const outcomes=await Promise.all([f.one.recordTaskIdentity('op1',digest,'task-a'),f.two.recordTaskIdentity('op1',digest,'task-b')]);
 assert.equal(outcomes.filter(Boolean).length,1);
 assert.ok(['task-a','task-b'].includes(f.b.prepare('SELECT external_task_id FROM factory_claim_slot').get().external_task_id));
});

test('task identity validation and ambiguous storage errors fail closed',async t=>{
 const f=fixture(t);for(const value of ['',null,'../task','x'.repeat(129)])await assert.rejects(f.one.recordTaskIdentity('op1',digest,value),/preserve/);
 const broken=createD1FactoryClaims({prepare(){return {bind(){return {run:async()=>({success:true})};}};}});
 await assert.rejects(broken.recordTaskIdentity('op1',digest,'task-a'),/preserve/);
 assert.deepEqual({...f.a.prepare('SELECT state,external_task_id FROM factory_claim_slot').get()},{state:'idle',external_task_id:null});
});

test('racing worker processes cannot overwrite a task identity',async t=>{
 const f=fixture(t);f.a.exec('UPDATE factory_claim_slot SET paused=0');assert.equal(await f.one.claim('op1',digest),true);
 const gate=new Int32Array(new SharedArrayBuffer(4));
 const moduleUrl=new URL('../src/factory-d1-claims.js',import.meta.url).href;
 const code=`import {parentPort,workerData} from 'node:worker_threads';
  import {DatabaseSync} from 'node:sqlite';import {createD1FactoryClaims} from ${JSON.stringify(moduleUrl)};
  const db=new DatabaseSync(workerData.path);db.exec('PRAGMA busy_timeout=5000');
  const d1={prepare(sql){return {bind(...args){return {async run(){const r=db.prepare(sql).run(...args);return {success:true,meta:{changes:Number(r.changes)}};}};}};}};
  const flag=new Int32Array(workerData.gate);parentPort.postMessage('ready');Atomics.wait(flag,0,0);
  try{parentPort.postMessage(await createD1FactoryClaims(d1).recordTaskIdentity('op1',workerData.digest,workerData.id));}finally{db.close();}`;
 const workers=['task-a','task-b'].map(id=>new Worker(code,{eval:true,workerData:{path:f.path,gate:gate.buffer,id,digest}}));
 t.after(async()=>{await Promise.all(workers.map(w=>w.terminate()));});let ready=0;
 const results=workers.map(worker=>new Promise((resolve,reject)=>{let started=false;worker.on('error',reject);worker.on('message',message=>{
  if(!started){if(message!=='ready')return reject(Error('worker failed to initialize'));started=true;if(++ready===2){Atomics.store(gate,0,1);Atomics.notify(gate,0,2);}return;}resolve(message);
 });}));
 assert.equal((await Promise.all(results)).filter(Boolean).length,1);
 assert.ok(['task-a','task-b'].includes(f.b.prepare('SELECT external_task_id FROM factory_claim_slot').get().external_task_id));
});
