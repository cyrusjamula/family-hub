import {people,member,allowRoom} from './policy.js';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const assistants=Object.freeze({human:'Human only',coordinator:'Hub coordinator',chatgpt_cyrus:'ChatGPT · Cyrus',copilot_cyrus:'Copilot · Cyrus',copilot_anhaita:'Copilot · Anhaita',copilot_iyanah:'Copilot · Iyanah',copilot_aarish:'Copilot · Aarish'});
const allowedAssistant=(id,room)=>Object.hasOwn(assistants,id)&&!(room==='parents'&&['copilot_iyanah','copilot_aarish'].includes(id));
const json=(data,status=200)=>Response.json(data,{status,headers:{'cache-control':'no-store'}});
function validUser(user){const known=member(user?.email);return known&&known.id===user.id&&known.role===user.role;}
export function taskOptions(user,room){return {members:Object.entries(people).filter(([,p])=>allowRoom(p,room)).map(([id,p])=>({id,name:p.name})),assistants:Object.entries(assistants).filter(([id])=>allowedAssistant(id,room)).map(([id,name])=>({id,name})),canApprove:user.role==='owner'};}
export function validateTask(body,user,room){
 if(!uuid.test(body.id)||typeof body.title!=='string'||!body.title.trim()||body.title.length>140||typeof body.details!=='string'||body.details.length>3000)throw Error('Enter a task title and up to 3000 characters of detail.');
 if(body.confirmRoomVisibility!==true)throw Error('Confirm who may see this task.');
 if(!Object.hasOwn(people,body.assignee)||!allowRoom(people[body.assignee],room))throw Error('Choose a person who can access this room.');
 if(!allowedAssistant(body.assistant,room)||typeof body.approvalRequired!=='boolean')throw Error('Choose an assistant and an approval requirement.');
 if(typeof body.provenance!=='string'||body.provenance.length>500)throw Error('Keep the source note under 500 characters.');
 return {room,creator_id:user.id,assignee_id:body.assignee,assistant:body.assistant,title:body.title.trim(),details:body.details.trim(),source:'hub',provenance:body.provenance.trim(),approval_required:Number(body.approvalRequired),approval:body.approvalRequired?'requested':'not_required'};
}
function visible(row,user){return {...row,creator:people[row.creator_id]?.name||'Family member',assignee:people[row.assignee_id]?.name||'Family member',assistantName:assistants[row.assistant],canUpdate:user.role==='owner'||row.creator_id===user.id||row.assignee_id===user.id,canApprove:user.role==='owner'&&row.approval==='requested'};}
export async function taskAPI(request,env,user){
 if(!validUser(user))return json({error:'Verified family identity required'},403);
 const url=new URL(request.url),room=url.searchParams.get('room')||'family';
 if(!allowRoom(user,room))return json({error:'Room access denied'},403);
 if(request.method==='GET'){
  if(url.pathname==='/api/tasks/options')return json(taskOptions(user,room));
  if(url.pathname!=='/api/tasks')return json({error:'Not found'},404);
  const state=url.searchParams.get('state')||'active';if(!['active','all'].includes(state))return json({error:'Invalid task filter'},400);
  const rows=await env.DB.prepare("SELECT * FROM tasks WHERE room=?"+(state==='active'?" AND status IN ('todo','working')":'')+' ORDER BY created DESC,id DESC LIMIT 101').bind(room).all();
  return json({tasks:rows.results.slice(0,100).map(r=>visible(r,user)),more:rows.results.length>100});
 }
 if(request.method!=='POST'||request.headers.get('origin')!==url.origin)return json({error:'Origin rejected'},403);
 if(!request.headers.get('content-type')?.startsWith('application/json'))return json({error:'JSON required'},415);
 const raw=await request.text();if(raw.length>6000)return json({error:'Task is too large'},413);let body;try{body=JSON.parse(raw);if(!body||typeof body!=='object'||Array.isArray(body))throw Error();}catch{return json({error:'Invalid task'},400);}
 if(url.pathname==='/api/tasks/create'){
  let task;try{task=validateTask(body,user,room);}catch(e){return json({error:e.message},400);}
  // The same ID and normalized task return the existing row after a lost response.
  const fields=['room','creator_id','assignee_id','assistant','title','details','source','provenance','approval_required'];
  const matches=row=>fields.every(k=>row[k]===task[k]);
  const before=await env.DB.prepare('SELECT * FROM tasks WHERE id=?').bind(body.id).first();
  if(before)return matches(before)?json(visible(before,user)):json({error:'Task ID already used. Keep the original task or start a new one.'},409);
  const inserted=await env.DB.prepare('INSERT OR IGNORE INTO tasks(id,room,creator_id,assignee_id,assistant,title,details,source,provenance,approval_required,approval) SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE (SELECT count(*) FROM tasks WHERE creator_id=? AND created>=date(\'now\'))<20 AND (SELECT count(*) FROM tasks)<1000 RETURNING *').bind(body.id,...Object.values(task),user.id).first();
  if(inserted)return json(visible(inserted,user),201);
  const existing=await env.DB.prepare('SELECT * FROM tasks WHERE id=?').bind(body.id).first();return existing&&matches(existing)?json(visible(existing,user)):json({error:'Task limit reached (20 per person per day, 1000 total). Keep this draft.'},429);
 }
 if(url.pathname!=='/api/tasks/update')return json({error:'Not found'},404);
 if(!uuid.test(body.id)||!Number.isSafeInteger(body.version)||body.version<1)return json({error:'Refresh the task before changing it'},400);
 const row=await env.DB.prepare('SELECT * FROM tasks WHERE id=? AND room=?').bind(body.id,room).first();if(!row)return json({error:'Task unavailable'},404);
 if(row.version!==body.version)return json({error:'Task changed. Refresh before deciding.'},409);
 let status=row.status,approval=row.approval,decided=row.decided_by,resultNote=row.result_note;
 if(body.action==='approve'||body.action==='reject'){
  if(user.role!=='owner')return json({error:'Only Cyrus can approve a task'},403);
  if(approval!=='requested'||['done','cancelled'].includes(status))return json({error:'This approval is no longer pending'},409);
  approval=body.action==='approve'?'approved':'rejected';decided=user.id;
 }else if(body.action==='status'){
  if(!(user.role==='owner'||row.creator_id===user.id||row.assignee_id===user.id))return json({error:'Only the owner, creator or assignee can update this task'},403);
  if(!['todo','working','done','cancelled'].includes(body.status)||['done','cancelled'].includes(status))return json({error:'Invalid task transition'},409);
  if(body.status==='done'&&row.approval_required&&approval!=='approved')return json({error:'Cyrus must approve this task before completion'},409);
  if(body.status==='done'){if(typeof body.resultNote!=='string'||!body.resultNote.trim()||body.resultNote.length>1000)return json({error:'Add a completion note and source (up to 1000 characters)'},400);resultNote=body.resultNote.trim();}
  status=body.status;
 }else return json({error:'Choose a supported task action'},400);
 const updated=await env.DB.prepare('UPDATE tasks SET status=?,approval=?,decided_by=?,result_note=?,updated_by=?,version=version+1,updated=CURRENT_TIMESTAMP WHERE id=? AND room=? AND version=? RETURNING *').bind(status,approval,decided,resultNote,user.id,row.id,room,body.version).first();
 return updated?json(visible(updated,user)):json({error:'Task changed. Refresh before deciding.'},409);
}
