import {SignJWT,importJWK} from 'jose';
import {seal,open,base64,unbase64} from './google.js';
import {member,allowRoom} from './policy.js';
const json=(v,s=200)=>new Response(JSON.stringify(v),{status:s,headers:{'content-type':'application/json','cache-control':'no-store'}});
const b64=b=>base64(b).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
const decode=s=>unbase64(s.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-s.length%4)%4));
export function validEndpoint(value){try{const u=new URL(value);return value.length<=2000&&u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&(u.hostname==='fcm.googleapis.com'||u.hostname==='updates.push.services.mozilla.com'||u.hostname==='web.push.apple.com'||u.hostname.endsWith('.notify.windows.com'));}catch{return false;}}
export function publicKey(env){const j=JSON.parse(env.PUSH_VAPID_JWK);return b64(Uint8Array.from([4,...decode(j.x),...decode(j.y)]));}
export async function sendPush(env,endpoint){
 if(!validEndpoint(endpoint))throw Error('Unsupported push service');
 const key=await importJWK(JSON.parse(env.PUSH_VAPID_JWK),'ES256');
 const token=await new SignJWT({sub:'https://jamula-family-coordinator.cyrus-7cd.workers.dev'}).setProtectedHeader({alg:'ES256'}).setAudience(new URL(endpoint).origin).setExpirationTime(Math.floor(Date.now()/1000)+3600).sign(key);
 // Empty wake-up only: no room, name, record or message content leaves the server.
 const r=await fetch(endpoint,{method:'POST',redirect:'manual',headers:{Authorization:'vapid t='+token+', k='+publicKey(env),TTL:'3600',Urgency:'normal'},body:new Uint8Array()});
 return r.status;
}
export async function pushAPI(request,env,user){
 if(!member(user.email))return json({error:'Family sign-in required'},403);
 if(!env.PUSH_VAPID_JWK)return json({configured:false,error:'Push setup pending'},503);
 const url=new URL(request.url);
 if(request.method==='GET'&&url.pathname==='/api/push/config')return json({configured:true,publicKey:publicKey(env)});
 if(request.method!=='POST'||request.headers.get('origin')!==url.origin)return json({error:'Origin rejected'},403);
 if(!request.headers.get('content-type')?.startsWith('application/json'))return json({error:'JSON required'},415);
 const raw=await request.text();if(raw.length>3500)return json({error:'Request too large'},413);let b;try{b=JSON.parse(raw);}catch{return json({error:'Invalid JSON'},400);}
 if(!validEndpoint(b.endpoint))return json({error:'This browser push service is not supported yet'},400);
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(b.endpoint)),id=b64(new Uint8Array(bytes));
 if(url.pathname==='/api/push/disable'){await env.DB.prepare('DELETE FROM push_devices WHERE id=? AND owner=?').bind(id,user.email).run();return json({disabled:true});}
 if(url.pathname==='/api/push/subscribe'){
  if(b.confirmNotifications!==true)return json({error:'Notification opt-in required'},400);
  const existing=await env.DB.prepare('SELECT owner FROM push_devices WHERE id=?').bind(id).first();if(existing&&existing.owner!==user.email)return json({error:'Disable notifications for the previous signed-in account first'},409);
  const count=await env.DB.prepare('SELECT count(*) AS n FROM push_devices WHERE owner=?').bind(user.email).first();if(!existing&&count.n>=5)return json({error:'Five device limit reached'},409);
  await env.DB.prepare('INSERT INTO push_devices(id,owner,endpoint) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET endpoint=excluded.endpoint').bind(id,user.email,await seal(env,{endpoint:b.endpoint},'push:'+user.email+':'+id)).run();return json({enabled:true});
 }
 if(url.pathname!=='/api/push/test')return json({error:'Not found'},404);
 const d=await env.DB.prepare('UPDATE push_devices SET last_test=? WHERE id=? AND owner=? AND last_test<? RETURNING endpoint').bind(Date.now(),id,user.email,Date.now()-60000).first();if(!d)return json({error:'Enable this device first; test at most once per minute'},429);
 const status=await sendPush(env,(await open(env,d.endpoint,'push:'+user.email+':'+id)).endpoint);return json({accepted:status>=200&&status<300,status},status>=200&&status<300?200:502);
}
export async function publishNotices(env){
 if(!env.PUSH_VAPID_JWK)return;
 const jobs=(await env.DB.prepare("SELECT d.id,d.owner,d.endpoint,n.id AS notice,n.room FROM push_devices d JOIN notifications n ON n.created>=d.created AND n.created>=datetime('now','-1 day') LEFT JOIN push_deliveries p ON p.device=d.id AND p.notice=n.id WHERE p.device IS NULL AND (n.room='family' OR d.owner IN ('cjamula@gmail.com','anhaita.jamula@gmail.com')) ORDER BY n.created LIMIT 8").all()).results;
 for(const d of jobs){
  const u=member(d.owner);if(!u||!allowRoom(u,d.room)){await env.DB.prepare('DELETE FROM push_devices WHERE id=?').bind(d.id).run();continue;}
  const claim=await env.DB.prepare("INSERT OR IGNORE INTO push_deliveries(notice,device,state) VALUES(?,?,'claimed') RETURNING notice").bind(d.notice,d.id).first();if(!claim)continue;
  let state='failed';try{const endpoint=(await open(env,d.endpoint,'push:'+d.owner+':'+d.id)).endpoint;const status=await sendPush(env,endpoint);state=status>=200&&status<300?'accepted':'failed';if(status===404||status===410)await env.DB.prepare('DELETE FROM push_devices WHERE id=?').bind(d.id).run();}catch{}
  await env.DB.prepare('UPDATE push_deliveries SET state=? WHERE notice=? AND device=?').bind(state,d.notice,d.id).run();
 }
}
