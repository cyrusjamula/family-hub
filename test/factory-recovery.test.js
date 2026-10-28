import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createFactoryRecovery} from '../scripts/factory-recovery.mjs';
import {createD1FactoryClaims} from '../src/factory-d1-claims.js';

const scopeDigest='a'.repeat(64),operationId='synthetic_operation';
const taskId='11111111-1111-4111-8111-111111111111';
const args={operationId,scopeDigest};
const wrap=db=>({prepare(sql){return {all:async()=>({success:true,results:db.prepare(sql).all()}),bind(...values){return {run:async()=>({success:true,meta:{changes:Number(db.prepare(sql).run(...values).changes)}})};}};}});
function fixture(t){
 const sql=new DatabaseSync(':memory:');t.after(()=>sql.close());
 sql.exec(readFileSync(new URL('../scripts/factory-d1-schema.sql',import.meta.url),'utf8'));
 sql.prepare("UPDATE factory_claim_slot SET paused=0,state='uncertain',operation_id=?,scope_digest=?,external_task_id=?").run(operationId,scopeDigest,taskId);
 const db=wrap(sql),calls=[];
 let state='completed',sessionState='completed';
 const send=async(url,options)=>{calls.push({url,options});return Response.json({id:taskId,state,repository:{id:1431589772},url:'https://api.github.com/agents/repos/cyrusjamula/family-hub/tasks/'+taskId,
  session_count:1,sessions:[{id:'synthetic-session',task_id:taskId,repository:{id:1431589772},state:sessionState}]});};
 const config={enabled:true,db,token:'synthetic-token',send,verifyTaskCorrelation:async x=>x.operationId===operationId&&x.scopeDigest===scopeDigest&&x.taskId===taskId,authorizeRecovery:async(session,request)=>session==='owner'&&request.operationId===operationId&&request.scopeDigest===scopeDigest};
 return {sql,db,calls,config,setState(a,b=a){state=a;sessionState=b;},row:()=>({...sql.prepare('SELECT * FROM factory_claim_slot').get()})};
}

test('disabled recovery requires no credentials, storage or provider access',async()=>{
 const result=await createFactoryRecovery({}).reconcile('owner',args);
 assert.deepEqual(result,{released:false,dispatchEnabled:false,state:'blocked'});
});

test('joins persisted task identity to the bounded real reader and releases only to paused idle',async t=>{
 const f=fixture(t),controller=createFactoryRecovery(f.config);
 const result=await controller.reconcile('owner',args);
 assert.deepEqual(result,{released:true,dispatchEnabled:false,state:'paused'});
 assert.deepEqual(f.row(),{singleton:1,paused:1,state:'idle',operation_id:null,scope_digest:null,external_task_id:null,cancel_requested:0});
 assert.equal(await createD1FactoryClaims(f.db).claim('other',scopeDigest),false);
 assert.equal(f.calls.length,1);assert.equal(f.calls[0].options.method,'GET');
 assert.equal(f.calls[0].url,'https://api.github.com/agents/repos/cyrusjamula/family-hub/tasks/'+taskId);
 assert.equal((await controller.reconcile('owner',args)).released,false);assert.equal(f.calls.length,1);
});

test('unknown start identity and mismatched operation/scope never read the provider or release',async t=>{
 const f=fixture(t),controller=createFactoryRecovery(f.config);
 for(const [session,input] of [['other',args],['owner',{...args,scopeDigest:'b'.repeat(64)}],['owner',{...args,operationId:'other'}],['owner',{...args,operationId:{}}]]){
  assert.equal((await controller.reconcile(session,input)).released,false);
 }
 f.sql.exec('UPDATE factory_claim_slot SET external_task_id=NULL');
 assert.equal((await controller.reconcile('owner',args)).released,false);
 assert.equal(f.calls.length,0);assert.equal(f.row().state,'uncertain');
});

test('nonterminal, contradictory, denied and invalid provider reads keep the lock paused',async t=>{
 const f=fixture(t);
 for(const [a,b] of [['in_progress','in_progress'],['completed','in_progress'],['unknown','completed']]){
  f.setState(a,b);assert.equal((await createFactoryRecovery(f.config).reconcile('owner',args)).released,false);
  assert.equal(f.row().state,'uncertain');assert.equal(f.row().paused,1);
 }
 for(const send of [async()=>new Response('',{status:403}),async()=>{throw Error('private provider diagnostic');},async()=>Response.json({})]){
  const result=await createFactoryRecovery({...f.config,send}).reconcile('owner',args);
  assert.deepEqual(result,{released:false,dispatchEnabled:false,state:'blocked'});
  assert.equal(f.row().external_task_id,taskId);
 }
});

test('revocation during provider inspection prevents release',async t=>{
 const f=fixture(t);let authorizations=0;
 const controller=createFactoryRecovery({...f.config,authorizeRecovery:async()=>++authorizations===1});
 assert.equal((await controller.reconcile('owner',args)).released,false);
 assert.equal(authorizations,2);assert.equal(f.row().state,'uncertain');
});

test('a cancellation arriving during provider inspection cannot be overwritten by a stale release',async t=>{
 const f=fixture(t);const send=async(...a)=>{await createD1FactoryClaims(f.db).requestCancellation(operationId,scopeDigest);return f.config.send(...a);};
 assert.equal((await createFactoryRecovery({...f.config,send}).reconcile('owner',args)).released,false);
 assert.equal(f.row().cancel_requested,1);assert.equal(f.row().state,'uncertain');
 // Fresh reconciliation can observe terminal evidence for that exact intent.
 assert.equal((await createFactoryRecovery(f.config).reconcile('owner',args)).released,true);
});

test('concurrent reconcilers have one release winner and cannot reopen dispatch',async t=>{
 const f=fixture(t);let release;const gate=new Promise(r=>release=r);let arrivals=0;
 const send=async(...args)=>{if(++arrivals===2)release();await gate;return f.config.send(...args);};
 const controller=createFactoryRecovery({...f.config,send});
 const results=await Promise.all([controller.reconcile('owner',args),controller.reconcile('owner',args)]);
 assert.equal(results.filter(x=>x.released).length,1);assert.equal(f.row().paused,1);
});

test('storage write ambiguity never reports a successful recovery',async t=>{
 const f=fixture(t),base=f.db;
 const db={prepare(sql){if(sql.includes("SET state='idle'"))return {bind:()=>({run:async()=>({success:true,meta:{changes:2}})})};return base.prepare(sql);}};
 assert.equal((await createFactoryRecovery({...f.config,db}).reconcile('owner',args)).released,false);
 assert.equal(f.row().state,'uncertain');
});

test('persisted identity alone is not authoritative task-to-operation correlation',async t=>{
 const f=fixture(t);
 assert.equal((await createFactoryRecovery({...f.config,verifyTaskCorrelation:async()=>false}).reconcile('owner',args)).released,false);
 assert.equal(f.calls.length,0);assert.equal(f.row().state,'uncertain');
 let confirmations=0;
 assert.equal((await createFactoryRecovery({...f.config,verifyTaskCorrelation:async()=>++confirmations===1}).reconcile('owner',args)).released,false);
 assert.equal(confirmations,2);assert.equal(f.row().state,'uncertain');
});
