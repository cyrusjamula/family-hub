// Internal observation only. This snapshot never authorizes dispatch, release,
// or resume: another worker can change the row immediately after it is read.
const invalid=()=>Error('Factory claim observation unavailable; preserve any existing lock');
const operationPattern=/^[A-Za-z0-9_-]{1,128}$/;
const digestPattern=/^[a-f0-9]{64}$/;

export async function observeD1FactoryClaim(db){
 try{
  const result=await db.prepare('SELECT singleton, paused, state, operation_id, scope_digest, external_task_id, cancel_requested FROM factory_claim_slot LIMIT 2').all();
  if(result?.success!==true||!Array.isArray(result.results)||result.results.length!==1)throw invalid();
  const row=result.results[0];
  if(!row||row.singleton!==1||(row.paused!==0&&row.paused!==1)||
    !['idle','claimed','uncertain'].includes(row.state)||(row.cancel_requested!==0&&row.cancel_requested!==1))throw invalid();
  if(row.state==='idle'){
   if(row.operation_id!==null||row.scope_digest!==null||row.external_task_id!==null||row.cancel_requested!==0)throw invalid();
  }else if(typeof row.operation_id!=='string'||!operationPattern.test(row.operation_id)||
           typeof row.scope_digest!=='string'||!digestPattern.test(row.scope_digest)||
           (row.external_task_id!==null&&(typeof row.external_task_id!=='string'||!operationPattern.test(row.external_task_id))))throw invalid();
  return Object.freeze({paused:row.paused===1,state:row.state,operationId:row.operation_id,scopeDigest:row.scope_digest,externalTaskId:row.external_task_id,cancelRequested:row.cancel_requested===1});
 }catch{throw invalid();}
}
