import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { SYNTHETIC_PUBKY_ALLOWLIST, SYNTHETIC_RECOVERY_CODE } from '../fixtures/identities';

const Z32 = /[ybndrfg8ejkmcpqxot1uwisza345h769]{52}/gi;
const PK_PREFIX = /\bpk:/i;
const AUTH = /pubkyauth:|paykit-connect:|hypercolor:\/\/e2e\/vrt/i;
const INVOICE = /\blnbc[0-9a-z]+|\bbtcrt1|\bbc1[a-z0-9]{20,}/i;
const COOKIE = /bearer\s+[a-z0-9._-]+|sessionid=/i;

const TEXT_EXT = new Set([
  '.html',
  '.json',
  '.md',
  '.txt',
  '.yaml',
  '.yml',
  '.svg',
  '.js',
  '.ts',
  '.tsx',
]);

export type PrivacyHit = { file: string; rule: string; excerpt: string };

function allowedPubky(value: string): boolean {
  return SYNTHETIC_PUBKY_ALLOWLIST.includes(value.toLowerCase());
}

export function scanText(file: string, text: string): PrivacyHit[] {
  const hits: PrivacyHit[] = [];
  if (text.includes(SYNTHETIC_RECOVERY_CODE)) {
    hits.push({ file, rule: 'recovery-fixture', excerpt: 'synthetic recovery vocabulary' });
  }
  if (PK_PREFIX.test(text)) {
    hits.push({ file, rule: 'pk-prefix', excerpt: 'pk:' });
  }
  if (INVOICE.test(text)) {
    hits.push({ file, rule: 'invoice', excerpt: 'invoice/address-like payload' });
  }
  if (COOKIE.test(text)) {
    hits.push({ file, rule: 'credential', excerpt: 'bearer/session' });
  }
  const z32 = text.match(Z32) ?? [];
  for (const token of z32) {
    if (!allowedPubky(token)) {
      hits.push({ file, rule: 'z32', excerpt: 'non-allowlisted 52-char z32' });
    }
  }
  if (AUTH.test(text) && file.endsWith('.html')) {
    hits.push({ file, rule: 'auth-url', excerpt: 'auth or e2e URL in report' });
  }
  return hits;
}

async function walk(dir: string, files: string[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(full, files);
    } else {
      files.push(full);
    }
  }
}

export async function scanPrivacy(root: string): Promise<PrivacyHit[]> {
  const files: string[] = [];
  try {
    const info = await stat(root);
    if (!info.isDirectory()) {
      files.push(root);
    } else {
      await walk(root, files);
    }
  } catch {
    return [];
  }
  const hits: PrivacyHit[] = [];
  for (const file of files) {
    if (!TEXT_EXT.has(path.extname(file).toLowerCase())) continue;
    const text = await readFile(file, 'utf8');
    hits.push(...scanText(path.relative(root, file) || file, text));
  }
  return hits;
}
