// Internal D1 primitive only; no route, binding, automatic migration or provider.
// The caller is responsible for authentication and freshly verified approval,
// budget, source and provider readiness. A claim alone authorizes no dispatch.
const operationPattern=/^[A-Za-z0-9_-]{1,128}$/;
const digestPattern=/^[a-f0-9]{64}$/;
const invalid=()=>Error('Factory claim unavailable; preserve any existing lock');

function parameters(operationId,digest){
 if(typeof operationId!=='string'||!operationPattern.test(operationId)||
    typeof digest!=='string'||!digestPattern.test(digest))throw invalid();
}
async function write(db,sql,...values){
 try{
  const result=await db.prepare(sql).bind(...values).run();
  if(result?.success!==true||!Number.isSafeInteger(result.meta?.changes)||
     result.meta.changes<0||result.meta.changes>1)throw invalid();
  return result.meta.changes===1;
 }catch{throw invalid();}
}

export function createD1FactoryClaims(db){
 if(!db||typeof db.prepare!=='function')throw invalid();
 return Object.freeze({
  async claim(operationId,digest){
   parameters(operationId,digest);
   // One conditional statement is the global claim transaction: two workers
   // cannot both change the same idle row, even across process restarts.
   return write(db,"UPDATE factory_claim_slot SET operation_id=?, scope_digest=?, state='claimed' WHERE singleton=1 AND paused=0 AND state='idle' AND operation_id IS NULL",operationId,digest);
  },
  async markUncertain(operationId,digest){
   parameters(operationId,digest);
   return write(db,"UPDATE factory_claim_slot SET state='uncertain' WHERE singleton=1 AND paused=0 AND state='claimed' AND operation_id=? AND scope_digest=?",operationId,digest);
  },
  async pause(){
   // Idempotent pause cannot release any active or uncertain operation.
   return write(db,'UPDATE factory_claim_slot SET paused=1 WHERE singleton=1 AND paused=0');
  }
 });
}
