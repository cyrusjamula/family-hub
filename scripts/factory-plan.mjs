import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

// Read-only planner. This file has no provider, network, dispatch or write capability.
export const factoryPolicy=Object.freeze({repository:'cyrusjamula/family-hub',owner:'cyrusjamula',maxParallel:2,dispatchEnabled:false});
export function issueScopeDigest(issue){
 return createHash('sha256').update(JSON.stringify({repository:factoryPolicy.repository,number:issue.number,title:issue.title,body:issue.body})).digest('hex');
}
function sections(body){
 const normalized=body.replace(/\r\n?/g,'\n'),headings=[...normalized.matchAll(/^## ([^\n]+)$/gm)],result=new Map();
 for(let i=0;i<headings.length;i++){const name=headings[i][1].trim().toLowerCase();if(result.has(name))throw Error('ambiguous duplicate readiness section');result.set(name,normalized.slice(headings[i].index+headings[i][0].length,headings[i+1]?.index??normalized.length).trim());}
 return result;
}
function canonicalScope(path){
 if(typeof path!=='string'||!path||path!==path.trim()||!/^[A-Za-z0-9_.\/-]+$/.test(path)||path.includes('//'))throw Error('invalid file scope');
 const canonical=path.endsWith('/')?path.slice(0,-1):path;
 if(canonical.split('/').some(segment=>!segment||segment==='.'||segment==='..'))throw Error('invalid file scope');
 return canonical;
}
export function issueWorkScope(issue){
 if(typeof issue.title!=='string'||typeof issue.body!=='string'||!Number.isSafeInteger(issue.number)||issue.number<1)throw Error('invalid issue');
 const parsed=sections(issue.body);
 for(const name of ['Scope','Acceptance checks','Regression tests','Files','Depends on'])if(!parsed.get(name.toLowerCase()))throw Error('missing readiness fields');
 const files=parsed.get('files').split('\n').map(s=>canonicalScope(s.replace(/^[-*]\s*/, '').replaceAll('`','').trim()));
 const depText=parsed.get('depends on');
 if(depText!=='None'&&!/^(?:#\d+[\s,]*)+$/.test(depText))throw Error('invalid dependency scope');
 const dependencies=[...depText.matchAll(/#(\d+)/g)].map(m=>Number(m[1]));
 return {files:[...new Set(files)],dependencies};
}
const overlaps=(left,right)=>left.some(a=>right.some(b=>a===b||a.startsWith(b.endsWith('/')?b:b+'/')||b.startsWith(a.endsWith('/')?a:a+'/')));
const protectedFiles=['.github','migrations','AGENTS.md','wrangler.jsonc','src/policy.js','src/google.js','src/worker.js','src/actions.js','src/push.js','src/reminders.js','src/private-ai.js','src/feedback.js','src/quota.js','scripts/deploy.mjs','scripts/ci.mjs','scripts/factory-plan.mjs','scripts/factory-collect.mjs'];
export function planFactory(snapshot,now=Date.now()){
 if(snapshot?.repository!==factoryPolicy.repository||!Array.isArray(snapshot.issues)||!Array.isArray(snapshot.active))throw Error('A trusted repository snapshot and active-work list are required');
 const seen=new Set();for(const issue of snapshot.issues){if(seen.has(issue.number))throw Error('Ambiguous duplicate issue');seen.add(issue.number);}
 const active=snapshot.active.filter(a=>['running','review'].includes(a.state)).map(a=>{
  if(!Number.isSafeInteger(a.issue)||a.issue<1||!Array.isArray(a.files)||!a.files.length)throw Error('Active work lacks a conflict scope');
  if(a.relatedIssues!==undefined&&(!Array.isArray(a.relatedIssues)||a.relatedIssues.some(n=>!Number.isSafeInteger(n)||n<1)))throw Error('Invalid active issue links');
  return {...a,files:a.files.map(canonicalScope)};
 });
 const selected=[],blocked=[],occupied=active.flatMap(a=>a.files);
 for(const issue of [...snapshot.issues].sort((a,b)=>a.number-b.number)){
  if(issue.state!=='open'||issue.pull_request)continue;
  let reason,details,hash;
  try{details=issueWorkScope(issue);hash=issueScopeDigest(issue);}catch(error){reason=error.message;}
  const labels=(issue.labels||[]).map(l=>typeof l==='string'?l:l.name);
  if(!reason&&!labels.includes('agent-ready'))reason='not marked ready';
  const approved=(issue.comments||[]).some(c=>c.author?.login===factoryPolicy.owner&&c.body==='/factory approve '+hash&&Number.isFinite(Date.parse(c.created_at))&&Date.parse(c.created_at)<=now&&now-Date.parse(c.created_at)<=7*86400000);
  if(!reason&&!approved)reason='owner approval missing, stale or invalidated by scope edits';
  if(!reason&&active.some(a=>a.issue===issue.number||a.relatedIssues?.includes(issue.number)))reason='already active';
  if(!reason&&details.dependencies.some(n=>snapshot.issues.find(i=>i.number===n)?.state!=='closed'))reason='dependency incomplete or unknown';
  if(!reason&&overlaps(details.files,protectedFiles))reason='protected changes require separate human handling';
  if(!reason&&overlaps(details.files,occupied))reason='file scope conflicts with active or selected work';
  if(!reason&&active.filter(a=>a.state==='running').length+selected.length>=factoryPolicy.maxParallel)reason='two-task concurrency cap';
  if(reason)blocked.push({issue:issue.number,reason});
  else{selected.push({issue:issue.number,scopeDigest:hash,files:details.files});occupied.push(...details.files);}
 }
 return {mode:'plan-only',dispatchEnabled:false,selected,blocked,activationBlockers:['Verify cloud-agent entitlement, included usage and spending stop controls','Review scoped dispatch permissions and durable duplicate-run leases','Authorize activation separately; this planner never starts an agent']};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 if(process.argv.length!==3)throw Error('Usage: node scripts/factory-plan.mjs trusted-snapshot.json');
 console.log(JSON.stringify(planFactory(JSON.parse(await readFile(process.argv[2],'utf8'))),null,2));
}
