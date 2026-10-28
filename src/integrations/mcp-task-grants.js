// Unmounted review-only boundary. All identities below MUST be supplied by a
// trusted host after verification, not from request arguments or token claims
// that have not been cryptographically verified. There is no grant UI, issuer,
// production schema, or route. The host must separately authorize sharing.
const id=/^[A-Za-z0-9_-]{1,128}$/;
const taskId=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const roles=new Set(['owner','parent','child']);
const unavailable=()=>({ok:false,error:'Task unavailable'});
export function createMcpTaskGrants({db,resolveOwner,resolveMember,resolveClient,verifyApproval,now=()=>Math.floor(Date.now()/1000)}={}){
 if(!db||typeof db.prepare!=='function'||typeof db.batch!=='function'||typeof resolveOwner!=='function'||typeof resolveMember!=='function'||typeof resolveClient!=='function'||typeof verifyApproval!=='function'||typeof now!=='function')throw Error('Invalid grant configuration');
 async function owner(session){
  const actor=await resolveOwner(session);
  if(!actor||!id.test(actor.id||'')||actor.role!=='owner')return false;
  const current=await resolveMember(actor.id);
  return current?.id===actor.id&&current.role==='owner'?actor.id:false;
 }
 async function member(memberId){
  if(typeof memberId!=='string'||!id.test(memberId))return null;
  const person=await resolveMember(memberId);
  return person?.id===memberId&&roles.has(person.role)?person:null;
 }
 return Object.freeze({
  // `session` is verified by the host. Only a current owner can consent to
  // disclosure. `confirmation` must be verified by the trusted host as a distinct owner
  // approval for the exact grant details shown to the owner.
  async approve(session,{grantId,task,version,memberId,clientId,expiresAt,confirmation}={}){
   try{
    const actor=await owner(session),time=now();
    if(!actor||typeof grantId!=='string'||!id.test(grantId)||typeof task!=='string'||!taskId.test(task)||
       !Number.isSafeInteger(version)||version<1||typeof clientId!=='string'||!id.test(clientId)||!Number.isSafeInteger(time)||
       !Number.isSafeInteger(expiresAt)||expiresAt<=time||expiresAt>time+7*86400)return false;
    const person=await member(memberId);
    if(!person||await resolveClient(person.id,clientId)!==true)return false;
    const details=Object.freeze({grantId,task,version,memberId:person.id,clientId,expiresAt});
    if(await verifyApproval(session,actor,details,confirmation)!==true)return false;
    // D1 batch is transactional: retire only an expired matching grant, retain
    // historical IDs for replay protection, and insert the fresh consent together.
    const retired=db.prepare(`UPDATE mcp_task_read_grants SET revoked=1
     WHERE task_id=? AND task_version=? AND member_id=? AND client_id=? AND revoked=0 AND expires_at<=?
     AND NOT EXISTS (SELECT 1 FROM mcp_task_read_grants WHERE id=?)
     AND EXISTS (SELECT 1 FROM tasks WHERE id=? AND version=? AND assignee_id=? AND (room='family' OR (room='parents' AND ? IN ('owner','parent'))))`)
     .bind(task,version,person.id,clientId,time,grantId,task,version,person.id,person.role);
    const inserted=db.prepare(`INSERT OR IGNORE INTO mcp_task_read_grants(id,task_id,task_version,member_id,client_id,approved_by,expires_at)
     SELECT ?,id,version,?,?,?,? FROM tasks WHERE id=? AND version=? AND assignee_id=? AND (room='family' OR (room='parents' AND ? IN ('owner','parent')))`)
     .bind(grantId,person.id,clientId,actor,expiresAt,task,version,person.id,person.role);
    const result=await db.batch([retired,inserted]);
    return result?.length===2&&result.every(r=>r?.success===true)&&result[1]?.meta?.changes===1;
   }catch{return false;}
  },
  async revoke(session,grantId){
   try{if(!await owner(session)||typeof grantId!=='string'||!id.test(grantId))return false;
    const result=await db.prepare('UPDATE mcp_task_read_grants SET revoked=1 WHERE id=? AND revoked=0').bind(grantId).run();
    return result?.success===true&&result?.meta?.changes===1;
   }catch{return false;}
  },
  // The host passes `principal` ONLY after verifying OAuth issuer, audience,
  // signature, read scope and client identity. The current boundary does not
  // yet return client identity, so it cannot safely call this method.
  async read(principal,task){
   try{
    if(!principal||typeof principal.clientId!=='string'||!id.test(principal.clientId)||typeof task!=='string'||!taskId.test(task))return unavailable();
    const person=await member(principal.memberId),time=now();
    if(!person||!Number.isSafeInteger(time)||await resolveClient(person.id,principal.clientId)!==true)return unavailable();
    const row=await db.prepare(`SELECT t.id,t.title,t.details,t.provenance,t.status,t.approval,t.version FROM tasks t
     WHERE t.id=? AND t.assignee_id=? AND (t.room='family' OR (t.room='parents' AND ? IN ('owner','parent')))
     AND EXISTS (SELECT 1 FROM mcp_task_read_grants g WHERE g.task_id=t.id AND g.task_version=t.version
      AND g.member_id=? AND g.client_id=? AND g.revoked=0 AND g.expires_at>?)`)
     .bind(task,person.id,person.role,person.id,principal.clientId,time).first();
    return row?{ok:true,task:row}:unavailable();
   }catch{return unavailable();}
  }
 });
}
