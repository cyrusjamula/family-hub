import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const app=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
const settle=async()=>{for(let i=0;i<10;i++)await new Promise(r=>setImmediate(r));};
async function device({permission='default',supported=true,locationError,subscribeError=false}={}){
 const elements={},all=[],requests=[],geoCalls=[],registrations=[],events=[];let active=false;
 class Element{
  constructor(tag='div'){this.tag=tag;this.children=[];this.dataset={};this.style={};this.value='';this.checked=false;this.hidden=false;this.disabled=false;this.events={};this._text='';all.push(this);}
  set id(id){this._id=id;elements[id]=this;}get id(){return this._id;}
  set textContent(v){this._text=String(v);this.children=[];}get textContent(){return this._text+this.children.map(c=>typeof c==='string'?c:c.textContent).join(' ');}
  append(...c){this.children.push(...c);}replaceChildren(...c){this._text='';this.children=[...c];}setAttribute(){}addEventListener(n,fn){this.events[n]=fn;}
 }
 for(const m of html.matchAll(/<([\w-]+)\b([^>]*\bid="([^"]+)"[^>]*)>/g)){const e=new Element(m[1]);e.hidden=/\bhidden\b/.test(m[2]);elements[m[3]]=e;}
 const tabs=['chat','planner','settings','advanced'].map(view=>{const e=new Element('button');e.dataset.view=view;return e;});
 const body=new Element('body');body.append(...Object.values(elements));
 const document={body,visibilityState:'visible',getElementById:id=>elements[id],createElement:tag=>new Element(tag),createTextNode:s=>String(s),querySelectorAll:s=>s==='button'?all.filter(e=>e.tag==='button'):s==='[data-view]'?tabs:[],addEventListener(){}};
 const subscription={endpoint:'https://wns2.notify.windows.com/synthetic-device',async unsubscribe(){events.push('browser-unsubscribe');active=false;return true;}};
 const registration={pushManager:{async getSubscription(){return active?subscription:null;},async subscribe(options){events.push('browser-subscribe');assert.equal(options.userVisibleOnly,true);active=true;return subscription;}}};
 const notification={permission,async requestPermission(){events.push('permission');return notification.permission;}};
 const navigator={geolocation:{getCurrentPosition(ok,fail,options){geoCalls.push(options);if(locationError)fail({code:locationError});else ok({coords:{latitude:12.34567,longitude:-98.76543}});}}};
 const window={location:{reload(){}}};
 if(supported){window.Notification=notification;window.PushManager=class{};navigator.serviceWorker={ready:Promise.resolve(registration),async getRegistration(){return active?registration:null;},async register(path,options){registrations.push({path,options});return registration;}};}
 const fetch=async(path,options={})=>{
  const req={path,body:options.body?JSON.parse(options.body):undefined};requests.push(req);const route=path.split('?')[0];
  if(route==='/api/me')return Response.json({id:'iyanah',name:'Synthetic child',role:'child',aiEnabled:true});
  if(route==='/api/push/config')return Response.json({configured:true,publicKey:'BA'});
  if(route==='/api/push/subscribe')return subscribeError?Response.json({error:'Disable the previous account first'},{status:409}):Response.json({enabled:true});
  if(route==='/api/push/disable'){events.push('server-disable');return Response.json({disabled:true});}
  if(route==='/api/push/test')return Response.json({accepted:true});
  return Response.json([]);
 };
 vm.runInNewContext(app,{document,window,navigator,Notification:notification,fetch,Intl,Date,URL,Uint8Array,atob,setInterval(){},Option:class extends Element{}});await settle();
 return {elements,requests,geoCalls,registrations,events,notification,async click(id){await elements[id].onclick();await settle();},async send(content,attach){elements.content.value=content;elements['attach-location'].checked=attach;elements.compose.onsubmit({preventDefault(){}});await settle();}};
}
test('location is never acquired in the background and attaches rounded coordinates only by selection',async()=>{
 const d=await device();assert.equal(d.geoCalls.length,0);await d.click('enable-location');assert.equal(d.geoCalls.length,1);assert.equal(d.geoCalls[0].enableHighAccuracy,false);assert.equal(d.geoCalls[0].timeout,10000);assert.equal(d.geoCalls[0].maximumAge,60000);
 assert.equal(d.requests.some(r=>JSON.stringify(r.body??{}).includes('12.35')),false);
 await d.send('No location selected',false);assert.equal(d.requests.findLast(r=>r.path.startsWith('/api/chat')).body.content,'No location selected');
 await d.send('Selected this time',true);const text=d.requests.findLast(r=>r.path.startsWith('/api/chat')).body.content;assert.match(text,/12\.35, -98\.77/);assert.doesNotMatch(text,/12\.34567|98\.76543/);assert.equal(d.elements['attach-location'].checked,false);
 await d.send('Next message',false);assert.equal(d.requests.findLast(r=>r.path.startsWith('/api/chat')).body.content,'Next message');
 await d.click('clear-location');await d.send('After clearing',true);assert.equal(d.requests.findLast(r=>r.path.startsWith('/api/chat')).body.content,'After clearing');assert.equal(d.elements['location-attach-label'].hidden,true);assert.equal(d.geoCalls.length,1);
});
test('denied or unavailable location sends no coordinates and permits a normal message',async()=>{
 for(const code of [1,2,3]){const d=await device({locationError:code});await d.click('enable-location');assert.match(d.elements['location-state'].textContent,code===1?/blocked/:/unavailable/);assert.match(d.elements.error.textContent,/not obtained/);await d.send('Synthetic message',true);assert.equal(d.requests.findLast(r=>r.path.startsWith('/api/chat')).body.content,'Synthetic message');}
});
test('unsupported or denied notifications never register a device or send a test',async()=>{
 for(const options of [{supported:false},{permission:'denied'},{permission:'default'}]){const d=await device(options);assert.equal(d.requests.some(r=>r.path.includes('/push/')),false);await d.click('enable-notifications');assert.equal(d.registrations.length,0);assert.equal(d.requests.some(r=>r.path.includes('/push/')),false);await d.click('test-notifications');assert.equal(d.requests.some(r=>r.path.includes('/push/test')),false);}
});
test('notification permission precedes registration; test is explicit and disable removes both registrations',async()=>{
 const d=await device({permission:'granted'});assert.equal(d.events.length,0);await d.click('enable-notifications');assert.equal(d.events[0],'permission');assert.equal(d.registrations[0].path,'/sw.js');assert.equal(d.registrations[0].options.scope,'/');
 const sub=d.requests.find(r=>r.path.includes('/push/subscribe'));assert.equal(sub.body.confirmNotifications,true);assert.deepEqual(Object.keys(sub.body).sort(),['confirmNotifications','endpoint']);assert.equal(d.requests.some(r=>r.path.includes('/push/test')),false);
 await d.click('test-notifications');assert.equal(d.requests.filter(r=>r.path.includes('/push/test')).length,1);assert.match(d.elements['notification-state'].textContent,/accepted/);
 await d.click('disable-notifications');assert.ok(d.events.indexOf('server-disable')<d.events.indexOf('browser-unsubscribe'));assert.match(d.elements['notification-state'].textContent,/off/);
});
test('rejected shared-device subscription cannot claim enabled or send an automatic test',async()=>{
 const d=await device({permission:'granted',subscribeError:true});await d.click('enable-notifications');assert.match(d.elements.error.textContent,/previous account/);assert.doesNotMatch(d.elements['notification-state'].textContent,/enabled on this device/);assert.equal(d.requests.some(r=>r.path.includes('/push/test')),false);
});
