// Unmounted host guard. Claim consumption is persisted before invoking the OAuth
// library. Unexpired claims survive uncertain results; expired host bindings
// cannot be submitted again and are eligible for bounded transactional cleanup.
const id=/^[A-Za-z0-9_-]{1,128}$/;
const hash=/^[a-f0-9]{64}$/;
const unavailable=()=>Error('Consent claim unavailable; start a new authorization request');
export function createD1ConsentClaims({enabled=false,db,now=Date.now,maxClaims=1000}={}){
 if(typeof enabled!=='boolean')throw unavailable();
 if(!enabled)return Object.freeze({async claim(){return false;}});
 if(typeof db?.prepare!=='function'||typeof db.batch!=='function'||typeof now!=='function'||!Number.isSafeInteger(maxClaims)||maxClaims<1||maxClaims>1000)throw unavailable();
 return Object.freeze({async claim({handleDigest,memberId,clientId,decision,expiresAt}={}){
  try{
   const time=now();
   if(typeof handleDigest!=='string'||!hash.test(handleDigest)||typeof memberId!=='string'||!id.test(memberId)||
    typeof clientId!=='string'||!id.test(clientId)||!['allow','deny'].includes(decision)||!Number.isSafeInteger(time)||
    !Number.isSafeInteger(expiresAt)||expiresAt<=time||expiresAt>time+300000)throw unavailable();
   const expired=db.prepare(`DELETE FROM mcp_consent_claims WHERE handle_digest IN
    (SELECT handle_digest FROM mcp_consent_claims WHERE expires_at<=? ORDER BY expires_at LIMIT 100)`).bind(time);
   const insert=db.prepare(`INSERT INTO mcp_consent_claims(handle_digest,member_id,client_id,decision,state,expires_at)
    SELECT ?,?,?,?,'consumed',? WHERE (SELECT count(*) FROM mcp_consent_claims)<?
    ON CONFLICT(handle_digest) DO NOTHING`).bind(handleDigest,memberId,clientId,decision,expiresAt,maxClaims);
   const results=await db.batch([expired,insert]);
   if(!Array.isArray(results)||results.length!==2||results.some(r=>r?.success!==true)||![0,1].includes(results[1]?.meta?.changes))throw unavailable();
   // The handle may expire while an adapter batch waits behind other work. An
   // expired cleanup from another request can remove its old row before this
   // delayed insert runs, so a successful insert alone is not authorization.
   const completedAt=now();
   if(!Number.isSafeInteger(completedAt)||expiresAt<=completedAt)return false;
   return results[1].meta.changes===1;
  }catch{throw unavailable();}
 }});
}
