import test from 'node:test';
import assert from 'node:assert/strict';
import {validateRuntime} from '../scripts/runtime.mjs';
const baseline={version:'26.12.1',pin:'26.12.1',engines:'>=26.12.1 <27',lockedEngines:'>=26.12.1 <27',workflow:'          node-version-file: .nvmrc\n'};
test('reviewed patched Node release is accepted consistently across tooling',()=>{assert.doesNotThrow(()=>validateRuntime(baseline));});
test('older or mismatched build Node versions are rejected',()=>{
 for(const version of ['24.19.0','24.22.1','26.12.0','26.13.0','27.0.0'])assert.throws(()=>validateRuntime({...baseline,version}));
 assert.throws(()=>validateRuntime({...baseline,version:'26.12.0',pin:'26.12.0'}));
});
test('engine, lockfile and CI pin drift is rejected',()=>{
 for(const change of [{engines:'>=24 <25'},{lockedEngines:'>=24 <25'},{workflow:'node-version: 24'},{workflow:baseline.workflow+'node-version: 24'}])assert.throws(()=>validateRuntime({...baseline,...change}));
});
