import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

// Validation is part of deployment itself, even if dashboard build settings drift.
export function runDeployment(run=spawnSync,wranglerArgs=[]){
 for(const args of [['run','ci'],['exec','--','wrangler','deploy','--keep-vars',...wranglerArgs]]){
  const result=run('npm',args,{stdio:'inherit',shell:false});
  if(result.error)throw result.error;
  if(result.status!==0)return result.status||1;
 }
 return 0;
}
if(process.argv[1]===fileURLToPath(import.meta.url))process.exit(runDeployment(spawnSync,process.argv.slice(2)));
