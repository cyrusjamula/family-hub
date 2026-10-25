import {factoryPolicy,planFactory} from './factory-plan.mjs';

// DRAFT SIMULATION LIBRARY, deliberately not a CLI or production dispatcher.
// The reader/flags below are injected test fixtures, NOT authenticated evidence.
// Production needs a separately reviewed trusted GitHub collector, entitlement/
// budget enforcement, durable shared storage and a supported provider adapter.
const controls=['scripts/factory-dispatch.mjs','scripts/factory-store.mjs','scripts/factory-input-audit.mjs'];
const changesControls=files=>files.some(file=>controls.some(control=>file===control||file.startsWith(control+'/')||control.startsWith(file+'/')));
const prerequisites=['activation','entitlement','budget','sourceAudit'];
const bounded=async(fn,timeoutMs)=>{
 let timer;try{return await Promise.race([Promise.resolve().then(fn),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('adapter timeout')),timeoutMs);})]);}finally{clearTimeout(timer);}
};
export function createSimulationController({store,readSimulationSnapshot,simulationAdapter,readSimulationGates=()=>({}),now=()=>Date.now(),timeoutMs=1000,runtimeMs=60000}){
 if(!store||typeof readSimulationSnapshot!=='function')throw Error('store and simulation snapshot reader required');
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>5000||!Number.isSafeInteger(runtimeMs)||runtimeMs<1||runtimeMs>3600000)throw Error('invalid simulation bounds');
 const gates=()=>{try{const g=readSimulationGates();return prerequisites.every(k=>g?.[k]===true)&&Number.isFinite(g.expiresAt)&&g.expiresAt>now();}catch{return false;}};
 const adapterReady=()=>simulationAdapter?.mode==='simulation'&&['start','inspect','cancel'].every(k=>typeof simulationAdapter[k]==='function');
 function planWithLocalWork(snapshot,localActive,existingIssue){
  const checkedAt=now();
  // Validate the original inventory before augmenting it. Missing/null active
  // means external work is unknown, never that there is no external work.
  planFactory(snapshot,checkedAt);
  // Once claimed, validate this issue independently of new candidate ordering.
  // Closed issues stay available for dependency checks; open dependencies remain
  // unknown/incomplete, and all external/local active locks still apply.
  const issues=existingIssue===undefined?snapshot.issues:snapshot.issues.filter(issue=>issue.number===existingIssue||issue.state==='closed');
  return planFactory({...snapshot,issues,active:[...snapshot.active,...localActive]},checkedAt);
 }

 async function candidate(number){
  if(!gates())return {blocked:'prerequisites disabled or expired'};
  if(!adapterReady())return {blocked:'simulation adapter missing'};
  const snapshot=await bounded(readSimulationSnapshot,timeoutMs);
  // planFactory checks the fixed repository, exact scope digest, owner comment,
  // approval age, dependencies, canonical file scopes and protected changes.
  // This does NOT authenticate a caller-supplied snapshot or GitHub identity.
  const active=store.active().map(r=>({issue:r.issue,files:r.files,state:r.state==='review'?'review':'running'}));
  const plan=planWithLocalWork(snapshot,active);
  const selected=plan.selected.find(x=>x.issue===number&&!changesControls(x.files));
  return selected?{candidate:{...selected,repository:factoryPolicy.repository}}:{blocked:plan.blocked.find(x=>x.issue===number)?.reason||'not selected'};
 }
 return Object.freeze({
  async dispatch(number){
   const initial=await candidate(number);if(initial.blocked)return initial;
   const claimed=store.claim(initial.candidate,now(),runtimeMs);if(claimed.blocked)return claimed;
   const id=claimed.run.id;
   try{
    // Re-read after the durable claim. The current run is omitted for its own
    // readiness check, but other active scopes remain conflict locks.
    const snapshot=await bounded(readSimulationSnapshot,timeoutMs);
    const plan=planWithLocalWork(snapshot,store.active().filter(r=>r.id!==id).map(r=>({issue:r.issue,files:r.files,state:'running'})),number);
    const current=plan.selected.find(x=>x.issue===number&&!changesControls(x.files));
    if(!gates()||now()>=claimed.run.deadline||!current||current.scopeDigest!==claimed.run.digest||!store.markUncertain(id)){
     store.abandonClaim(id);return {blocked:'readiness changed before start',run:store.get(id)};
    }
    const result=await bounded(()=>simulationAdapter.start({operationId:id,issue:number,scopeDigest:current.scopeDigest,files:current.files}),timeoutMs);
    store.recordStarted(id,result?.externalId);
   }catch{
    // Once the uncertain marker is committed, any exception/timeout may hide
    // an accepted provider run. Never release or automatically retry it.
    store.abandonClaim(id);
   }
   return {run:store.get(id)};
  },
  async reconcile(id){
   const run=store.get(id);if(!run||!['uncertain','running','review','cancel_pending'].includes(run.state))return run;
   // Revocation/pause stop new dispatch, and request cleanup of existing work.
   let scopeValid=false;
   try{
    const snapshot=await bounded(readSimulationSnapshot,timeoutMs);
    const plan=planWithLocalWork(snapshot,store.active().filter(r=>r.id!==id).map(r=>({issue:r.issue,files:r.files,state:'running'})),run.issue);
    scopeValid=plan.selected.some(item=>item.issue===run.issue&&item.scopeDigest===run.digest&&!changesControls(item.files));
   }catch{} // An unavailable/malformed snapshot cannot renew approval.
   if(!scopeValid||!gates()||!adapterReady()||store.paused()||now()>=run.deadline)store.requestCancel(id);
   if(!adapterReady())return store.get(id);
   try{
    const status=await bounded(()=>simulationAdapter.inspect({operationId:id,externalId:run.external_id}),timeoutMs);
    return store.reconcile(id,status);
   }catch{return store.get(id);}
  },
  async cancel(id){
   const run=store.requestCancel(id);if(!run||run.state!=='cancel_pending'||!adapterReady())return run;
   // An unknown start must first be reconciled by operation ID. No blind retry
   // or repeated cancellation calls; caller may poll reconcile thereafter.
   if(!run.external_id||!store.claimCancellation(id))return run;
   try{await bounded(()=>simulationAdapter.cancel({operationId:id,externalId:run.external_id}),timeoutMs);}catch{}
   return store.get(id);
  }
 });
}
