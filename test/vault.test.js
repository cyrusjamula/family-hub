import test from 'node:test';
import assert from 'node:assert/strict';
import {seal,open} from '../src/vault.js';
import {seal as legacySeal,open as legacyOpen} from '../src/google.js';
test('feedback vault preserves existing ciphertext format and purpose binding',async()=>{
 const env={GOOGLE_VAULT_KEY:btoa('s'.repeat(32))},value={text:'Synthetic record'},purpose='feedback:synthetic:record';
 assert.deepEqual(await open(env,await legacySeal(env,value,purpose),purpose),value);
 const encrypted=await seal(env,value,purpose);assert.deepEqual(await legacyOpen(env,encrypted,purpose),value);
 await assert.rejects(open(env,encrypted,purpose+':other'));
 await assert.rejects(open({GOOGLE_VAULT_KEY:btoa('t'.repeat(32))},encrypted,purpose));
});
