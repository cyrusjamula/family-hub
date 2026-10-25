import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { auditInputs } from '../scripts/factory-input-audit.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'factory-input-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'src'));
  await writeFile(path.join(root, 'src/safe.js'), 'export const task = { owner: "member-a", email: "member@example.com" };');
  return root;
}

test('only explicit approved text inputs are checked; unrelated files are not traversed', async t => {
  const root = await fixture(t);
  await writeFile(path.join(root, 'src/unselected.js'), 'const email = "person@fixture.invalid";');
  assert.deepEqual(await auditInputs(root, { files: ['src/safe.js'] }), { ok: true, filesChecked: 1, findings: {} });
});

test('path escapes, credentials, private/binary data and wildcard manifests fail closed', async t => {
  const root = await fixture(t);
  for (const value of ['../outside.js', '/tmp/outside.js', 'src/../safe.js', 'src\\safe.js', 'src/*.js', '.env', 'src/tokens.json', 'src/report.png', 'records/report.txt']) {
    assert.equal((await auditInputs(root, { files: [value] })).ok, false, value);
  }
  for (const manifest of [null, {}, { files: [] }, { files: ['src/safe.js', 'src/safe.js'] }, { files: ['src/safe.js'], approved: true }, { files: [13] }]) {
    assert.equal((await auditInputs(root, manifest)).ok, false);
  }
});

test('symlink files and directory links cannot enter the manifest', async t => {
  const root = await fixture(t);
  await symlink(path.join(root, 'src/safe.js'), path.join(root, 'src/link.js'));
  await symlink(path.join(root, 'src'), path.join(root, 'docs'));
  assert.deepEqual((await auditInputs(root, { files: ['src/link.js', 'docs/safe.js'] })).findings, { 'unreadable-or-linked-input': 2 });
});

test('findings expose classes and counts, never synthetic matches or snippets', async t => {
  const root = await fixture(t);
  const secret = 'ghp_' + 'x'.repeat(30);
  const googleId = 'synthetic_private_identifier_123';
  await writeFile(path.join(root, 'src/unsafe.js'), `const token = '${secret}'; const email = 'person@fixture.invalid'; const ref = 'https://drive.google.com/file/d/${googleId}/view';`);
  const result = await auditInputs(root, { files: ['src/unsafe.js'] });
  assert.deepEqual(result.findings, { 'credential-like-value': 1, 'personal-email': 1, 'private-google-reference': 1 });
  for (const value of [secret, googleId, 'person@fixture.invalid', 'unsafe.js']) assert.equal(JSON.stringify(result).includes(value), false);
});

test('missing, malformed UTF-8, null bytes, oversized files and directories are denied', async t => {
  const root = await fixture(t);
  await writeFile(path.join(root, 'src/utf8.txt'), Buffer.from([0xff]));
  await writeFile(path.join(root, 'src/null.txt'), Buffer.from([65, 0, 66]));
  await writeFile(path.join(root, 'src/large.txt'), 'x'.repeat(1024 * 1024 + 1));
  await mkdir(path.join(root, 'src/folder.txt'));
  const result = await auditInputs(root, { files: ['src/missing.js', 'src/utf8.txt', 'src/null.txt', 'src/large.txt', 'src/folder.txt'] });
  assert.equal(result.ok, false);
  assert.equal(result.filesChecked, 0);
  assert.deepEqual(result.findings, { 'unreadable-or-linked-input': 1, 'unsupported-input': 4 });
});

test('CLI exits nonzero with redacted output on invalid or rejected input', async t => {
  const root = await fixture(t);
  const manifest = path.join(root, 'manifest.json');
  await writeFile(manifest, JSON.stringify({ files: ['.env'] }));
  const script = path.resolve('scripts/factory-input-audit.mjs');
  const rejected = spawnSync(process.execPath, [script, root, manifest], { encoding: 'utf8' });
  assert.equal(rejected.status, 1);
  assert.equal(JSON.parse(rejected.stdout).ok, false);
  assert.equal(rejected.stdout.includes('.env'), false);
  const missing = spawnSync(process.execPath, [script, root, '/nonexistent/private-path'], { encoding: 'utf8' });
  assert.equal(missing.status, 1);
  assert.equal(missing.stdout.includes('private-path'), false);
  await writeFile(manifest, JSON.stringify({ files: ['src/safe.js'] }));
  assert.equal(spawnSync(process.execPath, [script, root, manifest]).status, 0);
});

test('quoted JSON credential and infrastructure keys fail the audit and CLI without exposing values', async t => {
  const root = await fixture(t);
  const apiKey = 'synthetic_value_123456789';
  const databaseId = 'synthetic-database-identifier-123456789';
  await writeFile(path.join(root, 'src/config.json'), JSON.stringify({ api_key: apiKey, database_id: databaseId }));
  const manifest = { files: ['src/config.json'] };
  const result = await auditInputs(root, manifest);
  assert.deepEqual(result, { ok: false, filesChecked: 1, findings: { 'credential-like-value': 1, 'infrastructure-identifier': 1 } });
  const manifestPath = path.join(root, 'manifest.json');
  await writeFile(manifestPath, JSON.stringify(manifest));
  const cli = spawnSync(process.execPath, [path.resolve('scripts/factory-input-audit.mjs'), root, manifestPath], { encoding: 'utf8' });
  assert.equal(cli.status, 1);
  assert.deepEqual(JSON.parse(cli.stdout), result);
  for (const value of [apiKey, databaseId, 'config.json']) assert.equal(cli.stdout.includes(value), false);
});
