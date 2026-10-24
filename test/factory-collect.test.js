import test from 'node:test';
import assert from 'node:assert/strict';
import {collectFactorySnapshot,summarizeFactory} from '../scripts/factory-collect.mjs';
import {planFactory,issueScopeDigest} from '../scripts/factory-plan.mjs';
const now=Date.parse('2026-10-24T05:00:00Z');
function issue(number,dependencies='None'){
 return {number,title:'Synthetic task',state:'open',labels:[{name:'agent-ready'}],body:'## Scope\nSynthetic change\n## Acceptance checks\nObservable result\n## Regression tests\nSynthetic failure case\n## Files\npublic/task-'+number+'.js\n## Depends on\n'+dependencies};
}
const approval=i=>({user:{login:'cyrusjamula'},body:'/factory approve '+issueScopeDigest(i),created_at:new Date(now-1000).toISOString()});
function provider(routes){
 const calls=[];const send=async(url,init)=>{
  const u=new URL(url);assert.equal(u.origin,'https://api.github.com');assert.ok(u.pathname.startsWith('/repos/cyrusjamula/family-hub/'));assert.equal(init.method,'GET');assert.equal(init.redirect,'manual');calls.push({path:u.pathname,query:u.search,init});
  const path=u.pathname.replace('/repos/cyrusjamula/family-hub',''),handler=routes[path];if(!handler)throw Error('Unexpected API read');
  const result=typeof handler==='function'?handler(u,init):handler;
  return result instanceof Response?result:Response.json(result);
 };return {send,calls};
}
test('trusted collector reads actual owner approvals and explicit closed dependencies without retaining raw discussion',async()=>{
 const i=issue(2,'#1'),p=provider({'/issues':[i],'/issues/2/comments':[approval(i),{user:{login:'someone'},body:'SYNTHETIC_PRIVATE_DISCUSSION'}],'/issues/2':i,'/issues/1':{...issue(1),state:'closed'},'/pulls':[]});
 const snapshot=await collectFactorySnapshot({token:'synthetic-token',send:p.send});const plan=planFactory(snapshot,now);assert.deepEqual(plan.selected.map(i=>i.issue),[2]);assert.equal(snapshot.issues[0].comments.length,1);assert.equal(JSON.stringify(snapshot).includes('SYNTHETIC_PRIVATE_DISCUSSION'),false);
 const summary=JSON.stringify(summarizeFactory(snapshot,plan));assert.equal(summary.includes('Synthetic change'),false);assert.equal(summary.includes('synthetic-token'),false);assert.equal(summary.includes('/factory approve '),false);
 assert.ok(p.calls.every(c=>c.init.headers.authorization==='Bearer synthetic-token'));
});
test('scope edited after approval is re-read and cannot be selected',async()=>{
 const i=issue(1),changed={...i,body:i.body+'\nChanged scope'},p=provider({'/issues':[i],'/issues/1/comments':[approval(i)],'/issues/1':changed,'/pulls':[]});
 const snapshot=await collectFactorySnapshot({send:p.send});assert.equal(planFactory(snapshot,now).selected.length,0);
});
test('list pagination follows only generated same-repository GET URLs and fails if completeness is capped',async()=>{
 const p=provider({'/issues':u=>u.searchParams.get('page')==='1'?Response.json([{...issue(1),labels:[]}],{headers:{link:'<https://evil.test/steal>; rel="next"'}}):[{...issue(2),labels:[]}],'/pulls':[]});
 const snapshot=await collectFactorySnapshot({token:'synthetic',send:p.send});assert.equal(snapshot.issues.length,2);assert.equal(p.calls.length,3);assert.ok(p.calls.every(c=>!c.path.includes('steal')));
 const capped=provider({'/issues':()=>Response.json([],{headers:{link:'<https://api.github.com/next>; rel="next"'}})});await assert.rejects(collectFactorySnapshot({send:capped.send}),/exceeds collector limit/);
});
test('PR conflict collection includes renamed paths and review work without consuming coding slots',async()=>{
 const i=issue(1),detail={number:9,state:'open',head:{sha:'a'.repeat(40)},changed_files:1,draft:false,user:{type:'User'},body:'Closes #1'},p=provider({'/issues':[i],'/issues/1/comments':[approval(i)],'/issues/1':i,'/pulls':[{number:9}],'/pulls/9':detail,'/pulls/9/files':[{filename:'public/new.js',previous_filename:'public/task-1.js'}]});
 const snapshot=await collectFactorySnapshot({send:p.send});assert.deepEqual(snapshot.active[0].files,['public/new.js','public/task-1.js']);assert.equal(snapshot.active[0].state,'review');assert.deepEqual(snapshot.active[0].relatedIssues,[1]);assert.equal(planFactory(snapshot,now).selected.length,0);
 const unrelated=issue(2);snapshot.issues.push({...unrelated,comments:[{author:{login:'cyrusjamula'},body:approval(unrelated).body,created_at:approval(unrelated).created_at}]});assert.deepEqual(planFactory(snapshot,now).selected.map(i=>i.issue),[2]);
});
test('truncated or changing PR scopes and empty drafts stop the entire proposal',async()=>{
 for(const mode of ['truncated','changed','empty']){
  let reads=0;const detail={number:9,state:'open',head:{sha:'a'.repeat(40)},changed_files:mode==='empty'?0:2},p=provider({'/issues':[], '/pulls':[{number:9}],'/pulls/9':()=>({...detail,head:{sha:mode==='changed'&&++reads>1?'b'.repeat(40):'a'.repeat(40)}}),'/pulls/9/files':mode==='truncated'?[{filename:'public/a.js'}]:[{filename:'public/a.js'},{filename:'public/b.js'}]});
  await assert.rejects(collectFactorySnapshot({send:p.send}));
 }
});
test('redirects, provider errors and malformed lists never produce a partial queue',async()=>{
 for(const response of [new Response(null,{status:302}),new Response(null,{status:403}),Response.json({not:'a list'})]){
  const p=provider({'/issues':response});await assert.rejects(collectFactorySnapshot({send:p.send}));assert.equal(p.calls.length,1);
 }
});
test('dependency parsing shares the planner rules for CRLF and normalized headings',async()=>{
 const i=issue(2,'#1');i.body=i.body.replace('## Depends on','## DEPENDS ON   ').replaceAll('\n','\r\n');const p=provider({'/issues':[i],'/issues/2/comments':[approval(i)],'/issues/2':i,'/issues/1':{...issue(1),state:'closed'},'/pulls':[]});
 assert.equal(planFactory(await collectFactorySnapshot({send:p.send}),now).selected.length,1);
});
