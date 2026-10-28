import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {COPILOT_REVIEW_CHECK,reconcilePullRequests} from '../scripts/copilot-auto-merge.mjs';

function fixture({reviews=[],draft=false,autoMerge=false,existing=false,changed=false,closed=false}={}){
 const pr={number:1,node_id:'synthetic-pr',state:closed?'closed':'open',draft,head:{sha:'a'.repeat(40)}};
 const calls=[];let reads=0;
 const github={
  rest:{
   pulls:{
    get:async()=>({data:++reads>1&&changed?{...pr,head:{sha:'b'.repeat(40)}}:pr}),
    list:()=>{},
    listReviews:()=>{}
   },
   checks:{
    listForRef:()=>{},
    create:async args=>{calls.push({kind:'check',args});},
    update:async args=>{calls.push({kind:'check',args});}
   }
  },
  paginate:async(method,args)=>{
   assert.equal(args.per_page,100);
   if(method===github.rest.pulls.list)return [pr];
   if(method===github.rest.pulls.listReviews)return reviews;
   assert.equal(method,github.rest.checks.listForRef);
   assert.equal(args.ref,pr.head.sha);
   return existing?[{id:9,name:COPILOT_REVIEW_CHECK,app:{slug:'github-actions'}}]:[];
  },
  graphql:async(query,args)=>{
   assert.equal(args.id,pr.node_id);
   if(query.startsWith('query'))return {node:{autoMergeRequest:autoMerge?{enabledAt:'synthetic'}:null}};
   assert.match(query,/enablePullRequestAutoMerge/);
   assert.match(query,/mergeMethod: SQUASH/);
   calls.push({kind:'enable'});
   return {};
  }
 };
 const context={repo:{owner:'synthetic',repo:'synthetic'},eventName:'pull_request_target',payload:{pull_request:pr}};
 const logs=[];const core={info:message=>logs.push({kind:'info',message}),warning:message=>logs.push({kind:'warning',message})};
 return {github,context,core,calls,pr,logs};
}
const review=(overrides={})=>({id:1,user:{login:'copilot-pull-request-reviewer[bot]',type:'Bot'},state:'COMMENTED',commit_id:'a'.repeat(40),...overrides});

test('Copilot review of the current commit enables squash auto-merge and passes the gate',async()=>{
 for(const state of ['COMMENTED','APPROVED']){
  const f=fixture({reviews:[review({state})]});await reconcilePullRequests(f);
  assert.equal(f.calls[0].args.head_sha,f.pr.head.sha);
  assert.equal(f.calls[0].args.conclusion,'success');
  assert.equal(f.calls[1].kind,'enable');
 }
});
test('missing, old, human, spoofed, dismissed, or change-requesting reviews cannot pass the gate',async()=>{
 for(const reviews of [[],[review({commit_id:'b'.repeat(40)})],[review({user:{login:'owner',type:'User'}})],[review({user:{login:'copilot-pull-request-reviewer[bot]',type:'User'}})],[review({state:'DISMISSED'})],[review({state:'CHANGES_REQUESTED'})],[review(),review({id:2,state:'DISMISSED'})]]){
  const f=fixture({reviews});await reconcilePullRequests(f);
  assert.equal(f.calls.length,1);
  assert.equal(f.calls[0].args.status,'in_progress');
  assert.equal(f.calls[0].args.conclusion,undefined);
 }
});
test('drafts stay blocked even with a current review',async()=>{
 const f=fixture({draft:true,reviews:[review()]});await reconcilePullRequests(f);
 assert.equal(f.calls.length,1);assert.equal(f.calls[0].args.status,'in_progress');
});
test('existing check and auto-merge settings are reused without duplicate mutations',async()=>{
 const f=fixture({existing:true,autoMerge:true,reviews:[review()]});await reconcilePullRequests(f);
 assert.equal(f.calls.length,1);assert.equal(f.calls[0].args.check_run_id,9);
 assert.equal(f.calls[0].args.head_sha,undefined);
});
test('a concurrent head change does not enable auto-merge and closed PRs are ignored',async()=>{
 const changed=fixture({changed:true,reviews:[review()]});await reconcilePullRequests(changed);
 assert.equal(changed.calls.length,1);
 const closed=fixture({closed:true,reviews:[review()]});await reconcilePullRequests(closed);
 assert.equal(closed.calls.length,0);
});
test('trusted workflow-run reconciliation reads all open PRs and propagates API failures',async()=>{
 const f=fixture({reviews:[review()]});f.context.eventName='workflow_run';
 await reconcilePullRequests(f);assert.equal(f.calls[1].kind,'enable');
 const failed=fixture();failed.github.paginate=async()=>{throw Error('synthetic API failure');};
 await assert.rejects(reconcilePullRequests(failed),/synthetic API failure/);
 assert.equal(failed.calls.length,0);
});
test('review notifications are unprivileged and reconciliation never checks out PR source',async()=>{
 const observer=await readFile('.github/workflows/copilot-review-event.yml','utf8');
 assert.match(observer,/pull_request_review:/);assert.match(observer,/permissions: \{\}/);
 assert.doesNotMatch(observer,/actions\/checkout|secrets\.|github\.token/);
 const workflow=await readFile('.github/workflows/copilot-auto-merge.yml','utf8');
 assert.match(workflow,/pull_request_target:/);
 assert.match(workflow,/workflows: \[Observe Copilot reviews\]/);
 assert.match(workflow,/ref: \$\{\{ github\.workflow_sha \}\}/);
 assert.match(workflow,/persist-credentials: false/);
 assert.doesNotMatch(workflow,/pull_request\.head|workflow_run\.head|download-artifact/);
});

test('transient unstable merge status retries with fresh state, and other errors surface',async()=>{
 const unstable=()=>Object.assign(new Error('synthetic'),{errors:[{type:'UNPROCESSABLE',message:'Pull request Pull request is in unstable status'}]});
 const f=fixture({reviews:[review()]});const graphql=f.github.graphql;let mutations=0,waits=0;
 f.github.graphql=async(q,a)=>{if(q.startsWith('mutation')&&++mutations===1)throw unstable();return graphql(q,a);};
 await reconcilePullRequests({...f,wait:async()=>{waits++;}});
 assert.equal(mutations,2);assert.equal(waits,1);assert.equal(f.calls.filter(c=>c.kind==='enable').length,1);
 const exhausted=fixture({reviews:[review()]});const query=exhausted.github.graphql;let failures=0;
 exhausted.github.graphql=async(q,a)=>{if(q.startsWith('mutation')){failures++;throw unstable();}return query(q,a);};
 await assert.rejects(reconcilePullRequests({...exhausted,wait:async()=>{}}));assert.equal(failures,3);
 const rejected=fixture({reviews:[review()]});const rejectedQuery=rejected.github.graphql;
 rejected.github.graphql=async(q,a)=>{if(q.startsWith('mutation'))throw Error('permission denied');return rejectedQuery(q,a);};
 await assert.rejects(reconcilePullRequests({...rejected,wait:async()=>{throw Error('must not retry');}}),/permission denied/);
});

test('a changed head while retrying does not enable auto-merge',async()=>{
 const f=fixture({reviews:[review()]});let reads=0;const get=f.github.rest.pulls.get;
 f.github.rest.pulls.get=async(...args)=>++reads===3?{data:{...f.pr,head:{sha:'b'.repeat(40)}}}:get(...args);
 const graphql=f.github.graphql;f.github.graphql=async(q,a)=>{if(q.startsWith('mutation'))throw Object.assign(new Error('synthetic'),{errors:[{type:'UNPROCESSABLE',message:'Pull request Pull request is in unstable status'}]});return graphql(q,a);};
 await reconcilePullRequests({...f,wait:async()=>{}});assert.equal(f.calls.filter(c=>c.kind==='enable').length,0);
});

test('a review dismissed during retry resets its check and prevents auto-merge',async()=>{
 const f=fixture({reviews:[review()]});const paginate=f.github.paginate;let reviewReads=0,mutations=0;
 f.github.paginate=async(method,args)=>{
  if(method===f.github.rest.pulls.listReviews&&++reviewReads===2)return [review({state:'DISMISSED'})];
  if(method===f.github.rest.checks.listForRef&&reviewReads===2)return [{id:9,name:COPILOT_REVIEW_CHECK,app:{slug:'github-actions'}}];
  return paginate(method,args);
 };
 const graphql=f.github.graphql;f.github.graphql=async(q,a)=>{if(q.startsWith('mutation')){mutations++;throw Object.assign(new Error('synthetic'),{errors:[{type:'UNPROCESSABLE',message:'Pull request Pull request is in unstable status'}]});}return graphql(q,a);};
 await reconcilePullRequests({...f,wait:async()=>{}});
 assert.equal(mutations,1);assert.equal(f.calls.length,2);assert.equal(f.calls[0].args.conclusion,'success');
 assert.equal(f.calls[1].args.status,'in_progress');assert.equal(f.calls[1].args.check_run_id,9);assert.equal(f.calls[1].args.conclusion,undefined);
});

const cleanError=()=>Object.assign(Error('synthetic clean rejection'),{errors:[{type:'UNPROCESSABLE',message:'Pull request Pull request is in clean status'}]});

test('a clean-status rejection requires owner action and cannot stop a later PR',async()=>{
 const f=fixture({reviews:[review()]});f.context.eventName='workflow_run';
 const second={...f.pr,number:2,node_id:'synthetic-second',head:{sha:'b'.repeat(40)}};
 const originalPaginate=f.github.paginate;
 f.github.paginate=async(method,args)=>{
  if(method===f.github.rest.pulls.list)return [f.pr,second];
  if(method===f.github.rest.pulls.listReviews)return [review({commit_id:args.pull_number===2?second.head.sha:f.pr.head.sha})];
  if(method===f.github.rest.checks.listForRef)return [];
  return originalPaginate(method,args);
 };
 const reads=[];f.github.rest.pulls.get=async args=>{reads.push(args.pull_number);return {data:args.pull_number===2?second:f.pr};};
 const mutations=[];
 f.github.graphql=async(query,args)=>{
  if(query.startsWith('query'))return {node:{autoMergeRequest:null}};
  assert.match(query,/enablePullRequestAutoMerge/);assert.doesNotMatch(query,/mergePullRequest/);
  mutations.push(args.id);if(args.id===f.pr.node_id)throw cleanError();
  f.calls.push({kind:'enable'});return {};
 };
 await reconcilePullRequests({...f,wait:async()=>assert.fail('clean rejection must not retry')});
 assert.deepEqual(mutations,[f.pr.node_id,second.node_id]);
 assert.equal(reads.filter(n=>n===1).length,3,'rereads clean PR before reporting owner action');
 assert.equal(f.calls.filter(c=>c.kind==='enable').length,1);
 assert.equal(f.logs.filter(l=>l.kind==='warning').length,1);
 assert.match(f.logs.find(l=>l.kind==='warning').message,/PR #1:.*Owner merge action is required/);
 assert.equal(f.logs.some(l=>/PR #1: squash auto-merge enabled/.test(l.message)),false);
 assert.equal(f.logs.some(l=>/PR #2: squash auto-merge enabled/.test(l.message)),true);
});

test('clean rejection after head/state changes never asks for a stale merge',async()=>{
 for(const change of [pr=>({...pr,state:'closed'}),pr=>({...pr,draft:true}),pr=>({...pr,head:{sha:'c'.repeat(40)}})]){
  const f=fixture({reviews:[review()]});let reads=0;f.github.rest.pulls.get=async()=>({data:++reads===3?change(f.pr):f.pr});
  const graphql=f.github.graphql;f.github.graphql=async(q,a)=>{if(q.startsWith('mutation'))throw cleanError();return graphql(q,a);};
  await reconcilePullRequests(f);
  assert.equal(f.logs.some(l=>l.kind==='warning'),false);
  assert.equal(f.logs.some(l=>/changed after clean-status/.test(l.message)),true);
  assert.equal(f.calls.some(c=>c.kind==='enable'),false);
 }
});

test('ambiguous and unrelated clean-like errors remain visible failures',async()=>{
 for(const errors of [
  [{type:'FORBIDDEN',message:'Pull request Pull request is in clean status'}],
  [{type:'UNPROCESSABLE',message:'different clean status error'}],
  [...cleanError().errors,{type:'FORBIDDEN',message:'permission denied'}]
 ]){
  const f=fixture({reviews:[review()]});const graphql=f.github.graphql;
  f.github.graphql=async(q,a)=>{if(q.startsWith('mutation'))throw Object.assign(Error('synthetic failure'),{errors});return graphql(q,a);};
  await assert.rejects(reconcilePullRequests(f),/synthetic failure/);
  assert.equal(f.logs.some(l=>l.kind==='warning'),false);
 }
});
