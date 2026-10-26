import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {deliverDue} from '../src/reminders.js';

function fixture(t){
 const sql=new DatabaseSync(':memory:');
 t.after(()=>sql.close());
 for(const name of readdirSync(new URL('../migrations/',import.meta.url)).sort())sql.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
 let failSecond=false,inFlight=0,maxInFlight=0,transactionsStarted=0;
 const DB={prepare(query){return {bind:(...args)=>({query,args})};},async batch(statements){
  inFlight++;maxInFlight=Math.max(maxInFlight,inFlight);
  // Model the asynchronous D1 request boundary before the atomic transaction.
  await new Promise(resolve=>setImmediate(resolve));
  transactionsStarted++;sql.exec('BEGIN IMMEDIATE');
  try{for(const [i,s]of statements.entries()){if(failSecond&&i===1)throw Error('synthetic transaction failure');sql.prepare(s.query).run(...s.args);}sql.exec('COMMIT');}
  catch(error){sql.exec('ROLLBACK');throw error;}
  finally{inFlight--;}
 }};
 const put=(id,room,due,state='pending')=>sql.prepare('INSERT INTO reminders(id,owner,room,content,due,state) VALUES(?,?,?,?,?,?)').run(id,'owner@synthetic.test',room,'Synthetic '+id,due,state);
 return {sql,env:{DB},put,fail(value){failSecond=value;},stats(){return {inFlight,maxInFlight,transactionsStarted};}};
}
test('overlapping and repeated reminder ticks deliver due rooms once without early or cancelled delivery',async t=>{
 const f=fixture(t),now=Date.UTC(2026,9,25,12);
 f.put('family-due','family',now);f.put('parents-due','parents',now-1);f.put('future','family',now+1000);f.put('cancelled','parents',now-1000,'cancelled');
 const ticks=[deliverDue(f.env,now),deliverDue(f.env,now)];
 assert.deepEqual(f.stats(),{inFlight:2,maxInFlight:2,transactionsStarted:0},'Both batch requests must be pending before either transaction starts');
 await Promise.all(ticks);
 assert.deepEqual(f.stats(),{inFlight:0,maxInFlight:2,transactionsStarted:2});
 await deliverDue(f.env,now);
 const notices=()=>f.sql.prepare('SELECT id,room,content FROM notifications ORDER BY id').all().map(r=>({...r}));
 assert.deepEqual(notices(),[
  {id:'reminder:family-due',room:'family',content:'Synthetic family-due'},
  {id:'reminder:parents-due',room:'parents',content:'Synthetic parents-due'}
 ]);
 const states=Object.fromEntries(f.sql.prepare('SELECT id,state FROM reminders').all().map(r=>[r.id,r.state]));
 assert.deepEqual(states,{'family-due':'delivered','parents-due':'delivered',future:'pending',cancelled:'cancelled'});
 await deliverDue(f.env,now+1000);await deliverDue(f.env,now+1000);
 assert.equal(notices().length,3);assert.equal(f.sql.prepare('SELECT count(*) AS n FROM notifications WHERE id=?').get('reminder:cancelled').n,0);
});
test('failed reminder transaction leaves work pending and retry commits one matching notice',async t=>{
 const f=fixture(t),now=Date.UTC(2026,9,25,12);f.put('retry','parents',now);f.fail(true);
 await assert.rejects(deliverDue(f.env,now),/synthetic transaction failure/);
 assert.equal(f.sql.prepare('SELECT count(*) AS n FROM notifications').get().n,0);
 assert.equal(f.sql.prepare('SELECT state FROM reminders WHERE id=?').get('retry').state,'pending');
 f.fail(false);await deliverDue(f.env,now);await deliverDue(f.env,now);
 assert.equal(f.sql.prepare('SELECT count(*) AS n FROM notifications').get().n,1);
 assert.equal(f.sql.prepare('SELECT state FROM reminders WHERE id=?').get('retry').state,'delivered');
});
