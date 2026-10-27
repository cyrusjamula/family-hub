import {createServer} from 'node:http';
import {createSyntheticResource} from './ai-synthetic-auth.mjs';
import {SPIKE_PROTOCOL} from './ai-capability-spike.mjs';

// Loopback synthetic integration experiment only. This is not an OAuth server,
// production identity verifier or deployable MCP endpoint. Never tunnel it.
const prefix='io.modelcontextprotocol/';
const info={name:'synthetic-authorized-mcp',version:'0.1.0'};
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const exact=(x,keys)=>object(x)&&Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
const matchingName=(header,name)=>header===name||header===`=?base64?${Buffer.from(name,'utf8').toString('base64')}?=`;
const methods={
 synthetic_family_read:{operation:'family_read',readOnly:true,properties:{}},
 synthetic_family_write:{operation:'family_write',readOnly:false,properties:{choice:{enum:['park-a','park-b']}}},
 synthetic_parents_read:{operation:'parents_read',readOnly:true,properties:{}},
 synthetic_owner_read:{operation:'owner_read',readOnly:true,properties:{}}
};
const descriptors=Object.entries(methods).map(([name,v])=>({name,description:'Fictional local test data only.',
 inputSchema:{type:'object',properties:v.properties,required:Object.keys(v.properties),additionalProperties:false},
 annotations:{readOnlyHint:v.readOnly,destructiveHint:false,openWorldHint:false}}));
const result=x=>({resultType:'complete',_meta:{[prefix+'serverInfo']:info},...x});
async function readBody(request){
 let size=0;const chunks=[];
 for await(const part of request){size+=part.length;if(size<=8192)chunks.push(part);}
 if(size>8192)throw Error('oversized');
 return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
}

export async function startSyntheticAuthorizedMcp({verificationKey,port=0}={}){
 if(!Number.isSafeInteger(port)||port<0||port>65535)throw Error('invalid local port');
 const resource=createSyntheticResource({verificationKey});let authority;let writes=0;
 const server=createServer(async(req,res)=>{
  const send=(status,value)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(value));};
  const fail=(status,id,code,message)=>send(status,{jsonrpc:'2.0',id,error:{code,message}});
  if(req.headers.host!==authority||(req.headers.origin!==undefined&&req.headers.origin!==`http://${authority}`))return fail(403,null,-32600,'Local origin rejected');
  if(req.url!=='/mcp'||req.method!=='POST')return fail(404,null,-32600,'Endpoint not found');
  if(!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type']||''))return fail(415,null,-32600,'JSON UTF-8 required');
  const accepted=(req.headers.accept||'').split(',').map(x=>x.trim().toLowerCase()).filter(x=>!/(?:^|;)\s*q=0(?:\.0*)?(?:;|$)/.test(x)).map(x=>x.split(';')[0].trim());
  if(!['application/json','text/event-stream'].every(x=>accepted.includes(x)))return fail(406,null,-32600,'Both MCP response types required');
  let rpc;try{rpc=await readBody(req);}catch{return fail(400,null,-32700,'Invalid or oversized JSON');}
  if(!object(rpc)||rpc.jsonrpc!=='2.0'||typeof rpc.method!=='string'||!Object.hasOwn(rpc,'id')||!(typeof rpc.id==='string'||Number.isSafeInteger(rpc.id))||!object(rpc.params))return fail(400,null,-32600,'Invalid request');
  const id=rpc.id,meta=rpc.params._meta;
  if(!object(meta)||meta[prefix+'protocolVersion']!==SPIKE_PROTOCOL||!object(meta[prefix+'clientCapabilities'])||req.headers['mcp-protocol-version']!==SPIKE_PROTOCOL||req.headers['mcp-method']!==rpc.method)return fail(400,id,-32602,'Invalid request metadata');
  if(rpc.method==='server/discover'&&exact(rpc.params,['_meta']))return send(200,{jsonrpc:'2.0',id,result:result({supportedVersions:[SPIKE_PROTOCOL],capabilities:{tools:{}},instructions:'Synthetic loopback only; no OAuth server or real records.'})});
  if(rpc.method==='tools/list'&&exact(rpc.params,['_meta']))return send(200,{jsonrpc:'2.0',id,result:result({tools:descriptors})});
  if(rpc.method!=='tools/call'||!exact(rpc.params,['_meta','name','arguments'])||typeof rpc.params.name!=='string'||!Object.hasOwn(methods,rpc.params.name)||!matchingName(req.headers['mcp-name'],rpc.params.name))return fail(400,id,-32602,'Invalid tool call');
  const method=methods[rpc.params.name],args=rpc.params.arguments;
  if(!exact(args,Object.keys(method.properties)))return fail(400,id,-32602,'Invalid tool arguments');
  const writing=method.operation==='family_write';
  if(writing){if(writes>=64)return fail(429,id,-32000,'Synthetic capacity reached');writes++;}
  let value;try{value=await resource.call({authorization:req.headers.authorization,operation:method.operation,...(writing?{choice:args.choice}:{})});}catch{if(writing)writes--;return fail(500,id,-32603,'Synthetic operation failed');}
  if(writing&&!value.ok)writes--;
  // Results contain only fixed fictional data and verified fictional subject.
  return send(200,{jsonrpc:'2.0',id,result:result({content:[{type:'text',text:JSON.stringify(value)}],structuredContent:value,isError:!value.ok})});
 });
 server.requestTimeout=5000;server.headersTimeout=5000;server.keepAliveTimeout=1000;server.maxConnections=16;
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',()=>{authority=`127.0.0.1:${server.address().port}`;resolve();});});
 return Object.freeze({url:`http://${authority}/mcp`,close:()=>new Promise((resolve,reject)=>{server.close(error=>error?reject(error):resolve());server.closeAllConnections();})});
}
