import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveBuildVersion} from '../scripts/build-version.mjs';
import {releaseFor} from '../src/release.js';
test('Cloudflare source commit takes priority over GitHub and runtime overrides',()=>{
 const cf='a'.repeat(40),gh='b'.repeat(40);assert.equal(resolveBuildVersion({WORKERS_CI_COMMIT_SHA:cf,GITHUB_SHA:gh},()=>{throw Error('No git read needed');}),cf);assert.equal(releaseFor({TELEMETRY_RELEASE:gh},cf),cf);assert.equal(resolveBuildVersion({GITHUB_SHA:gh},()=>{throw Error();}),gh);
});
test('invalid source metadata falls back safely without persisting arbitrary values',()=>{
 assert.equal(resolveBuildVersion({WORKERS_CI_COMMIT_SHA:'private arbitrary value'},()=> 'c'.repeat(40)),'c'.repeat(40));assert.equal(resolveBuildVersion({},()=>{throw Error('private path');}),'unknown');assert.equal(releaseFor({TELEMETRY_RELEASE:'abcdef0'},'unknown'),'abcdef0');assert.equal(releaseFor({TELEMETRY_RELEASE:'private arbitrary value'},'unknown'),'unknown');
});
