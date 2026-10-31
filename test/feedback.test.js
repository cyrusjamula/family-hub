import {releaseFor} from '../src/release.js';
import {people} from '../src/policy.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {feedbackAPI,validateScreenshot,issuePayload} from '../src/feedback.js';
import {directory,member} from '../src/policy.js';
import {digest} from '../src/actions.js';
import {open} from '../src/vault.js';
import {base64} from '../src/vault.js';
const owner=member(people.cyrus.email),child=member(people.iyanah.email),adult=member(people.anhaita.email);
const image={type:'image/png',data:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jL1sAAAAASUVORK5CYII='};
const req=(route,body,origin='https://hub.test')=>new Request('https://hub.test/api/feedback'+route,body===undefined?{}:{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)});
const draft=()=>({id:crypto.randomUUID(),title:'Synthetic feedback',details:'Only synthetic details',includeContext:true,context:'chat',includeName:false,confirmPrivateFeedback:true});
function fixture(){
 const sql=new DatabaseSync(':memory:');for(const name of readdirSync(new URL('../migrations/',import.meta.url)).sort())sql.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
 const DB={prepare(query){const bound=(args=[])=>({first:async()=>sql.prepare(query).get(...args)??null,all:async()=>({results:sql.prepare(query).all(...args)}),run:async()=>sql.prepare(query).run(...args)});return {...bound(),bind:(...args)=>bound(args)};}};
 const env={DB,FEEDBACK_ENABLED:'true',TELEMETRY_RELEASE:'abcdef0123456789',GOOGLE_VAULT_KEY:btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))),GITHUB_FEEDBACK_TOKEN:'synthetic-never-live'};
 return {sql,env,api:(route,body,user=owner,send=()=>{throw Error('No provider call expected');})=>feedbackAPI(req(route,body),env,user,send)};
}
test('feedback disabled, unauthenticated, unknown, and cross-origin requests fail before storage/provider',async()=>{
 const badDB={prepare(){throw Error('Storage must not be touched');}};
 assert.equal((await feedbackAPI(req('/submit',draft()),{DB:badDB},owner)).status,503);
 for(const user of [null,{id:'cyrus',role:'owner',email:'unknown@example.test'},{...child,role:'owner'}])assert.equal((await feedbackAPI(req(''),{DB:badDB,FEEDBACK_ENABLED:'true'},user)).status,403);
 assert.equal((await feedbackAPI(req('/submit',draft(),'https://evil.test'),{DB:badDB,FEEDBACK_ENABLED:'true'},child)).status,403);
 for(const user of [child,adult])for(const route of ['/preview','/publish','/reject','/reconcile'])assert.equal((await feedbackAPI(req(route,{id:crypto.randomUUID()}),{DB:badDB,FEEDBACK_ENABLED:'true'},user)).status,403);
});
test('text feedback needs permission and does not collect unselected context, logs, names or screenshots',async()=>{
 const {sql,env,api}=fixture(),body={...draft(),includeContext:false,context:'parents',signInEmail:'not-trusted',log:'SECRET LOG',screenshot:null};
 assert.equal((await api('/submit',{...body,confirmPrivateFeedback:false},child)).status,400);
 const result=await api('/submit',body,child);assert.equal(result.status,200);
 const row=sql.prepare('SELECT * FROM feedback').get();assert.equal(row.reporter,child.email);assert.equal(row.reporter_id,child.id);assert.equal(row.screenshot,null);assert.ok(!row.payload.includes(body.details));
 const saved=await open(env,row.payload,'feedback:'+child.email+':'+body.id);
 assert.deepEqual(saved,{title:body.title,details:body.details,context:'unspecified',includeName:false,relatedRequestId:null,release:releaseFor(env)});
 assert.equal(JSON.stringify(saved).includes('SECRET LOG'),false);sql.close();
});
test('identical retry of a report saved before request references existed returns the saved report',async()=>{
 const {sql,api}=fixture(),body=draft();
 const legacy={title:body.title,details:body.details,context:'chat',includeName:false,screenshot:null};
 sql.prepare('INSERT INTO feedback(id,reporter,reporter_id,payload,digest) VALUES(?,?,?,?,?)').run(body.id,child.email,child.id,'legacy',await digest(legacy));
 const retry=await api('/submit',body,child);assert.equal(retry.status,200);assert.equal((await retry.json()).id,body.id);sql.close();
});
test('screenshots require separate permission, supported type, signature and bounded size',async()=>{
 assert.throws(()=>validateScreenshot(image,false));assert.deepEqual(validateScreenshot(image,true),image);
 for(const bad of [{type:'image/svg+xml',data:btoa('<svg onload="evil()"/>')},{...image,type:'image/jpeg'},{...image,data:'not-base64'},{...image,data:'A'.repeat(200004)},{...image,data:btoa('not an image')}])assert.throws(()=>validateScreenshot(bad,true));
 const {sql,api}=fixture(),body={...draft(),screenshot:image};
 assert.equal((await api('/submit',body,child)).status,400);assert.equal(sql.prepare('SELECT count(*) AS n FROM feedback').get().n,0);
 assert.equal((await api('/submit',{...body,confirmScreenshot:true},child)).status,200);sql.close();
});
test('100 KB and full 150 KB screenshots encrypt, save and round-trip without argument-limit failures',async()=>{
 const {sql,api}=fixture();
 for(const size of [100000,150000]){
  const bytes=new Uint8Array(size);bytes.set([137,80,78,71,13,10,26,10]);
  const body={...draft(),confirmScreenshot:true,screenshot:{type:'image/png',data:base64(bytes)}};
  assert.equal((await api('/submit',body,child)).status,200);
  const response=await api('/image?id='+body.id,undefined,owner);assert.equal(response.status,200);assert.deepEqual(new Uint8Array(await response.arrayBuffer()),bytes);
 }
 sql.close();
});
test('pending reports remain reachable across pages despite newer completed reports and shared timestamps',async()=>{
 const {sql,api}=fixture(),expected=new Set();
 const insert=sql.prepare('INSERT INTO feedback(id,reporter,reporter_id,payload,digest,state,created) VALUES(?,?,?,?,?,?,?)');
 for(let i=0;i<65;i++){const id=crypto.randomUUID();expected.add(id);insert.run(id,child.email,child.id,'unused','unused','pending','2026-10-01 10:00:00');}
 for(let i=0;i<35;i++)insert.run(crypto.randomUUID(),adult.email,adult.id,'unused','unused','published','2026-10-02 10:00:00');
 let cursor=null;const seen=[];
 do{const page=await (await api(cursor?'?cursor='+encodeURIComponent(cursor):'')).json();seen.push(...page.reports.map(r=>r.id));assert.ok(page.reports.every(r=>r.state==='pending'));cursor=page.nextCursor;}while(cursor);
 assert.equal(seen.length,65);assert.deepEqual(new Set(seen),expected);
 const adultPage=await (await api('',undefined,adult)).json();assert.equal(adultPage.reports.length,30);assert.ok(adultPage.reports.every(r=>r.reporter==='Anhaita'));
 assert.equal((await api('?cursor='+encodeURIComponent("bad' OR 1=1"))).status,400);assert.equal((await api('?state=invalid')).status,400);sql.close();
});
test('private feedback and encrypted screenshots are visible only to reporter and owner',async()=>{
 const {sql,api}=fixture(),body={...draft(),confirmScreenshot:true,screenshot:image};await api('/submit',body,child);
 for(const user of [child,owner]){
  const report=await api('/report?id='+body.id,undefined,user);assert.equal(report.status,200);const value=await report.json();assert.equal(value.reporter,'Iyanah');assert.equal(value.hasScreenshot,true);assert.equal(value.screenshot,undefined);assert.equal(value.signInEmail,undefined);
  const picture=await api('/image?id='+body.id,undefined,user);assert.equal(picture.status,200);assert.equal(picture.headers.get('content-type'),'image/png');assert.equal(picture.headers.get('cache-control'),'no-store');assert.equal((await picture.arrayBuffer()).byteLength,atob(image.data).length);
 }
 for(const path of ['/report?id=','/image?id='])assert.equal((await api(path+body.id,undefined,adult)).status,404);
 assert.deepEqual((await (await api('',undefined,adult)).json()).reports,[]);assert.equal((await (await api('',undefined,child)).json()).reports.length,1);
 const stored=sql.prepare('SELECT * FROM feedback').get();assert.ok(!stored.screenshot.includes(image.data));sql.close();
});
test('feedback submissions are idempotent across concurrent retries and alias sign-ins',async()=>{
 const {sql,env,api}=fixture(),body=draft(),alias=directory('{"synthetic.alias@example.test":"iyanah"}').resolve('synthetic.alias@example.test');
 const results=await Promise.all(Array.from({length:4},()=>api('/submit',body,child)));assert.ok(results.every(r=>r.status===200));
 assert.equal((await feedbackAPI(req('/submit',body),env,alias)).status,200);assert.equal(sql.prepare('SELECT count(*) AS n FROM feedback').get().n,1);
 assert.equal((await api('/submit',{...body,details:'Changed'},child)).status,409);assert.equal((await api('/submit',body,adult)).status,409);sql.close();
});
test('daily report cap is per person and remains atomic with concurrent submissions',async()=>{
 const {sql,env,api}=fixture();const results=await Promise.all(Array.from({length:8},()=>api('/submit',draft(),child)));
 assert.equal(results.filter(r=>r.status===200).length,5);assert.equal(results.filter(r=>r.status===429).length,3);
 const alias=directory('{"synthetic.alias@example.test":"iyanah"}').resolve('synthetic.alias@example.test');assert.equal((await feedbackAPI(req('/submit',draft()),env,alias)).status,429);sql.close();
});
test('public preview is exact, respects name consent, and excludes private image, email and metadata',async()=>{
 const {sql,api}=fixture(),body={...draft(),confirmScreenshot:true,screenshot:image};await api('/submit',body,child);
 const preview=await (await api('/preview',{id:body.id,publicTitle:'Sanitized title',publicDetails:'Sanitized details @someone <script>'})).json();
 assert.equal(preview.visibility,'public');assert.equal(preview.repository,'cyrusjamula/family-hub');
 const text=JSON.stringify(preview.payload);assert.ok(!text.includes(child.email));assert.ok(!text.includes('Iyanah'));assert.ok(!text.includes(image.data));assert.ok(!text.includes('@someone'));assert.ok(!text.includes('<script>'));assert.match(text,/Restricted report and screenshot/);assert.match(text,/Context: chat/);
 const row=sql.prepare('SELECT * FROM feedback').get();assert.match(issuePayload(row,{includeName:true,context:'settings'},{publicTitle:'T',publicDetails:'D'}).body,/Reporter: Iyanah/);sql.close();
});
test('feedback links only a valid optional reference and release in encrypted private data and reviewed issue text',async()=>{
 const {sql,api,env}=fixture(),reference=crypto.randomUUID(),body={...draft(),relatedRequestId:reference};
 const invalid=await api('/submit',{...body,relatedRequestId:'PRIVATE_TOKEN'},child);
 assert.equal(invalid.status,400);assert.equal((await invalid.json()).error,'Enter a valid request reference UUID or leave it blank');
 assert.equal((await api('/submit',body,child)).status,200);
 const privateReport=await (await api('/report?id='+body.id,undefined,child)).json();
 assert.equal(privateReport.relatedRequestId,reference);assert.equal(privateReport.release,releaseFor(env));
 const review={id:body.id,publicTitle:'Sanitized title',publicDetails:'Sanitized details'},preview=await (await api('/preview',review)).json();
 assert.match(preview.payload.body,new RegExp(reference));assert.ok(preview.payload.body.includes('Hub release: '+releaseFor(env)));
 assert.equal(preview.payload.body.includes(body.details),false);sql.close();
});
test('missing connection, absent approval and changed digest never call GitHub',async()=>{
 const {sql,env,api}=fixture(),body=draft();await api('/submit',body,child);let calls=0;const provider=()=>{calls++;throw Error('must not call');};
 const publish={id:body.id,publicTitle:'Reviewed',publicDetails:'Reviewed details',digest:'wrong',confirmPublicIssue:true};
 assert.equal((await api('/publish',publish,owner,provider)).status,400);
 const preview=await (await api('/preview',publish)).json();
 assert.equal((await api('/publish',{...publish,digest:preview.digest,confirmPublicIssue:false},owner,provider)).status,400);
 assert.equal((await feedbackAPI(req('/publish',{...publish,digest:preview.digest}),{...env,GITHUB_FEEDBACK_TOKEN:''},owner,provider)).status,503);assert.equal(calls,0);assert.equal(sql.prepare('SELECT state FROM feedback').get().state,'pending');sql.close();
});
test('only exact owner-approved issue is created once under concurrent publish attempts',async()=>{
 const {sql,api}=fixture(),body={...draft(),confirmScreenshot:true,screenshot:image};await api('/submit',body,child);
 const review={id:body.id,publicTitle:'Approved title',publicDetails:'Approved description'},preview=await (await api('/preview',review)).json();let calls=0;
 const provider=async(url,init)=>{calls++;assert.equal(url,'https://api.github.com/repos/cyrusjamula/family-hub/issues');assert.equal(init.redirect,'manual');assert.deepEqual(JSON.parse(init.body),preview.payload);assert.equal(init.body.includes(image.data),false);return Response.json({number:123,html_url:'https://github.com/cyrusjamula/family-hub/issues/123'},{status:201});};
 const publish={...review,digest:preview.digest,confirmPublicIssue:true};
 const results=await Promise.all([api('/publish',publish,owner,provider),api('/publish',publish,owner,provider)]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);assert.equal(calls,1);assert.equal(sql.prepare('SELECT state FROM feedback').get().state,'published');sql.close();
});
test('timeouts, redirects, invalid provider URLs, and bookkeeping failure never resend an issue',async()=>{
 for(const failure of ['timeout','redirect','bad-url','bookkeeping']){
  const {sql,env,api}=fixture(),body=draft();await api('/submit',body,child);const review={id:body.id,publicTitle:'Reviewed',publicDetails:'Safe'};const preview=await (await api('/preview',review)).json();let calls=0;
  if(failure==='bookkeeping'){const prepare=env.DB.prepare.bind(env.DB);env.DB.prepare=query=>{if(query.startsWith("UPDATE feedback SET state='published'"))throw Error('completion write unavailable');return prepare(query);};}
  const provider=async()=>{calls++;if(failure==='timeout')throw Error('timeout');if(failure==='redirect')return new Response(null,{status:302});return Response.json({number:123,html_url:failure==='bad-url'?'https://evil.test':'https://github.com/cyrusjamula/family-hub/issues/123'},{status:201});};
  const publish={...review,digest:preview.digest,confirmPublicIssue:true};assert.equal((await api('/publish',publish,owner,provider)).status,502);assert.equal((await api('/publish',publish,owner,provider)).status,409);assert.equal(calls,1);assert.equal(sql.prepare('SELECT state FROM feedback').get().state,'uncertain');sql.close();
 }
});
test('rejected reports cannot publish and oversized submissions never persist',async()=>{
 const {sql,api}=fixture(),body=draft();await api('/submit',body,child);await api('/reject',{id:body.id});
 const review={id:body.id,publicTitle:'Reviewed',publicDetails:'Safe'},preview=await (await api('/preview',review)).json();
 assert.equal((await api('/publish',{...review,digest:preview.digest,confirmPublicIssue:true})).status,409);
 assert.equal((await api('/submit',{...draft(),extra:'x'.repeat(226000)},child)).status,400);assert.equal(sql.prepare('SELECT count(*) AS n FROM feedback').get().n,1);sql.close();
});

test('concurrent reuse of an ID with a different payload or reporter returns conflict, not quota',async()=>{
 for(const otherPerson of [false,true]){
  const {sql,api}=fixture(),body=draft();
  const results=await Promise.all([api('/submit',body,child),api('/submit',otherPerson?body:{...body,details:'Different payload'},otherPerson?adult:child)]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);assert.equal(sql.prepare('SELECT count(*) AS n FROM feedback').get().n,1);sql.close();
 }
});

async function uncertainFeedback(f){
 const body=draft();await f.api('/submit',body,child);
 const review={id:body.id,publicTitle:'Synthetic recovery',publicDetails:'Only synthetic recovery details'};
 const preview=await (await f.api('/preview',review)).json();
 assert.equal((await f.api('/publish',{...review,digest:preview.digest,confirmPublicIssue:true},owner,async()=>{throw Error('lost acknowledgement');})).status,502);
 return {id:body.id,payload:preview.payload};
}
test('uncertain feedback links an exact existing issue with GET only and concurrent retries are idempotent',async()=>{
 const f=fixture();try{
  const {id,payload}=await uncertainFeedback(f);let calls=0;
  const read=async(url,init)=>{calls++;assert.equal(url,'https://api.github.com/repos/cyrusjamula/family-hub/issues/73');assert.equal(init.method,'GET');assert.equal(init.redirect,'manual');assert.equal(init.body,undefined);return Response.json({...payload,number:73,html_url:'https://github.com/cyrusjamula/family-hub/issues/73'});};
  const body={id,issueNumber:73,confirmExistingIssue:true};
  const results=await Promise.all([f.api('/reconcile',body,owner,read),f.api('/reconcile',body,owner,read)]);
  assert.deepEqual(results.map(r=>r.status),[200,200]);assert.equal(calls,2);
  assert.equal(f.sql.prepare('SELECT state FROM feedback').get().state,'published');
  assert.equal((await f.api('/reconcile',body)).status,200);
  assert.equal((await f.api('/reconcile',{...body,issueNumber:74})).status,409);
 }finally{f.sql.close();}
});
test('recovery rejects mismatched issues, redirects, denied and oversized reads without changing or resending',async()=>{
 for(const failure of ['title','body','number','url','pull-request','redirect','denied','oversized','network']){
  const f=fixture();try{
   const {id,payload}=await uncertainFeedback(f);let calls=0;
   const read=async(url,init)=>{calls++;assert.equal(init.method,'GET');
    if(failure==='network')throw Error('sensitive provider details');
    if(failure==='redirect')return new Response(null,{status:302});
    if(failure==='denied')return new Response(null,{status:403});
    const issue={...payload,number:73,html_url:'https://github.com/cyrusjamula/family-hub/issues/73'};
    if(failure==='oversized')return Response.json({...issue,padding:'x'.repeat(131072)});
    if(failure==='pull-request')issue.pull_request={};else issue[{title:'title',body:'body',number:'number',url:'html_url'}[failure]]='wrong';
    return Response.json(issue);
   };
   const response=await f.api('/reconcile',{id,issueNumber:73,confirmExistingIssue:true},owner,read);
   assert.equal(response.status,422,failure);assert.equal(calls,1);assert.equal(f.sql.prepare('SELECT state FROM feedback').get().state,'uncertain');assert.equal((await response.text()).includes('sensitive provider details'),false);
  }finally{f.sql.close();}
 }
});
test('recovery requires explicit confirmation and uncertain state before provider access',async()=>{
 const f=fixture();try{
  const body=draft();await f.api('/submit',body,child);
  for(const input of [{id:body.id,issueNumber:73},{id:body.id,issueNumber:'73',confirmExistingIssue:true}])assert.equal((await f.api('/reconcile',input)).status,400);
  assert.equal((await f.api('/reconcile',{id:body.id,issueNumber:73,confirmExistingIssue:true})).status,409);
  const {id}=await uncertainFeedback(f);delete f.env.GITHUB_FEEDBACK_TOKEN;
  assert.equal((await f.api('/reconcile',{id,issueNumber:73,confirmExistingIssue:true})).status,503);
 }finally{f.sql.close();}
});
test('recovery cannot overwrite a concurrent change to the approved publication intent',async()=>{
 const f=fixture();try{
  const {id,payload}=await uncertainFeedback(f);
  const read=async()=>{f.sql.prepare('UPDATE feedback SET public_payload=? WHERE id=?').run('changed',id);return Response.json({...payload,number:73,html_url:'https://github.com/cyrusjamula/family-hub/issues/73'});};
  assert.equal((await f.api('/reconcile',{id,issueNumber:73,confirmExistingIssue:true},owner,read)).status,409);
  assert.equal(f.sql.prepare('SELECT state,issue_url FROM feedback').get().state,'uncertain');assert.equal(f.sql.prepare('SELECT issue_url FROM feedback').get().issue_url,null);
 }finally{f.sql.close();}
});
