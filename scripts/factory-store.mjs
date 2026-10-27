import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';

// Local simulation store only. Its directory is trusted configuration; never accept a
// database path or state transition from issue text. No production persistence adapter.
export class FactoryStore {
 constructor(path){
  this.db=new DatabaseSync(path);this.db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;
   CREATE TABLE IF NOT EXISTS factory_control (id INTEGER PRIMARY KEY CHECK(id=1), paused INTEGER NOT NULL);
   INSERT OR IGNORE INTO factory_control VALUES(1,1);
   CREATE TABLE IF NOT EXISTS factory_runs (
    id TEXT PRIMARY KEY, repository TEXT NOT NULL, issue INTEGER NOT NULL, digest TEXT NOT NULL,
    files TEXT NOT NULL, state TEXT NOT NULL, external_id TEXT, pr_url TEXT,
    created_at INTEGER NOT NULL, deadline INTEGER NOT NULL, cancel_requested INTEGER NOT NULL DEFAULT 0, cancel_attempted INTEGER NOT NULL DEFAULT 0,
    UNIQUE(repository,issue,digest));`);
 }
 close(){this.db.close();}
 transaction(fn){this.db.exec('BEGIN IMMEDIATE');try{const result=fn();this.db.exec('COMMIT');return result;}catch(error){this.db.exec('ROLLBACK');throw error;}}
 paused(){return this.db.prepare('SELECT paused FROM factory_control WHERE id=1').get().paused===1;}
 setPaused(paused){if(typeof paused!=='boolean')throw Error('boolean pause required');this.db.prepare('UPDATE factory_control SET paused=? WHERE id=1').run(Number(paused));}
 get(id){const row=this.db.prepare('SELECT * FROM factory_runs WHERE id=?').get(id);return row?{...row,files:JSON.parse(row.files)}:null;}
 active(){return this.db.prepare("SELECT * FROM factory_runs WHERE state IN ('claimed','uncertain','running','review','cancel_pending')").all().map(row=>({...row,files:JSON.parse(row.files)}));}
 claim({repository,issue,scopeDigest,files},now,runtimeMs){
  return this.transaction(()=>{
   if(this.paused())return {blocked:'paused'};
   if(this.db.prepare('SELECT id FROM factory_runs WHERE repository=? AND issue=? AND digest=?').get(repository,issue,scopeDigest))return {blocked:'duplicate scope'};
   // Global cap one, including uncertain and review work; no expired-lease stealing.
   if(this.active().length)return {blocked:'one-task cap'};
   const id=randomUUID();
   this.db.prepare("INSERT INTO factory_runs(id,repository,issue,digest,files,state,created_at,deadline) VALUES(?,?,?,?,?,'claimed',?,?)").run(id,repository,issue,scopeDigest,JSON.stringify(files),now,now+runtimeMs);
   return {run:this.get(id)};
  });
 }
 markUncertain(id){return this.transaction(()=>{
  const run=this.get(id);if(!run||run.state!=='claimed'||run.cancel_requested||this.paused())return false;
  // Commit the possibly-started state BEFORE invoking an injected adapter.
  this.db.prepare("UPDATE factory_runs SET state='uncertain' WHERE id=?").run(id);return true;
 });}
 abandonClaim(id){this.db.prepare("UPDATE factory_runs SET state='abandoned' WHERE id=? AND state='claimed'").run(id);}
 // Only the dispatching process may call this before invoking the adapter.
 // A recovered provider identity makes absence ambiguous and keeps the lock.
 cancelBeforeInvocation(id){this.db.prepare("UPDATE factory_runs SET state='cancelled' WHERE id=? AND state='cancel_pending' AND external_id IS NULL").run(id);}
 recordStarted(id,externalId){
  if(typeof externalId!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(externalId))throw Error('invalid provider run id');
  this.transaction(()=>{
   const run=this.get(id);
   if(run?.external_id&&run.external_id!==externalId)throw Error('provider identity changed');
   this.db.prepare("UPDATE factory_runs SET external_id=?,state=CASE WHEN cancel_requested=1 THEN 'cancel_pending' ELSE 'running' END WHERE id=? AND state IN ('uncertain','cancel_pending')").run(externalId,id);
  });
 }
 claimCancellation(id){return this.transaction(()=>{const run=this.get(id);if(!run||run.state!=='cancel_pending'||!run.external_id||run.cancel_attempted)return false;this.db.prepare('UPDATE factory_runs SET cancel_attempted=1 WHERE id=?').run(id);return true;});}
 requestCancel(id){this.db.prepare("UPDATE factory_runs SET cancel_requested=1,state=CASE WHEN state='claimed' THEN 'cancelled' ELSE 'cancel_pending' END WHERE id=? AND state IN ('claimed','uncertain','running','review')").run(id);return this.get(id);}
 reconcile(id,{state,externalId,prUrl,verifiedAbsent}){
  return this.transaction(()=>{
   const run=this.get(id);if(!run||!['uncertain','running','cancel_pending','review'].includes(run.state))return run;
   if(externalId!==undefined){if(typeof externalId!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(externalId))throw Error('invalid provider run id');if(run.external_id&&run.external_id!==externalId)throw Error('provider identity changed');}
   if(prUrl!==undefined&&run.pr_url&&prUrl!==run.pr_url)throw Error('PR identity changed');
   if(prUrl!==undefined&&!/^https:\/\/github\.com\/cyrusjamula\/family-hub\/pull\/[1-9]\d*$/.test(prUrl))throw Error('invalid PR link');
   if(!['running','review','failed','cancelled','not-started','unknown'].includes(state))throw Error('invalid reconciliation state');
   if(state==='unknown'||(run.state==='review'&&state==='running'))return run;
   // A response cannot simultaneously prove that no run exists and identify
   // one. Preserve the uncertain lock on contradictory provider evidence.
   if(state==='not-started'&&(externalId!==undefined||run.external_id||!['uncertain','cancel_pending'].includes(run.state)||verifiedAbsent!==true))throw Error('absence requires unresolved start and authoritative simulation evidence');
   // An uncorrelated terminal report is not evidence that an uncertain start
   // ended. Keep its lock until the provider identity is established or an
   // authoritative absence is explicitly reconciled.
   // A stored identity alone does not prove that this particular terminal
   // response belongs to the run. Require the adapter to echo the identity;
   // the check above rejects a mismatch, and omission must retain the lock.
   if(['failed','cancelled'].includes(state)&&!externalId)throw Error('provider run id required');
   if(['running','review'].includes(state)&&!(externalId||run.external_id))throw Error('provider run id required');
   if(state==='review'&&!(prUrl||run.pr_url))throw Error('review PR required');
   // Cancellation cannot be cleared by late/out-of-order running or review reports.
   const next=state==='not-started'?'abandoned':run.cancel_requested&&['running','review'].includes(state)?'cancel_pending':state;
   this.db.prepare('UPDATE factory_runs SET state=?,external_id=COALESCE(?,external_id),pr_url=COALESCE(?,pr_url) WHERE id=?').run(next,externalId??null,prUrl??null,id);
   return this.get(id);
  });
 }
}
