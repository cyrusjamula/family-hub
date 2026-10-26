import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const MAX_BYTES = 1024 * 1024;
const ALLOWED_ROOTS = new Set(['src', 'public', 'scripts', 'test', 'docs', '.github']);
const ROOT_FILES = new Set(['AGENTS.md', 'README.md', 'package.json', 'package-lock.json', '.nvmrc']);
const TEXT_EXTENSIONS = new Set(['.js', '.mjs', '.json', '.md', '.html', '.css', '.yml', '.yaml', '.txt']);
const BLOCKED_SEGMENT = /^(?:\.git|\.env(?:\..*)?|node_modules|build|dist|coverage|artifacts?|uploads?|screenshots?|records?|secrets?|\.wrangler|\.dev\.vars(?:\..*)?)$/i;
const BLOCKED_FILE = /(?:\.(?:db|sqlite\d?|pem|key|p12|pfx|log|png|jpe?g|webp|pdf|zip)$|(?:credentials?|tokens?|secrets?|private[-_]data|diagnostics?|chat[-_]history)(?:[._-]|$))/i;

// Each domain token is traversed once after an @ delimiter. Local-part
// membership uses one adjacent character; no regexp retries at every offset.
function inspectEmailReferences(text) {
  let personal = false;
  let calendar = false;
  let cursor = 0;
  while (cursor < text.length) {
    const at = text.indexOf('@', cursor);
    if (at < 0) break;
    cursor = at + 1;
    if (at === 0 || !/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]/i.test(text[at - 1])) continue;
    let end = cursor;
    let candidateEnd = -1;
    let dot = -1;
    let suffixLetters = 0;
    let suffixValid = false;
    while (end < text.length && /[A-Z0-9.-]/i.test(text[end])) {
      const character = text[end];
      if (character === '.') {
        dot = end;
        suffixLetters = 0;
        suffixValid = true;
      } else if (suffixValid && /[A-Z]/i.test(character)) {
        suffixLetters++;
        if (suffixLetters >= 2 && dot > at + 1) candidateEnd = end + 1;
      } else {
        suffixValid = false;
      }
      end++;
    }
    cursor = end;
    if (candidateEnd < 0) continue;
    const domain = text.slice(at + 1, candidateEnd).toLowerCase();
    if (!['example.com', 'example.org', 'example.net', 'test.invalid'].includes(domain)) personal = true;
    if (domain === 'group.calendar.google.com' && at >= 10 && /^[A-Z0-9_-]{10}$/i.test(text.slice(at - 10, at))) calendar = true;
  }
  return { personal, calendar };
}

// Scan disjoint lines, including sequence markers and a following indented
// scalar. Pending assignments never rescan a prior or nested key's content.
function hasPlainAssignment(lines, keyPrefix, minimum, allowedCharacter) {
  const scalarText = value => {
    const comment = value.indexOf('#');
    return (comment < 0 ? value : value.slice(0, comment)).trimEnd();
  };
  const validScalar = scalar => {
    if (scalar.length < minimum) return false;
    for (const character of scalar) {
      if (!allowedCharacter.test(character)) return false;
    }
    return true;
  };
  let pendingIndent = -1;
  for (const line of lines) {
    let indent = 0;
    while (indent < line.length && /[ \t]/.test(line[indent])) indent++;
    if (indent === line.length || line[indent] === '#') continue;
    if (pendingIndent >= 0) {
      if (indent > pendingIndent && validScalar(scalarText(line.slice(indent)))) return true;
      pendingIndent = -1;
    }
    let offset = indent;
    while (line[offset] === '-' && /[ \t]/.test(line[offset + 1] || '')) {
      offset++;
      while (offset < line.length && /[ \t]/.test(line[offset])) offset++;
    }
    const prefix = keyPrefix.exec(line.slice(offset));
    if (!prefix) continue;
    const scalar = scalarText(line.slice(offset + prefix[0].length));
    if (!scalar) { pendingIndent = offset; continue; }
    if (validScalar(scalar)) return true;
  }
  return false;
}

// Findings are deliberately class-only: never return matching text, snippets or paths.
export function inspectText(text) {
  const classes = new Set();
  const lines = text.split(/\r\n|\r|\n/);
  const plainCredential = hasPlainAssignment(lines, /^[ \t]*(?:"(?:access_token|refresh_token|client_secret|api_key)"|'(?:access_token|refresh_token|client_secret|api_key)'|(?:access_token|refresh_token|client_secret|api_key))[ \t]*[=:][ \t]*/i, 12, /[A-Z0-9_./+=-]/i);
  const plainInfrastructure = hasPlainAssignment(lines, /^[ \t]*(?:"(?:database_id|account_id|access_app_id)"|'(?:database_id|account_id|access_app_id)'|(?:database_id|account_id|access_app_id))[ \t]*[=:][ \t]*/i, 20, /[A-Z0-9-]/i);
  const emails = inspectEmailReferences(text);
  if (emails.personal) classes.add('personal-email');
  if (/(?:drive\.google\.com\/(?:file\/d|drive\/folders)\/|docs\.google\.com\/(?:document|spreadsheets|presentation|forms)\/d\/)[A-Za-z0-9_-]{10,}/i.test(text) || emails.calendar) classes.add('private-google-reference');
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:github_pat_[A-Za-z0-9_]{15,}|gh[pousr]_[A-Za-z0-9]{20,}|AIza[A-Za-z0-9_-]{30,})\b|(?:"(?:access_token|refresh_token|client_secret|api_key)"|'(?:access_token|refresh_token|client_secret|api_key)'|\b(?:access_token|refresh_token|client_secret|api_key))\s*[=:]\s*["'][A-Za-z0-9_./+=-]{12,}["']/i.test(text) || plainCredential) classes.add('credential-like-value');
  if (/(?:"(?:database_id|account_id|access_app_id)"|'(?:database_id|account_id|access_app_id)'|\b(?:database_id|account_id|access_app_id))\s*[=:]\s*["'][A-Za-z0-9-]{20,}["']/i.test(text) || plainInfrastructure) classes.add('infrastructure-identifier');
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
