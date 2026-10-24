import {googleRoleAllowed,googleEnabled,accessToken,connectionScopes,base64} from './google.js';
import {members} from './policy.js';
export const FAMILY_CALENDAR='family07651998613531102346@group.calendar.google.com';
const json=(v,s=200)=>new Response(JSON.stringify(v),{status:s,headers:{'content-type':'application/json','cache-control':'no-store'}});
export async function digest(payload){const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(payload)));return Array.from(new Uint8Array(b),v=>v.toString(16).padStart(2,'0')).join('');}
export function validateAction(kind,p){
 if(!p||typeof p!=='object')throw Error('Invalid action');
 if(kind==='calendar'){
  if(typeof p.title!=='string'||!p.title.trim()||p.title.length>160||typeof p.description!=='string'||p.description.length>3000)throw Error('Invalid title or description');
  const start=Date.parse(p.start),end=Date.parse(p.end);if(!/T.*(?:Z|[+-]\d\d:\d\d)$/.test(p.start)||!/T.*(?:Z|[+-]\d\d:\d\d)$/.test(p.end)||!Number.isFinite(start)||!Number.isFinite(end)||end<=start||end-start>7*86400000)throw Error('Use explicit time zones and an event duration under seven days');
  if(p.confirmFamilyVisibility!==true)throw Error('Confirm visibility on the shared Family calendar');
  return {title:p.title.trim(),description:p.description,start:new Date(start).toISOString(),end:new Date(end).toISOString(),calendarId:FAMILY_CALENDAR,sendUpdates:'none'};
 }
 if(kind==='email'){
  if(!Array.isArray(p.to)||!p.to.length||p.to.length>4||p.to.some(e=>!Object.hasOwn(members,e)))throw Error('Choose exact family recipients');
  if(typeof p.subject!=='string'||!p.subject.trim()||p.subject.length>160||/[\r\n]/.test(p.subject)||typeof p.body!=='string'||!p.body.trim()||p.body.length>5000)throw Error('Invalid email subject or body');
  return {to:[...new Set(p.to)].sort(),subject:p.subject.trim(),body:p.body};
 }
 throw Error('Unsupported action');
}
export async function executeGoogleAction(env,user,action){
 const p=JSON.parse(action.payload),token=await accessToken(env,user);
 if(action.kind==='calendar'){
  const id='jamula'+action.id.replaceAll('-','');const endpoint='https://www.googleapis.com/calendar/v3/calendars/'+encodeURIComponent(FAMILY_CALENDAR)+'/events';
  const body={id,summary:p.title,description:p.description,start:{dateTime:p.start},end:{dateTime:p.end},extendedProperties:{private:{jamulaAction:action.id,digest:action.digest}}};
  let r=await fetch(endpoint+'?sendUpdates=none',{method:'POST',redirect:'manual',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(body)});
  if(r.status===409){r=await fetch(endpoint+'/'+id,{headers:{authorization:'Bearer '+token},redirect:'manual'});if(!r.ok)throw Error('Could not verify existing event');const e=await r.json();if(e.extendedProperties?.private?.digest!==action.digest)throw Error('Existing event differs');return e.id;}
  if(!r.ok)throw Error('Calendar write rejected');return (await r.json()).id;
 }
 const subject='=?UTF-8?B?'+base64(new TextEncoder().encode(p.subject))+'?=';
 const mime=['To: '+p.to.join(', '),'Subject: '+subject,'MIME-Version: 1.0','Content-Type: text/plain; charset=UTF-8','Content-Transfer-Encoding: base64','',''+base64(new TextEncoder().encode(p.body))].join('\r\n');
 const raw=base64(new TextEncoder().encode(mime)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
 const r=await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send',{method:'POST',redirect:'manual',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({raw})});if(!r.ok)throw Error('Email send rejected');return (await r.json()).id;
}
export async function actionAPI(request,env,user,executor=executeGoogleAction){
 if(!googleRoleAllowed(user))return json({error:'Only Cyrus can review or execute external actions'},403);
 const url=new URL(request.url);
 if(request.method==='GET')return json((await env.DB.prepare('SELECT * FROM actions WHERE owner=? ORDER BY created DESC LIMIT 25').bind(user.email).all()).results);
 if(request.method!=='POST'||request.headers.get('origin')!==url.origin)return json({error:'Origin rejected'},403);
 if(!request.headers.get('content-type')?.startsWith('application/json'))return json({error:'JSON required'},415);
 const text=await request.text();if(text.length>10000)return json({error:'Request too large'},413);let body;try{body=JSON.parse(text);}catch{return json({error:'Invalid JSON'},400);}
 if(url.pathname==='/api/actions/propose'){
  let payload;try{payload=validateAction(body.kind,body.payload);}catch(e){return json({error:e.message},400);}
  const id=crypto.randomUUID(),hash=await digest(payload);await env.DB.prepare('INSERT INTO actions(id,owner,kind,room,payload,digest,expires) VALUES(?,?,?,?,?,?,?)').bind(id,user.email,body.kind,'parents',JSON.stringify(payload),hash,Date.now()+86400000).run();return json({id,digest:hash,state:'pending'});
 }
 if(url.pathname!=='/api/actions/execute')return json({error:'Not found'},404);
 if(!googleEnabled(env))return json({error:'Google actions are disabled or not configured. No action was attempted.'},503);
 if(body.confirmExactAction!==true)return json({error:'Review and confirm the exact action first'},400);
 const a=await env.DB.prepare('SELECT * FROM actions WHERE id=? AND owner=?').bind(body.id,user.email).first();
 if(!a||a.state!=='pending'||a.expires<Date.now()||a.digest!==body.digest||await digest(JSON.parse(a.payload))!==a.digest)return json({error:'Action expired, changed, already processed, or unavailable'},409);
 const scopes=await connectionScopes(env,user);const needed=a.kind==='calendar'?'https://www.googleapis.com/auth/calendar.events':'https://www.googleapis.com/auth/gmail.send';if(!scopes.has(needed))return json({error:'Authorize this Google action permission before execution. No action attempted.'},403);
 // Claim once. Network uncertainty never causes an automatic resend or new action.
 const claimed=await env.DB.prepare("UPDATE actions SET state='executing' WHERE id=? AND owner=? AND state='pending' AND expires>? RETURNING id").bind(a.id,user.email,Date.now()).first();if(!claimed)return json({error:'Action already claimed'},409);
 try{
  const providerId=await executor(env,user,a);await env.DB.batch([env.DB.prepare("UPDATE actions SET state='executed',provider_id=? WHERE id=?").bind(providerId,a.id),env.DB.prepare('INSERT INTO notifications(id,room,content) VALUES(?,?,?)').bind(crypto.randomUUID(),'parents','Cyrus executed '+a.kind+' action '+a.id+'.')]);return json({state:'executed',providerId});
 }catch{await env.DB.prepare("UPDATE actions SET state='uncertain' WHERE id=?").bind(a.id).run();return json({error:'Provider result uncertain or rejected. Do not retry automatically; check Google first.',state:'uncertain'},502);}
}
