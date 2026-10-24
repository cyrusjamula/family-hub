import {seal,open} from './google.js';
import {member} from './policy.js';
import {digest} from './actions.js';

const REPO='cyrusjamula/family-hub';
const HUB='https://jamula-family-coordinator.cyrus-7cd.workers.dev/';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const json=(data,status=200)=>Response.json(data,{status,headers:{'cache-control':'no-store'}});
const contexts=['unspecified','chat','planner','settings','advanced'];
const safeText=(value,max)=>typeof value==='string'&&value.trim()&&value.length<=max;

export function validateScreenshot(value,consent){
 if(value===undefined||value===null)return null;
 if(consent!==true)throw Error('Screenshot permission is required');
 if(!value||!['image/png','image/jpeg','image/webp'].includes(value.type)||typeof value.data!=='string'||value.data.length>200000||! /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.data))throw Error('Choose a PNG, JPEG or WebP screenshot up to 150 KB');
 const bytes=Uint8Array.from(atob(value.data),c=>c.charCodeAt(0));
 if(bytes.length<12||bytes.length>150000)throw Error('Screenshot size is invalid');
 const png=[137,80,78,71,13,10,26,10].every((b,i)=>bytes[i]===b);
 const jpeg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
 const webp=String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP';
 if(!(value.type==='image/png'&&png||value.type==='image/jpeg'&&jpeg||value.type==='image/webp'&&webp))throw Error('Screenshot content does not match its image type');
 return {type:value.type,data:value.data};
}
export function validateFeedback(body,user){
 if(!uuid.test(body.id)||!safeText(body.title,120)||!safeText(body.details,3000)||body.confirmPrivateFeedback!==true)throw Error('Enter a title, details and permission to submit');
 const context=body.includeContext===true?body.context:'unspecified';
 if(!contexts.includes(context)||context==='advanced'&&user.role!=='owner')throw Error('Invalid feedback context');
 return {title:body.title.trim(),details:body.details.trim(),context,includeName:body.includeName===true,screenshot:validateScreenshot(body.screenshot,body.confirmScreenshot)};
}
async function bodyJSON(request){
 const reader=request.body?.getReader();if(!reader)throw Error('JSON required');
 const decoder=new TextDecoder();let text='',size=0;
 for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>225000){await reader.cancel();throw Error('Feedback is too large');}text+=decoder.decode(value,{stream:true});}
 text+=decoder.decode();const body=JSON.parse(text);if(!body||typeof body!=='object'||Array.isArray(body))throw Error('Invalid feedback');return body;
}
function canRead(user,row){return row&&(user.role==='owner'||row.reporter===user.email);}
function cleanPublicText(value){return value.replaceAll('@','＠').replaceAll('<','‹').replaceAll('>','›');}
export function issuePayload(row,report,body){
 if(!safeText(body.publicTitle,120)||!safeText(body.publicDetails,3000))throw Error('Review a public title and description');
 const name=report.includeName?member(row.reporter)?.name:'Family member (identity retained privately)';
 return {title:'[Hub feedback] '+cleanPublicText(body.publicTitle.trim()),body:[cleanPublicText(body.publicDetails.trim()),'','Reporter: '+name,'Context: '+report.context,'Reported: '+row.created,'','[Restricted report'+(row.screenshot?' and screenshot':'')+']('+HUB+'#feedback='+row.id+')','The report and any screenshot require Hub sign-in and are visible only to the reporter and owner.','Feedback ID: '+row.id].join('\n')};
}
export async function feedbackAPI(request,env,user,send=fetch){
 const known=member(user?.email);if(!known||known.id!==user.id||known.role!==user.role)return json({error:'Verified family identity required'},403);
 const url=new URL(request.url),path=url.pathname;
 if(request.method==='GET'&&path==='/api/feedback/config')return json({enabled:env.FEEDBACK_ENABLED==='true',publishConfigured:user.role==='owner'?!!env.GITHUB_FEEDBACK_TOKEN:undefined});
 if(env.FEEDBACK_ENABLED!=='true')return json({error:'Feedback setup is pending'},503);
 try{
  if(request.method==='GET'){
   if(path==='/api/feedback'){
    const rows=await (user.role==='owner'?env.DB.prepare('SELECT id,reporter,reporter_id,state,issue_url,created FROM feedback ORDER BY created DESC LIMIT 30'):env.DB.prepare('SELECT id,reporter,reporter_id,state,issue_url,created FROM feedback WHERE reporter=? ORDER BY created DESC LIMIT 30').bind(user.email)).all();
    return json(rows.results.map(r=>({id:r.id,reporter:member(r.reporter)?.name,state:r.state,issueUrl:r.issue_url,created:r.created})));
   }
   const id=url.searchParams.get('id');if(!uuid.test(id))return json({error:'Invalid report ID'},400);
   const row=await env.DB.prepare('SELECT * FROM feedback WHERE id=?').bind(id).first();
   if(!canRead(user,row))return json({error:'Report unavailable'},404);
   if(path==='/api/feedback/report'){
    const report=await open(env,row.payload,'feedback:'+row.reporter+':'+row.id);
    return json({id:row.id,reporter:member(row.reporter)?.name,state:row.state,issueUrl:row.issue_url,created:row.created,...report,hasScreenshot:!!row.screenshot});
   }
   if(path==='/api/feedback/image'&&row.screenshot){
    const image=await open(env,row.screenshot,'feedback-image:'+row.reporter+':'+row.id);
    return new Response(Uint8Array.from(atob(image.data),c=>c.charCodeAt(0)),{headers:{'content-type':image.type,'cache-control':'no-store','x-content-type-options':'nosniff','content-disposition':'inline; filename="feedback-image"'}});
   }
   return json({error:'Not found'},404);
  }
  if(request.method!=='POST'||request.headers.get('origin')!==url.origin)return json({error:'Origin rejected'},403);
  if(!request.headers.get('content-type')?.startsWith('application/json'))return json({error:'JSON required'},415);
  if(path!=='/api/feedback/submit'&&user.role!=='owner')return json({error:'Only Cyrus can review and publish issues'},403);
  let body;try{body=await bodyJSON(request);}catch{return json({error:'Invalid or oversized feedback'},400);}
  if(path==='/api/feedback/submit'){
   let report;try{report=validateFeedback(body,user);}catch(error){return json({error:error.message},400);}
   const hash=await digest(report),existing=await env.DB.prepare('SELECT * FROM feedback WHERE id=?').bind(body.id).first();
   if(existing)return existing.reporter===user.email&&existing.digest===hash?json({id:existing.id,state:existing.state}):json({error:'Submission ID already used; start a new report'},409);
   const {screenshot,...payload}=report;
   const encrypted=await seal(env,payload,'feedback:'+user.email+':'+body.id),image=screenshot?await seal(env,screenshot,'feedback-image:'+user.email+':'+body.id):null;
   // Atomic per-person daily limit; aliases use the same immutable storage owner.
   const saved=await env.DB.prepare("INSERT OR IGNORE INTO feedback(id,reporter,reporter_id,payload,screenshot,digest) SELECT ?,?,?,?,?,? WHERE (SELECT count(*) FROM feedback WHERE reporter=? AND created>=date('now'))<5 RETURNING id").bind(body.id,user.email,user.id,encrypted,image,hash,user.email).first();
   if(!saved){const retry=await env.DB.prepare('SELECT * FROM feedback WHERE id=?').bind(body.id).first();if(retry?.reporter===user.email&&retry.digest===hash)return json({id:retry.id,state:retry.state});return json({error:'Five reports per person per day; check for an existing submission'},429);}
   return json({id:body.id,state:'pending',note:'Saved privately for Cyrus. Nothing was sent to GitHub.'});
  }
  if(!uuid.test(body.id))return json({error:'Invalid report ID'},400);
  const row=await env.DB.prepare('SELECT * FROM feedback WHERE id=?').bind(body.id).first();if(!row)return json({error:'Report unavailable'},404);
  if(path==='/api/feedback/reject'){
   const rejected=await env.DB.prepare("UPDATE feedback SET state='rejected' WHERE id=? AND state='pending' RETURNING id").bind(row.id).first();return rejected?json({state:'rejected'}):json({error:'Only pending reports can be rejected'},409);
  }
  if(!['/api/feedback/preview','/api/feedback/publish'].includes(path))return json({error:'Not found'},404);
  const report=await open(env,row.payload,'feedback:'+row.reporter+':'+row.id);
  let payload;try{payload=issuePayload(row,report,body);}catch(error){return json({error:error.message},400);}
  const hash=await digest(payload);
  if(path==='/api/feedback/preview')return json({payload,digest:hash,repository:REPO,visibility:'public'});
  if(!env.GITHUB_FEEDBACK_TOKEN)return json({error:'GitHub feedback connection is not configured'},503);
  if(body.confirmPublicIssue!==true||body.digest!==hash)return json({error:'Review and approve this exact public issue first'},400);
  const intent=await seal(env,payload,'feedback-public:'+row.id);
  const claimed=await env.DB.prepare("UPDATE feedback SET state='publishing',public_payload=? WHERE id=? AND state='pending' RETURNING id").bind(intent,row.id).first();
  if(!claimed)return json({error:'Already processed or publication result uncertain. Check GitHub before creating another issue.'},409);
  try{
   const response=await send('https://api.github.com/repos/'+REPO+'/issues',{method:'POST',redirect:'manual',headers:{authorization:'Bearer '+env.GITHUB_FEEDBACK_TOKEN,accept:'application/vnd.github+json','content-type':'application/json','user-agent':'Jamula-Family-Hub','X-GitHub-Api-Version':'2022-11-28'},body:JSON.stringify(payload)});
   if(response.status!==201)throw Error('GitHub rejected publication');
   const issue=await response.json();if(!Number.isSafeInteger(issue.number)||issue.number<1||issue.html_url!=='https://github.com/'+REPO+'/issues/'+issue.number)throw Error('Unverified GitHub result');
   await env.DB.prepare("UPDATE feedback SET state='published',issue_url=? WHERE id=? AND state='publishing'").bind(issue.html_url,row.id).run();
   return json({state:'published',issueUrl:issue.html_url});
  }catch{try{await env.DB.prepare("UPDATE feedback SET state='uncertain' WHERE id=? AND state='publishing'").bind(row.id).run();}catch{}return json({error:'GitHub result uncertain. Do not retry; check GitHub for Feedback ID '+row.id+'.',state:'uncertain'},502);}
 }catch{return json({error:'Feedback service unavailable. Keep your draft. If publishing, check GitHub before retrying.'},503);}
}
