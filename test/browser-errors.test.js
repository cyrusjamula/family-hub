import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../public/browser-errors.js',import.meta.url),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function client(stored='false'){
 const elements={},listeners={},requests=[],values=new Map([['hub-browser-diagnostics-consent',stored]]);
 class Element{
  constructor(){this.checked=false;this.events={};this.children=[];}
  set id(value){this._id=value;elements[value]=this;}get id(){return this._id;}
  append(...items){this.children.push(...items);}addEventListener(name,fn){this.events[name]=fn;}setAttribute(name,value){this[name]=value;}
 }
 let respond=async()=>({ok:true,json:async()=>({requestId:'123e4567-e89b-42d3-a456-426614174000'})});
 const settings=new Element(),sandbox={document:{getElementById:id=>id==='view-settings'?settings:elements[id],createElement:()=>new Element(),createTextNode:text=>String(text),querySelector:()=>({dataset:{view:'chat'}})},window:{addEventListener(name,fn){listeners[name]=fn;}},localStorage:{getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)},fetch:async(url,options)=>{requests.push({url,options});return respond();}};
 vm.runInNewContext(source,sandbox);
 return {elements,listeners,requests,values,setResponse:fn=>{respond=fn;}};
}
test('browser reporting is off by default and requires a device-level opt-in',async()=>{
 const c=await client();c.listeners.error();await tick();assert.equal(c.requests.length,0);
 const consent=c.elements['browser-diagnostics-consent'];consent.checked=true;consent.events.change();c.listeners.error({message:'PRIVATE_ERROR',filename:'https://private.test/path',error:{stack:'PRIVATE_STACK'}});await tick();
 assert.equal(c.values.get('hub-browser-diagnostics-consent'),'true');assert.equal(c.requests.length,1);
 const sent=JSON.parse(c.requests[0].options.body);assert.deepEqual(Object.keys(sent).sort(),['section','type']);assert.deepEqual(sent,{type:'exception',section:'chat'});assert.match(c.elements['browser-diagnostics-status'].textContent,/123e4567-e89b-42d3-a456-426614174000/);
});
test('unhandled rejections send only fixed enums, cap requests, and ignore reporting failures',async()=>{
 const c=await client('true');for(let i=0;i<7;i++)c.listeners.unhandledrejection({reason:'PRIVATE_PROMPT_REPLY'});await tick();
 assert.equal(c.requests.length,5);for(const request of c.requests)assert.deepEqual(JSON.parse(request.options.body),{type:'rejection',section:'chat'});
 const offline=await client('true');offline.setResponse(async()=>{throw Error('OFFLINE_PRIVATE_DETAILS');});assert.doesNotThrow(()=>offline.listeners.error());await tick();assert.equal(offline.requests.length,1);
});
