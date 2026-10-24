import test from 'node:test';
import assert from 'node:assert/strict';
import {runDeployment} from '../scripts/deploy.mjs';

test('failed regression validation blocks Wrangler deployment',()=>{
 for(const failure of [{status:1},{status:9},{status:null,signal:'SIGTERM'}]){
  const calls=[];
  assert.notEqual(runDeployment((command,args)=>{calls.push([command,args]);return failure;}),0);
  assert.deepEqual(calls,[['npm',['run','ci']]]);
 }
});
test('deployment runs only after validation and preserves runtime variables',()=>{
 const calls=[];
 assert.equal(runDeployment((command,args,options)=>{calls.push([command,args]);assert.equal(options.shell,false);return {status:0};}),0);
 assert.deepEqual(calls,[['npm',['run','ci']],['npm',['exec','--','wrangler','deploy','--keep-vars']]]);
});
test('validation spawn errors and deployment failures propagate',()=>{
 assert.throws(()=>runDeployment(()=>({error:Error('runner unavailable')})),/runner unavailable/);
 let calls=0;
 assert.equal(runDeployment(()=>({status:++calls===1?0:7})),7);
 assert.equal(calls,2);
});
test('dry-run and environment arguments reach only Wrangler without changing validation',()=>{
 for(const args of [['--dry-run'],['--env','staging'],['--dry-run','--outdir','build-synthetic']]){
  const calls=[];assert.equal(runDeployment((command,argv)=>{calls.push([command,argv]);return {status:0};},args),0);
  assert.deepEqual(calls,[['npm',['run','ci']],['npm',['exec','--','wrangler','deploy','--keep-vars',...args]]]);
 }
});
