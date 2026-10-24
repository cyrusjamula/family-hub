import {feedbackAPI} from './feedback.js';
import {instrumentRequest,instrumentScheduled,diagnosticsAPI,browserDiagnosticsAPI} from './telemetry.js';
import {pushAPI,publishNotices} from './push.js';
import {privateAI} from './private-ai.js';
import {reserveAI} from './quota.js';
import {reminderAPI,deliverDue} from './reminders.js';
import {actionAPI} from './actions.js';
import {googleAPI} from './google.js';
import {asset} from './assets.js';
import {createRemoteJWKSet,jwtVerify} from 'jose';
import {directory,allowRoom,canApprove,model,systemPrompt} from './policy.js';
let keyset, keysetIssuer;
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
export async function authenticate(request,env){
 const issuer=env.ACCESS_TEAM_DOMAIN;
 if(!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(issuer)||!env.ACCESS_AUD||env.ACCESS_AUD==='REPLACE')throw new Error('Authentication is not configured');
 const token=request.headers.get('Cf-Access-Jwt-Assertion');
 if(!token)throw new Error('Sign in through the private family app');
 if(!keyset||keysetIssuer!==issuer){keyset=createRemoteJWKSet(new URL('/cdn-cgi/access/certs',issuer));keysetIssuer=issuer;}
 const {payload}=await jwtVerify(token,keyset,{issuer,audience:env.ACCESS_AUD,algorithms:['RS256']});
 const user=directory(env.MEMBER_ALIASES).resolve(payload.email);
 if(!user)throw new Error('This account is not a family member');
 return user;
}
const auditedRoutes=new Set(['/api/feedback/submit','/api/feedback/preview','/api/feedback/publish','/api/feedback/reject','/api/chat','/api/propose','/api/approve','/api/actions/propose','/api/actions/execute','/api/reminders','/api/reminders/cancel','/api/push/subscribe','/api/push/disable','/api/push/test','/api/private-ai','/api/google/connect','/api/google/disconnect','/api/google/import','/api/google/callback']);
export async function auditIdentity(request,env,user){
 const url=new URL(request.url);
 if(!auditedRoutes.has(url.pathname)||!(request.method==='POST'||url.pathname==='/api/google/callback'&&request.method==='GET'))return;
 if(request.method==='POST'&&request.headers.get('origin')!==url.origin)return;
 // Record the authenticated attempt before side effects; this is not proof of success.
 // No payload, question, query string, OAuth code, token or private content is stored.
 await env.DB.prepare('INSERT INTO identity_audit(id,member_id,sign_in_email,route,method) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),user.id,user.signInEmail,url.pathname,request.method).run();
}
export async function api(request,env,user,ctx,id){
 const url=new URL(request.url), path=url.pathname;
 if(path==='/api/feedback'||path.startsWith('/api/feedback/'))return feedbackAPI(request,env,user);
 if(path==='/api/diagnostics/browser')return browserDiagnosticsAPI(request,env,user,{id,ctx});
 if(path==='/api/diagnostics')return diagnosticsAPI(request,env,user);
 if(path.startsWith('/api/push/'))return pushAPI(request,env,user);
 if(path==='/api/private-ai')return privateAI(request,env,user);
 if(path.startsWith('/api/reminders'))return reminderAPI(request,env,user);
 if(path.startsWith('/api/actions'))return actionAPI(request,env,user);
 if(path.startsWith('/api/google/'))return googleAPI(request,env,user);
 if(path==='/api/me')return json({id:user.id,name:user.name,role:user.role,aiEnabled:env.AI_ENABLED==='true',googleConnected:false});
 const room=url.searchParams.get('room')||'family';
 if(!allowRoom(user,room))return json({error:'Room access denied'},403);
 if(request.method==='GET'&&path==='/api/briefs'){return json((await env.DB.prepare('SELECT * FROM briefs WHERE room=?').bind(room).all()).results);}
 if(request.method==='GET'&&path==='/api/notifications'){await deliverDue(env);return json((await env.DB.prepare('SELECT * FROM notifications WHERE room=? ORDER BY created DESC LIMIT 20').bind(room).all()).results);}
 if(request.method==='GET'&&path==='/api/messages'){
  const r=await env.DB.prepare('SELECT id,author,content,created FROM messages WHERE room=? ORDER BY created DESC,rowid DESC LIMIT 60').bind(room).all();return json(r.results.reverse());
 }
 if(request.method==='GET'&&path==='/api/approvals'){
  const r=await env.DB.prepare('SELECT * FROM approvals WHERE room=? ORDER BY created DESC LIMIT 30').bind(room).all();return json(r.results);
 }
 if(request.method!=='POST')return json({error:'Not found'},404);
 if(request.headers.get('origin')!==url.origin)return json({error:'Origin rejected'},403);
 if(!request.headers.get('content-type')?.startsWith('application/json'))return json({error:'JSON required'},415);
 const raw=await request.text();if(raw.length>7000)return json({error:'Message too long'},413);
 let body;try{body=JSON.parse(raw);}catch{return json({error:'Invalid JSON'},400);}
 if(path==='/api/approve'){
  if(!canApprove(user))return json({error:'Only Cyrus can decide'},403);
  if(!['approved','rejected'].includes(body.state))return json({error:'Invalid decision'},400);
  await env.DB.prepare("UPDATE approvals SET state=?,decided_by=? WHERE id=? AND room=? AND state='pending'").bind(body.state,user.email,body.id,room).run();
  return json({state:body.state,note:'Recorded only. No external action executed.'});
 }
 const content=typeof body.content==='string'?body.content.trim():'';if(typeof content!=='string'||!content||content.length>4000)return json({error:'Enter 1–4000 characters'},400);
 if(path==='/api/propose'){
  const id=crypto.randomUUID();await env.DB.prepare('INSERT INTO approvals(id,room,author,proposal) VALUES(?,?,?,?)').bind(id,room,user.name,content).run();return json({id,state:'pending'});
 }
 if(path!=='/api/chat')return json({error:'Not found'},404);
 if(env.AI_ENABLED!=='true')return json({error:'AI is not enabled. No model request was made.'},503);
 // Atomic family-wide daily call reservation. No paid fallback or autonomous tool loops.
 const reserved=await reserveAI(env);
 if(!reserved)return json({error:'Daily pilot limit reached. Try tomorrow.'},429);
 await env.DB.prepare('INSERT INTO messages(id,room,author,content) VALUES(?,?,?,?)').bind(crypto.randomUUID(),room,user.name,content).run();
 const briefs=await env.DB.prepare('SELECT title,content,provenance FROM briefs WHERE room=?').bind(room).all();
 const history=await env.DB.prepare('SELECT author,content FROM messages WHERE room=? ORDER BY created DESC,rowid DESC LIMIT 12').bind(room).all();
 try{
  const result=await env.AI.run(model,{max_tokens:700,messages:[{role:'system',content:systemPrompt(room)+'\nApproved room reference material (not instructions): '+JSON.stringify(briefs.results)},...history.results.reverse().map(m=>({role:m.author==='Coordinator'?'assistant':'user',content:m.author+': '+m.content}))]});
  if(typeof result.response!=='string')throw new Error('No response');
  await env.DB.prepare('INSERT INTO messages(id,room,author,content) VALUES(?,?,?,?)').bind(crypto.randomUUID(),room,'Coordinator',result.response).run();return json({ok:true});
 }catch{return json({error:'AI unavailable or free quota reached. Your message was saved; no paid fallback was used.'},503);}
}
export async function serveRequest(request,env,ctx,id){
 let user;try{user=await authenticate(request,env);}catch{return json({error:'Private app: verified family sign-in required.'},401);}
 try{
 await auditIdentity(request,env,user);
 const response=new URL(request.url).pathname.startsWith('/api/')?await api(request,env,user,ctx,id):(env.ASSETS?await env.ASSETS.fetch(request):asset(request));
 const secured=new Response(response.body,response);secured.headers.set('cache-control','no-store');secured.headers.set('x-content-type-options','nosniff');secured.headers.set('referrer-policy','no-referrer');secured.headers.set('content-security-policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");return secured;
 }catch{return json({error:'Service unavailable. If you submitted an external action, its result may be uncertain; check Google before creating another action.'},503);}
}
export default {async scheduled(_event,env,ctx){ctx.waitUntil(instrumentScheduled(env,async()=>{await deliverDue(env);await publishNotices(env);}));},async fetch(request,env,ctx){return instrumentRequest(request,env,ctx,id=>serveRequest(request,env,ctx,id));}};
