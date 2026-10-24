import assert from 'node:assert/strict';

export function validateRuntime({version,pin,engines,lockedEngines,workflow}){
 assert.match(pin,/^26\.\d+\.\d+$/,'Use an explicit reviewed Node 26 patch release');
 const [,minor,patch]=pin.split('.').map(Number);
 assert.ok(minor>12||minor===12&&patch>=1,'Node pin predates the 26.12.1 security baseline');
 assert.equal(version,pin,'Running Node must match .nvmrc; update any build NODE_VERSION override');
 assert.equal(engines,`>=${pin} <27`,'Engine constraint must match the reviewed pin');
 assert.equal(lockedEngines,engines,'Lockfile root engine constraint must match package.json');
 assert.match(workflow,/node-version-file:\s*\.nvmrc\s*$/m,'CI must use the same .nvmrc pin');
 assert.doesNotMatch(workflow,/^\s*node-version:/m,'CI must not override the shared Node pin');
}
