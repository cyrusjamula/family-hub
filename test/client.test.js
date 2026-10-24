import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const app=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};}
async function client(){
 const all=[],elements={},listeners={},intervals=[],requests=[];
 class Element{
  constructor(tag='div'){this.tag=tag;this.children=[];this.dataset={};this.style={};this.attributes={};this.events={};this.value='';this.checked=false;this.disabled=false;this.hidden=false;this._text='';all.push(this);}
  set textContent(value){this._text=String(value);this.children=[];}
  get textContent(){return this._text+this.children.map(x=>typeof x==='string'?x:x.textContent).join(' ');}
  append(...children){this.children.push(...children);}
  replaceChildren(...children){this._text='';this.children=[...children];}
  setAttribute(name,value){this.attributes[name]=value;}
  addEventListener(name,fn){this.events[name]=fn;}
 }
 for(const match of html.matchAll(/<([\w-]+)\b([^>]*\bid="([^"]+)"[^>]*)>/g)){const el=new Element(match[1]);el.hidden=/\bhidden\b/.test(match[2]);elements[match[3]]=el;}
 const tabs=['chat','planner','settings','advanced'].map(view=>{const el=new Element('button');el.dataset.view=view;return el;});
 const document={visibilityState:'visible',getElementById:id=>elements[id],createElement:tag=>new Element(tag),createTextNode:text=>String(text),querySelectorAll:selector=>selector==='button'?all.filter(e=>e.tag==='button'):selector==='[data-view]'?tabs:[],addEventListener:(name,fn)=>{listeners[name]=fn;}};
 let intercept=null,messages={family:[{author:'Family',content:'Family current'}],parents:[{author:'Parent',content:'Parents current'}]},approvals={family:[],parents:[]};
 const response=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
 const sandbox={document,window:{},navigator:{},Intl,Date,URL,Option:class extends Element{},setInterval:fn=>{intervals.push(fn);},fetch:async(url,options={})=>{
  const u=new URL(url,'https://hub.test'),entry={path:u.pathname,room:u.searchParams.get('room'),body:options.body?JSON.parse(options.body):undefined};requests.push(entry);
  const overridden=await intercept?.(entry);if(overridden)return overridden;
  const route=u.pathname.slice(5);return response(route==='me'?{name:'Owner',role:'owner',aiEnabled:true}:route==='google/status'?{configured:false,connected:false}:route==='messages'?messages[entry.room]:route==='approvals'?approvals[entry.room]:[]);
 }};
 vm.runInNewContext(app+'\n;globalThis.hooks={refresh,calendarBoundary,getRoom:()=>room};',sandbox);
 for(let i=0;i<8;i++)await tick();
 return {elements,document,listeners,intervals,requests,response,messages,approvals,hooks:sandbox.hooks,setIntercept(fn){intercept=fn;},draft(text){elements.content.value=text;elements.content.events.input();},switchRoom:room=>elements[room].onclick()};
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
