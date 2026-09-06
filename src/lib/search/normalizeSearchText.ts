import { stripBidiAndC1 } from '../../utils/displaySanitize';

export function normalizeSearchText(raw: string): string {
  return stripBidiAndC1(raw).normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
}

export function likePattern(query: string): string {
  const escaped = normalizeSearchText(query).replace(/[%_\\]/g, ch => `\\${ch}`);
  return `%${escaped}%`;
}

export function ftsQuery(query: string): string | null {
  const normalized = normalizeSearchText(query).replace(/["*]/g, ' ').trim();
  if (normalized.length === 0) return null;
  const terms = normalized
    .split(' ')
    .filter(Boolean)
    .map(term => `"${term.replace(/"/g, '')}"`);
  if (terms.length === 0) return null;
  return terms.join(' AND ');
}
