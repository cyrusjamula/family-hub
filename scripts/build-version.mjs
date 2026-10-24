import {execFileSync} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
export function resolveBuildVersion(env=process.env,readGit=()=>execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim()){
 for(const value of [env.WORKERS_CI_COMMIT_SHA,env.GITHUB_SHA])if(typeof value==='string'&&/^[a-f0-9]{40}$/.test(value))return value;
 try{const value=readGit();if(typeof value==='string'&&/^[a-f0-9]{40}$/.test(value))return value;}catch{}
 return 'unknown';
}
export async function writeBuildVersion(){const version=resolveBuildVersion();await writeFile(new URL('../src/build-version.js',import.meta.url),'// Generated during build.\nexport const BUILD_VERSION='+JSON.stringify(version)+';\n');return version;}
