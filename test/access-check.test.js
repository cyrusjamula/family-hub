import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../public/access-check.js',import.meta.url),'utf8');
function harness(person={id:'cyrus',role:'owner'},override){
 class Element{constructor(){this.children=[];this.textContent='';}append(node){this.children.push(node);}replaceChildren(){this.children=[];}}
 const elements=Object.fromEntries(['run-check','check-results','check-identity','check-status'].map(id=>[id,new Element()])),requests=[],cancelled=[];
 const fetch=async(path,options)=>{
  requests.push({path,options});const changed=await override?.(path,requests.length);if(changed)return changed;
  if(path==='/api/me')return Response.json(person);
  const denied=(path.includes('parents')&&person.role==='child')||(!path.includes('messages')&&person.role!=='owner');
  return {status:denied?403:200,body:{cancel:async()=>cancelled.push(path)},json(){throw Error('Private JSON must not be read');},text(){throw Error('Private text must not be read');}};
 };
 vm.runInNewContext(source,{document:{getElementById:id=>elements[id],createElement:()=>new Element()},fetch,AbortSignal});
 return {elements,requests,cancelled,run:()=>elements['run-check'].onclick()};
}
test('access checks require a click and discard every private response for all roles',async()=>{
 for(const person of [{id:'cyrus',role:'owner'},{id:'anhaita',role:'parent'},{id:'iyanah',role:'child'},{id:'aarish',role:'child'}]){
  const h=harness(person);assert.equal(h.requests.length,0);await h.run();assert.equal(h.requests.length,6);assert.equal(h.cancelled.length,5);assert.match(h.elements['check-status'].textContent,/5 of 5 checks passed/);assert.match(h.elements['check-identity'].textContent,new RegExp(person.role));
  for(const {options} of h.requests){assert.equal(options.method,'GET');assert.equal(options.credentials,'same-origin');assert.equal(options.redirect,'error');assert.equal(options.cache,'no-store');assert.equal(options.body,undefined);assert.ok(options.signal instanceof AbortSignal);}
 }
});
test('unexpected private success cancels body and stops before more probes',async()=>{
 let cancelled=false;
 const h=harness({id:'iyanah',role:'child'},path=>path.includes('parents')?{status:200,body:{cancel:async()=>{cancelled=true;}},json(){throw Error('Never parse private data');}}:undefined);
 await h.run();assert.equal(cancelled,true);assert.equal(h.requests.length,3);assert.match(h.elements['check-status'].textContent,/Stopped: Parents private conversation/);assert.equal(h.elements['check-results'].children[1].children[3].textContent,'FAIL');
});
test('unknown or inconsistent identities stop before protected probes',async()=>{
 for(const person of [{id:'unknown',role:'owner'},{id:'iyanah',role:'owner'},{id:'cyrus',role:'child'}]){const h=harness(person);await h.run();assert.equal(h.requests.length,1);assert.equal(h.elements['check-identity'].textContent,'');assert.match(h.elements['check-status'].textContent,/could not finish/);}
});
test('auth redirects and transport failures show a generic error without response content',async()=>{
 for(const reply of [()=>{throw Error('sensitive transport detail');},()=>new Response('<private>login</private>',{headers:{'content-type':'text/html'}}),()=>new Response('private denial',{status:401})]){
  const h=harness(undefined,reply);await h.run();assert.equal(h.requests.length,1);assert.match(h.elements['check-status'].textContent,/could not finish/);assert.doesNotMatch(h.elements['check-status'].textContent,/sensitive|<private>|private denial/);assert.equal(h.elements['run-check'].disabled,false);
 }
});
test('concurrent clicks cannot overlap checks and retry works after failure',async()=>{
 let resolve,first=true;const wait=new Promise(r=>{resolve=r;});const h=harness(undefined,async()=>{if(first){first=false;await wait;throw Error('offline');}});
 const run=h.run();await h.run();assert.equal(h.requests.length,1);assert.equal(h.elements['run-check'].disabled,true);resolve();await run;await h.run();assert.equal(h.requests.length,7);assert.match(h.elements['check-status'].textContent,/5 of 5/);
});
