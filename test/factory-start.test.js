import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createFactoryStart} from '../scripts/factory-start.mjs';

const scopeDigest='a'.repeat(64),operationId='synthetic_operation';
const taskId='11111111-1111-4111-8111-111111111111';
const input={operationId,scopeDigest,prompt:'Synthetic approved public-source task',model:'gpt-5.4'};
const root='https://api.github.com/agents/repos/cyrusjamula/family-hub/tasks';
const wrap=db=>({prepare(sql){return {all:async()=>({success:true,results:db.prepare(sql).all()}),bind(...values){return {run:async()=>({success:true,meta:{changes:Number(db.prepare(sql).run(...values).changes)}})};}};}});
const response=()=>({id:taskId,repository:{id:1431589772},url:root+'/'+taskId,state:'queued',session_count:1});
function fixture(t){
 const sql=new DatabaseSync(':memory:');t.after(()=>sql.close());sql.exec(readFileSync(new URL('../scripts/factory-d1-schema.sql',import.meta.url),'utf8'));sql.exec('UPDATE factory_claim_slot SET paused=0');
 const calls=[];const db=wrap(sql);
 const send=async(url,options)=>{calls.push({url,options});return options.method==='GET'?Response.json({tasks:[],total_active_count:0,total_archived_count:0}):Response.json(response(),{status:201});};
 const authorizeDispatch=async(session,request)=>{assert.equal(Object.isFrozen(request),true);return session==='owner'&&request.operationId===operationId&&request.scopeDigest===scopeDigest&&request.prompt===input.prompt&&request.model===input.model&&request.baseRef==='main'&&request.createPullRequest===true;};
 return {sql,db,calls,config:{enabled:true,db,token:'synthetic-token',send,authorizeDispatch},row:()=>({...sql.prepare('SELECT * FROM factory_claim_slot').get()}),posts:()=>calls.filter(c=>c.options.method==='POST')};
}

test('default-off starter has no storage, credential or provider requirement',async()=>{
 assert.deepEqual(await createFactoryStart().dispatch('owner',input),{state:'blocked',started:false});
});
test('trusted exact payload authorization precedes all provider reads and rejects tampered scope content',async t=>{
 const f=fixture(t),controller=createFactoryStart(f.config);
 for(const [session,request] of [['other',input],['owner',{...input,prompt:'Changed prompt with same digest'}],['owner',{...input,model:'other'}],['owner',{...input,head_ref:'existing'}],['owner',{...input,scopeDigest:'b'.repeat(64)}]])assert.equal((await controller.dispatch(session,request)).state,'blocked');
 assert.equal(f.calls.length,0);assert.equal(f.row().state,'idle');
});
test('real provider composition persists uncertainty before exactly one POST and records returned identity',async t=>{
 const f=fixture(t),send=f.config.send;
 f.config.send=async(url,options)=>{if(options.method==='POST'){assert.equal(f.row().state,'uncertain');assert.equal(f.row().external_task_id,null);assert.equal(url,root);assert.equal(options.redirect,'manual');assert.deepEqual(JSON.parse(options.body),{prompt:input.prompt,model:input.model,base_ref:'main',create_pull_request:true});}return send(url,options);};
 assert.deepEqual(await createFactoryStart(f.config).dispatch('owner',input),{state:'recorded',started:true,taskId});
 assert.equal(f.row().external_task_id,taskId);assert.equal(f.row().state,'uncertain');assert.equal(f.posts().length,1);
 assert.equal((await createFactoryStart(f.config).dispatch('owner',input)).state,'blocked');assert.equal(f.posts().length,1);
});
test('queued task with zero sessions retains the accepted immutable identity',async t=>{
 const f=fixture(t),send=f.config.send;let posts=0;
 f.config.send=async(url,options)=>{if(options.method==='GET')return send(url,options);posts++;return Response.json({...response(),session_count:0},{status:201});};
 const controller=createFactoryStart(f.config);
 assert.deepEqual(await controller.dispatch('owner',input),{state:'recorded',started:true,taskId});
 assert.equal(f.row().external_task_id,taskId);assert.equal(f.row().state,'uncertain');
 await controller.dispatch('owner',input);assert.equal(posts,1);
});
test('optional counts do not invent a minimum and uncertain metadata cannot discard verified identity',async t=>{
 for(const variant of ['omitted','zero-terminal','negative','string','unknown-state']){
  const f=fixture(t),send=f.config.send;const task=response();
  if(variant==='omitted')delete task.session_count;
  if(variant==='zero-terminal'){task.session_count=0;task.state='completed';}
  if(variant==='negative')task.session_count=-1;if(variant==='string')task.session_count='0';if(variant==='unknown-state')task.state='unknown';
  f.config.send=async(url,options)=>options.method==='GET'?send(url,options):Response.json(task,{status:201});
  const result=await createFactoryStart(f.config).dispatch('owner',input);
  assert.deepEqual(result,{state:['omitted','zero-terminal'].includes(variant)?'recorded':'uncertain',started:true,taskId},variant);
  assert.equal(f.row().external_task_id,taskId);assert.equal(f.row().state,'uncertain');
 }
});
test('independent connections and concurrent controllers start only one task',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'factory-start-')),path=join(dir,'claims.db');const a=new DatabaseSync(path),b=new DatabaseSync(path);
 t.after(()=>{a.close();b.close();rmSync(dir,{recursive:true,force:true});});a.exec(readFileSync(new URL('../scripts/factory-d1-schema.sql',import.meta.url),'utf8'));a.exec('UPDATE factory_claim_slot SET paused=0');let posts=0;
 const send=async(url,options)=>{if(options.method==='GET')return Response.json({tasks:[]});posts++;return Response.json(response(),{status:201});};
 const config={enabled:true,token:'synthetic-token',send,authorizeDispatch:async()=>true};
 const results=await Promise.all([createFactoryStart({...config,db:wrap(a)}).dispatch('owner',input),createFactoryStart({...config,db:wrap(b)}).dispatch('owner',input)]);
 assert.equal(posts,1);assert.equal(results.filter(r=>r.started===true).length,1);assert.equal(a.prepare('SELECT state FROM factory_claim_slot').get().state,'uncertain');
});
test('active provider work and failed inventory never reserve or start another task',async t=>{
 for(const failure of ['active','denied']){
  const f=fixture(t);f.config.send=async url=>failure==='denied'?new Response(null,{status:403}):Response.json({tasks:url.includes('is_archived=true')?[]:[{...response(),state:'in_progress'}]});
  assert.equal((await createFactoryStart(f.config).dispatch('owner',input)).state,'blocked');assert.equal(f.row().state,'idle');
 }
});
test('revoked dispatch authority, pause and cancellation before transport prevent POST without releasing the lock',async t=>{
 for(const failure of ['revoked','pause','cancel']){
  const f=fixture(t);let checks=0;f.config.authorizeDispatch=async()=>{checks++;if(checks===3){if(failure==='revoked')return false;f.sql.exec(failure==='pause'?'UPDATE factory_claim_slot SET paused=1':'UPDATE factory_claim_slot SET cancel_requested=1');}return true;};
  assert.equal((await createFactoryStart(f.config).dispatch('owner',input)).state,'blocked');assert.equal(f.posts().length,0);assert.equal(f.row().state,'uncertain');
 }
});
test('ambiguous writes and malformed provider responses retain uncertainty and never retry',async t=>{
 for(const failure of ['network','redirect','wrong-repo','wrong-url','oversize','timeout']){
  const f=fixture(t),send=f.config.send;f.config.timeoutMs=100;let posts=0;
  f.config.send=async(url,options)=>{if(options.method==='GET')return send(url,options);posts++;
   if(failure==='network')throw Error('sensitive diagnostics');if(failure==='timeout')return new Promise(()=>{});if(failure==='redirect')return new Response(null,{status:302});
   const task=response();if(failure==='wrong-repo')task.repository.id=1;if(failure==='wrong-url')task.url='https://evil.test';if(failure==='oversize')task.padding='x'.repeat(131072);return Response.json(task,{status:201});};
  const controller=createFactoryStart(f.config),result=await controller.dispatch('owner',input);
  assert.deepEqual(result,{state:'uncertain',started:null},failure);assert.equal(f.row().state,'uncertain');assert.equal(f.row().external_task_id,null);
  await controller.dispatch('owner',input);assert.equal(posts,1);assert.equal(JSON.stringify(result).includes('sensitive'),false);
 }
});
test('pause/cancellation after final gate cannot erase accepted identity or permit a duplicate start',async t=>{
 const f=fixture(t),send=f.config.send;f.config.send=async(url,options)=>{if(options.method==='POST')f.sql.exec('UPDATE factory_claim_slot SET paused=1,cancel_requested=1');return send(url,options);};
 const controller=createFactoryStart(f.config);assert.equal((await controller.dispatch('owner',input)).state,'recorded');assert.equal(f.row().external_task_id,taskId);assert.equal(f.row().paused,1);assert.equal(f.row().cancel_requested,1);
 await controller.dispatch('owner',input);assert.equal(f.posts().length,1);
});
test('identity storage failure returns accepted task identity for trusted recovery and retains lock',async t=>{
 const f=fixture(t),prepare=f.db.prepare;f.db.prepare=sql=>{if(sql.startsWith('UPDATE factory_claim_slot SET external_task_id'))throw Error('storage unavailable');return prepare(sql);};
 assert.deepEqual(await createFactoryStart(f.config).dispatch('owner',input),{state:'uncertain',started:true,taskId});assert.equal(f.row().state,'uncertain');assert.equal(f.row().external_task_id,null);assert.equal(f.posts().length,1);
});
