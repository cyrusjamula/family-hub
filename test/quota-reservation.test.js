import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {reserveAI} from '../src/quota.js';

function fixture(t){
 const folder=mkdtempSync(join(tmpdir(),'family-quota-'));
 const path=join(folder,'fixture.sqlite');
 const first=new DatabaseSync(path);const second=new DatabaseSync(path);
 first.exec(readFileSync(new URL('../migrations/0001.sql',import.meta.url),'utf8'));
 t.after(()=>{first.close();second.close();rmSync(folder,{recursive:true,force:true});});
 let pending=0,maxPending=0;
 const env=sql=>({DB:{prepare(query){return {bind:(...args)=>({async first(){
  pending++;maxPending=Math.max(maxPending,pending);
  try{await new Promise(resolve=>setImmediate(resolve));return sql.prepare(query).get(...args);}
  finally{pending--;}
 }})};}}});
 return {first,envs:[env(first),env(second)],stats:()=>({pending,maxPending})};
}

test('concurrent quota reservations stop at the shared daily limit and reset on UTC rollover',async t=>{
 const f=fixture(t);t.mock.timers.enable({apis:['Date'],now:Date.UTC(2026,0,1,23,59,59)});
 for(let i=0;i<78;i++)assert.equal(await reserveAI(f.envs[i%2]),true);
 const results=await Promise.all(Array.from({length:10},(_,i)=>reserveAI(f.envs[i%2])));
 assert.ok(f.stats().maxPending>=2,'multiple requests reached the storage boundary before any completed');
 assert.equal(results.filter(Boolean).length,2);assert.equal(results.filter(x=>!x).length,8);
 assert.equal(f.first.prepare('SELECT calls FROM usage WHERE day=?').get('2026-01-01').calls,80);
 assert.equal(await reserveAI(f.envs[0]),false);
 t.mock.timers.tick(1000);
 assert.equal(await reserveAI(f.envs[1]),true);
 assert.deepEqual(f.first.prepare('SELECT day,calls FROM usage ORDER BY day').all().map(row=>({...row})),[
  {day:'2026-01-01',calls:80},{day:'2026-01-02',calls:1}
 ]);
});

test('quota storage errors propagate instead of granting a reservation',async()=>{
 const env={DB:{prepare(){return {bind(){return {async first(){throw Error('synthetic storage unavailable');}};}};}}};
 await assert.rejects(reserveAI(env),/synthetic storage unavailable/);
});
