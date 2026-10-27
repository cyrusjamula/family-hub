import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPair,SignJWT} from 'jose';
import {createSyntheticResource,syntheticIssuer,syntheticAudience} from '../scripts/ai-synthetic-auth.mjs';

test('synthetic authorization rejects forged identity, wrong audience, missing scope and private access',async()=>{
 const {publicKey,privateKey}=await generateKeyPair('ES256');
 const attacker=await generateKeyPair('ES256');
 const resource=createSyntheticResource({verificationKey:publicKey});
 const issue=async({subject='synthetic-child',issuer=syntheticIssuer,audience=syntheticAudience,
  scope='synthetic:read',expires='5m',key=privateKey}={})=>new SignJWT({scope}).setProtectedHeader({alg:'ES256'}).setSubject(subject)
   .setIssuer(issuer).setAudience(audience).setIssuedAt().setExpirationTime(expires).sign(key);
 const call=async(token,operation,choice)=>resource.call({authorization:`Bearer ${token}`,operation,choice});
 const child=await issue(),parent=await issue({subject:'synthetic-parent'}),owner=await issue({subject:'synthetic-owner'});
 assert.equal((await call(child,'family_read')).ok,true);
 for(const operation of [['family_read'],['parents_read'],['owner_read'],['family_write'],{toString:()=> 'family_read'}]){
  assert.deepEqual(await call(child,operation),{ok:false,error:'unauthorized'});
 }
 assert.deepEqual(await call(child,'parents_read'),{ok:false,error:'unauthorized'});
 assert.deepEqual(await call(child,'owner_read'),{ok:false,error:'unauthorized'});
 assert.equal((await call(parent,'parents_read')).ok,true);
 assert.equal((await call(parent,'owner_read')).ok,false);
 assert.equal((await call(owner,'owner_read')).ok,true);
 for(const bad of [await issue({key:attacker.privateKey}),await issue({audience:'https://wrong.example.test/mcp'}),
  await issue({issuer:'https://wrong.example.test'}),await issue({subject:'synthetic-unknown'}),
  await issue({expires:'-1s'}),await issue({scope:'synthetic:write'})]){
  assert.deepEqual(await call(bad,'family_read'),{ok:false,error:'unauthorized'});
 }
 assert.deepEqual(await resource.call({authorization:'Bearer forged.synthetic.token',operation:'family_read'}),{ok:false,error:'unauthorized'});
 assert.deepEqual(await resource.call({authorization:'Bearer test\nInjected: x',operation:'family_read'}),{ok:false,error:'unauthorized'});
 assert.deepEqual(await call(child,'family_write','park-a'),{ok:false,error:'unauthorized'});
 assert.equal((await call(child,'family_read')).version,0);
 const writer=await issue({scope:'synthetic:write'});
 assert.deepEqual(await call(writer,'family_write','park-a'),{ok:true,synthetic:true,version:1,option:'park-a',author:'synthetic-child'});
 assert.equal((await call(parent,'family_read')).option,'park-a');
 assert.equal((await call(writer,'family_write','arbitrary-sensitive-text')).error,'invalid-synthetic-choice');
 assert.equal((await call(parent,'family_read')).version,1);
 assert.equal((await call(child,'__proto__')).ok,false);
});
