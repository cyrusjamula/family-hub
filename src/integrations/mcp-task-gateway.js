// Unmounted MCP integration boundary. All storage and current-member checks are
// supplied by a trusted host; never use client-provided identity or room claims.
// A real deployment additionally needs an OAuth issuer, secure runtime config,
// durable task store and independently reviewed rollout.
const prefix='io.modelcontextprotocol/';
const protocol='2026-07-28';
const info={name:'family-task-gateway',version:'0.1.0'};
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const exact=(x,keys)=>object(x)&&Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
const requestId=/^[A-Za-z0-9_-]{1,64}$/;
const methods={
 task_read:{scope:'tasks:read',keys:['taskId'],readOnly:true},
 task_propose:{scope:'tasks:write',keys:['taskId','requestId','expectedVersion','option'],readOnly:false}
};
const schema=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const tools=[
 {name:'task_read',description:'Read an assigned task permitted for the authenticated member.',inputSchema:schema({taskId:{type:'string',pattern:'^[A-Za-z0-9_-]{1,64}$'}}),annotations:{readOnlyHint:true,destructiveHint:false}},
 {name:'task_propose',description:'Save a proposal for an assigned task; does not approve or send an external action.',inputSchema:schema({taskId:{type:'string',pattern:'^[A-Za-z0-9_-]{1,64}$'},requestId:{type:'string',pattern:'^[A-Za-z0-9_-]{1,64}$'},expectedVersion:{type:'integer',minimum:0},option:{type:'string',enum:['park-a','park-b']}}),annotations:{readOnlyHint:false,destructiveHint:false}}
];
const result=value=>({resultType:'complete',_meta:{[prefix+'serverInfo']:info},...value});
const json=(payload,status=200,headers={})=>Response.json(payload,{status,headers:{'cache-control':'no-store',...headers}});
const error=(id,code,message,status=400)=>json({jsonrpc:'2.0',id,error:{code,message}},status);
async function boundedBody(request){
 if(!request.body)throw Error('missing body');
 const reader=request.body.getReader();let size=0;const chunks=[];
 try{
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;
   if(size>8192){void reader.cancel().catch(()=>{});throw Error('too large');}chunks.push(value);}
 }finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let pos=0;for(const c of chunks){bytes.set(c,pos);pos+=c.byteLength;}
 return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
}
function headerMatches(header,name){
 if(header===name)return true;
 const encoded=btoa(String.fromCharCode(...new TextEncoder().encode(name)));
 return header===`=?base64?${encoded}?=`;
}
export function createMcpTaskGateway({resource,boundary,backend}={}){
 let url;try{url=new URL(resource);}catch{throw Error('Invalid MCP gateway configuration');}
 if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/mcp'||url.href!==resource||url.search||url.hash||
    !boundary||typeof boundary.metadata!=='function'||typeof boundary.authorize!=='function'||
    !backend||typeof backend.read!=='function'||typeof backend.propose!=='function')throw Error('Invalid MCP gateway configuration');
 const metadata=url.origin+'/.well-known/oauth-protected-resource/mcp';
 return Object.freeze({async handle(request){
  if(request.url===metadata&&request.method==='GET')return boundary.metadata();
  if(request.url!==resource)return error(null,-32600,'Not found',404);
  if(request.method!=='POST')return error(null,-32600,'Method not allowed',405);
  if(!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('content-type')||''))return error(null,-32600,'JSON required',415);
  let rpc;try{rpc=await boundedBody(request);}catch{return error(null,-32700,'Invalid or oversized JSON',400);}
  if(!object(rpc)||rpc.jsonrpc!=='2.0'||typeof rpc.method!=='string'||!Object.hasOwn(rpc,'id')||
     !(typeof rpc.id==='string'||Number.isSafeInteger(rpc.id))||!object(rpc.params))return error(null,-32600,'Invalid request');
  const id=rpc.id,meta=rpc.params._meta;
  if(!object(meta)||meta[prefix+'protocolVersion']!==protocol||!object(meta[prefix+'clientCapabilities'])||
     request.headers.get('mcp-protocol-version')!==protocol||request.headers.get('mcp-method')!==rpc.method)return error(id,-32602,'Invalid metadata');
  const discovery=rpc.method==='server/discover'||rpc.method==='tools/list';
  let spec;
  if(discovery){if(!exact(rpc.params,['_meta']))return error(id,-32602,'Invalid parameters');spec={scope:'tasks:read'};}
  else{
   if(rpc.method!=='tools/call'||!exact(rpc.params,['_meta','name','arguments'])||typeof rpc.params.name!=='string'||
      !Object.hasOwn(methods,rpc.params.name)||!headerMatches(request.headers.get('mcp-name'),rpc.params.name))return error(id,-32602,'Invalid tool');
   spec=methods[rpc.params.name];const args=rpc.params.arguments;
   if(!exact(args,spec.keys)||typeof args.taskId!=='string'||!requestId.test(args.taskId)||
      (spec.scope==='tasks:write'&&(!requestId.test(args.requestId||'')||typeof args.requestId!=='string'||
       !Number.isSafeInteger(args.expectedVersion)||args.expectedVersion<0||!['park-a','park-b'].includes(args.option))))return error(id,-32602,'Invalid arguments');
  }
  let authorization;try{authorization=await boundary.authorize(request,spec.scope);}catch{return error(id,-32603,'Authorization unavailable',503);}
  if(authorization?.response)return authorization.response;
  if(!authorization?.member||typeof authorization.member.id!=='string'||!['owner','parent','child'].includes(authorization.member.role)||authorization.scope!==spec.scope)return error(id,-32603,'Authorization unavailable',503);
  if(rpc.method==='server/discover')return json({jsonrpc:'2.0',id,result:result({supportedVersions:[protocol],capabilities:{tools:{}},instructions:'Task proposals require separate approval for external actions.'})});
  if(rpc.method==='tools/list')return json({jsonrpc:'2.0',id,result:result({tools})});
  try{
   // Backend must perform current per-task audience checks and atomic replay/
   // version handling; verified identity is passed separately from arguments.
   const value=await (spec.scope==='tasks:read'?backend.read(authorization.member,rpc.params.arguments):backend.propose(authorization.member,rpc.params.arguments));
   if(!object(value))throw Error('invalid backend response');
   return json({jsonrpc:'2.0',id,result:result({content:[{type:'text',text:JSON.stringify(value)}],structuredContent:value,isError:value.ok!==true})});
  }catch{return error(id,-32603,'Task operation unavailable',503);}
 }});
}
