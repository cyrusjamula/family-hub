import {factoryPolicy} from './factory-plan.mjs';

const root=`https://api.github.com/agents/repos/${factoryPolicy.repository}/tasks`;
const repositoryId=1431589772;
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const terminal=new Set(['completed','failed','cancelled','timed_out']);
const states=new Set([...terminal,'queued','in_progress','idle','waiting_for_user']);
const maxBytes=1024*1024;
const invalid=()=>Error('GitHub task read unavailable; readiness is unknown');

function pageLinks(link,url,page,maxPages){
 const relations=new Map();
 if(link)for(const part of link.split(',')){
  const match=/^\s*<([^>]+)>;\s*rel="(next|prev|first|last)"\s*$/.exec(part);
  if(!match||relations.has(match[2]))throw invalid();
  let target;try{target=new URL(match[1]);}catch{throw invalid();}
  const targetPage=target.searchParams.get('page');const n=Number(targetPage);
  const expected=new URL(url);expected.searchParams.set('page',targetPage);
  if(! /^[1-9]\d*$/.test(targetPage||'')||!Number.isSafeInteger(n)||n>maxPages||
     target.origin!==expected.origin||target.pathname!==expected.pathname||target.hash||target.username||target.password||
     [...target.searchParams].length!==[...expected.searchParams].length||
     [...expected.searchParams].some(([key,value])=>target.searchParams.get(key)!==value))throw invalid();
  relations.set(match[2],n);
 }
 if((relations.has('first')&&relations.get('first')!==1)||
    (relations.has('prev')&&relations.get('prev')!==page-1)||
    (relations.has('next')&&relations.get('next')!==page+1)||
    (relations.has('last')&&(relations.get('last')<page||
     (relations.get('last')>page&&!relations.has('next'))||
     (relations.has('next')&&relations.get('last')<relations.get('next')))))throw invalid();
 return {more:relations.has('next'),last:relations.get('last')};
}

function advertisedTotals(data){
 const keys=['total_active_count','total_archived_count'];
 if(keys.every(key=>!Object.hasOwn(data,key)))return null;
 if(!keys.every(key=>Number.isSafeInteger(data[key])&&data[key]>=0))throw invalid();
 return keys.map(key=>data[key]);
}

function taskSummary(task,expectedId){
 if(!task||typeof task.id!=='string'||!uuid.test(task.id)||
    (expectedId!==undefined&&task.id!==expectedId)||!states.has(task.state)||
    task.repository?.id!==repositoryId||task.url!==`${root}/${task.id}`)throw invalid();
 return {id:task.id,state:task.state,terminal:terminal.has(task.state)};
}

// Read-only provider boundary, deliberately separate from the simulation controller.
// Tokens belong to the trusted host; never give them to a coding sandbox. This
// reader establishes neither approval nor write permission and has no start/stop API.
export function createGitHubTaskReader({token,send=fetch,timeoutMs=10000,maxPages=10}={}){
 if(typeof token!=='string'||!token.length||token.length>4096||/[\s\x00-\x1f\x7f]/.test(token)||
    typeof send!=='function'||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000||
    !Number.isSafeInteger(maxPages)||maxPages<1||maxPages>10)throw invalid();
 async function get(url){
  const abort=new AbortController();let timer;
  try{
   return await Promise.race([
    (async()=>{
     const response=await send(url,{method:'GET',redirect:'manual',signal:abort.signal,headers:{
      accept:'application/vnd.github+json','user-agent':'Family-Hub-Task-Reader',
      'X-GitHub-Api-Version':'2026-03-10',authorization:`Bearer ${token}`}});
     if(response.status!==200||response.redirected||!response.body)throw invalid();
     const reader=response.body.getReader();const chunks=[];let bytes=0;
     try{
      while(true){const {done,value}=await reader.read();if(done)break;
       bytes+=value.byteLength;if(bytes>maxBytes)throw invalid();chunks.push(value);}
     }catch{try{await reader.cancel();}catch{}throw invalid();}
     finally{reader.releaseLock();}
     return {data:JSON.parse(Buffer.concat(chunks).toString('utf8')),link:response.headers.get('link')};
    })(),
    new Promise((_,reject)=>{timer=setTimeout(()=>{abort.abort();reject(invalid());},timeoutMs);})
   ]);
  }catch{throw invalid();}finally{clearTimeout(timer);abort.abort();}
 }
 return Object.freeze({
  async inventory(){
   const tasks=[];const seen=new Set();let totals;
   // Non-archived alone is not a complete inventory: archived rows are checked too.
   for(const archived of [false,true]){
    let bucketCount=0;let promisedLast;
    for(let page=1;page<=maxPages;page++){
     const url=`${root}?per_page=100&page=${page}&is_archived=${archived}&sort=created_at&direction=asc`;
     const {data,link}=await get(url);
     if(!Array.isArray(data?.tasks)||data.tasks.length>100)throw invalid();
     const counts=advertisedTotals(data);
     // Preview responses may omit totals; when advertised, both counts must
     // remain present and unchanged throughout this point-in-time collection.
     if(totals===undefined)totals=counts;
     else if(JSON.stringify(counts)!==JSON.stringify(totals))throw invalid();
     bucketCount+=data.tasks.length;
     const bucketTotal=totals?.[archived?1:0];
     if(bucketTotal!==undefined&&bucketCount>bucketTotal)throw invalid();
     for(const row of data.tasks){const task=taskSummary(row);if(seen.has(task.id))throw invalid();seen.add(task.id);tasks.push(task);}
     // Inspect every relation but construct requests ourselves; never follow URLs.
     const {more,last}=pageLinks(link,url,page,maxPages);
     if(last!==undefined){if(promisedLast!==undefined&&promisedLast!==last)throw invalid();promisedLast=last;}
     if(promisedLast!==undefined&&((!more&&page!==promisedLast)||(more&&page>=promisedLast)))throw invalid();
     if(!more){if(bucketTotal!==undefined&&bucketCount!==bucketTotal)throw invalid();break;}
     if(bucketTotal!==undefined&&bucketCount>=bucketTotal)throw invalid();
     if(page===maxPages||!data.tasks.length)throw invalid();
    }
   }
   return {repository:factoryPolicy.repository,dispatchEnabled:false,tasks,
    hasNonterminalTasks:tasks.some(task=>!task.terminal)};
  },
  async inspect(id){
   if(typeof id!=='string'||!uuid.test(id))throw invalid();
   const {data}=await get(`${root}/${id}`);const task=taskSummary(data,id);
   if(!Array.isArray(data.sessions)||!data.sessions.length||data.sessions.length>100||
      !Number.isSafeInteger(data.session_count)||data.session_count!==data.sessions.length)throw invalid();
   const seen=new Set();const sessions=data.sessions.map(session=>{
    if(!session||typeof session.id!=='string'||! /^[A-Za-z0-9-]{1,128}$/.test(session.id)||
       seen.has(session.id)||session.task_id!==id||session.repository?.id!==repositoryId||
       !states.has(session.state)||(task.terminal&&!terminal.has(session.state)))throw invalid();
    seen.add(session.id);return {id:session.id,state:session.state,terminal:terminal.has(session.state)};
   });
   return {...task,sessions,dispatchEnabled:false,cancellationAvailable:false};
  }
 });
}
