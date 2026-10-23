import test from 'node:test';import assert from 'node:assert/strict';
import {generateKeyPair,exportJWK,jwtVerify} from 'jose';
import {validEndpoint,sendPush,publicKey,pushAPI,publishNotices} from '../src/push.js';
test('push endpoint allowlist rejects redirects, local networks and fake suffixes',()=>{
 for(const e of ['https://fcm.googleapis.com/fcm/send/test','https://updates.push.services.mozilla.com/wpush/v2/test','https://web.push.apple.com/test','https://wns2.notify.windows.com/test'])assert.equal(validEndpoint(e),true);
 for(const e of ['http://fcm.googleapis.com/test','https://localhost/test','https://127.0.0.1/test','https://fcm.googleapis.com.evil.test/test','https://user:pass@fcm.googleapis.com/test','https://fcm.googleapis.com:444/test'])assert.equal(validEndpoint(e),false);
});
test('push signs only generic empty wakeup, audience constrained and no redirect',async()=>{
 const {privateKey,publicKey:verifyKey}=await generateKeyPair('ES256',{extractable:true});const env={PUSH_VAPID_JWK:JSON.stringify(await exportJWK(privateKey))};assert.equal(publicKey(env).length,87);
 const original=globalThis.fetch;
 try{globalThis.fetch=async(url,init)=>{assert.equal(url,'https://fcm.googleapis.com/fcm/send/synthetic');assert.equal(init.redirect,'manual');assert.equal(init.body.byteLength,0);const token=init.headers.Authorization.split('t=')[1].split(',')[0];const {payload}=await jwtVerify(token,verifyKey,{audience:'https://fcm.googleapis.com'});assert.equal(payload.sub,'https://jamula-family-coordinator.cyrus-7cd.workers.dev');assert.ok(payload.exp<=Date.now()/1000+3601);return new Response(null,{status:201});};assert.equal(await sendPush(env,'https://fcm.googleapis.com/fcm/send/synthetic'),201);}finally{globalThis.fetch=original;}
});
test('push rejects unknown members and cross-origin writes before storage',async()=>{
 assert.equal((await pushAPI(new Request('https://hub.test/api/push/config'),{}, {email:'naannaa.bear@gmail.com'})).status,403);
 assert.equal((await pushAPI(new Request('https://hub.test/api/push/subscribe',{method:'POST',headers:{origin:'https://evil.test'}}),{PUSH_VAPID_JWK:'configured'},{email:'iyanah.j11@gmail.com'})).status,403);
});
test('revoked or child parent-room subscription never receives a push',async()=>{
 let deleted=0;const env={PUSH_VAPID_JWK:'configured',DB:{prepare(sql){return {all:async()=>({results:[{id:'synthetic',owner:'iyanah.j11@gmail.com',room:'parents',notice:'n'}]}),bind:()=>({run:async()=>{deleted++;}})};}}};
 await publishNotices(env);assert.equal(deleted,1);
});
