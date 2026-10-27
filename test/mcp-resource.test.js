import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPair,SignJWT} from 'jose';
import {createMcpResourceBoundary} from '../src/integrations/mcp-resource.js';

const resource='https://example.test/mcp',issuer='https://issuer.example.test/';
const token=async(key,{sub='fixture-a',iss=issuer,aud=resource,scope='tasks:read',expired=false,typ='at+jwt',...claims}={})=>
 new SignJWT({scope,...claims}).setProtectedHeader({alg:'ES256',typ}).setIssuer(iss).setAudience(aud).setSubject(sub).setIssuedAt().setExpirationTime(expired?'1 second ago':'5 minutes from now').sign(key);
const request=value=>new Request(resource,{method:'POST',headers:value?{authorization:value}:{}});
const base=async()=>{const {publicKey,privateKey}=await generateKeyPair('ES256');let member={id:'fixture-a',role:'child'};let lookups=0;
 const boundary=createMcpResourceBoundary({resource,issuer,verificationKey:publicKey,resolveMember:async sub=>{lookups++;return sub==='fixture-a'?member:null;}});
 return {boundary,privateKey,remove:()=>{member=null;},lookups:()=>lookups};};

test('metadata and unauthenticated challenge identify the exact resource',async()=>{
 const f=await base();const res=f.boundary.metadata();assert.equal(res.headers.get('cache-control'),'no-store');
 assert.deepEqual(await res.json(),{resource,authorization_servers:[issuer],scopes_supported:['tasks:read','tasks:write']});
 const denial=await f.boundary.authorize(request(), 'tasks:read');assert.equal(denial.response.status,401);
 assert.equal(denial.response.headers.get('www-authenticate'),'Bearer resource_metadata="https://example.test/.well-known/oauth-protected-resource/mcp"');assert.equal(f.lookups(),0);
});

test('valid scoped signed token resolves current membership, never its claimed role',async()=>{
 const f=await base();const signed=await token(f.privateKey,{role:'owner',room:'parents'});
 assert.deepEqual(await f.boundary.authorize(request('Bearer '+signed),'tasks:read'),{member:{id:'fixture-a',role:'child'},scope:'tasks:read'});
 for(const prefix of ['bearer ','BEARER  ','Bearer   '])assert.deepEqual(await f.boundary.authorize(request(prefix+signed),'tasks:read'),{member:{id:'fixture-a',role:'child'},scope:'tasks:read'});
 f.remove();assert.equal((await f.boundary.authorize(request('Bearer '+signed),'tasks:read')).response.status,401);
});

test('wrong key, issuer, audience, expiry, scopes and unknown member cannot authorize',async()=>{
 const f=await base(),other=await generateKeyPair('ES256');
 const invalid=[await token(other.privateKey),await token(f.privateKey,{iss:'https://evil.example/'}),
  await token(f.privateKey,{aud:'https://example.test/'}),await token(f.privateKey,{expired:true}),
  await token(f.privateKey,{scope:'tasks:read unknown'}),
  await token(f.privateKey,{scope:'tasks:read tasks:read'}),await token(f.privateKey,{sub:'fixture-other'}),await token(f.privateKey,{typ:'JWT'}),'not-a-jwt'];
 for(const value of invalid)assert.equal((await f.boundary.authorize(request('Bearer '+value),'tasks:read')).response.status,401);
 assert.equal((await f.boundary.authorize(request('Bearer '+await token(f.privateKey)),'tasks:admin')).response.status,401);
});

test('a read-only token cannot authorize writes and lookup failures fail closed',async()=>{
 const f=await base(),signed=await token(f.privateKey);const denial=(await f.boundary.authorize(request('Bearer '+signed),'tasks:write')).response;
 assert.equal(denial.status,403);assert.equal(denial.headers.get('www-authenticate'),'Bearer resource_metadata="https://example.test/.well-known/oauth-protected-resource/mcp", error="insufficient_scope", scope="tasks:write"');assert.equal(denial.headers.get('cache-control'),'no-store');
 f.remove();assert.equal((await f.boundary.authorize(request('Bearer '+signed),'tasks:write')).response.status,401);
 assert.equal((await f.boundary.authorize(new Request('https://evil.example/mcp',{method:'POST',headers:{authorization:'Bearer '+signed}}),'tasks:read')).response.status,401);
 const {publicKey,privateKey}=await generateKeyPair('ES256');const broken=createMcpResourceBoundary({resource,issuer,verificationKey:publicKey,resolveMember:async()=>{throw Error('private details');}});
 const result=await broken.authorize(request('Bearer '+await token(privateKey)),'tasks:read');assert.equal(result.response.status,401);assert.equal(await result.response.text(),'');
});

test('untrusted configuration and malformed credentials are rejected',async()=>{
 const {publicKey}=await generateKeyPair('ES256');for(const value of ['http://example.test/mcp','https://user@example.test/mcp','https://example.test/mcp?x=1','https://example.test/other'])
  assert.throws(()=>createMcpResourceBoundary({resource:value,issuer,verificationKey:publicKey,resolveMember:()=>null}),/Invalid/);
 const f=await base();for(const value of ['Basic x','Bearer ','bearer abc','Bearer '+ 'x'.repeat(4097)])assert.equal((await f.boundary.authorize(request(value),'tasks:read')).response.status,401);
});
