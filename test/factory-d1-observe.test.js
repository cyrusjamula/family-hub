import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {observeD1FactoryClaim} from '../src/factory-d1-observe.js';

const digest='a'.repeat(64);
const row={singleton:1,paused:1,state:'idle',operation_id:null,scope_digest:null};
const fake=result=>({prepare:()=>({all:async()=>result})});
const sqlite=db=>({prepare:sql=>({all:async()=>({success:true,results:db.prepare(sql).all()})})});

test('observes persisted states across independently reopened SQLite connections without writing',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'factory-observe-'));
 const path=join(dir,'claims.sqlite');
 let db=new DatabaseSync(path);
 try{
  db.exec(readFileSync(new URL('../scripts/factory-d1-schema.sql',import.meta.url),'utf8'));
  assert.deepEqual(await observeD1FactoryClaim(sqlite(db)),{paused:true,state:'idle',operationId:null,scopeDigest:null});
  db.prepare("UPDATE factory_claim_slot SET paused=0,state='claimed',operation_id=?,scope_digest=?").run('synthetic_operation',digest);
  db.close();
  db=new DatabaseSync(path);
  assert.deepEqual(await observeD1FactoryClaim(sqlite(db)),{paused:false,state:'claimed',operationId:'synthetic_operation',scopeDigest:digest});
  db.exec("UPDATE factory_claim_slot SET paused=1,state='uncertain'");
  const before=db.prepare('SELECT * FROM factory_claim_slot').get();
  assert.deepEqual(await observeD1FactoryClaim(sqlite(db)),{paused:true,state:'uncertain',operationId:'synthetic_operation',scopeDigest:digest});
  assert.deepEqual(db.prepare('SELECT * FROM factory_claim_slot').get(),before);
 }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});

test('fails closed on missing, malformed or impossible snapshots',async()=>{
 const invalid=[undefined,{success:false,results:[row]},{success:true,results:[]},{success:true,results:[row,row]},
  ...[{...row,singleton:2},{...row,paused:2},{...row,state:'unknown'},
   {...row,operation_id:'unexpected'}, {...row,state:'claimed'},
   {...row,state:'uncertain',operation_id:'bad space',scope_digest:digest},
   {...row,state:'claimed',operation_id:'valid',scope_digest:'bad'}].map(value=>({success:true,results:[value]}))];
 for(const value of invalid)await assert.rejects(observeD1FactoryClaim(fake(value)),/observation unavailable/);
 await assert.rejects(observeD1FactoryClaim({prepare(){throw Error('sensitive details');}}),error=>error.message==='Factory claim observation unavailable; preserve any existing lock');
 await assert.rejects(observeD1FactoryClaim(null),/observation unavailable/);
});
