import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
const source=await readFile(new URL('../public/feedback.js',import.meta.url),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function client(){
 const elements={},requests=[],objects=[];let intercept;
 class Element{
  constructor(tag='div'){this.tag=tag;this.value='';this.checked=false;this.hidden=false;this.disabled=false;this.files=[];this.children=[];this.events={};this.dataset={};this.textContent='';}
  set id(value){this._id=value;elements[value]=this;}get id(){return this._id;}
  setAttribute(name,value){this[name]=value;}replaceWith(el){elements[el.id]=el;}before(){}after(){}
  append(...items){this.children.push(...items);}replaceChildren(...items){this.children=[...items];this.textContent='';}
  addEventListener(name,fn){this.events[name]=fn;}removeAttribute(name){delete this[name];}
  querySelectorAll(){return Object.values(elements).filter(e=>e.tag==='button');}
  showModal(){this.open=true;}close(){this.open=false;}getContext(){return {drawImage(){}};}reset(){}
 }
 for(const match of html.matchAll(/<([\w-]+)\b([^>]*\bid="([^"]+)"[^>]*)>/g)){const el=new Element(match[1]);el.hidden=/\bhidden\b/.test(match[2]);el.disabled=/\bdisabled\b/.test(match[2]);elements[match[3]]=el;}
 const triage=new Element('details');
 const document={getElementById:id=>elements[id],createElement:tag=>new Element(tag),createTextNode:text=>String(text),querySelector:selector=>selector==='#feedback-dialog details.panel'?triage:{dataset:{view:'chat'}}};
 class SafeURL extends URL{static createObjectURL(){const url='blob:synthetic-'+objects.length;objects.push(url);return url;}static revokeObjectURL(url){objects.push('revoked:'+url);}}
 const sandbox={document,window:{location:{hash:''},addEventListener(){}},crypto,URL:SafeURL,Uint8Array,btoa,createImageBitmap:async()=>({width:1,height:1,close(){}}),fetch:async(url,options={})=>{
  const body=options.body?JSON.parse(options.body):undefined;const entry={url,body};requests.push(entry);const override=await intercept?.(entry);if(override)return override;
  if(url==='/api/me')return Response.json({id:'iyanah',name:'Iyanah',role:'child'});
  if(url.endsWith('/config'))return Response.json({enabled:true});
  if(url.endsWith('/submit'))return Response.json({id:body.id,state:'pending'});
  if(url.includes('/report?id='))return Response.json({id:url.split('=')[1],title:'Synthetic',details:'Safe',reporter:'Iyanah',state:'pending',context:'chat',hasScreenshot:false});
  return Response.json({reports:[],nextCursor:null});
 }};
 vm.runInNewContext(source+'\n;globalThis.hooks={prepareFeedback,openFeedback,feedbackRun,clearFeedbackPreview,getDraft:()=>feedbackDraft,showFeedbackReport,listFeedback,getId:()=>feedbackId};',sandbox);
 await sandbox.hooks.openFeedback();
 return {elements,requests,objects,hooks:sandbox.hooks,setIntercept:fn=>{intercept=fn;},async settle(){for(let i=0;i<6;i++)await tick();}};
}
function fill(c){c.elements['feedback-title'].value='Synthetic title';c.elements['feedback-details'].value='Safe description';}
test('feedback preview collects only selected context and identity permission; no network before submission',async()=>{
 const c=await client();fill(c);const before=c.requests.length;await c.hooks.prepareFeedback();
 const draft=c.hooks.getDraft();assert.equal(draft.includeContext,false);assert.equal(draft.includeName,false);assert.equal(draft.screenshot,undefined);assert.equal(c.requests.length,before);
 assert.match(c.elements['feedback-review-text'].textContent,/Context: not included/);assert.match(c.elements['feedback-review-text'].textContent,/Public name: not included/);
 assert.equal(c.elements['feedback-submit-consent'].checked,false);
});
test('selected screenshot is never read without permission and revocation discards preview',async()=>{
 const c=await client();fill(c);let reads=0;c.elements['feedback-file'].files=[{type:'image/png',size:12,arrayBuffer:async()=>{reads++;return new Uint8Array(12).buffer;}}];
 await assert.rejects(c.hooks.prepareFeedback(),/Allow the selected screenshot/);assert.equal(reads,0);
 c.elements['feedback-image-consent'].checked=true;await c.hooks.prepareFeedback();assert.equal(reads,1);assert.ok(c.hooks.getDraft().screenshot);
 c.elements['feedback-image-consent'].checked=false;c.elements['feedback-image-consent'].events.change();
 assert.equal(c.hooks.getDraft(),null);assert.equal(c.elements['feedback-file'].disabled,true);assert.equal(c.elements['feedback-local-image'].hidden,true);assert.equal(c.elements['feedback-local-image'].width,0);
});
test('revoked permission during asynchronous file read cannot reattach a screenshot',async()=>{
 const c=await client();fill(c);let resolve;c.elements['feedback-image-consent'].checked=true;
 c.elements['feedback-file'].files=[{type:'image/png',size:12,arrayBuffer:()=>new Promise(r=>{resolve=r;})}];
 const pending=c.hooks.prepareFeedback();c.elements['feedback-image-consent'].checked=false;c.elements['feedback-image-consent'].events.change();resolve(new Uint8Array(12).buffer);await pending;
 assert.equal(c.hooks.getDraft(),null);assert.equal(c.elements['feedback-review-panel'].hidden,true);
});
test('editing a reviewed report invalidates approval and failed submission retains its id for retry',async()=>{
 const c=await client();fill(c);await c.hooks.prepareFeedback();
 c.elements['feedback-form'].events.input({target:{id:'feedback-title'}});assert.equal(c.hooks.getDraft(),null);
 await c.hooks.prepareFeedback();const id=c.hooks.getId();c.elements['feedback-submit-consent'].checked=true;
 c.setIntercept(({url})=>{if(url.endsWith('/submit'))throw Error('offline');});
 c.elements['feedback-form'].onsubmit({preventDefault(){}});await c.settle();assert.equal(c.hooks.getId(),id);assert.equal(c.hooks.getDraft().id,id);assert.equal(c.requests.filter(r=>r.url.endsWith('/submit')).length,1);
 c.setIntercept(null);c.elements['feedback-form'].onsubmit({preventDefault(){}});await c.settle();
 const submitted=c.requests.filter(r=>r.url.endsWith('/submit'));assert.equal(submitted.length,2);assert.equal(submitted[0].body.id,submitted[1].body.id);
 assert.notEqual(c.hooks.getId(),id);assert.equal(c.elements['feedback-owner-review'].hidden,true);
});
test('submission without preview/consent performs no POST and closing clears image permission',async()=>{
 const c=await client();fill(c);c.elements['feedback-form'].onsubmit({preventDefault(){}});await c.settle();assert.equal(c.requests.some(r=>r.body),false);
 c.elements['feedback-image-consent'].checked=true;c.elements['feedback-close'].onclick();assert.equal(c.elements['feedback-image-consent'].checked,false);assert.equal(c.elements['feedback-file'].disabled,true);assert.equal(c.elements['feedback-dialog'].open,false);
});
test('opening a restricted report expands its enclosing triage panel',async()=>{
 const c=await client();c.elements['feedback-triage'].open=false;
 await c.hooks.showFeedbackReport('synthetic-id');assert.equal(c.elements['feedback-triage'].open,true);assert.equal(c.elements['feedback-report'].hidden,false);
});
test('report list has working forward/back navigation with opaque encoded cursors',async()=>{
 const c=await client();const cursor='2026-10-01 10:00:00|synthetic-id';
 c.setIntercept(({url})=>url.startsWith('/api/feedback?')?Response.json({reports:[{id:'synthetic-id',reporter:'Iyanah',state:'pending',created:'synthetic'}],nextCursor:url.includes('cursor=')?null:cursor}):null);
 await c.hooks.listFeedback();assert.equal(c.elements['feedback-next'].hidden,false);assert.equal(c.elements['feedback-previous'].hidden,true);
 await c.elements['feedback-next'].onclick();assert.ok(c.requests.at(-1).url.endsWith('cursor='+encodeURIComponent(cursor)));assert.equal(c.elements['feedback-next'].hidden,true);assert.equal(c.elements['feedback-previous'].hidden,false);
 await c.elements['feedback-previous'].onclick();assert.equal(c.elements['feedback-previous'].hidden,true);
});
test('selected images render as pixels on canvas, never as a DOM-derived blob URL',async()=>{
 const c=await client();fill(c);c.elements['feedback-image-consent'].checked=true;c.elements['feedback-file'].files=[{type:'image/png',size:12,arrayBuffer:async()=>new Uint8Array(12).buffer}];
 await c.hooks.prepareFeedback();assert.equal(c.elements['feedback-local-image'].tag,'canvas');assert.equal(c.elements['feedback-local-image'].width,1);assert.equal(c.elements['feedback-local-image'].src,undefined);assert.equal(c.objects.length,0);
});

test('unchecked section consent transmits no current section in the POST body',async()=>{
 const c=await client();fill(c);await c.hooks.prepareFeedback();
 c.elements['feedback-submit-consent'].checked=true;c.elements['feedback-form'].onsubmit({preventDefault(){}});await c.settle();
 const submitted=c.requests.find(r=>r.url.endsWith('/submit')).body;assert.equal(submitted.includeContext,false);assert.equal(submitted.context,'unspecified');
 const opted=await client();fill(opted);opted.elements['feedback-context'].checked=true;await opted.hooks.prepareFeedback();assert.equal(opted.hooks.getDraft().context,'chat');
});
test('a supplied diagnostic UUID is displayed in private review and linked only on explicit submission',async()=>{
 const c=await client(),reference='123e4567-e89b-42d3-a456-426614174000';fill(c);c.elements['feedback-reference'].value=reference;
 await c.hooks.prepareFeedback();assert.equal(c.hooks.getDraft().relatedRequestId,reference);assert.match(c.elements['feedback-review-text'].textContent,new RegExp(reference));
 assert.equal(c.requests.some(r=>r.body),false);c.elements['feedback-submit-consent'].checked=true;c.elements['feedback-form'].onsubmit({preventDefault(){}});await c.settle();
 assert.equal(c.requests.find(r=>r.url.endsWith('/submit')).body.relatedRequestId,reference);
});
test('an invalid optional request reference explains the UUID requirement before submission',async()=>{
 const c=await client();fill(c);c.elements['feedback-reference'].value='not-a-uuid';
 await assert.rejects(c.hooks.prepareFeedback(),/Enter a valid request reference UUID or leave it blank/);
 assert.equal(c.hooks.getDraft(),null);assert.equal(c.requests.some(r=>r.body),false);
});
