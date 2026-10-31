import {jwtVerify} from 'jose';

// Reusable OAuth resource-server boundary. Not registered as a Worker route.
// The authorization server and the verified membership directory must be
// selected and configured separately; no credentials are provisioned here.
const allowedScopes=new Set(['tasks:read','tasks:write']);
function canonical(value){
 try{const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||u.toString()!==value||value.includes('"'))throw Error();return u;}
 catch{throw Error('Invalid MCP resource configuration');}
}
export function createMcpResourceBoundary({resource,issuer,verificationKey,resolveMember,resolveClient}={}){
 const resourceUrl=canonical(resource),issuerUrl=canonical(issuer);
 if(resourceUrl.pathname!=='/mcp'||issuerUrl.pathname!=='/'||!verificationKey||typeof resolveMember!=='function'||(resolveClient!==undefined&&typeof resolveClient!=='function'))throw Error('Invalid MCP resource configuration');
 const metadataUrl=resourceUrl.origin+'/.well-known/oauth-protected-resource/mcp';
 const challenge=`Bearer resource_metadata="${metadataUrl}"`;
 const deny=()=>new Response(null,{status:401,headers:{'www-authenticate':challenge,'cache-control':'no-store'}});
 return Object.freeze({
  // Hosts must mount this at the exact configured metadata path over HTTPS.
  metadata(){return Response.json({resource,authorization_servers:[issuer],scopes_supported:[...allowedScopes]},{headers:{'cache-control':'no-store'}});},
  // requiredScope is selected by trusted server-side routing, never a client.
  async authorize(request,requiredScope){
   if(request.method!=='POST'||request.url!==resource||!allowedScopes.has(requiredScope))return {response:deny()};
   const bearer=request.headers.get('authorization')||'';
   const match=/^Bearer +([A-Za-z0-9._~-]{1,4096})$/i.exec(bearer);
   if(!match)return {response:deny()};
   try{
    const {payload,protectedHeader}=await jwtVerify(match[1],verificationKey,{issuer,audience:resource,algorithms:['ES256'],requiredClaims:['sub','exp','iat'],maxTokenAge:'10m'});
    if(protectedHeader.typ!=='at+jwt')return {response:deny()};
    if(typeof payload.sub!=='string'||!payload.sub||payload.sub.length>256||typeof payload.scope!=='string')return {response:deny()};
    const scopes=payload.scope.split(' ');
    if(scopes.some(s=>!s||!allowedScopes.has(s))||new Set(scopes).size!==scopes.length)return {response:deny()};
    // Resolve membership on every call. Token-provided roles/room names are
    // untrusted. Downstream handlers must enforce room and action permissions.
    const member=await resolveMember(payload.sub);
    if(!member||typeof member.id!=='string'||!member.id||!['owner','parent','child'].includes(member.role))return {response:deny()};
    // A configured client resolver requires signed issuer-attested client identity.
    // Never infer this from tool arguments, request headers, or token role claims.
    let clientId;
    if(resolveClient!==undefined){
     if(typeof payload.client_id!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(payload.client_id)||
        await resolveClient(member.id,payload.client_id)!==true)return {response:deny()};
     clientId=payload.client_id;
    }
    if(!scopes.includes(requiredScope))return {response:new Response(null,{status:403,headers:{'www-authenticate':`${challenge}, error="insufficient_scope", scope="${requiredScope}"`,'cache-control':'no-store'}})};
    return {member:{id:member.id,role:member.role,...(clientId===undefined?{}:{clientId})},scope:requiredScope};
   }catch{return {response:deny()};}
  }
 });
}
