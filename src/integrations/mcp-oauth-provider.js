import {OAuthAuthorizationServer,OAuthResourceServer,AuthorizationError,insufficientScope} from '@cloudflare/workers-oauth-provider';
import {createMcpTaskGateway} from './mcp-task-gateway.js';

const internalId=/^[A-Za-z0-9_-]{1,128}$/;
const scopes=['tasks:read'];
const json=(error,status)=>Response.json({error},{status,headers:{'cache-control':'no-store'}});
const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
async function consentForm(request){
 if(request.headers.get('content-type')!=='application/x-www-form-urlencoded')throw Error();
 const reader=request.body?.getReader();if(!reader)throw Error();let size=0,text='';const decoder=new TextDecoder('utf-8',{fatal:true});
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>2048){void reader.cancel().catch(()=>{});throw Error();}text+=decoder.decode(value,{stream:true});}text+=decoder.decode();}
 finally{reader.releaseLock();}
 const data=new URLSearchParams(text),keys=[...data.keys()];
 if(keys.length!==2||!keys.includes('handle')||!keys.includes('decision')||!['allow','deny'].includes(data.get('decision'))||!data.get('handle')||data.get('handle').length>1024)throw Error();
 return {handle:data.get('handle'),decision:data.get('decision')};
}
async function bindingKey(handle){
 const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(handle));
 return 'family-consent:'+Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('');
}
// A separate, unmounted candidate using the official OAuth implementation. It
// does not use the custom ES256 verifier: these tokens are validated by the
// authorization server and the library supplies the verified token context.
export function createFamilyOAuthProvider({enabled=false,issuer,resource,authenticate,resolveMember,resolveRegisteredClient,grants,allowDynamicRegistration=false}={}){
 if(typeof enabled!=='boolean'||typeof allowDynamicRegistration!=='boolean')throw Error('Invalid OAuth host configuration');
 if(!enabled)return Object.freeze({async fetch(){return json('AI task access is disabled',503);},async validateToken(){return null;}});
 const authUrl=new URL(issuer),resourceUrl=new URL(resource);
 if(authUrl.protocol!=='https:'||authUrl.pathname!=='/'||authUrl.href!==issuer||authUrl.username||authUrl.password||authUrl.search||authUrl.hash||
  resourceUrl.protocol!=='https:'||resourceUrl.pathname!=='/mcp'||resourceUrl.href!==resource||resourceUrl.username||resourceUrl.password||resourceUrl.search||resourceUrl.hash||
  typeof authenticate!=='function'||typeof resolveMember!=='function'||typeof resolveRegisteredClient!=='function'||!grants||typeof grants.read!=='function')throw Error('Invalid OAuth host configuration');
 const authorizationServer=new OAuthAuthorizationServer({issuer:issuer.slice(0,-1),resources:[resource],scopesSupported:scopes,
  accessTokenTTL:600,refreshTokenTTL:3600,...(allowDynamicRegistration?{clientRegistrationEndpoint:'/oauth/register'}:{}),onError:()=>{}});
 async function person(id){
  if(typeof id!=='string'||!internalId.test(id))return null;
  const p=await resolveMember(id);return p?.id===id&&['owner','parent','child'].includes(p.role)?{id:p.id,role:p.role}:null;
 }
 async function client(memberId,externalId){
  if(typeof externalId!=='string'||!externalId||externalId.length>2048)return null;
  const c=await resolveRegisteredClient(memberId,externalId);
  return c&&typeof c.id==='string'&&internalId.test(c.id)?c.id:null;
 }
 const resourceServer=new OAuthResourceServer({resourceMetadata:{resource,authorization_servers:[issuer.slice(0,-1)]},requiredScopes:scopes,
  validateToken:env=>(audience,token)=>authorizationServer.validateToken(audience,token,env),
  handler:{async fetch(request,_env,ctx){
   if(!ctx.auth.scope.includes('tasks:read'))return insufficientScope(ctx.auth,scopes);
   const member=await person(ctx.auth.userId),clientId=member&&await client(member.id,ctx.auth.clientId);
   if(!member||!clientId||ctx.props?.memberId!==member.id||ctx.props?.clientId!==clientId)return json('Task unavailable',403);
   // This principal comes only from the library-validated per-request context.
   // The external client ID maps through a current trusted registration to the
   // internal grant ID; URL client IDs are never treated as internal authority.
   const boundary={metadata:()=>json('Not found',404),authorize:async(_request,scope)=>({member:{...member,clientId},scope})};
   const backend={read:(_member,args)=>grants.read({memberId:member.id,clientId},args.taskId)};
   return createMcpTaskGateway({resource,boundary,backend}).handle(request);
  }}});
 async function authorize(request,env){
  const oauth=authorizationServer.getOAuthApi(env),session=await authenticate(request),member=await person(session?.id);
  if(!member)return json('Sign in with an authorized family account',401);
  if(request.method==='GET'){
   const parsed=await oauth.parseAuthRequest(request);
   if(parsed.scope.length!==1||parsed.scope[0]!=='tasks:read')return json('Only task read access is supported',400);
   const clientId=await client(member.id,parsed.clientId);if(!clientId)return json('Client connection is not approved',403);
   const description=await oauth.describeConsent(parsed),consent=await oauth.beginConsent(parsed);
   // parseAuthRequest has verified the exact registered redirect URI. Chromium
   // also applies form-action to the POST response's redirect, not only its target.
   const callbackOrigin=new URL(parsed.redirectUri).origin;
   await env.OAUTH_KV.put(await bindingKey(consent.handle),JSON.stringify({memberId:member.id,clientId,externalClientId:parsed.clientId,expiresAt:Date.now()+300000}),{expirationTtl:300});
   const headers=new Headers(consent.headers);headers.set('content-type','text/html; charset=utf-8');headers.set('cache-control','no-store');
   headers.set('content-security-policy',`default-src 'none'; form-action 'self' ${callbackOrigin}; frame-ancestors 'none'; base-uri 'none'`);
   return new Response(`<!doctype html><title>Approve AI task access</title><h1>Approve AI task access</h1><p>Signed-in member: ${escape(member.id)}</p><p>Client: ${escape(description.clientName)} (unverified display name)</p><p>Client ID: ${escape(description.clientId)}</p><p>Redirect destination: ${escape(description.redirectHost)}</p><p>Resource: ${escape(resource)}</p><p>Allow this client to read only tasks separately approved for it. Access tokens last up to ten minutes and the OAuth refresh grant lasts one hour; task consent may expire sooner. No proposal writes or external actions.</p><form method="post" action="${escape(issuer+'authorize')}"><input type="hidden" name="handle" value="${escape(consent.handle)}"><button name="decision" value="allow">Allow task reads</button><button name="decision" value="deny">Deny</button></form>`,{headers});
  }
  if(request.method!=='POST')return json('Method not allowed',405);
  if(request.headers.get('origin')!==authUrl.origin)return json('Origin rejected',403);
  let form;try{form=await consentForm(request);}catch{return json('Invalid consent form',400);}
  const key=await bindingKey(form.handle),saved=await env.OAUTH_KV.get(key,'json');
  if(!saved||saved.memberId!==member.id||!Number.isSafeInteger(saved.expiresAt)||saved.expiresAt<=Date.now()||saved.expiresAt>Date.now()+300000||saved.clientId!==await client(member.id,saved.externalClientId))return json('Consent expired or account/connection changed',403);
  if(form.decision==='deny'){
   const denied=await oauth.denyConsent(request,form.handle);await env.OAUTH_KV.delete(key);return new Response(null,{status:302,headers:denied.headers});
  }
  const approved=await oauth.approveConsent(request,form.handle,{scope:scopes});
  if(approved.request.clientId!==saved.externalClientId)return json('Client connection changed',403);
  const completed=await oauth.completeAuthorization({request:approved.request,userId:member.id,metadata:{},scope:scopes,props:{memberId:member.id,clientId:saved.clientId}});
  await env.OAUTH_KV.delete(key);const headers=new Headers(approved.headers);headers.set('location',completed.redirectTo);headers.set('cache-control','no-store');
  return new Response(null,{status:302,headers});
 }
 return Object.freeze({async fetch(request,env,ctx){
  try{
   const url=new URL(request.url);
   if(url.origin===authUrl.origin&&url.pathname==='/authorize')return await authorize(request,env);
   if(url.origin===resourceUrl.origin&&(url.pathname==='/mcp'||url.pathname.startsWith('/mcp/')||url.pathname==='/.well-known/oauth-protected-resource/mcp'))return await resourceServer.fetch(request,env,ctx);
   if(url.origin===authUrl.origin)return await authorizationServer.fetch(request,env,ctx);
   return json('Not found',404);
  }catch(error){if(error instanceof AuthorizationError)return error.redirectTo?Response.redirect(error.redirectTo,302):json('Invalid authorization request',400);return json('OAuth service unavailable',503);}
 },validateToken:(audience,token,env)=>authorizationServer.validateToken(audience,token,env)});
}
