import {releaseFor} from './release.js';
import {member} from './policy.js';

const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const routes=new Set(['/api/tasks','/api/tasks/options','/api/tasks/create','/api/tasks/update','/','/api/me','/api/briefs','/api/messages','/api/approvals','/api/notifications','/api/chat','/api/propose','/api/approve','/api/private-ai','/api/google/status','/api/google/connect','/api/google/callback','/api/google/disconnect','/api/google/verify','/api/google/calendar','/api/google/records','/api/google/record','/api/google/import','/api/actions','/api/actions/propose','/api/actions/execute','/api/reminders','/api/reminders/cancel','/api/push/config','/api/push/subscribe','/api/push/disable','/api/push/test','/api/feedback','/api/feedback/config','/api/feedback/submit','/api/feedback/report','/api/feedback/image','/api/feedback/preview','/api/feedback/publish','/api/feedback/reject','/api/feedback/reconcile','/api/diagnostics','/api/diagnostics/browser']);
const methods=new Set(['GET','POST','HEAD','OPTIONS']);
const browserTypes=new Set(['exception','rejection']),browserSections=new Set(['chat','planner','settings','advanced']);
const retention=7*86400000,dailyCap=200,totalCap=1000;
export function diagnosticMetadata(request,env,{id,status,duration,now=Date.now(),unhandled=false}){
 const path=new URL(request.url).pathname,release=releaseFor(env);
 return {id,created:now,route:routes.has(path)?path:'/other',method:methods.has(request.method)?request.method:'OTHER',status,duration_ms:Math.min(600000,Math.max(0,Math.round(duration))),category:unhandled?'unhandled':status===429?'quota_or_rate_limit':status===403?'access_denied':status>=500?'service_error':'request_error',release};
}
export async function storeDiagnostic(env,event){
 if(env.TELEMETRY_ENABLED!=='true')return;
 const day=new Date(event.created);day.setUTCHours(0,0,0,0);
 await env.DB.batch([
  env.DB.prepare('DELETE FROM diagnostics WHERE created<?').bind(event.created-retention),
  env.DB.prepare('INSERT OR IGNORE INTO diagnostics(id,created,route,method,status,duration_ms,category,release) SELECT ?,?,?,?,?,?,?,? WHERE (SELECT count(*) FROM diagnostics WHERE created>=?)<? AND (SELECT count(*) FROM diagnostics)<?').bind(event.id,event.created,event.route,event.method,event.status,event.duration_ms,event.category,event.release,day.getTime(),dailyCap,totalCap)
 ]);
}
function enqueue(env,ctx,event){
 if(env.TELEMETRY_ENABLED!=='true'||!ctx?.waitUntil)return;
 // Telemetry must never alter an operation's result or trigger a provider retry.
 try{ctx.waitUntil(storeDiagnostic(env,event).catch(()=>{}));}catch{}
}
export async function instrumentRequest(request,env,ctx,serve){
 const id=crypto.randomUUID(),start=Date.now();let response,unhandled=false;
 try{response=await serve(id);}catch{unhandled=true;response=Response.json({error:'Service unavailable. If you submitted an external action, check its result before trying again.'},{status:503});}
 const result=new Response(response.body,response);result.headers.set('x-request-id',id);result.headers.set('cache-control','no-store');result.headers.set('x-content-type-options','nosniff');
 if(result.status>=400&&result.headers.get('content-type')?.includes('application/json')){
  try{const data=await result.clone().json();if(data&&typeof data==='object'&&!Array.isArray(data)){const enriched={...data,requestId:id,error:(typeof data.error==='string'?data.error:'Request failed. Check the operation result before retrying.')+' [Reference: '+id+']'};const revised=Response.json(enriched,{status:result.status,headers:result.headers});revised.headers.delete('content-length');response=revised;}else response=result;}catch{response=result;}
 }else response=result;
 // No diagnostics payloads, unauthenticated traffic, successful request sampling,
 // request bodies, headers, exception messages or identities enter persistent logs.
 if(result.status>=400&&result.status!==401&&!new URL(request.url).pathname.startsWith('/api/diagnostics'))enqueue(env,ctx,diagnosticMetadata(request,env,{id,status:result.status,duration:Date.now()-start,unhandled}));
 return response;
}
export async function instrumentScheduled(env,run){
 const id=crypto.randomUUID(),start=Date.now();
 try{return await run();}catch{
  try{await storeDiagnostic(env,{id,created:Date.now(),route:'job/reminders-and-push',method:'SCHEDULED',status:503,duration_ms:Math.min(600000,Math.max(0,Date.now()-start)),category:'scheduled_error',release:releaseFor(env)});}catch{}
  throw Error('Scheduled Hub job failed. Reference: '+id);
 }
}
export async function diagnosticsAPI(request,env,user){
 const known=member(user?.email);
 if(!known||known.id!==user.id||known.role!=='owner'||user.role!=='owner')return Response.json({error:'Owner diagnostics only'},{status:403});
 if(env.TELEMETRY_ENABLED!=='true')return Response.json({error:'Diagnostic collection is disabled'},{status:503});
 if(request.method!=='GET')return Response.json({error:'Read-only diagnostics endpoint'},{status:405});
 const id=new URL(request.url).searchParams.get('id');if(!uuid.test(id))return Response.json({error:'Enter an exact request reference'},{status:400});
 try{
  const row=await env.DB.prepare('SELECT id,created,route,method,status,duration_ms,category,release FROM diagnostics WHERE id=? AND created>=?').bind(id,Date.now()-retention).first();
  if(!row)return Response.json({error:'No retained diagnostic for this reference. Collection may have been disabled or capped.'},{status:404});
  let incident=null;
  try{incident=await env.DB.prepare('SELECT count(*) AS occurrences,min(created) AS first_seen,max(created) AS last_seen FROM diagnostics WHERE route=? AND method=? AND status=? AND category=? AND release=? AND created>=?').bind(row.route,row.method,row.status,row.category,row.release,Date.now()-retention).first();}catch{/* A grouping failure must not hide the requested diagnostic. */}
  return Response.json({...row,incident},{headers:{'cache-control':'no-store'}});
 }catch{return Response.json({error:'Diagnostics unavailable'},{status:503});}
}
export async function browserDiagnosticsAPI(request,env,user,{id,ctx}){
 const known=member(user?.email);
 if(!known||known.id!==user.id||known.role!==user.role)return Response.json({error:'Verified family identity required'},{status:403});
 if(env.TELEMETRY_ENABLED!=='true')return Response.json({error:'Diagnostic collection is disabled'},{status:503});
 const url=new URL(request.url);
 if(request.method!=='POST'||request.headers.get('origin')!==url.origin)return Response.json({error:'Origin rejected'},{status:403});
 if(!request.headers.get('content-type')?.startsWith('application/json'))return Response.json({error:'JSON required'},{status:415});
 let body;try{
  const reader=request.body?.getReader();if(!reader)throw Error();const decoder=new TextDecoder();let text='',size=0;
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>512){await reader.cancel();throw Error();}text+=decoder.decode(value,{stream:true});}
  body=JSON.parse(text+decoder.decode());
 }catch{return Response.json({error:'Invalid browser event'},{status:400});}
 if(!body||typeof body!=='object'||Array.isArray(body)||!browserTypes.has(body.type)||!browserSections.has(body.section))return Response.json({error:'Invalid browser event'},{status:400});
 const release=releaseFor(env);
 enqueue(env,ctx,{id,created:Date.now(),route:'browser/'+body.section,method:'BROWSER',status:0,duration_ms:0,category:body.type==='exception'?'browser_exception':'browser_rejection',release});
 return Response.json({requestId:id},{status:202,headers:{'cache-control':'no-store'}});
}
