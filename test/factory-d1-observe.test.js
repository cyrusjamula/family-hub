import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {observeD1FactoryClaim} from '../src/factory-d1-observe.js';

const digest='a'.repeat(64);
const row={singleton:1,paused:1,state:'idle',operation_id:null,scope_digest:null,external_task_id:null};
const fake=result=>({prepare:()=>({all:async()=>result})});
const sqlite=db=>({prepare:sql=>({all:async()=>({success:true,results:db.prepare(sql).all()})})});

test('observes persisted states across independently reopened SQLite connections without writing',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'factory-observe-'));
 const path=join(dir,'claims.sqlite');
 let db=new DatabaseSync(path);
 try{
  db.exec(readFileSync(new URL('../scripts/factory-d1-schema.sql',import.meta.url),'utf8'));
  assert.deepEqual(await observeD1FactoryClaim(sqlite(db)),{paused:true,state:'idle',operationId:null,scopeDigest:null,externalTaskId:null,cancelRequested:false});
  db.prepare("UPDATE factory_claim_slot SET paused=0,state='claimed',operation_id=?,scope_digest=?").run('synthetic_operation',digest);
  db.close();
  db=new DatabaseSync(path);
  assert.deepEqual(await observeD1FactoryClaim(sqlite(db)),{paused:false,state:'claimed',operationId:'synthetic_operation',scopeDigest:digest,externalTaskId:null,cancelRequested:false});
  db.exec("UPDATE factory_claim_slot SET paused=1,state='uncertain'");
  const before=db.prepare('SELECT * FROM factory_claim_slot').get();
  assert.deepEqual(await observeD1FactoryClaim(sqlite(db)),{paused:true,state:'uncertain',operationId:'synthetic_operation',scopeDigest:digest,externalTaskId:null,cancelRequested:false});
  assert.deepEqual(db.prepare('SELECT * FROM factory_claim_slot').get(),before);
 }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});

test('fails closed on missing, malformed or impossible snapshots',async()=>{
 const invalid=[undefined,{success:false,results:[row]},{success:true,results:[]},{success:true,results:[row,row]},
  ...[{...row,singleton:2},{...row,paused:2},{...row,cancel_requested:2},{...row,cancel_requested:1},{...row,state:'unknown'},
   {...row,operation_id:'unexpected'}, {...row,state:'claimed'},
   {...row,state:'uncertain',operation_id:'bad space',scope_digest:digest},
   {...row,state:'claimed',operation_id:'valid',scope_digest:'bad'}].map(value=>({success:true,results:[value]}))];
 for(const value of invalid)await assert.rejects(observeD1FactoryClaim(fake(value)),/observation unavailable/);
 await assert.rejects(observeD1FactoryClaim({prepare(){throw Error('sensitive details');}}),error=>error.message==='Factory claim observation unavailable; preserve any existing lock');
 await assert.rejects(observeD1FactoryClaim(null),/observation unavailable/);
});

test('fails closed when a damaged table contains an extra non-singleton row',async()=>{
 const db=new DatabaseSync(':memory:');
 try{
  db.exec('CREATE TABLE factory_claim_slot (singleton INTEGER, paused INTEGER, state TEXT, operation_id TEXT, scope_digest TEXT, external_task_id TEXT, cancel_requested INTEGER)');
  db.prepare('INSERT INTO factory_claim_slot VALUES (?,?,?,?,?,?,?)').run(1,0,'idle',null,null,null,0);
  db.prepare('INSERT INTO factory_claim_slot VALUES (?,?,?,?,?,?,?)').run(2,0,'claimed','synthetic_operation',digest,null,0);
  await assert.rejects(observeD1FactoryClaim(sqlite(db)),/observation unavailable/);
 }finally{db.close();}
});


test('rejects malformed task identities and idle identities without modifying persisted rows',async()=>{
 const db=new DatabaseSync(':memory:');
 try{
  db.exec('CREATE TABLE factory_claim_slot (singleton INTEGER, paused INTEGER, state TEXT, operation_id TEXT, scope_digest TEXT, external_task_id TEXT, cancel_requested INTEGER)');
  for(const [state,taskId] of [['idle','task_1'],['claimed','bad space'],['uncertain',''],['claimed','x'.repeat(129)]]){
   db.exec('DELETE FROM factory_claim_slot');
   db.prepare('INSERT INTO factory_claim_slot VALUES (1,0,?,?,?,?,0)').run(state,state==='idle'?null:'operation',state==='idle'?null:digest,taskId);
   const before=db.prepare('SELECT * FROM factory_claim_slot').get();
   await assert.rejects(observeD1FactoryClaim(sqlite(db)),/observation unavailable/);
   assert.deepEqual(db.prepare('SELECT * FROM factory_claim_slot').get(),before);
  }
  for(const state of ['claimed','uncertain'])for(const taskId of [null,'task_1','x'.repeat(128)]){
   db.exec('DELETE FROM factory_claim_slot');
   db.prepare('INSERT INTO factory_claim_slot VALUES (1,0,?,?,?,?,0)').run(state,'operation',digest,taskId);
   assert.equal((await observeD1FactoryClaim(sqlite(db))).state,state);
  }
 }finally{db.close();}
});

test('fails closed when the external task identity column or result field is missing',async()=>{
 const db=new DatabaseSync(':memory:');
 try{
  db.exec("CREATE TABLE factory_claim_slot (singleton INTEGER, paused INTEGER, state TEXT, operation_id TEXT, scope_digest TEXT); INSERT INTO factory_claim_slot VALUES (1,0,'idle',NULL,NULL)");
  await assert.rejects(observeD1FactoryClaim(sqlite(db)),/observation unavailable/);
  const {external_task_id,...missing}=row;
  await assert.rejects(observeD1FactoryClaim(fake({success:true,results:[missing]})),/observation unavailable/);
  await assert.rejects(observeD1FactoryClaim(fake({success:true,results:[{...missing,state:'claimed',operation_id:'operation',scope_digest:digest}]})),/observation unavailable/);
 }finally{db.close();}
});
