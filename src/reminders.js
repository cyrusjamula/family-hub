import {googleRoleAllowed} from './google.js';
const json=(v,s=200)=>new Response(JSON.stringify(v),{status:s,headers:{'content-type':'application/json','cache-control':'no-store'}});
export function validateReminder(p,now=Date.now()){
 if(!p||!['family','parents'].includes(p.room)||p.confirmRoomVisibility!==true)throw Error('Confirm who can see this reminder');
 if(typeof p.content!=='string'||!p.content.trim()||p.content.length>500)throw Error('Use 1–500 characters');
 const due=Date.parse(p.due);if(!/T.*(?:Z|[+-]\d\d:\d\d)$/.test(p.due)||!Number.isFinite(due)||due<=now||due>now+366*86400000)throw Error('Choose a future time within one year, with an explicit time zone');
 return {room:p.room,content:p.content.trim(),due};
}
// No Google, AI or messaging calls. Stable notification IDs make overlapping ticks safe.
export async function deliverDue(env,now=Date.now()){
 await env.DB.batch([
  env.DB.prepare("INSERT OR IGNORE INTO notifications(id,room,content) SELECT 'reminder:'||id,room,content FROM reminders WHERE state='pending' AND due<=?").bind(now),
  env.DB.prepare("UPDATE reminders SET state='delivered' WHERE state='pending' AND due<=? AND EXISTS(SELECT 1 FROM notifications WHERE notifications.id='reminder:'||reminders.id)").bind(now)
 ]);
}
export async function reminderAPI(request,env,user){
 if(!googleRoleAllowed(user))return json({error:'Only Cyrus manages reminders'},403);
 if(request.method==='GET')return json((await env.DB.prepare('SELECT * FROM reminders WHERE owner=? ORDER BY due DESC LIMIT 50').bind(user.email).all()).results);
 const url=new URL(request.url);if(request.method!=='POST'||request.headers.get('origin')!==url.origin)return json({error:'Origin rejected'},403);
 if(!request.headers.get('content-type')?.startsWith('application/json'))return json({error:'JSON required'},415);
 const raw=await request.text();if(raw.length>2000)return json({error:'Request too large'},413);let body;try{body=JSON.parse(raw);}catch{return json({error:'Invalid JSON'},400);}
 if(url.pathname==='/api/reminders/cancel'){await env.DB.prepare("UPDATE reminders SET state='cancelled' WHERE id=? AND owner=? AND state='pending'").bind(body.id,user.email).run();return json({cancelled:true});}
 if(url.pathname!=='/api/reminders')return json({error:'Not found'},404);
 let p;try{p=validateReminder(body);}catch(e){return json({error:e.message},400);}
 const id=crypto.randomUUID();await env.DB.prepare('INSERT INTO reminders(id,owner,room,content,due) VALUES(?,?,?,?,?)').bind(id,user.email,p.room,p.content,p.due).run();return json({id,state:'pending'});
}
