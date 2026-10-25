import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const app=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};}
async function client(person={name:'Owner',role:'owner',aiEnabled:true}){
 const all=[],elements={},listeners={},intervals=[],requests=[];
 class Element{
  constructor(tag='div'){this.tag=tag;this.children=[];this.dataset={};this.style={};this.attributes={};this.events={};this.value='';this.checked=false;this.disabled=false;this.hidden=false;this._text='';all.push(this);}
  set id(value){this._id=value;elements[value]=this;}get id(){return this._id;}
  set textContent(value){this._text=String(value);this.children=[];}
  get textContent(){return this._text+this.children.map(x=>typeof x==='string'?x:x.textContent).join(' ');}
  append(...children){this.children.push(...children);}
  replaceChildren(...children){this._text='';this.children=[...children];}
  setAttribute(name,value){this.attributes[name]=value;}
  addEventListener(name,fn){this.events[name]=fn;}
 }
 for(const match of html.matchAll(/<([\w-]+)\b([^>]*\bid="([^"]+)"[^>]*)>/g)){const el=new Element(match[1]);el.hidden=/\bhidden\b/.test(match[2]);elements[match[3]]=el;}
 const reminderNotice=new Element('p');reminderNotice.textContent=html.match(/<section id="reminders"[^>]*><p>([^<]*)<\/p>/)[1];elements.reminders.append(reminderNotice);elements.reminders.querySelector=selector=>selector==='p'?reminderNotice:null;
 const tabs=['chat','planner','settings','advanced'].map(view=>{const el=new Element('button');el.dataset.view=view;return el;});
 const body=new Element('body');body.append(...Object.values(elements));
 const document={body,visibilityState:'visible',getElementById:id=>elements[id],createElement:tag=>new Element(tag),createTextNode:text=>String(text),querySelectorAll:selector=>selector==='button'?all.filter(e=>e.tag==='button'):selector==='[data-view]'?tabs:[],addEventListener:(name,fn)=>{listeners[name]=fn;}};
 let intercept=null,messages={family:[{author:'Family',content:'Family current'}],parents:[{author:'Parent',content:'Parents current'}]},approvals={family:[],parents:[]};
 const response=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
 const sandbox={document,window:{location:{reload(){}}},navigator:{},Intl,Date,URL,Option:class extends Element{},setInterval:fn=>{intervals.push(fn);},fetch:async(url,options={})=>{
  const u=new URL(url,'https://hub.test'),entry={path:u.pathname,room:u.searchParams.get('room'),body:options.body?JSON.parse(options.body):undefined};requests.push(entry);
  const overridden=await intercept?.(entry);if(overridden)return overridden;
  const route=u.pathname.slice(5);return response(route==='me'?person:route==='google/status'?{configured:false,connected:false}:route==='messages'?messages[entry.room]:route==='approvals'?approvals[entry.room]:[]);
 }};
 vm.runInNewContext(app+'\n;globalThis.hooks={refresh,calendarBoundary,getRoom:()=>room};',sandbox);
 for(let i=0;i<8;i++)await tick();
 return {elements,reminderNotice,document,tabs,listeners,intervals,requests,response,messages,approvals,hooks:sandbox.hooks,setIntercept(fn){intercept=fn;},draft(text){elements.content.value=text;elements.content.events.input();},switchRoom:room=>elements[room].onclick()};
}

test('failed switch retains the displayed room, draft and submission audience',async()=>{
 const c=await client();await c.switchRoom('parents');c.draft('Private follow-up');
 c.setIntercept(r=>{if(r.room==='family'&&r.path==='/api/messages')throw Error('offline');});
 await c.switchRoom('family');assert.equal(c.hooks.getRoom(),'parents');assert.equal(c.elements.content.value,'Private follow-up');assert.match(c.elements.messages.textContent,/Parents current/);
 c.setIntercept(null);await c.elements.propose.onclick();const post=c.requests.findLast(r=>r.path==='/api/propose');assert.equal(post.room,'parents');assert.equal(post.body.content,'Private follow-up');
});
test('drafts stay in their own room when switching both ways',async()=>{
 const c=await client();c.draft('Family draft');await c.switchRoom('parents');assert.equal(c.elements.content.value,'');c.draft('Private draft');await c.switchRoom('family');assert.equal(c.elements.content.value,'Family draft');await c.switchRoom('parents');assert.equal(c.elements.content.value,'Private draft');
});
test('slow private refresh cannot appear after switching to Family',async()=>{
 const c=await client();await c.switchRoom('parents');const gate=deferred();let held=false;
 c.setIntercept(r=>{if(!held&&r.room==='parents'&&r.path==='/api/messages'){held=true;return gate.promise;}});
 const oldRefresh=c.hooks.refresh();await tick();await c.switchRoom('family');gate.resolve(c.response([{author:'Parent',content:'Parents stale secret'}]));await oldRefresh;
 assert.equal(c.hooks.getRoom(),'family');assert.match(c.elements.messages.textContent,/Family current/);assert.doesNotMatch(c.elements.messages.textContent,/Parents stale secret/);
});
test('out-of-order refreshes cannot replace newer messages in the same room',async()=>{
 const c=await client(),gate=deferred();let held=false;
 c.setIntercept(r=>{if(!held&&r.path==='/api/messages'){held=true;return gate.promise;}});
 const first=c.hooks.refresh();await tick();c.messages.family=[{author:'Family',content:'Newest message'}];await c.hooks.refresh();gate.resolve(c.response([{author:'Family',content:'Old message'}]));await first;assert.match(c.elements.messages.textContent,/Newest message/);
});
test('visible-room polling refreshes remote messages and approvals without clearing draft',async()=>{
 const c=await client();c.draft('Unsent local draft');c.messages.family=[{author:'Other',content:'Incoming message'}];c.approvals.family=[{id:'remote',author:'Other',state:'pending',proposal:'Incoming approval'}];
 await c.intervals[0]();assert.match(c.elements.messages.textContent,/Incoming message/);assert.match(c.elements.approvals.textContent,/Incoming approval/);assert.equal(c.elements.content.value,'Unsent local draft');
});
test('owner calendar boundaries account for winter, summer and both DST transitions',async()=>{
 const {calendarBoundary:boundary}= (await client()).hooks;
 assert.equal(boundary('2026-07-01'),'2026-07-01T07:00:00.000Z');assert.equal(boundary('2026-12-24'),'2026-12-24T08:00:00.000Z');
 assert.equal(Date.parse(boundary('2026-03-09'))-Date.parse(boundary('2026-03-08')),23*3600000);assert.equal(Date.parse(boundary('2026-11-02'))-Date.parse(boundary('2026-11-01')),25*3600000);assert.throws(()=>boundary('2026-02-30'));
});

test('parent and child views hide owner controls and cannot open Advanced',async()=>{
 for(const role of ['parent','child']){
  const c=await client({name:'Synthetic member',role,aiEnabled:true});
  assert.equal(c.elements.parents.hidden,role==='child');
  for(const id of ['advanced-tab','google','actions','reminders'])assert.equal(c.elements[id].hidden,true,id);
  assert.equal(c.requests.some(r=>['/api/google/status','/api/actions','/api/reminders'].includes(r.path)),false);
  c.tabs.find(t=>t.dataset.view==='advanced').onclick();assert.equal(c.elements['view-advanced'].hidden,true);
  c.approvals.family=[{id:'synthetic',author:'Member',proposal:'Synthetic decision',state:'pending'}];await c.hooks.refresh();
  assert.equal(c.elements.approvals.children[0].children.filter(e=>e.tag==='button').length,0);
 }
});
test('authentication denial or a login HTML response removes private UI and blocks stale requests',async()=>{
 for(const response of [()=>Response.json({error:'Sign in again'},{status:401}),()=>Response.json({error:'Room access denied'},{status:403}),()=>new Response('<html>Access login</html>',{headers:{'content-type':'text/html'}})]){
  const c=await client();await c.switchRoom('parents');c.draft('Unsent private fixture');
  c.elements['private-answer'].textContent='Private answer fixture';
  c.setIntercept(r=>r.path==='/api/messages'?response():null);
  await assert.rejects(c.hooks.refresh());
  assert.doesNotMatch(c.document.body.textContent,/Parents current|Unsent private fixture|Private answer fixture/);
  assert.match(c.document.body.textContent,/Reload/);
  const before=c.requests.length;await assert.rejects(c.hooks.refresh());assert.equal(c.requests.length,before);
 }
});
test('a late private response cannot repopulate a page after session lock',async()=>{
 const c=await client();await c.switchRoom('parents');const gate=deferred();let held=false;
 c.setIntercept(r=>{if(r.path!=='/api/messages')return null;if(!held){held=true;return gate.promise;}return Response.json({error:'Session changed'},{status:403});});
 const old=c.hooks.refresh();await tick();await assert.rejects(c.hooks.refresh());
 gate.resolve(c.response([{author:'Parent',content:'Late private fixture'}]));await old.catch(()=>{});
 assert.doesNotMatch(c.document.body.textContent,/Late private fixture|Parents current/);assert.match(c.document.body.textContent,/Reload/);
});
test('ordinary service failure preserves a private draft for the same session',async()=>{
 const c=await client();await c.switchRoom('parents');c.draft('Retry draft fixture');
 c.setIntercept(r=>r.path==='/api/messages'?Response.json({error:'Temporarily unavailable'},{status:503}):null);
 await assert.rejects(c.hooks.refresh());assert.equal(c.elements.content.value,'Retry draft fixture');assert.match(c.elements.messages.textContent,/Parents current/);
});

test('coordinator task drafts use the matching room, preserve prior drafts and never auto-send',async()=>{
 const c=await client();c.draft('Family draft');await c.listeners['task-compose']({detail:{room:'parents',content:'Reviewed synthetic task handoff'}});assert.equal(c.hooks.getRoom(),'parents');assert.equal(c.elements.content.value,'Reviewed synthetic task handoff');assert.equal(c.requests.some(r=>r.path==='/api/chat'),false);await c.switchRoom('family');assert.equal(c.elements.content.value,'Family draft');await c.listeners['task-compose']({detail:{room:'family',content:'Must not overwrite'}});assert.equal(c.elements.content.value,'Family draft');
});
test('failed coordinator-room switch leaves the existing audience and draft intact',async()=>{
 const c=await client();c.draft('Keep Family draft');c.setIntercept(r=>{if(r.room==='parents')throw Error('offline');});await c.listeners['task-compose']({detail:{room:'parents',content:'Private task'}});assert.equal(c.hooks.getRoom(),'family');assert.equal(c.elements.content.value,'Keep Family draft');assert.equal(c.requests.some(r=>r.path==='/api/chat'),false);
});

test('reminder scheduling explains the selected-room audience and generic push before submission',async()=>{
 const c=await client();
 assert.match(c.reminderNotice.textContent,/generic push alert/i);
 assert.match(c.reminderNotice.textContent,/selected room/i);
 assert.match(c.reminderNotice.textContent,/No email/i);
 assert.doesNotMatch(c.reminderNotice.textContent,/do not send.*push/i);
 assert.equal(c.elements['reminder-create'].textContent,'Schedule reminder');
 assert.equal(c.requests.some(r=>r.path==='/api/reminders'&&r.body),false);
});
