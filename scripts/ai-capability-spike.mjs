import {createServer} from 'node:http';
import {pathToFileURL} from 'node:url';

// Synthetic loopback fixture only. No Hub imports, accounts, credentials, files,
// provider calls or production authorization. State disappears when closed.
export const SPIKE_PROTOCOL = '2026-07-28';
const PREFIX = 'io.modelcontextprotocol/';
const serverInfo = {name:'synthetic-coordination-spike',version:'0.1.0'};
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => object(value) && Object.keys(value).length === keys.length && keys.every(k => Object.hasOwn(value,k));
const schema = properties => ({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const taskId = {const:'synthetic-task-1'};
const requestId = {type:'string',pattern:'^synthetic-[a-z0-9-]{1,40}$'};
const tool = (name,description,inputSchema,readOnlyHint) => ({name,description,inputSchema,annotations:{readOnlyHint,destructiveHint:false,idempotentHint:true,openWorldHint:false}});
const tools = [
 tool('synthetic_task_get','Read the fixed fictional task. This fixture has no real family data.',schema({taskId}),true),
 tool('synthetic_task_propose','Choose park-a or park-b for the fictional task. In-memory receipts last only until server shutdown; at most 64 writes.',schema({taskId,expectedVersion:{type:'integer',minimum:0,maximum:64},option:{enum:['park-a','park-b']},requestId}),false),
 tool('synthetic_receipt_get','Read a synthetic write receipt while this local process remains alive.',schema({requestId}),true)
];
const result = data => ({resultType:'complete',_meta:{[PREFIX+'serverInfo']:serverInfo},...data});
const toolResult = (data,isError=false) => result({content:[{type:'text',text:JSON.stringify(data)}],structuredContent:data,isError});
const errorResult = (code,message,data) => ({code,message,...(data?{data}:{})});
function decodedName(header) {
 if(typeof header!=='string')return null;
 if(header.startsWith('=?base64?')&&header.endsWith('?=')){
  const encoded=header.slice(9,-2);
  if(!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded))return null;
  try{return new TextDecoder('utf-8',{fatal:true}).decode(Buffer.from(encoded,'base64'));}catch{return null;}
 }
 return /^[\x20-\x7e]+$/.test(header)?header:null;
}
async function body(request) {
 const chunks=[];let size=0;
 for await(const chunk of request){size+=chunk.length;if(size<=8192)chunks.push(chunk);}
 if(size>8192)throw Error('oversized');
 return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
}
export async function startCapabilitySpike({port=0}={}) {
 if(!Number.isSafeInteger(port)||port<0||port>65535)throw Error('invalid local port');
 const task={id:'synthetic-task-1',title:'Choose a fictional park',version:0,option:null,approval:'not-requested'};
 const receipts=new Map();
 let authority;
 const server=createServer(async(request,response)=>{
  const send=(status,payload,headers={})=>{response.writeHead(status,{'content-type':'application/json','cache-control':'no-store',...headers});response.end(payload===undefined?undefined:JSON.stringify(payload));};
  const fail=(status,id,code,message,data)=>send(status,{jsonrpc:'2.0',id,error:errorResult(code,message,data)});
  // Exact authority/origin checks block DNS rebinding and cross-origin browsers.
  if(request.headers.host!==authority||(request.headers.origin!==undefined&&request.headers.origin!==`http://${authority}`))return fail(403,null,-32600,'Local origin rejected');
  if(request.url!=='/mcp')return fail(404,null,-32600,'Endpoint not found');
  if(request.method!=='POST')return send(405,undefined,{allow:'POST'});
  if(!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers['content-type']||''))return fail(415,null,-32600,'JSON UTF-8 required');
  const accepted=(request.headers.accept||'').split(',').map(x=>x.trim().toLowerCase()).filter(x=>!/(?:^|;)\s*q=0(?:\.0*)?(?:;|$)/.test(x)).map(x=>x.split(';')[0].trim());
  if(!['application/json','text/event-stream'].every(x=>accepted.includes(x)))return fail(406,null,-32600,'Both MCP response types required');
  let rpc;
  try{rpc=await body(request);}catch{return fail(400,null,-32700,'Invalid or oversized JSON');}
  if(!object(rpc)||rpc.jsonrpc!=='2.0'||typeof rpc.method!=='string'||!Object.hasOwn(rpc,'id')||!(typeof rpc.id==='string'||Number.isSafeInteger(rpc.id)))return fail(400,null,-32600,'Single JSON-RPC request required');
  const id=rpc.id;
  if(!object(rpc.params))return fail(400,id,-32602,'Request metadata required');
  const meta=rpc.params._meta;
  if(!object(meta)||typeof meta[PREFIX+'protocolVersion']!=='string'||!object(meta[PREFIX+'clientCapabilities']))return fail(400,id,-32602,'Request metadata required');
  if(request.headers['mcp-protocol-version']!==meta[PREFIX+'protocolVersion']||request.headers['mcp-method']!==rpc.method||(rpc.method==='tools/call'&&decodedName(request.headers['mcp-name'])!==rpc.params.name))return fail(400,id,-32020,'Header mismatch');
  if(meta[PREFIX+'protocolVersion']!==SPIKE_PROTOCOL)return fail(400,id,-32022,'Unsupported protocol version',{supported:[SPIKE_PROTOCOL],requested:meta[PREFIX+'protocolVersion']});
  // Client metadata is self-reported and never used as identity or approval.
  if(rpc.method==='server/discover'){
   if(!exact(rpc.params,['_meta']))return fail(400,id,-32602,'Unexpected discovery parameters');
   return send(200,{jsonrpc:'2.0',id,result:result({supportedVersions:[SPIKE_PROTOCOL],capabilities:{tools:{}},instructions:'Synthetic loopback fixture. No real data, identity, approvals or external actions.'})});
  }
  if(rpc.method==='tools/list'){
   if(!exact(rpc.params,['_meta']))return fail(400,id,-32602,'Pagination unsupported for the fixed tool list');
   return send(200,{jsonrpc:'2.0',id,result:result({tools})});
  }
  if(rpc.method!=='tools/call')return fail(404,id,-32601,'Method not found; supported protocol 2026-07-28');
  if(!exact(rpc.params,['_meta','name','arguments'])||typeof rpc.params.name!=='string'||!object(rpc.params.arguments))return fail(400,id,-32602,'Malformed tool request');
  const {name,arguments:args}=rpc.params;
  if(!tools.some(t=>t.name===name))return fail(400,id,-32602,'Unknown tool');
  const finish=(data,isError=false)=>send(200,{jsonrpc:'2.0',id,result:toolResult(data,isError)});
  const invalid=()=>finish({error:'invalid-arguments'},true);
  if(name==='synthetic_task_get'){
   if(!exact(args,['taskId'])||args.taskId!==task.id)return invalid();
   return finish({task:{...task},synthetic:true});
  }
  if(name==='synthetic_receipt_get'){
   if(!exact(args,['requestId'])||typeof args.requestId!=='string'||!/^synthetic-[a-z0-9-]{1,40}$/.test(args.requestId))return invalid();
   return receipts.has(args.requestId)?finish({receipt:receipts.get(args.requestId).receipt,synthetic:true}):finish({error:'receipt-unavailable'},true);
  }
  if(!exact(args,['taskId','expectedVersion','option','requestId'])||args.taskId!==task.id||!Number.isSafeInteger(args.expectedVersion)||args.expectedVersion<0||args.expectedVersion>64||!['park-a','park-b'].includes(args.option)||typeof args.requestId!=='string'||!/^synthetic-[a-z0-9-]{1,40}$/.test(args.requestId))return invalid();
  const digest=JSON.stringify([args.taskId,args.expectedVersion,args.option]);
  const previous=receipts.get(args.requestId);
  if(previous)return previous.digest===digest?finish({receipt:previous.receipt,synthetic:true}):finish({error:'idempotency-conflict'},true);
  if(args.expectedVersion!==task.version)return finish({error:'version-conflict',currentVersion:task.version},true);
  if(receipts.size>=64)return finish({error:'synthetic-capacity-reached'},true);
  // No await between compare/mutate/receipt: one synchronous in-memory turn.
  task.version++;task.option=args.option;
  const receipt={id:`synthetic-receipt-${task.version}`,requestId:args.requestId,taskId:task.id,version:task.version,option:task.option,status:'recorded'};
  receipts.set(args.requestId,{digest,receipt});
  return finish({receipt,synthetic:true});
 });
 server.requestTimeout=5000;server.headersTimeout=5000;server.keepAliveTimeout=1000;server.maxConnections=16;
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',()=>{authority=`127.0.0.1:${server.address().port}`;resolve();});});
 return Object.freeze({url:`http://${authority}/mcp`,close:()=>new Promise((resolve,reject)=>{server.close(error=>error?reject(error):resolve());server.closeAllConnections();})});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 if(process.argv.length!==2)throw Error('This fixture accepts no host, data or credential arguments');
 const spike=await startCapabilitySpike();
 console.log(`Synthetic loopback fixture only: ${spike.url}`);
 for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{spike.close().then(()=>process.exit(0));});
}
