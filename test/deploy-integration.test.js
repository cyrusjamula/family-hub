import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,readFile,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const deployment=fileURLToPath(new URL('../scripts/deploy.mjs',import.meta.url));
async function fixture(t,pass){
 const cwd=await mkdtemp(join(tmpdir(),'hub-deploy-gate-'));
 t.after(()=>rm(cwd,{recursive:true,force:true}));
 await mkdir(join(cwd,'node_modules','.bin'),{recursive:true});
 await writeFile(join(cwd,'user.npmrc'),'');
 await writeFile(join(cwd,'global.npmrc'),'');
 await writeFile(join(cwd,'package.json'),JSON.stringify({name:'synthetic-deployment-fixture',private:true,type:'module',scripts:{ci:'node --test regression.test.mjs'}}));
 await writeFile(join(cwd,'regression.test.mjs'),`import test from 'node:test';import assert from 'node:assert/strict';import {writeFileSync} from 'node:fs';test('synthetic regression fixture',()=>{assert.equal(${pass},true,'intentional fixture failure');writeFileSync('validation-passed','yes');});`);
 // Local executable boundary: never install or call the real provider CLI.
 await writeFile(join(cwd,'node_modules','.bin','wrangler'),`#!/usr/bin/env node\nconst fs=require('node:fs');fs.appendFileSync('wrangler-calls.jsonl',JSON.stringify(process.argv.slice(2))+'\\n');if(!fs.existsSync('validation-passed'))process.exit(91);`,{mode:0o755});
 const env={PATH:process.env.PATH,NPM_CONFIG_OFFLINE:'true',NPM_CONFIG_CACHE:join(cwd,'npm-cache'),NPM_CONFIG_USERCONFIG:join(cwd,'user.npmrc'),NPM_CONFIG_GLOBALCONFIG:join(cwd,'global.npmrc'),NPM_CONFIG_UPDATE_NOTIFIER:'false',NO_COLOR:'1'};
 const result=spawnSync(process.execPath,[deployment],{cwd,env,encoding:'utf8',timeout:20000,maxBuffer:1024*1024});
 assert.ifError(result.error);assert.equal(result.signal,null);assert.match(result.stdout+result.stderr,/synthetic regression fixture/);
 return {cwd,result};
}
test('real deployment subprocess exits after a failing test suite without reaching Wrangler',async t=>{
 const {cwd,result}=await fixture(t,false);
 assert.notEqual(result.status,0);assert.match(result.stdout+result.stderr,/intentional fixture failure/);
 await assert.rejects(access(join(cwd,'wrangler-calls.jsonl')),{code:'ENOENT'});
});
test('real deployment subprocess reaches the local Wrangler boundary once after tests pass',async t=>{
 const {cwd,result}=await fixture(t,true);assert.equal(result.status,0,result.stdout+result.stderr);
 const calls=(await readFile(join(cwd,'wrangler-calls.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
 assert.deepEqual(calls,[['deploy','--keep-vars']]);
});
