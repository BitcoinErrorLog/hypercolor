const SAFE_HREF = /^https:\/\//i;
const DISALLOWED = /^(javascript|data|vbscript|file|about):/i;

export function sanitizeHref(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (DISALLOWED.test(trimmed)) return null;
  if (trimmed.startsWith('/') || trimmed.startsWith('#') || trimmed.startsWith('?')) return null;
  if (!SAFE_HREF.test(trimmed)) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'https:') return null;
    if (url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}
