import {createGitHubTaskReader} from './factory-github-tasks.mjs';
import {createD1FactoryClaims} from '../src/factory-d1-claims.js';
import {observeD1FactoryClaim} from '../src/factory-d1-observe.js';

const operation=/^[A-Za-z0-9_-]{1,128}$/;
const digest=/^[a-f0-9]{64}$/;
const taskId=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const terminal=new Set(['completed','failed','cancelled','timed_out']);
const blocked=()=>Object.freeze({released:false,dispatchEnabled:false,state:'blocked'});

// Trusted-host integration only. No route, CLI, deployment or provider mutation.
// authorizeRecovery must authenticate the current owner and exact operation/scope;
// request text and provider metadata are never authority to recover a claim.
export function createFactoryRecovery({enabled=false,db,token,send,authorizeRecovery}={}){
 if(typeof enabled!=='boolean')throw Error('Invalid recovery configuration');
 if(!enabled)return Object.freeze({reconcile:async()=>blocked()});
 if(typeof authorizeRecovery!=='function')throw Error('Invalid recovery configuration');
 const claims=createD1FactoryClaims(db),reader=createGitHubTaskReader({token,send});
 return Object.freeze({async reconcile(session,{operationId,scopeDigest}={}){
  try{
   if(typeof operationId!=='string'||!operation.test(operationId)||typeof scopeDigest!=='string'||!digest.test(scopeDigest))return blocked();
   const request=Object.freeze({operationId,scopeDigest});
   if(await authorizeRecovery(session,request)!==true)return blocked();
   // Pause first, and leave it paused even after a successful recovery. This
   // cannot cancel a provider session or grant permission for another dispatch.
   await claims.pause();
   const row=await observeD1FactoryClaim(db);
   if(!row.paused||row.state==='idle'||row.operationId!==operationId||row.scopeDigest!==scopeDigest||
      typeof row.externalTaskId!=='string'||!taskId.test(row.externalTaskId))return blocked();
   const task=await reader.inspect(row.externalTaskId);
   if(task.id!==row.externalTaskId||task.terminal!==true||!terminal.has(task.state)||
      !task.sessions.length||task.sessions.some(s=>s.terminal!==true||!terminal.has(s.state)))return blocked();
   // Recheck authentication after the external read; revoked approval cannot
   // release storage. The conditional write rejects changed identity or intent.
   if(await authorizeRecovery(session,request)!==true)return blocked();
   const result=await db.prepare(`UPDATE factory_claim_slot SET state='idle',operation_id=NULL,scope_digest=NULL,external_task_id=NULL,cancel_requested=0
    WHERE singleton=1 AND paused=1 AND state=? AND operation_id=? AND scope_digest=? AND external_task_id=? AND cancel_requested=?`)
    .bind(row.state,operationId,scopeDigest,row.externalTaskId,row.cancelRequested?1:0).run();
   if(result?.success!==true||result?.meta?.changes!==1)return blocked();
   return Object.freeze({released:true,dispatchEnabled:false,state:'paused'});
  }catch{return blocked();}
 }});
}
