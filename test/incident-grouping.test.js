import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {diagnosticsAPI} from '../src/telemetry.js';
import {member,people} from '../src/policy.js';
test('owner lookup groups only matching retained events without disclosing other categories or versions',async()=>{
 const sql=new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('../migrations/0008_diagnostics.sql',import.meta.url),'utf8'));
 const now=Date.now(),id=crypto.randomUUID(),insert=sql.prepare('INSERT INTO diagnostics VALUES(?,?,?,?,?,?,?,?)');
 const add=(key,time,route='/api/chat',category='service_error',release='abcdef0')=>insert.run(key,time,route,'POST',503,1,category,release);
 add(id,now-1000);add(crypto.randomUUID(),now);add(crypto.randomUUID(),now-8*86400000);add(crypto.randomUUID(),now,'/api/google/status');add(crypto.randomUUID(),now,'/api/chat','unhandled');add(crypto.randomUUID(),now,'/api/chat','service_error','fedcba0');
 const env={TELEMETRY_ENABLED:'true',DB:{prepare:q=>({bind:(...args)=>({first:async()=>sql.prepare(q).get(...args)})})}};
 try{const request=new Request('https://hub.test/api/diagnostics?id='+id);const res=await diagnosticsAPI(request,env,member(people.cyrus.email));assert.equal(res.status,200);const data=await res.json();assert.equal(data.id,id);assert.deepEqual(data.incident,{occurrences:2,first_seen:now-1000,last_seen:now});assert.equal(res.headers.get('cache-control'),'no-store');assert.equal((await diagnosticsAPI(request,{...env,DB:{prepare(){throw Error('Must not read');}}},member(people.iyanah.email))).status,403);}finally{sql.close();}
});
test('incident grouping failure preserves the individual diagnostic',async()=>{
 const id=crypto.randomUUID(),row={id,created:Date.now(),route:'/api/chat',method:'POST',status:503,duration_ms:1,category:'service_error',release:'unknown'};
 const env={TELEMETRY_ENABLED:'true',DB:{prepare:q=>({bind:()=>({first:async()=>{if(q.includes('count(*)'))throw Error('grouping unavailable');return row;}})})}};
 const response=await diagnosticsAPI(new Request('https://hub.test/api/diagnostics?id='+id),env,member(people.cyrus.email));assert.equal(response.status,200);assert.deepEqual(await response.json(),{...row,incident:null});
});
