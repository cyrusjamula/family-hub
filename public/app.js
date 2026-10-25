const $=id=>document.getElementById(id);let room='family',me,approxLocation=null,drafts={family:'',parents:''},refreshVersion=0,switchingRoom=false,pendingActions=0,sessionLocked=false;
const calendarZone=new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
function calendarBoundary(value){if(!/^\d{4}-\d{2}-\d{2}$/.test(value))throw Error('Choose valid start and end dates.');const [year,month,day]=value.split('-').map(Number),target=Date.UTC(year,month-1,day),date=new Date(target);if(date.getUTCFullYear()!==year||date.getUTCMonth()!==month-1||date.getUTCDate()!==day)throw Error('Choose valid start and end dates.');let instant=target;for(let i=0;i<3;i++){const parts=Object.fromEntries(calendarZone.formatToParts(new Date(instant)).filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)])),local=Date.UTC(parts.year,parts.month-1,parts.day,parts.hour,parts.minute,parts.second),adjustment=target-local;instant+=adjustment;if(!adjustment)break;}return new Date(instant).toISOString();}
const sessionNotice='Your sign-in changed or expired. Reload this page to verify your account. If you submitted an external action, check its result before retrying.';
function lockSession(){
 if(sessionLocked)return;sessionLocked=true;++refreshVersion;me=undefined;room='family';drafts={family:'',parents:''};approxLocation=null;
 const panel=document.createElement('main');panel.className='app-shell';const heading=document.createElement('h1');heading.textContent='Verify your sign-in';
 const notice=document.createElement('p');notice.id='error';notice.textContent=sessionNotice;
 const reload=document.createElement('button');reload.type='button';reload.textContent='Reload and verify account';reload.onclick=()=>window.location.reload();
 panel.append(heading,notice,reload);document.body.replaceChildren(panel);
}
async function call(path,body,requestRoom=room){
 if(sessionLocked)throw Error(sessionNotice);
 const r=await fetch('/api/'+path.split('&')[0]+(path==='me'?'':'?room='+requestRoom+(path.includes('&')?'&'+path.split('&').slice(1).join('&'):'')),{method:body?'POST':'GET',headers:body?{'content-type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
 if(sessionLocked)throw Error(sessionNotice);
 if(r.status===401||r.status===403||r.redirected||r.ok&&r.headers.get('content-type')?.includes('text/html')){lockSession();throw Error(sessionNotice);}
 const data=await r.json();if(sessionLocked)throw Error(sessionNotice);if(!r.ok)throw Error(data.error||'Request failed');return data;
}
function p(text){const el=document.createElement('p');el.textContent=text;return el;}
async function loadRoom(targetRoom){
 const [messages,approvals,briefs,notices]=await Promise.all(['messages','approvals','briefs','notifications'].map(path=>call(path,undefined,targetRoom)));
 return {messages,approvals,briefs,notices};
}
function renderRoom({messages,approvals,briefs,notices}){$('briefs').replaceChildren();for(const b of briefs){const details=document.createElement('details');const summary=document.createElement('summary');summary.textContent=b.title+' · approved reference';details.append(summary,p(b.content),p(b.provenance));$('briefs').append(details);}$('notices').replaceChildren();for(const n of notices)$('notices').append(p(n.content));$('messages').replaceChildren();const earlier=document.createElement('details');const earlierTitle=document.createElement('summary');earlierTitle.textContent='Earlier messages ('+Math.max(0,messages.length-2)+')';earlier.append(earlierTitle);if(messages.length>2)$('messages').append(earlier);messages.forEach((m,i)=>{const a=document.createElement('article');a.dataset.user=String(m.author!=='Coordinator');const n=document.createElement('strong');n.textContent=m.author;a.append(n,p(m.content));(i<messages.length-2?earlier:$('messages')).append(a);});if(!messages.length)$('messages').append(p('Start with a question or an idea.'));$('room-note').textContent=room==='family'?'Everyone in Family can see this conversation.':'Only Cyrus and Anhaita can see this conversation.';$('approvals').replaceChildren();for(const a of approvals){const div=document.createElement('article');div.append(p(a.author+' · '+a.state),p(a.proposal));if(me.role==='owner'&&a.state==='pending')for(const state of ['approved','rejected']){const b=document.createElement('button');b.textContent=state;b.onclick=()=>act(async()=>{await call('approve',{id:a.id,state});await refresh();});div.append(b);} $('approvals').append(div);}for(const r of ['family','parents'])$(r).setAttribute('aria-pressed',String(room===r));}
async function refresh(){
 if(switchingRoom)return false;
 const targetRoom=room,version=++refreshVersion;
 let snapshot;try{snapshot=await loadRoom(targetRoom);}catch(error){if(sessionLocked)throw error;if(version!==refreshVersion||targetRoom!==room)return false;throw error;}
 if(version!==refreshVersion||targetRoom!==room||switchingRoom)return false;
 renderRoom(snapshot);return true;
}
async function switchRoom(nextRoom){
 if(nextRoom===room||switchingRoom)return;
 switchingRoom=true;++refreshVersion;
 try{
  const snapshot=await loadRoom(nextRoom);
  // Commit audience, draft and rendered conversation together, only after all reads succeed.
  drafts[room]=$('content').value;room=nextRoom;$('content').value=drafts[room]||'';
  $('attach-location').checked=false;$('private-answer').replaceChildren();$('private-question').value='';$('private-ai-consent').checked=false;
  renderRoom(snapshot);
 }finally{switchingRoom=false;}
}
async function act(fn){pendingActions++;$('error').textContent='';document.querySelectorAll('button').forEach(b=>b.disabled=true);try{await fn();}catch(e){$('error').textContent=e.message;}finally{pendingActions--;document.querySelectorAll('button').forEach(b=>b.disabled=pendingActions>0);}}
for(const r of ['family','parents'])$(r).onclick=()=>act(()=>switchRoom(r));
$('content').addEventListener('input',()=>{drafts[room]=$('content').value;});
$('compose').onsubmit=e=>{e.preventDefault();act(async()=>{try{const content=$('content').value+($('attach-location').checked&&approxLocation?'\nApproximate current location (shared explicitly for this request): '+approxLocation:'');await call('chat',{content});$('attach-location').checked=false;$('content').value='';drafts[room]='';}finally{await refresh();}});};
$('propose').onclick=()=>act(async()=>{const content=$('content').value.trim();if(!content)throw Error('Describe the exact proposed action.');await call('propose',{content});$('content').value='';drafts[room]='';await refresh();});
act(async()=>{me=await call('me');$('identity').textContent='Welcome, '+me.name+' · '+me.role;$('parents').hidden=me.role==='child';$('status').textContent=me.aiEnabled?'Your coordinator is ready.':'Coordinator activation pending.';await refresh();if(me.role==='owner'){$('google').hidden=false;$('actions').hidden=false;$('reminders').hidden=false;$('advanced-tab').hidden=false;document.querySelectorAll('[data-owner]').forEach(e=>e.hidden=false);await googleStatus();await listActions();await listReminders();}});

async function googleStatus(){const state=await call('google/status');$('google-state').textContent=state.connected?('Google connected · '+((state.scopes||'').includes('gmail.send')?'calendar/email permissions granted':'read only')):'Google '+(state.configured?'ready to authorize':'setup pending');$('google-connect').disabled=!state.configured;$('google-disconnect').disabled=!state.connected;if(state.connected){await listRecords();}}
$('google-connect').onclick=()=>act(async()=>{const r=await call('google/connect',{});window.location.assign(r.authorizationUrl);});
$('google-disconnect').onclick=()=>act(async()=>{await call('google/disconnect',{});await googleStatus();});
$('google-calendar').onclick=()=>act(async()=>{const start=$('calendar-start').value,end=$('calendar-end').value;if(!start||!end)throw Error('Choose start and end dates.');const r=await call('google/calendar&start='+encodeURIComponent(calendarBoundary(start))+'&end='+encodeURIComponent(calendarBoundary(end)));$('calendar-results').replaceChildren();for(const e of r.events)$('calendar-results').append(p((e.start.dateTime||e.start.date)+' · '+e.summary));if(!r.events.length)$('calendar-results').append(p('No events in this window.'));if(r.moreAvailable)$('calendar-results').append(p('More events exist; shorten the date window.'));});
$('google-import').onclick=()=>act(async()=>{if(!$('import-consent').checked)throw Error('Confirm this document’s private import first.');const r=await call('google/import',{fileId:$('drive-file').value.trim(),confirmPrivateImport:true});await listRecords();$('import-consent').checked=false;});

async function listRecords(){const rows=await call('google/records');$('record-results').replaceChildren();$('private-record').replaceChildren(new Option('Choose an imported record',''));for(const row of rows){$('private-record').append(new Option(row.title,row.id));const button=document.createElement('button');button.type='button';button.textContent='Read privately: '+row.title;button.onclick=()=>act(async()=>{const r=await call('google/record&id='+encodeURIComponent(row.id));const text=p(r.content);text.style.whiteSpace='pre-wrap';$('record-results').append(text);});$('record-results').append(button);}}

$('google-verify').onclick=()=>act(async()=>{const r=await call('google/verify');$('drive-status').textContent=r.foldersChecked+' folders verified. '+r.note;});

$('authorize-actions').onclick=()=>act(async()=>{const r=await call('google/connect',{actions:true});window.location.assign(r.authorizationUrl);});
$('action-propose').onclick=()=>act(async()=>{const kind=$('action-kind').value;const payload=kind==='calendar'?{title:$('action-title').value,description:$('action-body').value,start:$('action-start').value,end:$('action-end').value,confirmFamilyVisibility:$('family-visibility').checked}:{subject:$('action-title').value,body:$('action-body').value,to:[...document.querySelectorAll('.recipient:checked')].map(e=>e.value)};await call('actions/propose',{kind,payload});await listActions();});
async function listActions(){const rows=await call('actions');$('action-list').replaceChildren();for(const a of rows){const box=document.createElement('article');box.append(p(a.kind+' · '+a.state+' · expires '+new Date(a.expires).toLocaleString()));const content=document.createElement('pre');content.style.whiteSpace='pre-wrap';content.textContent=JSON.stringify(JSON.parse(a.payload),null,2);box.append(content);if(a.state==='pending'){const label=document.createElement('label');const check=document.createElement('input');check.type='checkbox';label.append(check,document.createTextNode(' I approve this exact action and its recipients/visibility.'));const b=document.createElement('button');b.type='button';b.textContent='Approve and execute exact action';b.onclick=()=>act(async()=>{if(!check.checked)throw Error('Review and confirm this exact action first.');try{await call('actions/execute',{id:a.id,digest:a.digest,confirmExactAction:true});}finally{await listActions();}});box.append(label,b);}$('action-list').append(box);}}

$('private-ask').onclick=()=>act(async()=>{ $('private-answer').replaceChildren();if(!$('private-ai-consent').checked)throw Error('Confirm sending this selected document and question to Cloudflare AI.');const recordId=$('private-record').value,question=$('private-question').value.trim();if(!recordId||!question)throw Error('Choose a record and enter a question.');try{const r=await call('private-ai',{recordId,question,confirmPrivateAI:true});$('private-answer').append(p(r.answer),p('Source: '+r.source.title+' · modified '+r.source.modified+' · https://drive.google.com/file/d/'+r.source.id+'/view'),p(r.note));}finally{$('private-ai-consent').checked=false;}});
$('reminder-create').onclick=()=>act(async()=>{await call('reminders',{room:$('reminder-room').value,content:$('reminder-content').value,due:$('reminder-due').value,confirmRoomVisibility:$('reminder-consent').checked});$('reminder-content').value='';$('reminder-consent').checked=false;await listReminders();});
async function listReminders(){const rows=await call('reminders');$('reminder-list').replaceChildren();for(const r of rows){const box=document.createElement('article');box.append(p(r.content),p(r.room+' · '+new Date(r.due).toLocaleString()+' · '+r.state));if(r.state==='pending'){const b=document.createElement('button');b.type='button';b.textContent='Cancel reminder';b.onclick=()=>act(async()=>{await call('reminders/cancel',{id:r.id});await listReminders();});box.append(b);}$('reminder-list').append(box);}}

function showView(view){if(view==='advanced'&&me?.role!=='owner')return;for(const key of ['chat','planner','settings','advanced'])$('view-'+key).hidden=key!==view;document.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.view===view)));if(view!=='advanced'){$('private-answer').replaceChildren();$('private-question').value='';$('private-ai-consent').checked=false;}if(view==='chat'||view==='planner')refresh().catch(e=>{$('error').textContent=e.message;});}
document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>showView(b.dataset.view));
$('enable-location').onclick=()=>deviceAct('enable-location',async()=>{if(!navigator.geolocation)throw Error('This browser does not support location.');$('location-state').textContent='Waiting for this device’s permission…';await new Promise((resolve,reject)=>navigator.geolocation.getCurrentPosition(pos=>{approxLocation=pos.coords.latitude.toFixed(2)+', '+pos.coords.longitude.toFixed(2)+' (approximate; measured '+new Date().toLocaleTimeString()+')';$('location-state').textContent='Location ready. Approximate coordinates stay on this page until you attach them to a message.';$('location-attach-label').hidden=false;resolve();},err=>{$('location-state').textContent=err.code===1?'Location permission is blocked. Allow location in this site’s browser settings to try again.':'Location unavailable. Try again when your device has a signal.';reject(Error('Location was not obtained.'));},{enableHighAccuracy:false,maximumAge:60000,timeout:10000}));});
$('clear-location').onclick=()=>{approxLocation=null;$('attach-location').checked=false;$('location-attach-label').hidden=true;$('location-state').textContent='Location cleared from this page. Browser permission can be revoked in site settings.';};
function decodeKey(value){return Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-value.length%4)%4)),c=>c.charCodeAt(0));}
async function thisSubscription(){const registration=await navigator.serviceWorker.getRegistration('/');return registration?await registration.pushManager.getSubscription():null;}
async function notificationStatus(){if(!('Notification'in window)||!('serviceWorker'in navigator)||!('PushManager'in window)){$('notification-state').textContent='Push notifications are not supported in this browser. On iPhone/iPad, open the installed Home Screen app.';return;}$('notification-state').textContent=Notification.permission==='denied'?'Notifications are blocked in this browser’s site settings.':Notification.permission==='granted'&&await thisSubscription()?'Notifications enabled on this device.':'Notifications are off on this device.';}
$('enable-notifications').onclick=()=>deviceAct('enable-notifications',async()=>{if(!('Notification'in window)||!('serviceWorker'in navigator)||!('PushManager'in window))throw Error('This browser does not support push notifications here.');$('notification-state').textContent='Waiting for the browser’s notification permission prompt…';const permission=await Notification.requestPermission();if(permission!=='granted'){await notificationStatus();throw Error('Allow notifications in this site’s browser settings to enable them.');}const config=await call('push/config');const registration=await navigator.serviceWorker.register('/sw.js',{scope:'/'});await navigator.serviceWorker.ready;const sub=await registration.pushManager.getSubscription()||await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:decodeKey(config.publicKey)});await call('push/subscribe',{endpoint:sub.endpoint,confirmNotifications:true});await notificationStatus();});
$('disable-notifications').onclick=()=>act(async()=>{const sub=await thisSubscription();if(sub){await call('push/disable',{endpoint:sub.endpoint});await sub.unsubscribe();}await notificationStatus();});
$('test-notifications').onclick=()=>act(async()=>{const sub=await thisSubscription();if(!sub)throw Error('Enable notifications for this device first.');const r=await call('push/test',{endpoint:sub.endpoint});$('notification-state').textContent=r.accepted?'Test alert accepted by your browser’s push service. Check your device notifications.':'Test alert was not accepted.';});
notificationStatus().catch(()=>{$('notification-state').textContent='Device notification status unavailable.';});
setInterval(async()=>{if(!me||pendingActions||switchingRoom||document.visibilityState!=='visible'||$('view-chat').hidden&&$('view-planner').hidden)return;try{await refresh();}catch{}},60000);
document.addEventListener('visibilitychange',()=>{if(me&&!pendingActions&&!switchingRoom&&document.visibilityState==='visible'&&(!$('view-chat').hidden||!$('view-planner').hidden))refresh().catch(e=>{$('error').textContent=e.message;});});

async function deviceAct(id,fn){$(id).disabled=true;$('error').textContent='';try{await fn();}catch(e){$('error').textContent=e.message;}finally{$(id).disabled=false;}}


const accessCheckLink=document.createElement('a');accessCheckLink.href='/access-check.html';accessCheckLink.textContent='Check my access';$('view-settings').append(accessCheckLink);

// Load daily task intake without adding private configuration to generated markup.
if(document.head){const tasksModule=document.createElement('script');tasksModule.type='module';tasksModule.src='/tasks.js';document.head.append(tasksModule);}
document.addEventListener('hub-session-locked',lockSession);

// Prepare an explicit coordinator draft; the user still reviews and sends it.
document.addEventListener('task-compose',event=>act(async()=>{
 const target=event.detail?.room,content=event.detail?.content;
 if(!['family','parents'].includes(target)||typeof content!=='string'||!content.trim()||content.length>4000)throw Error('Shorten this task handoff before opening it in Chat.');
 if(!me||target==='parents'&&me.role==='child')throw Error('This conversation is unavailable to your account.');
 if((target===room?$('content').value:drafts[target]||'').trim())throw Error('Finish or clear the existing draft in that conversation before opening a task.');
 await switchRoom(target);if(sessionLocked)throw Error(sessionNotice);
 $('content').value=content;drafts[target]=content;showView('chat');
}));
