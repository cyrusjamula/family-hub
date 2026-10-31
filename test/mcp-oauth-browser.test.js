import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {existsSync,mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:https';
import {registerHooks} from 'node:module';

registerHooks({resolve(specifier,context,next){if(specifier==='cloudflare:workers')return {url:'data:text/javascript,export class WorkerEntrypoint {}',shortCircuit:true};return next(specifier,context);}});
const {createFamilyOAuthProvider}=await import('../src/integrations/mcp-oauth-provider.js');
const chrome=[process.env.CHROME_BIN,'/usr/bin/google-chrome','/usr/bin/google-chrome-stable','/usr/bin/chromium','/usr/bin/chromium-browser'].find(p=>p&&existsSync(p));
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(predicate,message){for(let i=0;i<200;i++){if(await predicate())return;await wait(50);}throw Error(message);}
function memoryKV(){
 const values=new Map();return {async get(key,type){const row=values.get(key);return row===undefined?null:(type==='json'||type?.type==='json')?JSON.parse(row.value):row.value;},async put(key,value,options={}){values.set(key,{value,metadata:options.metadata});},async delete(key){values.delete(key);},async list({prefix=''}={}){return {keys:[...values].filter(([key])=>key.startsWith(prefix)).map(([name,row])=>({name,metadata:row.metadata})),list_complete:true,cursor:''};}};
}
async function chromium(t,dir){
 const child=spawn(chrome,['--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--disable-background-networking','--disable-component-update','--disable-default-apps','--disable-sync','--no-first-run','--no-proxy-server','--ignore-certificate-errors','--remote-debugging-port=0','--user-data-dir='+join(dir,'browser'),'about:blank'],{stdio:['ignore','ignore','pipe']});
 t.after(()=>{child.kill('SIGKILL');});
 const endpoint=await new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(Error('Chromium did not start')),10000);child.once('error',reject);child.once('exit',()=>reject(Error('Chromium exited before connecting')));child.stderr.on('data',chunk=>{output+=chunk;const match=/DevTools listening on (ws:\/\/[^\s]+)/.exec(output);if(match){clearTimeout(timer);resolve(match[1]);}});});
 const socket=new WebSocket(endpoint);await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});t.after(()=>socket.close());
 let nextId=0;const pending=new Map();socket.addEventListener('message',event=>{const data=JSON.parse(event.data),entry=pending.get(data.id);if(entry){pending.delete(data.id);clearTimeout(entry.timer);data.error?entry.reject(Error('Chromium command failed')):entry.resolve(data.result);}});
 function send(method,params={},sessionId){return new Promise((resolve,reject)=>{const id=++nextId,timer=setTimeout(()=>{pending.delete(id);reject(Error('Chromium command timed out'));},5000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});}
 const {targetId}=await send('Target.createTarget',{url:'about:blank'}),{sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});
 return (method,params)=>send(method,params,sessionId);
}

for(const decision of ['allow','deny'])test('Chromium follows '+decision+' consent POST to its validated cross-origin callback',{skip:!chrome&&!process.env.CI,timeout:40000},async t=>{
 assert.ok(chrome,'CI requires Chromium; set CHROME_BIN if its executable is not on the standard path');
 const dir=mkdtempSync(join(tmpdir(),'family-oauth-csp-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const certificate=spawnSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(dir,'key.pem'),'-out',join(dir,'cert.pem'),'-days','1','-subj','/CN=localhost'],{stdio:'ignore'});
 assert.equal(certificate.status,0,'A local OpenSSL executable is required for the ephemeral test certificate');
 let provider,issuer;const env={OAUTH_KV:memoryKV()},ctx={waitUntil(){},passThroughOnException(){}},callbacks=[];
 const server=createServer({key:readFileSync(join(dir,'key.pem')),cert:readFileSync(join(dir,'cert.pem'))},async(req,res)=>{
  try{
   const url=new URL(req.url,'https://'+req.headers.host);
   if(url.pathname==='/callback'){callbacks.push(url);res.writeHead(200,{'content-type':'text/html'});res.end('<title>Synthetic callback received</title>');return;}
   let body='';for await(const chunk of req){body+=chunk;if(body.length>4096)throw Error();}
   const response=await provider.fetch(new Request(url,{method:req.method,headers:req.headers,...(body?{body}: {})}),env,ctx);
   res.writeHead(response.status,{...Object.fromEntries(response.headers),...(response.headers.getSetCookie().length?{'set-cookie':response.headers.getSetCookie()}: {})});res.end(Buffer.from(await response.arrayBuffer()));
  }catch{res.writeHead(500);res.end('Synthetic test server failure');}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();server.close();});
 const port=server.address().port;issuer='https://127.0.0.1:'+port+'/';const redirect='https://localhost:'+port+'/callback',resource=issuer+'mcp',registered=new Set();
 provider=createFamilyOAuthProvider({enabled:true,issuer,resource,allowDynamicRegistration:true,authenticate:async()=>({id:'synthetic-member'}),resolveMember:async id=>({id,role:'child'}),resolveRegisteredClient:async(_member,id)=>registered.has(id)?{id:'synthetic-client'}:null,grants:{async read(){throw Error('No task read expected');}}});
 const registration=await provider.fetch(new Request(issuer+'oauth/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({client_name:'Synthetic browser client',redirect_uris:[redirect],token_endpoint_auth_method:'none',grant_types:['authorization_code'],response_types:['code']})}),env,ctx);
 assert.equal(registration.status,201);const client=(await registration.json()).client_id;registered.add(client);
 const challenge=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode('a'.repeat(43)))).toString('base64url'),url=new URL(issuer+'authorize');
 for(const [key,value] of Object.entries({client_id:client,redirect_uri:redirect,response_type:'code',scope:'tasks:read',resource,state:'synthetic-state',code_challenge:challenge,code_challenge_method:'S256'}))url.searchParams.set(key,value);
 const send=await chromium(t,dir);await send('Page.navigate',{url:url.href});
 await until(async()=>{const r=await send('Runtime.evaluate',{expression:'!!document.querySelector("button[value='+decision+']")',returnByValue:true});return r.result.value;},'Consent form did not appear');
 await send('Runtime.evaluate',{expression:'document.querySelector("button[value='+decision+']").click()'});
 await until(()=>callbacks.length>0,'Chromium blocked the consent callback redirect');
 assert.equal(callbacks.length,1);assert.equal(callbacks[0].origin,new URL(redirect).origin);assert.equal(callbacks[0].searchParams.get('state'),'synthetic-state');
 if(decision==='allow'){assert.ok(callbacks[0].searchParams.get('code'));assert.equal(callbacks[0].searchParams.has('error'),false);}else{assert.equal(callbacks[0].searchParams.get('error'),'access_denied');assert.equal(callbacks[0].searchParams.has('code'),false);}
});
