import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Worker} from 'node:worker_threads';
import {FactoryStore} from '../scripts/factory-store.mjs';
import {createSimulationController} from '../scripts/factory-dispatch.mjs';
import {issueScopeDigest} from '../scripts/factory-plan.mjs';
const timestamp=Date.parse('2026-10-25T12:00:00Z');
function fixture(number=1){
 const issue={number,title:'Synthetic task',state:'open',labels:['agent-ready'],body:'## Scope\nSynthetic change.\n## Acceptance checks\n- [ ] Observable behavior.\n## Regression tests\n- [ ] Test failure.\n## Files\npublic/synthetic.js\n## Depends on\nNone',comments:[]};
 issue.comments=[{author:{login:'cyrusjamula'},body:'/factory approve '+issueScopeDigest(issue),created_at:new Date(timestamp-1000).toISOString()}];return issue;
}
function setup(t){
 const dir=mkdtempSync(join(tmpdir(),'factory-simulation-')),path=join(dir,'state.sqlite');const store=new FactoryStore(path);
 t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true});});
 const issue=fixture(),snapshot={repository:'cyrusjamula/family-hub',issues:[issue],active:[]};
 const calls={start:0,inspect:0,cancel:0};
 const adapter={mode:'simulation',start:async()=>{calls.start++;return {externalId:'mock-run'};},inspect:async()=>{calls.inspect++;return {state:'running',externalId:'mock-run'};},cancel:async()=>{calls.cancel++;}};
 const gates={activation:true,entitlement:true,budget:true,sourceAudit:true,expiresAt:timestamp+100000};
 const controller=(options={})=>createSimulationController({store,readSimulationSnapshot:async()=>structuredClone(snapshot),simulationAdapter:adapter,readSimulationGates:()=>gates,now:()=>timestamp,...options});
 return {path,store,issue,snapshot,calls,adapter,gates,controller};
}
test('simulation defaults paused; omitted prerequisites and missing adapter dispatch nothing',async t=>{
 const f=setup(t);assert.equal((await f.controller().dispatch(1)).blocked,'paused');f.store.setPaused(false);
 assert.match((await f.controller({readSimulationGates:()=>({})}).dispatch(1)).blocked,/prerequisites/);
 assert.match((await f.controller({simulationAdapter:undefined}).dispatch(1)).blocked,/adapter/);
 for(const key of ['activation','entitlement','budget','sourceAudit']){const gates={...f.gates,[key]:false};assert.match((await f.controller({readSimulationGates:()=>gates}).dispatch(1)).blocked,/prerequisites/);}
 assert.match((await f.controller({readSimulationGates:()=>({...f.gates,expiresAt:timestamp})}).dispatch(1)).blocked,/expired/);assert.equal(f.calls.start,0);
});
test('planner gates block forged/stale/changed approvals, dependencies and protected scopes',async t=>{
 const mutations=[i=>i.comments=[],i=>i.comments[0].author.login='other',i=>i.comments[0].created_at='2020-01-01',i=>i.comments[0].created_at='2030-01-01',i=>i.title+='edited',i=>i.body=i.body.replace('None','#2'),i=>{i.body=i.body.replace('public/synthetic.js','src/policy.js');i.comments[0].body='/factory approve '+issueScopeDigest(i);},i=>i.labels=[]];
 for(const mutate of mutations){const f=setup(t);f.store.setPaused(false);mutate(f.issue);await f.controller().dispatch(1);assert.equal(f.calls.start,0);}
 const f=setup(t);f.store.setPaused(false);f.snapshot.repository='attacker/repo';await assert.rejects(f.controller().dispatch(1));assert.equal(f.calls.start,0);
});
test('readiness is read again after claiming; scope edits or pause prevent start',async t=>{
 for(const changed of ['scope','pause','revoke']){const f=setup(t);f.store.setPaused(false);let reads=0;
 const c=f.controller({readSimulationSnapshot:async()=>{if(++reads===2){if(changed==='scope')f.issue.title+='edit';if(changed==='pause')f.store.setPaused(true);if(changed==='revoke')f.gates.activation=false;}return structuredClone(f.snapshot);}});
 const r=await c.dispatch(1);assert.equal(f.calls.start,0);assert.equal(r.run.state,'abandoned');}
});
test('uncertain is committed before start; exception and restart never automatically retry',async t=>{
 const f=setup(t);f.store.setPaused(false);f.adapter.start=async({operationId})=>{f.calls.start++;const observer=new FactoryStore(f.path);try{assert.equal(observer.get(operationId).state,'uncertain');}finally{observer.close();}throw Error('response lost');};
 const r=await f.controller().dispatch(1);assert.equal(r.run.state,'uncertain');assert.equal(f.calls.start,1);
 const observer=new FactoryStore(f.path);t.after(()=>observer.close());const c=f.controller({store:observer});await c.dispatch(1);assert.equal(f.calls.start,1);assert.equal(observer.active().length,1);
 f.adapter.inspect=async()=>({state:'not-started',verifiedAbsent:true});assert.equal((await c.reconcile(r.run.id)).state,'abandoned');assert.equal((await c.dispatch(1)).blocked,'duplicate scope');
});
test('timeout retains uncertain claim and another issue cannot start',async t=>{
 const f=setup(t);f.store.setPaused(false);f.adapter.start=()=>{f.calls.start++;return new Promise(()=>{});};
 const r=await f.controller({timeoutMs:5}).dispatch(1);assert.equal(r.run.state,'uncertain');
 f.snapshot.issues.push(fixture(2));await f.controller().dispatch(2);assert.equal(f.calls.start,1);
});
test('a late start response cannot replace an already reconciled provider identity',async t=>{
 const f=setup(t);f.store.setPaused(false);let finishStart,notifyStart;const started=new Promise(resolve=>{notifyStart=resolve;});
 f.adapter.start=()=>{f.calls.start++;notifyStart();return new Promise(resolve=>{finishStart=resolve;});};
 const c=f.controller(),dispatch=c.dispatch(1);await started;
 const id=f.store.active()[0].id;await c.cancel(id);
 const cancelled=[];f.adapter.inspect=async()=>({state:'running',externalId:'run-A'});f.adapter.cancel=async({externalId})=>cancelled.push(externalId);
 assert.equal((await c.reconcile(id)).external_id,'run-A');
 finishStart({externalId:'run-B'});await dispatch;
 const run=f.store.get(id);assert.equal(run.external_id,'run-A');assert.equal(run.state,'cancel_pending');
 assert.deepEqual(cancelled,['run-A']);assert.equal(f.store.active().length,1);
});
test('uncorrelated terminal reports cannot release an uncertain or cancellation-pending claim',async t=>{
 for(const state of ['failed','cancelled'])for(const cancel of [false,true]){
  const f=setup(t);f.store.setPaused(false);f.adapter.start=async()=>{f.calls.start++;throw Error('lost response');};
  const c=f.controller(),r=await c.dispatch(1);if(cancel)await c.cancel(r.run.id);
  f.adapter.inspect=async()=>({state});const unresolved=await c.reconcile(r.run.id);
  assert.equal(unresolved.state,cancel?'cancel_pending':'uncertain');assert.equal(f.store.active().length,1);
  f.snapshot.issues.push(fixture(2));assert.ok((await c.dispatch(2)).blocked);assert.equal(f.calls.start,1);
  f.adapter.inspect=async()=>({state,externalId:'mock-run'});assert.equal((await c.reconcile(r.run.id)).state,state);
 }
});
test('independent connections retain one durable claim; duplicate deliveries return one run',async t=>{
 const f=setup(t);f.store.setPaused(false);const second=new FactoryStore(f.path);t.after(()=>second.close());
 await Promise.all([f.controller().dispatch(1),f.controller({store:second}).dispatch(1)]);assert.equal(f.calls.start,1);assert.equal(second.active().length,1);
});
test('separate worker threads compete for one SQLite claim without stealing after restart',async t=>{
 const f=setup(t);f.store.setPaused(false);const moduleUrl=new URL('../scripts/factory-store.mjs',import.meta.url).href;
 const jobs=Array.from({length:4},(_,n)=>new Promise((resolve,reject)=>{const worker=new Worker(`const {parentPort,workerData}=require('node:worker_threads');(async()=>{const {FactoryStore}=await import(workerData.moduleUrl);const s=new FactoryStore(workerData.path);try{parentPort.postMessage(s.claim({repository:'cyrusjamula/family-hub',issue:workerData.issue,scopeDigest:'digest',files:['public/synthetic.js']},1,10));}finally{s.close();}})().catch(e=>{throw e;});`,{eval:true,workerData:{moduleUrl,path:f.path,issue:n+1}});worker.once('message',resolve);worker.once('error',reject);}));
 const results=await Promise.all(jobs);assert.equal(results.filter(r=>r.run).length,1);assert.equal(f.store.active().length,1);
 assert.equal(f.store.claim({repository:'cyrusjamula/family-hub',issue:9,scopeDigest:'other',files:['public/other.js']},999999,10).blocked,'one-task cap');
});
test('cancellation is durable and sent at most once; late running reports cannot clear it',async t=>{
 const f=setup(t);f.store.setPaused(false);const r=await f.controller().dispatch(1);f.adapter.cancel=async()=>{f.calls.cancel++;throw Error('cancel response lost');};
 const c=f.controller();await c.cancel(r.run.id);await c.cancel(r.run.id);assert.equal(f.calls.cancel,1);
 assert.equal((await c.reconcile(r.run.id)).state,'cancel_pending');f.adapter.inspect=async()=>({state:'cancelled',externalId:'mock-run'});assert.equal((await c.reconcile(r.run.id)).state,'cancelled');
});
test('reconciliation rejects unknown identity and PR links; review keeps a durable lock',async t=>{
 const f=setup(t);f.store.setPaused(false);const c=f.controller(),r=await c.dispatch(1);
 for(const status of [{state:'running',externalId:'different'},{state:'review',prUrl:'https://evil.invalid/1'},{state:'review'},{state:'surprise'}]){f.adapter.inspect=async()=>status;assert.equal((await c.reconcile(r.run.id)).state,'running');}
 f.adapter.inspect=async()=>({state:'review',externalId:'mock-run',prUrl:'https://github.com/cyrusjamula/family-hub/pull/999'});assert.equal((await c.reconcile(r.run.id)).state,'review');assert.equal(f.store.active().length,1);
});
test('revocation, pause and runtime expiry request cancellation without releasing unknown work',async t=>{
 for(const stop of ['budget','pause','deadline']){const f=setup(t);f.store.setPaused(false);const r=await f.controller().dispatch(1);if(stop==='budget')f.gates.budget=false;if(stop==='pause')f.store.setPaused(true);
 const c=f.controller({now:()=>stop==='deadline'?timestamp+60001:timestamp});f.adapter.inspect=async()=>({state:'unknown'});assert.equal((await c.reconcile(r.run.id)).state,'cancel_pending');assert.equal(f.store.active().length,1);assert.equal(f.calls.start,1);}
});
test('invalid start response and failed status lookup preserve uncertain work',async t=>{
 const f=setup(t);f.store.setPaused(false);f.adapter.start=async()=>{f.calls.start++;return {externalId:'https://invalid'};};
 const c=f.controller(),r=await c.dispatch(1);assert.equal(r.run.state,'uncertain');f.adapter.inspect=async()=>{throw Error('offline');};
 assert.equal((await c.reconcile(r.run.id)).state,'uncertain');await c.dispatch(1);assert.equal(f.calls.start,1);
});
test('crash before provider invocation holds the slot until explicit reconciliation handling',t=>{
 const f=setup(t);f.store.setPaused(false);const claim=f.store.claim({repository:'cyrusjamula/family-hub',issue:1,scopeDigest:'synthetic',files:['public/synthetic.js']},timestamp,10);
 const reopened=new FactoryStore(f.path);try{assert.equal(reopened.get(claim.run.id).state,'claimed');assert.equal(reopened.claim({repository:'cyrusjamula/family-hub',issue:2,scopeDigest:'other',files:['public/other.js']},timestamp+1000,10).blocked,'one-task cap');}finally{reopened.close();}
});
test('active scope edits, approval removal/expiry and failed snapshot revoke active work',async t=>{
 for(const change of ['title','body','approval','expiry','malformed','offline']){
  const f=setup(t);f.store.setPaused(false);const r=await f.controller().dispatch(1);
  if(change==='title')f.issue.title+=' edited';if(change==='body')f.issue.body+=' edited';if(change==='approval')f.issue.comments=[];
  if(change==='expiry')f.issue.comments[0].created_at='2020-01-01';if(change==='malformed')f.snapshot.repository='wrong/repo';
  const c=f.controller(change==='offline'?{readSimulationSnapshot:async()=>{throw Error('offline');}}:{});
  const updated=await c.reconcile(r.run.id);assert.equal(updated.state,'cancel_pending',change);assert.equal(updated.cancel_requested,1,change);assert.equal(f.calls.start,1);assert.equal(f.store.active().length,1);
 }
});
test('contradictory absence cannot unlock an acknowledged provider run',async t=>{
 for(const cancel of [false,true]){const f=setup(t);f.store.setPaused(false);const c=f.controller(),r=await c.dispatch(1);if(cancel)await c.cancel(r.run.id);
 f.adapter.inspect=async()=>({state:'not-started',verifiedAbsent:true});assert.equal((await c.reconcile(r.run.id)).state,cancel?'cancel_pending':'running');assert.equal(f.store.active().length,1);}
});
test('uncertain cancellation needs explicit absence proof; unavailable gates revoke active work',async t=>{
 const f=setup(t);f.store.setPaused(false);f.adapter.start=async()=>{throw Error('unknown');};const c=f.controller(),r=await c.dispatch(1);await c.cancel(r.run.id);
 f.adapter.inspect=async()=>({state:'not-started'});assert.equal((await c.reconcile(r.run.id)).state,'cancel_pending');
 f.adapter.inspect=async()=>({state:'not-started',verifiedAbsent:true});assert.equal((await c.reconcile(r.run.id)).state,'abandoned');
 const g=setup(t);g.store.setPaused(false);const started=await g.controller().dispatch(1);const broken=g.controller({readSimulationGates:()=>{throw Error('offline');}});
 assert.equal((await broken.reconcile(started.run.id)).state,'cancel_pending');assert.equal(g.store.active().length,1);
});
test('new controller and audit controls cannot authorize their own modification',async t=>{
 for(const file of ['scripts/factory-dispatch.mjs','scripts/factory-store.mjs','scripts/factory-input-audit.mjs','scripts/factory-github-tasks.mjs','scripts/']){
  const f=setup(t);f.store.setPaused(false);f.issue.body=f.issue.body.replace('public/synthetic.js',file);f.issue.comments[0].body='/factory approve '+issueScopeDigest(f.issue);
  await f.controller().dispatch(1);assert.equal(f.calls.start,0,file);
 }
 const f=setup(t);f.store.setPaused(false);const c=f.controller(),r=await c.dispatch(1);f.issue.body=f.issue.body.replace('public/synthetic.js','scripts/factory-store.mjs');f.issue.comments[0].body='/factory approve '+issueScopeDigest(f.issue);
 assert.equal((await c.reconcile(r.run.id)).state,'cancel_pending');assert.equal(f.calls.start,1);
});
test('missing adapter retains cleanup intent when an active run needs reconciliation',async t=>{
 const f=setup(t);f.store.setPaused(false);const r=await f.controller().dispatch(1);
 const unavailable=f.controller({simulationAdapter:undefined});assert.equal((await unavailable.reconcile(r.run.id)).state,'cancel_pending');assert.equal(f.calls.inspect,0);assert.equal(f.store.active().length,1);
});
test('an active run keeps its scope lock when a lower-numbered overlapping candidate becomes ready',async t=>{
 const f=setup(t);f.store.setPaused(false);f.issue.number=2;f.issue.comments[0].body='/factory approve '+issueScopeDigest(f.issue);
 const c=f.controller(),run=await c.dispatch(2);assert.equal(run.run.state,'running');
 f.snapshot.issues.push(fixture(1));assert.equal((await c.reconcile(run.run.id)).state,'running');
 await c.dispatch(1);assert.equal(f.calls.start,1);assert.equal(f.store.active().length,1);
});
test('missing or null external active inventory blocks initial, pre-start and active checks',async t=>{
 for(const invalid of [undefined,null]){
  const initial=setup(t);initial.store.setPaused(false);initial.snapshot.active=invalid;
  await assert.rejects(initial.controller().dispatch(1),/active-work list/);assert.equal(initial.calls.start,0);
  const pre=setup(t);pre.store.setPaused(false);let reads=0;
  const controller=pre.controller({readSimulationSnapshot:async()=>{const snapshot=structuredClone(pre.snapshot);if(++reads===2)snapshot.active=invalid;return snapshot;}});
  const result=await controller.dispatch(1);assert.equal(pre.calls.start,0);assert.equal(result.run.state,'abandoned');
  const active=setup(t);active.store.setPaused(false);const c=active.controller(),started=await c.dispatch(1);active.snapshot.active=invalid;
  assert.equal((await c.reconcile(started.run.id)).state,'cancel_pending');assert.equal(active.store.active().length,1);
 }
});
test('polling sends bounded cleanup once on pause, revocation and expiry even if inspect fails',async t=>{
 for(const reason of ['pause','revocation','expiry']){const f=setup(t);f.store.setPaused(false);const started=await f.controller().dispatch(1);
 if(reason==='pause')f.store.setPaused(true);if(reason==='revocation')f.gates.budget=false;
 f.adapter.inspect=async()=>{throw Error('offline');};const c=f.controller(reason==='expiry'?{now:()=>timestamp+60001}:{});
 await c.reconcile(started.run.id);await c.reconcile(started.run.id);assert.equal(f.calls.cancel,1,reason);assert.equal(f.store.get(started.run.id).state,'cancel_pending');}
});
test('cancelled uncertain starts get cleanup once when inspection recovers their external identity',async t=>{
 const f=setup(t);f.store.setPaused(false);f.adapter.start=async()=>{throw Error('response lost');};const c=f.controller(),started=await c.dispatch(1);await c.cancel(started.run.id);assert.equal(f.calls.cancel,0);
 f.adapter.inspect=async()=>({state:'running',externalId:'recovered-run'});await c.reconcile(started.run.id);await c.reconcile(started.run.id);
 assert.equal(f.calls.cancel,1);assert.equal(f.store.get(started.run.id).external_id,'recovered-run');
});
test('own correlated review PR is excluded from conflicts, including first discovery; unrelated work remains locked',async t=>{
 for(const previouslyLinked of [false,true]){const f=setup(t);f.store.setPaused(false);const c=f.controller(),started=await c.dispatch(1);
 const status={state:'review',externalId:'mock-run',prUrl:'https://github.com/cyrusjamula/family-hub/pull/999'};
 if(previouslyLinked)f.store.reconcile(started.run.id,status);
 f.adapter.inspect=async()=>status;f.snapshot.active=[{issue:999,relatedIssues:[1],files:['public/synthetic.js'],state:'review'}];
 assert.equal((await c.reconcile(started.run.id)).state,'review',String(previouslyLinked));assert.equal(f.calls.cancel,0);
 f.snapshot.active.push({issue:1000,relatedIssues:[],files:['public/synthetic.js'],state:'review'});
 assert.equal((await c.reconcile(started.run.id)).state,'cancel_pending');assert.equal(f.calls.cancel,1);}
});
test('correlated PR scope and immutable identity cannot expand approval',async t=>{
 const f=setup(t);f.store.setPaused(false);const c=f.controller(),started=await c.dispatch(1);
 const status={state:'review',externalId:'mock-run',prUrl:'https://github.com/cyrusjamula/family-hub/pull/999'};f.adapter.inspect=async()=>status;
 await c.reconcile(started.run.id);assert.throws(()=>f.store.reconcile(started.run.id,{...status,prUrl:'https://github.com/cyrusjamula/family-hub/pull/1000'}),/identity/);
 f.snapshot.active=[{issue:999,relatedIssues:[1],files:['public/unapproved.js'],state:'review'}];
 assert.equal((await c.reconcile(started.run.id)).state,'cancel_pending');assert.equal(f.calls.cancel,1);
});
