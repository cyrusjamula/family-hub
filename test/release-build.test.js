import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,copyFile,writeFile,readFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';
test('repeated build metadata generation and validation keep the same source release',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'hub-release-fixture-')),sha='0123456789abcdef0123456789abcdef01234567';
 try{
  await mkdir(path.join(root,'src'));await mkdir(path.join(root,'scripts'));await writeFile(path.join(root,'package.json'),'{"type":"module"}');
  for(const file of ['src/release.js','scripts/build-version.mjs'])await copyFile(new URL('../'+file,import.meta.url),path.join(root,file));await writeFile(path.join(root,'src/build-version.js'),"export const BUILD_VERSION='unknown';\n");
  const run=()=>spawnSync(process.execPath,['--input-type=module','-e',"import {writeBuildVersion} from './scripts/build-version.mjs'; await writeBuildVersion(); const {releaseFor}=await import('./src/release.js'); if(releaseFor({TELEMETRY_RELEASE:'abcdef0'})!==process.env.WORKERS_CI_COMMIT_SHA)process.exit(1);"],{cwd:root,env:{...process.env,WORKERS_CI_COMMIT_SHA:sha},encoding:'utf8'});
  assert.equal(run().status,0);const first=await readFile(path.join(root,'src/build-version.js'),'utf8');assert.equal(run().status,0);assert.equal(await readFile(path.join(root,'src/build-version.js'),'utf8'),first);
 }finally{await rm(root,{recursive:true,force:true});}
});
