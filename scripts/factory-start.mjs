import {createGitHubTaskReader} from './factory-github-tasks.mjs';
import {createD1FactoryClaims} from '../src/factory-d1-claims.js';
import {observeD1FactoryClaim} from '../src/factory-d1-observe.js';

const root='https://api.github.com/agents/repos/cyrusjamula/family-hub/tasks';
const repositoryId=1431589772;
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const operation=/^[A-Za-z0-9_-]{1,128}$/;
const digest=/^[a-f0-9]{64}$/;
const blocked=()=>Object.freeze({state:'blocked',started:false});
const uncertain=(known={})=>Object.freeze({state:'uncertain',started:null,...known});

// Unmounted trusted-host composition. Enabling this constructor is not runtime
// authorization. The host must verify the owner, exact current frozen scope,
// prompt/model, expiry/dependencies, budget, input boundaries, provider entitlement
// and a supported stop path on EVERY authorizeDispatch invocation.
export function createFactoryStart({enabled=false,db,token,send=fetch,authorizeDispatch,timeoutMs=10000}={}){
 if(typeof enabled!=='boolean')throw Error('Invalid factory start configuration');
 if(!enabled)return Object.freeze({enabled:false,dispatch:async()=>blocked()});
 if(typeof authorizeDispatch!=='function'||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000)throw Error('Invalid factory start configuration');
 const claims=createD1FactoryClaims(db),reader=createGitHubTaskReader({token,send,timeoutMs});
 async function start(request){
  const abort=new AbortController();let timer;
  try{return await Promise.race([
   (async()=>{
    const response=await send(root,{method:'POST',redirect:'manual',signal:abort.signal,headers:{accept:'application/vnd.github+json','content-type':'application/json','user-agent':'Family-Hub-Task-Starter','X-GitHub-Api-Version':'2026-03-10',authorization:'Bearer '+token},body:JSON.stringify({prompt:request.prompt,model:request.model,base_ref:'main',create_pull_request:true})});
    if(response.status!==201||response.redirected||!response.body)throw Error();
    const stream=response.body.getReader();let text='',bytes=0;const decoder=new TextDecoder();
    try{for(;;){const {done,value}=await stream.read();if(done)break;bytes+=value.byteLength;if(bytes>131072)throw Error();text+=decoder.decode(value,{stream:true});}text+=decoder.decode();}
    catch(error){await stream.cancel().catch(()=>{});throw error;}finally{stream.releaseLock();}
    const task=JSON.parse(text);
    if(typeof task?.id!=='string'||!uuid.test(task.id)||task.repository?.id!==repositoryId||task.url!==root+'/'+task.id)throw Error();
    // The documented count is optional and has no positive minimum. Metadata
    // cannot erase a verified identity or establish running/terminal evidence.
    const metadataKnown=['queued','in_progress','idle','waiting_for_user','completed','failed','cancelled','timed_out'].includes(task.state)&&
     (!Object.hasOwn(task,'session_count')||(Number.isSafeInteger(task.session_count)&&task.session_count>=0));
    return {taskId:task.id,metadataKnown};
   })(),
   new Promise((_,reject)=>{timer=setTimeout(()=>{abort.abort();reject(Error());},timeoutMs);})
  ]);}finally{clearTimeout(timer);abort.abort();}
 }
 return Object.freeze({enabled:true,async dispatch(session,input={}){
  let attempted=false,taskId;
  try{
   if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['operationId','scopeDigest','prompt','model'].includes(k)))return blocked();
   const {operationId,scopeDigest,prompt,model}=input;
   if(typeof operationId!=='string'||!operation.test(operationId)||typeof scopeDigest!=='string'||!digest.test(scopeDigest)||
      typeof prompt!=='string'||!prompt.trim()||new TextEncoder().encode(prompt).length>16000||
      typeof model!=='string'||! /^[a-z0-9][a-z0-9.-]{0,63}$/.test(model))return blocked();
   const request=Object.freeze({operationId,scopeDigest,prompt,model,baseRef:'main',createPullRequest:true});
   if(await authorizeDispatch(session,request)!==true)return blocked();
   const prior=await observeD1FactoryClaim(db);if(prior.paused||prior.state!=='idle')return blocked();
   const inventory=await reader.inventory();if(inventory.hasNonterminalTasks)return blocked();
   if(await authorizeDispatch(session,request)!==true||!await claims.claim(operationId,scopeDigest))return blocked();
   // Persist unknown outcome BEFORE any write-capable provider request. A crash
   // or lost response can never turn a second event into another start.
   if(!await claims.markUncertain(operationId,scopeDigest))return blocked();
   if(await authorizeDispatch(session,request)!==true)return blocked();
   const current=await observeD1FactoryClaim(db);
   if(current.paused||current.cancelRequested||current.state!=='uncertain'||current.operationId!==operationId||current.scopeDigest!==scopeDigest||current.externalTaskId!==null)return blocked();
   attempted=true;const accepted=await start(request);taskId=accepted.taskId;
   const recorded=await claims.recordTaskIdentity(operationId,scopeDigest,taskId);
   return recorded&&accepted.metadataKnown?Object.freeze({state:'recorded',started:true,taskId}):uncertain({started:true,taskId});
  }catch{return attempted?uncertain(taskId?{started:true,taskId}:{}):blocked();}
 }});
}
