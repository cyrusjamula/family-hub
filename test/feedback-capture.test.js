import test from 'node:test';import assert from 'node:assert/strict';
import {captureFeedbackPage} from '../public/feedback-capture.js';
const viewport={innerWidth:2400,innerHeight:1600,scrollX:5,scrollY:100};
function fixture(size=100){const canvases=[];return {body:{},canvases,createElement(){const c={width:0,height:0,getContext:()=>({drawImage(){}}),toBlob(fn,type){fn(new Blob([new Uint8Array(size)],{type}));}};canvases.push(c);return c;}};}
test('page rendering is local, visible-viewport-only, excludes the dialog and sensitive browser fields, and bounds attachment size',async()=>{
 const doc=fixture(),original={width:2400,height:1600};let options;
 const blob=await captureFeedbackPage({document:doc,viewport,render:async(body,opt)=>{assert.equal(body,doc.body);options=opt;return original;}});
 assert.equal(blob.type,'image/jpeg');assert.ok(blob.size<=150000);assert.equal(options.width,2400);assert.equal(options.height,1600);assert.equal(options.y,100);assert.equal(options.allowTaint,false);assert.equal(options.useCORS,false);assert.equal(options.proxy,null);assert.equal(options.logging,false);
 for(const node of [{id:'feedback-dialog'},{tagName:'IFRAME'},{type:'password'},{type:'file'}])assert.equal(options.ignoreElements(node),true);assert.equal(options.ignoreElements({tagName:'P'}),false);assert.equal(original.width,0);assert.equal(doc.canvases[0].width,0);
});
test('oversized or failed rendering gracefully falls back to text/upload and releases canvases',async()=>{
 const doc=fixture(150001),original={width:2000,height:1200};assert.equal(await captureFeedbackPage({document:doc,viewport,render:async()=>original}),null);assert.equal(original.width,0);assert.equal(doc.canvases[0].width,0);
 assert.equal(await captureFeedbackPage({document:fixture(),viewport,render:async()=>{throw Error('no renderer');}}),null);
});
test('timed-out capture cannot return a late attachment and clears its eventual pixels',async()=>{
 let resolve;const pending=new Promise(r=>{resolve=r;}),original={width:100,height:100};const result=await captureFeedbackPage({document:fixture(),viewport,timeout:1,render:()=>pending});assert.equal(result,null);resolve(original);await new Promise(r=>setImmediate(r));assert.equal(original.width,0);assert.equal(original.height,0);
});
