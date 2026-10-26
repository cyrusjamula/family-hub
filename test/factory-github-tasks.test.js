import test from 'node:test';
import assert from 'node:assert/strict';
import {createGitHubTaskReader} from '../scripts/factory-github-tasks.mjs';

const root='https://api.github.com/agents/repos/cyrusjamula/family-hub/tasks';
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const task=(n,state='completed')=>({id:id(n),url:`${root}/${id(n)}`,repository:{id:1431589772},state,session_count:1,prompt:'PRIVATE-SYNTHETIC-PROMPT'});
const session=(n,state='completed')=>({id:'synthetic-session',task_id:id(n),repository:{id:1431589772},state,prompt:'PRIVATE-SYNTHETIC-PROMPT'});
const response=(data,headers={})=>new Response(JSON.stringify(data),{headers});
const setup=send=>createGitHubTaskReader({token:'synthetic-secret',send});
const failed=promise=>assert.rejects(promise,error=>error.message==='GitHub task read unavailable; readiness is unknown');

test('inventory includes archived work, strips private payloads and sends only bounded GET requests',async()=>{
 const calls=[];
 const reader=setup(async(url,options)=>{calls.push({url,options});return response({tasks:[task(calls.length,calls.length===2?'in_progress':'completed')]});});
 const result=await reader.inventory();
 assert.equal(calls.length,2);assert.equal(result.hasNonterminalTasks,true);assert.equal(result.dispatchEnabled,false);
 assert.deepEqual(result.tasks.map(t=>t.state),['completed','in_progress']);
 assert.ok(!JSON.stringify(result).includes('PRIVATE'));
 for(const call of calls){assert.equal(call.options.method,'GET');assert.equal(call.options.redirect,'manual');
  assert.equal(call.options.headers.authorization,'Bearer synthetic-secret');assert.equal(new URL(call.url).origin,'https://api.github.com');}
 assert.equal(typeof reader.start,'undefined');assert.equal(typeof reader.cancel,'undefined');
});

test('empty inventories are explicit, and no terminal task is treated as active',async()=>{
 assert.equal((await setup(async()=>response({tasks:[]})).inventory()).hasNonterminalTasks,false);
 let count=0;const reader=setup(async()=>response({tasks:++count===1?['completed','failed','cancelled','timed_out'].map((s,n)=>task(n,s)):[]}));
 assert.equal((await reader.inventory()).hasNonterminalTasks,false);
});

test('all documented nonterminal states retain work locks',async()=>{
 for(const state of ['queued','in_progress','idle','waiting_for_user']){
  let count=0;const result=await setup(async()=>response({tasks:++count===1?[task(1,state)]:[]})).inventory();
  assert.equal(result.hasNonterminalTasks,true,state);
 }
});

test('pagination cannot silently omit active work on a later page',async()=>{
 const calls=[];const result=await setup(async url=>{
  calls.push(url);const parsed=new URL(url);
  if(parsed.searchParams.get('is_archived')==='true')return response({tasks:[]});
  if(parsed.searchParams.get('page')==='1'){
   parsed.searchParams.set('page','2');return response({tasks:[task(1)]},{link:`<${parsed}>; rel="next"`});
  }
  return response({tasks:[task(2,'queued')]});
 }).inventory();
 assert.equal(calls.length,3);assert.equal(result.tasks.length,2);assert.equal(result.hasNonterminalTasks,true);
});

test('incomplete, changing, duplicate or unknown inventories fail closed',async()=>{
 for(const data of [{},{tasks:null},{tasks:{}},{tasks:[task(1,'future-state')]},{tasks:[task(1),task(1)]},
  {tasks:[{...task(1),repository:{id:42}}]},{tasks:[{...task(1),url:'https://example.test/task'}]},
  {tasks:Array.from({length:101},(_,n)=>task(n))}])await failed(setup(async()=>response(data)).inventory());
 await failed(setup(async()=>response({tasks:[task(1)]})).inventory()); // Duplicate across archive boundary.
 let calls=0;await failed(setup(async()=>{if(++calls===2)throw Error('private diagnostics');return response({tasks:[]});}).inventory());
});

test('malformed, redirected and over-limit pagination is never reported complete',async()=>{
 for(const link of ['garbage',`<not-a-url-private-synthetic>; rel="next"`,`<https://example.test/tasks?page=2>; rel="next"`,
  `<${root}?page=2>; rel="next"`])await failed(setup(async()=>response({tasks:[task(1)]},{link})).inventory());
 const reader=createGitHubTaskReader({token:'synthetic-secret',maxPages:1,send:async url=>{
  const next=new URL(url);next.searchParams.set('page','2');return response({tasks:[task(1)]},{link:`<${next}>; rel="next"`});
 }});await failed(reader.inventory());
});

test('HTTP denial, redirects, invalid JSON and provider errors remain sanitized',async()=>{
 for(const status of [301,302,401,403,404,429,500])await failed(setup(async()=>new Response('private diagnostics',{status})).inventory());
 await failed(setup(async()=>new Response('private invalid JSON')).inventory());
 await failed(setup(async()=>{throw Error('synthetic-secret PRIVATE');}).inventory());
});

test('oversized and stalled response bodies cannot produce readiness',async()=>{
 await failed(setup(async()=>new Response('x'.repeat(1024*1024+1))).inventory());
 const reader=createGitHubTaskReader({token:'synthetic-secret',timeoutMs:20,send:async()=>new Response(new ReadableStream({start(){},cancel(){}}))});
 await failed(reader.inventory());
 const hung=createGitHubTaskReader({token:'synthetic-secret',timeoutMs:20,send:()=>new Promise(()=>{})});
 await failed(hung.inventory());
});

test('task inspection verifies identity and sessions without claiming cancellation capability',async()=>{
 const reader=setup(async()=>response({...task(1,'cancelled'),sessions:[session(1,'cancelled')]}));
 assert.deepEqual(await reader.inspect(id(1)),{id:id(1),state:'cancelled',terminal:true,
  sessions:[{id:'synthetic-session',state:'cancelled',terminal:true}],dispatchEnabled:false,cancellationAvailable:false});
});

test('wrong task/session identities and contradictory terminal status fail closed',async()=>{
 const base={...task(1),sessions:[session(1)]};
 for(const data of [{...base,id:id(2)}, {...base,sessions:[]},{...base,sessions:null},
  {...base,session_count:2},{...base,session_count:undefined},{...base,session_count:1.5},
  {...base,sessions:[session(2)]},{...base,sessions:[session(1),session(1)]},
  {...base,sessions:[session(1,'in_progress')]},
  {...base,sessions:[{...session(1),repository:{id:42}}]},
  {...base,sessions:[session(1,'new-state')]}])await failed(setup(async()=>response(data)).inspect(id(1)));
});

test('invalid IDs and invalid configuration make no provider request',async()=>{
 let calls=0;const send=async()=>{calls++;throw Error('must not call');};
 const reader=setup(send);
 for(const value of ['../tasks','https://example.test',null,1,'',id(1)+'?x=1'])await failed(reader.inspect(value));
 for(const options of [{token:''},{token:'bad\nheader'},{token:3},{token:'x',timeoutMs:0},{token:'x',timeoutMs:30001},
  {token:'x',maxPages:11},{token:'x',maxPages:0},{token:'x',send:null}])assert.throws(()=>createGitHubTaskReader({...options}),/readiness is unknown/);
 assert.equal(calls,0);
});

test('advertised bucket totals cannot hide omitted tasks or drift during pagination',async()=>{
 const totals={total_active_count:1,total_archived_count:0};
 await failed(setup(async()=>response({...totals,tasks:[]})).inventory());
 for(const counts of [{total_active_count:1},{total_active_count:-1,total_archived_count:0},
  {total_active_count:1.5,total_archived_count:0},{total_active_count:'1',total_archived_count:0}]){
  await failed(setup(async()=>response({...counts,tasks:[task(1)]})).inventory());
 }
 let calls=0;await failed(setup(async()=>response({tasks:++calls===1?[task(1)]:[],
  total_active_count:calls===1?1:2,total_archived_count:0})).inventory());
 let read=0;const valid=await setup(async()=>response({...totals,tasks:++read===1?[task(1)]:[]})).inventory();
 assert.equal(valid.hasNonterminalTasks,false);assert.equal(valid.tasks.length,1);
 const archivedCounts={total_active_count:0,total_archived_count:1};
 await failed(setup(async()=>response({...archivedCounts,tasks:[]})).inventory());
 let missing=0;await failed(setup(async()=>response(++missing===1?
  {...totals,tasks:[task(1)]}:{tasks:[]})).inventory());
 let archived=0;const both=await setup(async()=>response({total_active_count:1,total_archived_count:1,
  tasks:[task(++archived,archived===2?'queued':'completed')]})).inventory();
 assert.equal(both.hasNonterminalTasks,true);assert.equal(both.tasks.length,2);
});

test('all pagination relations are validated and later last requires next',async()=>{
 for(const build of [
  url=>{url.searchParams.set('page','2');return `<${url}>; rel="last"`;},
  url=>`<not-a-url-private-synthetic>; rel="last"`,
  url=>{url.searchParams.set('page','2');return `<${url}>; rel="next", <https://example.test/tasks>; rel="last"`;},
  url=>{url.searchParams.set('page','2');return `<${url}>; rel="next", <${url}>; rel="next"`;},
  url=>`<${url}>; rel="prev"`,
  url=>{url.searchParams.set('page','3');return `<${url}>; rel="first"`;}
 ])await failed(setup(async url=>response({tasks:[]},{link:build(new URL(url))})).inventory());
 const counts={total_active_count:2,total_archived_count:0};
 const result=await setup(async url=>{
  const parsed=new URL(url);
  if(parsed.searchParams.get('is_archived')==='true')return response({...counts,tasks:[]});
  if(parsed.searchParams.get('page')==='1'){
   parsed.searchParams.set('page','2');return response({...counts,tasks:[task(1)]},{link:`<${parsed}>; rel="next", <${parsed}>; rel="last"`});
  }
  parsed.searchParams.set('page','1');return response({...counts,tasks:[task(2,'queued')]},{link:`<${parsed}>; rel="prev", <${parsed}>; rel="first"`});
 }).inventory();
 assert.equal(result.tasks.length,2);assert.equal(result.hasNonterminalTasks,true);
});

test('an earlier promised last page cannot disappear or change on a later page',async()=>{
 for(const changedLast of [undefined,2]){
  await failed(setup(async url=>{
   const parsed=new URL(url);const page=Number(parsed.searchParams.get('page'));
   if(parsed.searchParams.get('is_archived')==='true')return response({tasks:[]});
   if(page===1){
    const next=new URL(url);next.searchParams.set('page','2');const last=new URL(url);last.searchParams.set('page','3');
    return response({tasks:[task(1)]},{link:`<${next}>; rel="next", <${last}>; rel="last"`});
   }
   if(changedLast){parsed.searchParams.set('page',String(changedLast));return response({tasks:[task(2)]},{link:`<${parsed}>; rel="last"`});}
   return response({tasks:[task(2)]});
  }).inventory());
 }
});
