import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../public/tasks.js',import.meta.url),'utf8'),tick=()=>new Promise(r=>setImmediate(r));
async function client(role='owner',{initialFailure=false}={}){
 const elements={},all=[],requests=[],events=[];let intercept,revision=1;
 class E{constructor(tag='div',text=''){this.tag=tag;this.children=[];this.value='';this._text=text;this.isConnected=true;this.disabled=false;this.checked=false;all.push(this);}set id(v){this._id=v;elements[v]=this;}get id(){return this._id;}set textContent(t){this._text=String(t);this.children=[];}get textContent(){return this._text+this.children.map(c=>c.textContent||'').join(' ');}append(...c){this.children.push(...c);}prepend(...c){this.children.unshift(...c);}replaceChildren(...c){this._text='';this.children=c;}setAttribute(k,v){this[k]=v;}querySelectorAll(){return all.filter(e=>['button','input','textarea','select'].includes(e.tag));}}
 const host=new E('section');host.id='view-planner';
 const owner={id:role==='owner'?'cyrus':'iyanah',role};
 const options={members:[{id:owner.id,name:'Synthetic member'}],assistants:[{id:'human',name:'Human only'}]};
 const task={id:crypto.randomUUID(),title:'Synthetic task',details:'Fixture only',room:'family',assignee:'Synthetic member',assignee_id:owner.id,creator:'Synthetic member',creator_id:owner.id,assistantName:'Human only',approval:'not_required',status:'todo',version:revision,canUpdate:true,canApprove:false};
 const sandbox={document:{getElementById:id=>elements[id],createElement:tag=>new E(tag),addEventListener(){},dispatchEvent(event){events.push(event);}},crypto,CustomEvent,navigator:{clipboard:{async writeText(){}}},Event,fetch:async(path,opt={})=>{
  const req={path,body:opt.body?JSON.parse(opt.body):undefined};requests.push(req);const custom=await intercept?.(req);if(custom)return custom;
  if(path==='/api/me'){if(initialFailure){initialFailure=false;return Response.json({error:'temporarily unavailable'},{status:503});}return Response.json(owner);}if(path.startsWith('/api/tasks/options'))return Response.json(options);if(path.startsWith('/api/tasks/create'))return Response.json({...task,id:req.body.id}, {status:201});if(path.startsWith('/api/tasks/update')){revision++;return Response.json({...task,version:revision});}return Response.json({tasks:[],more:false});
 }};vm.runInNewContext(source+'\n;globalThis.hooks=familyTaskUI;',sandbox);const settle=async()=>{for(let i=0;i<10;i++)await tick();};await settle();return {elements,all,requests,events,task,hooks:sandbox.hooks,intercept:fn=>{intercept=fn;},settle,async submit(){await elements['task-form'].onsubmit({preventDefault(){}});}};
}
test('task creation requires audience consent, preserves failed draft/id, and confirms a saved report despite refresh failure',async()=>{
 const c=await client();c.elements['task-title'].value='My synthetic task';await c.submit();assert.equal(c.requests.some(r=>r.body),false);assert.match(c.elements['task-status'].textContent,/audience/);
 c.elements['task-consent'].checked=true;c.intercept(r=>{if(r.path.startsWith('/api/tasks/create'))throw Error('offline');});await c.submit();const id=c.requests.findLast(r=>r.body).body.id;assert.equal(c.elements['task-title'].value,'My synthetic task');
 c.intercept(r=>r.path.startsWith('/api/tasks?')?Response.json({error:'read unavailable'},{status:503}):undefined);await c.submit();assert.equal(c.requests.filter(r=>r.body).at(-1).body.id,id);assert.match(c.elements['task-status'].textContent,/Task saved.*could not refresh/);assert.equal(c.elements['task-title'].value,'');
});
test('draft text and submission IDs stay with their audience across successful and failed switches',async()=>{
 const c=await client();c.elements['task-title'].value='Family draft';await c.hooks.load('parents');assert.equal(c.elements['task-title'].value,'');c.elements['task-title'].value='PARENTS_DRAFT';
 c.intercept(r=>{if(r.path.includes('room=family'))throw Error('offline');});await assert.rejects(c.hooks.load('family'));assert.equal(c.hooks.getRoom(),'parents');assert.equal(c.elements['task-title'].value,'PARENTS_DRAFT');
 c.intercept(null);await c.hooks.load('family');assert.equal(c.elements['task-title'].value,'Family draft');await c.hooks.load('parents');assert.equal(c.elements['task-title'].value,'PARENTS_DRAFT');
});
test('late Parents response never replaces a more recent Family view',async()=>{
 const c=await client();let resolve;const delayed=new Promise(r=>{resolve=r;});c.intercept(r=>r.path.startsWith('/api/tasks?room=parents')?delayed:undefined);const older=c.hooks.load('parents');await tick();await c.hooks.load('family');resolve(Response.json({tasks:[{...c.task,room:'parents',details:'PRIVATE_LATE_RESPONSE'}],more:false}));await older;assert.equal(c.hooks.getRoom(),'family');assert.doesNotMatch(c.elements['task-list'].textContent,/PRIVATE_LATE_RESPONSE/);
});
test('manual handoff does not invoke any external assistant or provider',async()=>{
 const c=await client('child');assert.equal(c.elements['task-audience'].children.some(o=>o.value==='parents'),false);const prompt=c.hooks.handoff(c.task);assert.match(prompt,/Do not send messages/);assert.match(prompt,/source/);assert.ok(c.requests.every(r=>r.path.startsWith('/api/')));assert.equal(c.requests.some(r=>r.body),false);
});
test('authentication denial removes task data and prevents further requests',async()=>{
 const c=await client();c.elements['task-title'].value='PRIVATE_DRAFT';c.intercept(()=>Response.json({error:'expired'},{status:401}));await assert.rejects(c.hooks.load());const count=c.requests.length;await assert.rejects(c.hooks.load());assert.equal(c.requests.length,count);assert.match(c.elements['family-tasks'].textContent,/Reload/);assert.doesNotMatch(c.elements['family-tasks'].textContent,/PRIVATE_DRAFT/);assert.deepEqual(Object.keys(c.hooks.getDrafts()),[]);
});

test('an edited draft after a lost create response can recover the original before assigning a new ID',async()=>{
 const c=await client();c.elements['task-title'].value='Original task';c.elements['task-consent'].checked=true;let original;
 c.intercept(r=>{if(r.path.startsWith('/api/tasks/create')){original=r.body;throw Error('response lost after commit');}});await c.submit();assert.equal(c.elements['task-recovery'].hidden,false);
 c.elements['task-title'].value='Edited task';const before=c.requests.length;await c.submit();assert.equal(c.requests.length,before);assert.match(c.elements['task-status'].textContent,/recover/);
 c.intercept(r=>r.path.startsWith('/api/tasks/create')?Response.json({...c.task,id:original.id}):undefined);await c.elements['task-recover'].onclick();assert.equal(c.elements['task-title'].value,'Edited task');assert.equal(c.elements['task-consent'].checked,false);assert.notEqual(c.hooks.getDrafts().family.id,original.id);assert.match(c.elements['task-status'].textContent,/edits remain as a new draft/);assert.equal(c.requests.filter(r=>r.body).at(-1).body.title,'Original task');
});

test('refresh recovers failed initial identity lookup and restores the adult audience option once',async()=>{
 const c=await client('owner',{initialFailure:true});assert.match(c.elements['task-status'].textContent,/unavailable/);const refresh=c.all.find(e=>e.tag==='button'&&e.textContent==='Refresh');await refresh.onclick();assert.equal(c.elements['task-audience'].children.filter(o=>o.value==='parents').length,1);await refresh.onclick();assert.equal(c.elements['task-audience'].children.filter(o=>o.value==='parents').length,1);
});
test('completion-note drafts survive refreshes and audience switches until confirmed completion',async()=>{
 const c=await client();c.intercept(r=>r.path.startsWith('/api/tasks?room=family')?Response.json({tasks:[c.task],nextCursor:null}):undefined);await c.hooks.load();let note=c.elements['task-result-'+c.task.id];note.value='UNSAVED_RESULT';note.oninput();await c.hooks.load();assert.equal(c.elements['task-result-'+c.task.id].value,'UNSAVED_RESULT');await c.hooks.load('parents');await c.hooks.load('family');assert.equal(c.elements['task-result-'+c.task.id].value,'UNSAVED_RESULT');
});
test('task cursor navigation encodes opaque references and supports returning to the first page',async()=>{
 const c=await client(),cursor='2026-10-01 10:00:00|'+crypto.randomUUID();c.intercept(r=>r.path.startsWith('/api/tasks?')?Response.json({tasks:[],nextCursor:r.path.includes('cursor=')?null:cursor}):undefined);await c.hooks.load();assert.equal(c.elements['task-next'].hidden,false);await c.elements['task-next'].onclick();assert.ok(c.requests.at(-1).path.endsWith('cursor='+encodeURIComponent(cursor)));assert.equal(c.elements['task-previous'].hidden,false);await c.elements['task-previous'].onclick();assert.equal(c.elements['task-previous'].hidden,true);
});

test('definitively rejected recovery releases the pending ID and keeps edited text available to save',async()=>{
 const c=await client();c.elements['task-title'].value='   ';c.elements['task-consent'].checked=true;c.intercept(r=>{if(r.path.startsWith('/api/tasks/create'))throw Error('offline before response');});await c.submit();const original=c.requests.findLast(r=>r.body).body.id;
 c.elements['task-title'].value='Corrected title';await c.submit();c.intercept(r=>r.path.startsWith('/api/tasks/create')?Response.json({error:'Invalid original title'},{status:400}):undefined);await c.elements['task-recover'].onclick();assert.equal(c.elements['task-title'].value,'Corrected title');assert.equal(c.elements['task-recovery'].hidden,true);assert.equal(c.elements['task-consent'].checked,false);assert.notEqual(c.hooks.getDrafts().family.id,original);
 c.intercept(null);c.elements['task-consent'].checked=true;await c.submit();assert.match(c.elements['task-status'].textContent,/Task saved/);assert.equal(c.requests.findLast(r=>r.body).body.title,'Corrected title');
});

test('coordinator handoff prepares a room-specific draft without sending task content to a provider',async()=>{
 const c=await client();c.task.assistant='coordinator';c.task.room='parents';c.intercept(r=>r.path.startsWith('/api/tasks?')?Response.json({tasks:[c.task],nextCursor:null}):undefined);await c.hooks.load('parents');const before=c.requests.length;await c.all.find(e=>e.tag==='button'&&e.textContent==='Open in coordinator chat').onclick();assert.equal(c.requests.length,before);assert.equal(c.events.at(-1).type,'task-compose');assert.equal(c.events.at(-1).detail.room,'parents');assert.match(c.events.at(-1).detail.content,/Parents private/);
});
