import {createMcpResourceBoundary} from './mcp-resource.js';
import {createMcpTaskGateway} from './mcp-task-gateway.js';

// Unmounted and off by default. A reviewed host must provide issuer-attested
// client_id tokens, live membership/client resolvers and the task-grant service.
// This composition creates no issuer, route, grant, credential or migration.
export function createGrantedMcpReadGateway({enabled=false,resource,issuer,verificationKey,resolveMember,resolveClient,grants}={}){
 if(typeof enabled!=='boolean')throw Error('Invalid granted gateway configuration');
 if(!enabled)return Object.freeze({async handle(){return Response.json({error:'AI task access is disabled'},{status:503,headers:{'cache-control':'no-store'}});}});
 if(typeof resolveClient!=='function'||!grants||typeof grants.read!=='function')throw Error('Invalid granted gateway configuration');
 const resourceBoundary=createMcpResourceBoundary({resource,issuer,verificationKey,resolveMember,resolveClient});
 const boundary={
  metadata:()=>Response.json({resource,authorization_servers:[issuer],scopes_supported:['tasks:read']},{headers:{'cache-control':'no-store'}}),
  authorize:(request,scope)=>resourceBoundary.authorize(request,scope)
 };
 const backend={async read(member,args){
  // Both fields originate exclusively in the verified boundary. The grant read
  // rechecks current membership, connection, audience, version and expiration.
  if(typeof member.clientId!=='string')return {ok:false,error:'Task unavailable'};
  return grants.read({memberId:member.id,clientId:member.clientId},args.taskId);
 }};
 return createMcpTaskGateway({resource,boundary,backend});
}
