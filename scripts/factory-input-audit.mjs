import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const MAX_BYTES = 1024 * 1024;
const ALLOWED_ROOTS = new Set(['src', 'public', 'scripts', 'test', 'docs', '.github']);
const ROOT_FILES = new Set(['AGENTS.md', 'README.md', 'package.json', 'package-lock.json', '.nvmrc']);
const TEXT_EXTENSIONS = new Set(['.js', '.mjs', '.json', '.md', '.html', '.css', '.yml', '.yaml', '.txt']);
const BLOCKED_SEGMENT = /^(?:\.git|\.env(?:\..*)?|node_modules|build|dist|coverage|artifacts?|uploads?|screenshots?|records?|secrets?|\.wrangler|\.dev\.vars(?:\..*)?)$/i;
const BLOCKED_FILE = /(?:\.(?:db|sqlite\d?|pem|key|p12|pfx|log|png|jpe?g|webp|pdf|zip)$|(?:credentials?|tokens?|private[-_]data|diagnostics?|chat[-_]history)(?:[._-]|$))/i;

// Findings are deliberately class-only: never return matching text, snippets or paths.
export function inspectText(text) {
  const classes = new Set();
  const emails = text.match(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  if (emails.some(email => !/^(?:example\.(?:com|org|net)|test\.invalid)$/i.test(email.split('@').at(-1)))) classes.add('personal-email');
  if (/(?:drive\.google\.com\/(?:file\/d|drive\/folders)\/|docs\.google\.com\/(?:document|spreadsheets|presentation|forms)\/d\/)[A-Za-z0-9_-]{10,}|\b[A-Za-z0-9_-]{10,}@group\.calendar\.google\.com\b/i.test(text)) classes.add('private-google-reference');
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:github_pat_[A-Za-z0-9_]{15,}|gh[pousr]_[A-Za-z0-9]{20,}|AIza[A-Za-z0-9_-]{30,})\b|(?:"(?:access_token|refresh_token|client_secret|api_key)"|'(?:access_token|refresh_token|client_secret|api_key)'|\b(?:access_token|refresh_token|client_secret|api_key))\s*[=:]\s*["'][A-Za-z0-9_./+=-]{12,}["']/i.test(text)) classes.add('credential-like-value');
  if (/(?:"(?:database_id|account_id|access_app_id)"|'(?:database_id|account_id|access_app_id)'|\b(?:database_id|account_id|access_app_id))\s*[=:]\s*["'][A-Za-z0-9-]{20,}["']/i.test(text)) classes.add('infrastructure-identifier');
  return [...classes].sort();
}

function permitted(relative) {
  if (typeof relative !== 'string' || !relative || relative.includes('\\') || relative.includes('\0') || path.posix.isAbsolute(relative)) return false;
  const parts = relative.split('/');
  if (parts.some(p => !p || p === '.' || p === '..' || BLOCKED_SEGMENT.test(p))) return false;
  if (parts.some(part => BLOCKED_FILE.test(part))) return false;
  if (parts.length === 1) return ROOT_FILES.has(relative);
  if (!ALLOWED_ROOTS.has(parts[0]) || !TEXT_EXTENSIONS.has(path.posix.extname(relative))) return false;
  return parts[0] !== '.github' || (parts.length === 3 && parts[1] === 'workflows');
}

export async function auditInputs(root, manifest) {
  const findings = new Map();
  const add = kind => findings.set(kind, (findings.get(kind) || 0) + 1);
  const result = () => ({ ok: findings.size === 0, filesChecked, findings: Object.fromEntries([...findings].sort(([a], [b]) => a.localeCompare(b))) });
  let filesChecked = 0;
  if (!manifest || Object.keys(manifest).length !== 1 || !Array.isArray(manifest.files) || manifest.files.length < 1 || manifest.files.length > 500 || new Set(manifest.files).size !== manifest.files.length) {
    add('invalid-manifest');
    return result();
  }
  let base;
  try { base = await realpath(root); } catch { add('unreadable-root'); return result(); }
  for (const relative of manifest.files) {
    if (!permitted(relative)) { add('disallowed-path'); continue; }
    try {
      let current = base;
      let stat;
      for (const part of relative.split('/')) {
        current = path.join(current, part);
        stat = await lstat(current);
        if (stat.isSymbolicLink()) throw new Error('link');
      }
      if (!stat.isFile() || stat.size > MAX_BYTES) { add('unsupported-input'); continue; }
      const bytes = await readFile(current);
      if (bytes.length > MAX_BYTES || bytes.includes(0)) { add('unsupported-input'); continue; }
      let text;
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { add('unsupported-input'); continue; }
      filesChecked++;
      for (const kind of inspectText(text)) add(kind);
    } catch { add('unreadable-or-linked-input'); }
  }
  return result();
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 4) throw new Error('arguments');
    const manifest = JSON.parse(await readFile(process.argv[3], 'utf8'));
    const result = await auditInputs(process.argv[2], manifest);
    console.log(JSON.stringify(result));
    process.exitCode = result.ok ? 0 : 1;
  } catch {
    console.log(JSON.stringify({ ok: false, filesChecked: 0, findings: { 'invalid-audit-request': 1 } }));
    process.exitCode = 1;
  }
}
