import {createRemoteJWKSet,jwtVerify} from 'jose';
const OWNER='cjamula@gmail.com';
const ROOTS=['1uRQtQdhwHUIdCZVneu1mlPIn0zb8KHIw','1kMxJUnAfzL1ezaVJLHjUxjDwE1i3B9Dp'];
const CALENDAR='family07651998613531102346@group.calendar.google.com';
export const SCOPES=['openid','email','https://www.googleapis.com/auth/drive.readonly','https://www.googleapis.com/auth/calendar.events.readonly'];
const enc=new TextEncoder(),dec=new TextDecoder();
const json=(v,s=200)=>new Response(JSON.stringify(v),{status:s,headers:{'content-type':'application/json','cache-control':'no-store'}});
const googleKeys=createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
export function base64(bytes){return btoa(String.fromCharCode(...bytes));}
export function unbase64(s){return Uint8Array.from(atob(s),c=>c.charCodeAt(0));}
const random=()=>base64(crypto.getRandomValues(new Uint8Array(32))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
async function hash(s){return base64(new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(s)))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');}
async function key(env){const bytes=unbase64(env.GOOGLE_VAULT_KEY||'');if(bytes.length!==32)throw Error('Vault not configured');return crypto.subtle.importKey('raw',bytes,'AES-GCM',false,['encrypt','decrypt']);}
export async function seal(env,value,aad){const iv=crypto.getRandomValues(new Uint8Array(12));const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:enc.encode(aad)},await key(env),enc.encode(JSON.stringify(value)));return JSON.stringify({iv:base64(iv),data:base64(new Uint8Array(ciphertext))});}
export async function open(env,value,aad){const v=JSON.parse(value);return JSON.parse(dec.decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:unbase64(v.iv),additionalData:enc.encode(aad)},await key(env),unbase64(v.data))));}
function configured(env){return !!(env.GOOGLE_CLIENT_ID&&env.GOOGLE_CLIENT_SECRET&&env.GOOGLE_VAULT_KEY&&env.GOOGLE_ENABLED==='true');}
export function googleRoleAllowed(user){return user?.role==='owner'&&user.email===OWNER;}
async function responseJSON(response){if(!response.ok){let data;try{data=await response.json();}catch{}if(data?.error==='invalid_grant'){const e=new Error('Google consent expired or was revoked. Reconnect Google; no external action was executed.');e.safeGoogle=true;throw e;}const reason=data?.error?.errors?.[0]?.reason||data?.error?.status||'requestRejected';const safe=/^[A-Za-z_]+$/.test(reason)?reason:'requestRejected';const error=new Error('Google request failed: HTTP '+response.status+' ('+safe+').');error.safeGoogle=true;throw error;}return response.json();}
async function tokenRequest(env,body){return responseJSON(await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},redirect:'manual',body:new URLSearchParams({...body,client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET})}));}
export async function accessToken(env,user){const c=await env.DB.prepare('SELECT credentials FROM google_connections WHERE owner=?').bind(user.email).first();if(!c)throw Error('Google not connected');let t=await open(env,c.credentials,'google:'+user.email);if(t.expires<Date.now()+60000){const next=await tokenRequest(env,{grant_type:'refresh_token',refresh_token:t.refresh_token});if(typeof next.access_token!=='string'||!Number.isFinite(next.expires_in)||next.expires_in<=0)throw Error('Invalid refreshed credential');t={...t,access_token:next.access_token,expires:Date.now()+next.expires_in*1000};await env.DB.prepare('UPDATE google_connections SET credentials=? WHERE owner=?').bind(await seal(env,t,'google:'+user.email),user.email).run();}return t.access_token;}
async function googleFetch(token,url){return fetch(url,{headers:{authorization:'Bearer '+token},redirect:'manual'});}
async function metadata(token,id){return responseJSON(await googleFetch(token,'https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(id)+'?fields=id,name,mimeType,parents,trashed,modifiedTime,capabilities(canDownload),shortcutDetails'));}
export async function insideRoots(token,file,lookup=metadata){let nodes=file.parents||[],seen=new Set();for(let depth=0;depth<15&&nodes.length;depth++){const next=[];for(const id of nodes){if(ROOTS.includes(id))return true;if(seen.has(id))continue;seen.add(id);const parent=await lookup(token,id);if(parent.trashed)continue;next.push(...(parent.parents||[]));}nodes=next;}return false;}
async function googleHandler(request,env,user){
 const url=new URL(request.url),path=url.pathname;
 // Every route is owner-only, including metadata and status. No child/parent credential sharing.
 if(!googleRoleAllowed(user))return json({error:'Only Cyrus can manage or view this private connection.'},403);
 if(request.method==='GET'&&path==='/api/google/status'){
  if(!configured(env))return json({configured:false,connected:false});
  const c=await env.DB.prepare('SELECT scopes,connected FROM google_connections WHERE owner=?').bind(user.email).first();return json({configured:true,connected:!!c,scopes:c?.scopes,connectedAt:c?.connected});
 }
 if(!configured(env))return json({error:'Google authorization is not configured. No records have been accessed.'},503);
 const redirectUri=url.origin+'/api/google/callback';
 if(request.method==='GET'&&path==='/api/google/callback'){
  const state=url.searchParams.get('state');if(!state)return json({error:'Missing authorization state'},400);
  const saved=await env.DB.prepare('DELETE FROM oauth_states WHERE state_hash=? AND owner=? AND expires>? RETURNING verifier,nonce').bind(await hash(state),user.email,Date.now()).first();
  if(!saved)return json({error:'Expired or already-used authorization request'},400);
  const code=url.searchParams.get('code');if(!code||url.searchParams.has('error'))return json({error:'Google authorization was not completed'},400);
  const t=await tokenRequest(env,{grant_type:'authorization_code',code,redirect_uri:redirectUri,code_verifier:saved.verifier});
  const {payload}=await jwtVerify(t.id_token,googleKeys,{issuer:['https://accounts.google.com','accounts.google.com'],audience:env.GOOGLE_CLIENT_ID,algorithms:['RS256']});
  if(payload.email!==OWNER||payload.email_verified!==true||payload.nonce!==saved.nonce)return json({error:'Authorize using Cyrus’s specified Google account'},403);
  const scopes=new Set((t.scope||'').split(' '));if(!SCOPES.slice(2).every(s=>scopes.has(s)))return json({error:'Required read-only permissions were not granted'},400);
  if(!t.refresh_token)return json({error:'Offline access was not granted; reconnect with consent'},400);
  await env.DB.prepare('INSERT INTO google_connections(owner,credentials,scopes) VALUES(?,?,?) ON CONFLICT(owner) DO UPDATE SET credentials=excluded.credentials,scopes=excluded.scopes,connected=CURRENT_TIMESTAMP').bind(user.email,await seal(env,{access_token:t.access_token,refresh_token:t.refresh_token,expires:Date.now()+t.expires_in*1000},'google:'+user.email),t.scope).run();
  return Response.redirect(url.origin+'/?google=connected',303);
 }
 if(request.method==='GET'&&path==='/api/google/verify'){
  const token=await accessToken(env,user);let checked=0;for(const id of ROOTS){const root=await metadata(token,id);if(root.trashed||root.mimeType!=='application/vnd.google-apps.folder')return json({error:'An approved folder is unavailable'},403);checked++;}return json({verified:true,foldersChecked:checked,note:'Folder metadata only. No document content imported.'});
 }
 if(request.method==='GET'&&path==='/api/google/calendar'){
  const start=url.searchParams.get('start'),end=url.searchParams.get('end');const from=Date.parse(start),to=Date.parse(end);if(!Number.isFinite(from)||!Number.isFinite(to)||to<=from||to-from>32*86400000)return json({error:'Choose a window of at most 32 days'},400);
  const token=await accessToken(env,user);const query=new URLSearchParams({timeMin:new Date(from).toISOString(),timeMax:new Date(to).toISOString(),singleEvents:'true',orderBy:'startTime',maxResults:'100'});
  const data=await responseJSON(await googleFetch(token,'https://www.googleapis.com/calendar/v3/calendars/'+encodeURIComponent(CALENDAR)+'/events?'+query));return json({events:(data.items||[]).map(e=>({summary:e.summary,start:e.start,end:e.end,status:e.status})),moreAvailable:!!data.nextPageToken,note:'Owner-only live view. Not copied to family chat or AI.'});
 }
 if(request.method==='GET'&&path==='/api/google/record'){
  return json(await readPrivateRecord(env,user,url.searchParams.get('id')));
 }
 if(request.method==='GET'&&path==='/api/google/records'){
  const r=await env.DB.prepare('SELECT id,title,source_id,source_modified,imported FROM private_records WHERE owner=? ORDER BY imported DESC LIMIT 30').bind(user.email).all();return json(r.results);
 }
 if(request.method!=='POST')return json({error:'Not found'},404);
 if(request.headers.get('origin')!==url.origin)return json({error:'Origin rejected'},403);
 if(!request.headers.get('content-type')?.startsWith('application/json'))return json({error:'JSON required'},415);
 const raw=await request.text();if(raw.length>2000)return json({error:'Request too large'},413);let body;try{body=JSON.parse(raw);}catch{return json({error:'Invalid JSON'},400);}
 if(path==='/api/google/connect'){
  const state=random(),verifier=random(),nonce=random();await env.DB.prepare('DELETE FROM oauth_states WHERE expires<?').bind(Date.now()).run();await env.DB.prepare('INSERT INTO oauth_states(state_hash,owner,verifier,nonce,expires) VALUES(?,?,?,?,?)').bind(await hash(state),user.email,verifier,nonce,Date.now()+600000).run();
  const requested=body.actions===true?[...SCOPES,'https://www.googleapis.com/auth/calendar.events','https://www.googleapis.com/auth/gmail.send']:SCOPES;
  const q=new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID,redirect_uri:redirectUri,response_type:'code',scope:requested.join(' '),access_type:'offline',prompt:'consent',state,nonce,code_challenge:await hash(verifier),code_challenge_method:'S256',login_hint:OWNER});return json({authorizationUrl:'https://accounts.google.com/o/oauth2/v2/auth?'+q});
 }
 if(path==='/api/google/disconnect'){
  const c=await env.DB.prepare('SELECT credentials FROM google_connections WHERE owner=?').bind(user.email).first();if(c){const t=await open(env,c.credentials,'google:'+user.email);const r=await fetch('https://oauth2.googleapis.com/revoke',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token:t.refresh_token})});if(!r.ok)return json({error:'Google revocation failed; connection retained so you can retry'},502);}
  await env.DB.batch([env.DB.prepare('DELETE FROM google_connections WHERE owner=?').bind(user.email),env.DB.prepare('DELETE FROM oauth_states WHERE owner=?').bind(user.email)]);return json({disconnected:true,note:'Previously imported encrypted records remain until removed separately.'});
 }
 if(path==='/api/google/import'){
  if(body.confirmPrivateImport!==true)return json({error:'Explicit private import confirmation required'},400);
  const id=body.fileId;if(typeof id!=='string'||!/^[-\w]{10,150}$/.test(id))return json({error:'Invalid Drive file ID'},400);
  const token=await accessToken(env,user),file=await metadata(token,id);
  if(file.trashed||file.mimeType==='application/vnd.google-apps.shortcut'||!await insideRoots(token,file))return json({error:'Choose a direct file inside Family Hub or Parents Private'},403);
  // Reject unsupported/binary identity records rather than automatically ingesting them.
  if(!['application/vnd.google-apps.document','text/plain'].includes(file.mimeType))return json({error:'Pilot supports Google Docs and plain text only. Passport images, PDFs and financial files are not imported automatically.'},415);
  const endpoint=file.mimeType==='application/vnd.google-apps.document'?'https://www.googleapis.com/drive/v3/files/'+id+'/export?mimeType=text%2Fplain':'https://www.googleapis.com/drive/v3/files/'+id+'?alt=media';
  const r=await googleFetch(token,endpoint);if(!r.ok)throw Error('Document read failed');const reader=r.body.getReader();let size=0,chunks=[];for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>64000){await reader.cancel();return json({error:'Choose a document smaller than 64 KB'},413);}chunks.push(value);}let content='';const decoder=new TextDecoder();for(const chunk of chunks)content+=decoder.decode(chunk,{stream:true});content+=decoder.decode();
  const record=crypto.randomUUID();await env.DB.prepare('INSERT INTO private_records(id,owner,source_id,title,encrypted_content,source_modified) VALUES(?,?,?,?,?,?) ON CONFLICT(owner,source_id) DO UPDATE SET title=excluded.title,encrypted_content=excluded.encrypted_content,source_modified=excluded.source_modified,imported=CURRENT_TIMESTAMP').bind(record,user.email,id,file.name,await seal(env,{content},'record:'+user.email+':'+id),file.modifiedTime).run();
  return json({imported:true,title:file.name,note:'Encrypted owner-only record. Not sent to AI or published to any chat.'});
 }
 return json({error:'Not found'},404);
}

export async function googleAPI(request,env,user){try{return await googleHandler(request,env,user);}catch(error){if(error.safeGoogle)return json({error:error.message},502);return json({error:'Google connection check failed ('+(/^[A-Za-z]+$/.test(error.name)?error.name:'Error')+'). No external action was executed.'},502);}}

export async function connectionScopes(env,user){const c=await env.DB.prepare('SELECT scopes FROM google_connections WHERE owner=?').bind(user.email).first();return new Set((c?.scopes||'').split(' '));}

export async function readPrivateRecord(env,user,id){
 if(!googleRoleAllowed(user))throw Error('Owner required');
 const r=await env.DB.prepare('SELECT * FROM private_records WHERE id=? AND owner=?').bind(id,user.email).first();if(!r)throw Error('Record not found');
 const token=await accessToken(env,user),source=await metadata(token,r.source_id);
 if(source.trashed||!await insideRoots(token,source))throw Error('Source no longer accessible');
 if(source.modifiedTime!==r.source_modified)throw Error('Source changed; reimport first');
 const stored=await open(env,r.encrypted_content,'record:'+user.email+':'+r.source_id);
 return {title:r.title,content:stored.content,sourceId:r.source_id,modified:r.source_modified,note:'Owner-only view. Not sent to AI by this read.'};
}
