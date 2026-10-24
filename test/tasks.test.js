import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {taskAPI,taskOptions} from '../src/tasks.js';
import {people,member,directory} from '../src/policy.js';
const owner=member(people.cyrus.email),parent=member(people.anhaita.email),child=member(people.iyanah.email),otherChild=member(people.aarish.email);
const req=(path,body)=>new Request('https://hub.test/api/tasks'+path,body===undefined?{}:{method:'POST',headers:{origin:'https://hub.test','content-type':'application/json'},body:JSON.stringify(body)});
function fixture(){const sql=new DatabaseSync(':memory:');for(const f of readdirSync(new URL('../migrations/',import.meta.url)).sort())sql.exec(readFileSync(new URL('../migrations/'+f,import.meta.url),'utf8'));const env={DB:{prepare:q=>{const bound=(args=[])=>({first:async()=>sql.prepare(q).get(...args)??null,all:async()=>({results:sql.prepare(q).all(...args)}),run:async()=>sql.prepare(q).run(...args)});return {...bound(),bind:(...a)=>bound(a)};}}};return {sql,env,api:(path,body,user=owner)=>taskAPI(req(path,body),env,user)};}
const draft=(patch={})=>({id:crypto.randomUUID(),title:'Synthetic Seoul layover research',details:'Find two free activities; no booking.',assignee:'iyanah',assistant:'copilot_iyanah',provenance:'Synthetic trip brief; verify official sources.',approvalRequired:true,confirmRoomVisibility:true,...patch});
test('real task storage preserves stable ownership, room, source, assistant, approval and completion evidence',async()=>{
 const {sql,api}=fixture();try{const body=draft();const created=await api('/create?room=family',body,child);assert.equal(created.status,201);const task=await created.json();assert.equal(task.creator_id,child.id);assert.equal(task.assignee_id,child.id);assert.equal(task.approval,'requested');assert.equal(task.source,'hub');assert.equal(task.provenance,body.provenance);
 assert.equal((await api('/update?room=family',{id:body.id,version:1,action:'status',status:'done',resultNote:'Checked sources'},child)).status,409);
 assert.equal((await api('/update?room=family',{id:body.id,version:1,action:'approve'},child)).status,403);
 const approval=await api('/update?room=family',{id:body.id,version:1,action:'approve'});assert.equal(approval.status,200);
 assert.equal((await api('/update?room=family',{id:body.id,version:2,action:'status',status:'done'},child)).status,400);
 const done=await (await api('/update?room=family',{id:body.id,version:2,action:'status',status:'done',resultNote:'Compared two synthetic official sources; owner reviewed.'},child)).json();assert.equal(done.status,'done');assert.equal(done.version,3);assert.equal(done.updated_by,child.id);assert.equal(done.decided_by,owner.id);assert.match(done.result_note,/owner reviewed/);
 assert.equal((await api('/update?room=family',{id:body.id,version:3,action:'status',status:'working'},child)).status,409);
 }finally{sql.close();}
});
test('children cannot read/write Parents tasks or receive parent task handoffs',async()=>{
 const {sql,api}=fixture();try{for(const user of [child,otherChild])for(const [path,body]of [['?room=parents',undefined],['/create?room=parents',draft()],['/update?room=parents',{id:crypto.randomUUID(),version:1,action:'approve'}]])assert.equal((await api(path,body,user)).status,403);
 assert.equal((await api('/create?room=parents',draft({assignee:'cyrus',assistant:'copilot_iyanah'}),owner)).status,400);assert.equal((await api('/create?room=parents',draft({assignee:'iyanah',assistant:'human'}),owner)).status,400);
 assert.equal(taskOptions(owner,'parents').members.some(p=>p.id==='iyanah'),false);assert.equal(taskOptions(owner,'parents').assistants.some(p=>p.id==='copilot_aarish'),false);
 const privateTask=draft({assignee:'anhaita',assistant:'copilot_anhaita',details:'PARENTS_ONLY_SYNTHETIC'});assert.equal((await api('/create?room=parents',privateTask,parent)).status,201);
 const family=await (await api('?room=family',undefined,child)).json();assert.equal(JSON.stringify(family).includes('PARENTS_ONLY_SYNTHETIC'),false);assert.equal((await api('/update?room=family',{id:privateTask.id,version:1,action:'status',status:'working'},child)).status,404);
 }finally{sql.close();}
});
test('same task retries and approved aliases are idempotent; altered payload and cross-person IDs do not overwrite',async()=>{
 const {sql,api}=fixture();try{const body=draft();const responses=await Promise.all(Array.from({length:4},()=>api('/create?room=family',body,child)));assert.ok(responses.every(r=>[200,201].includes(r.status)));assert.equal(sql.prepare('SELECT count(*) AS n FROM tasks').get().n,1);
 const alias=directory('{"task.alias@example.test":"iyanah"}').resolve('task.alias@example.test');assert.equal((await api('/create?room=family',body,alias)).status,200);assert.equal((await api('/create?room=family',{...body,title:'Changed'},child)).status,409);assert.equal((await api('/create?room=family',body,otherChild)).status,409);
 }finally{sql.close();}
});
test('optimistic versions stop concurrent updates, other family members cannot update, and approval cannot be forged',async()=>{
 const {sql,api}=fixture();try{const body=draft({assignee:'anhaita',assistant:'human'});await api('/create?room=family',body,child);assert.equal((await api('/update?room=family',{id:body.id,version:1,action:'status',status:'working'},otherChild)).status,403);
 const results=await Promise.all(['approve','reject'].map(action=>api('/update?room=family',{id:body.id,version:1,action})));assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);assert.equal(sql.prepare('SELECT version FROM tasks').get().version,2);
 assert.equal((await api('/create?room=family',draft({confirmRoomVisibility:false}),child)).status,400);
 }finally{sql.close();}
});
test('daily cap is atomic, existing retries stay available and no provider is invoked',async()=>{
 const {sql,api}=fixture(),original=globalThis.fetch;globalThis.fetch=()=>{throw Error('No external provider calls allowed');};try{
 const bodies=Array.from({length:21},()=>draft());const res=await Promise.all(bodies.map(b=>api('/create?room=family',b,child)));assert.equal(res.filter(r=>r.status===201).length,20);assert.equal(res.filter(r=>r.status===429).length,1);assert.equal(sql.prepare('SELECT count(*) AS n FROM tasks').get().n,20);assert.equal((await api('/create?room=family',bodies[0],child)).status,200);
 }finally{globalThis.fetch=original;sql.close();}
});
test('unknown identity, forged role, invalid room and cross-origin requests deny before storage',async()=>{
 const env={DB:{prepare(){throw Error('No storage access permitted');}}};for(const user of [null,{...child,role:'owner'},{...child,email:'unknown@example.test'}])assert.equal((await taskAPI(req(''),env,user)).status,403);
 assert.equal((await taskAPI(req('?room=other'),env,owner)).status,403);assert.equal((await taskAPI(new Request('https://hub.test/api/tasks/create',{method:'POST',headers:{origin:'https://evil.test','content-type':'application/json'},body:'{}'}),env,owner)).status,403);
});

test('all retained tasks remain reachable across cursor pages, including shared timestamps and completed work',async()=>{
 const {sql,api}=fixture();try{
  const expected=new Set();for(let i=0;i<101;i++){const id=crypto.randomUUID();expected.add(id);sql.prepare('INSERT INTO tasks(id,room,creator_id,assignee_id,assistant,title,details,source,provenance,approval_required,approval,status) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(id,'family',child.id,child.id,'human','Synthetic '+i,'Fixture only','hub','Synthetic',0,'not_required',i%2?'done':'todo');}
  let cursor=null;const seen=[];do{const page=await (await api('?room=family&state=all'+(cursor?'&cursor='+encodeURIComponent(cursor):''),undefined,child)).json();seen.push(...page.tasks.map(t=>t.id));cursor=page.nextCursor;}while(cursor);assert.equal(seen.length,101);assert.deepEqual(new Set(seen),expected);
  assert.equal((await api('?room=family&cursor='+encodeURIComponent("bad' OR 1=1"),undefined,child)).status,400);
 }finally{sql.close();}
});
