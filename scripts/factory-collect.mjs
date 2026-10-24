import {appendFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {factoryPolicy,planFactory,issueScopeDigest,issueWorkScope} from './factory-plan.mjs';

const root='https://api.github.com/repos/'+factoryPolicy.repository;
const isNumber=n=>Number.isSafeInteger(n)&&n>0;
const isReady=issue=>(issue.labels||[]).some(l=>(typeof l==='string'?l:l.name)==='agent-ready');
export async function collectFactorySnapshot({token,send=fetch}={}){
 let requests=0;
 async function get(path,query={}){
  if(++requests>250)throw Error('Collector request limit reached');
  const url=root+path+(Object.keys(query).length?'?'+new URLSearchParams(query):'');
  const response=await send(url,{method:'GET',redirect:'manual',signal:AbortSignal.timeout(10000),headers:{accept:'application/vnd.github+json','user-agent':'Family-Hub-Read-Only-Factory',...(token?{authorization:'Bearer '+token}:{})}});
  if(response.status!==200)throw Error('GitHub read failed');
  return {data:await response.json(),more:/(?:^|,)\s*<[^>]+>;\s*rel="next"/.test(response.headers.get('link')||'')};
 }
 async function pages(path,query={},limit=5){
  const rows=[];
  for(let page=1;page<=limit;page++){
   const result=await get(path,{...query,per_page:100,page});if(!Array.isArray(result.data))throw Error('Unexpected GitHub list');rows.push(...result.data);
   if(!result.more)return rows;
  }
  throw Error('GitHub list exceeds collector limit');
 }
 const listed=await pages('/issues',{state:'open',sort:'created',direction:'asc'}),issues=new Map();
 for(const issue of listed){if(issue.pull_request)continue;if(!isNumber(issue.number)||issues.has(issue.number))throw Error('Ambiguous GitHub issue');issues.set(issue.number,{number:issue.number,title:issue.title,body:issue.body||'',state:issue.state,labels:issue.labels||[],comments:[]});}
 for(const [number,issue] of issues){
  if(!isReady(issue))continue;
  const comments=await pages('/issues/'+number+'/comments');
  // Only exact owner approvals are retained; never print raw comments or bodies.
  issue.comments=comments.filter(c=>c.user?.login===factoryPolicy.owner&&typeof c.body==='string'&&/^\/factory approve [a-f0-9]{64}$/.test(c.body)).map(c=>({author:{login:c.user.login},body:c.body,created_at:c.created_at}));
  const current=(await get('/issues/'+number)).data;
  if(current.number!==number||current.pull_request)throw Error('Issue changed type');
  Object.assign(issue,{title:current.title,body:current.body||'',state:current.state,labels:current.labels||[]});
 }
 // Dependency status is fetched explicitly; missing references never count as closed.
 const dependencyIds=new Set();for(const issue of issues.values())if(isReady(issue)){let scope;try{scope=issueWorkScope(issue);}catch{continue;}for(const id of scope.dependencies)dependencyIds.add(id);}
 for(const number of dependencyIds)if(!issues.has(number)){
  const dep=(await get('/issues/'+number)).data;if(dep.number!==number||dep.pull_request)throw Error('Invalid issue dependency');issues.set(number,{number,title:dep.title,body:dep.body||'',state:dep.state,labels:dep.labels||[],comments:[]});
 }
 const pulls=await pages('/pulls',{state:'open'}),active=[];
 for(const pr of pulls){
  if(!isNumber(pr.number))throw Error('Invalid pull request');
  const detail=(await get('/pulls/'+pr.number)).data;
  if(!Number.isSafeInteger(detail.changed_files)||detail.changed_files<1||detail.changed_files>1000||! /^[a-f0-9]{40}$/.test(detail.head?.sha||''))throw Error('Pull request conflict scope is incomplete');
  const files=await pages('/pulls/'+pr.number+'/files',{},10);
  if(files.length!==detail.changed_files)throw Error('Truncated pull request file scope');
  const current=(await get('/pulls/'+pr.number)).data;if(current.head?.sha!==detail.head.sha||current.base?.sha!==detail.base?.sha||current.base?.ref!==detail.base?.ref||current.changed_files!==detail.changed_files||current.state!=='open')throw Error('Pull request changed while collecting');
  const closingReferences=(current.body||'').matchAll(/\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?):?\s+(?:([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)?#([1-9]\d*)\b|https:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/issues\/([1-9]\d*)\b)/gi);
  const relatedIssues=[...closingReferences].filter(m=>!(m[1]||m[3])||(m[1]||m[3]).toLowerCase()===factoryPolicy.repository.toLowerCase()).map(m=>Number(m[2]||m[4]));
  active.push({issue:pr.number,relatedIssues,files:[...new Set(files.flatMap(file=>[file.filename,...(file.previous_filename?[file.previous_filename]:[])]))],state:current.draft===true&&current.user?.type==='Bot'?'running':'review'});
 }
 return {repository:factoryPolicy.repository,issues:[...issues.values()],active};
}
export function summarizeFactory(snapshot,plan){
 const approvals=snapshot.issues.filter(i=>i.state==='open'&&isReady(i)).map(i=>({issue:i.number,scopeDigest:issueScopeDigest(i)}));
 // No issue titles/bodies, comments, identities, credentials or raw HTTP errors.
 return {mode:plan.mode,dispatchEnabled:false,readyScopes:approvals,selected:plan.selected,blocked:plan.blocked,activationBlockers:plan.activationBlockers};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 try{
  if(process.env.GITHUB_REPOSITORY!==factoryPolicy.repository||process.env.GITHUB_REF!=='refs/heads/main'||!process.env.GITHUB_TOKEN)throw Error('Trusted main workflow required');
  const snapshot=await collectFactorySnapshot({token:process.env.GITHUB_TOKEN}),summary=summarizeFactory(snapshot,planFactory(snapshot));
  const text=JSON.stringify(summary,null,2);console.log(text);
  if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,'## Factory proposal — no agents started\n\n```json\n'+text+'\n```\n');
 }catch{console.error('Factory collection failed; no complete proposal was produced and no agent was started.');process.exitCode=1;}
}
