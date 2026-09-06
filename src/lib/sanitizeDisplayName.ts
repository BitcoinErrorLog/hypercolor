import { stripBidiAndC1 } from '../utils/displaySanitize';

/** Max Unicode scalar values kept after sanitizing a display name or nickname. */
export const DISPLAY_NAME_MAX_CHARS = 32;

/**
 * Local display names and nicknames: strip Unicode format / bidi / tag chars
 * (same rules as web), collapse whitespace, trim, cap length.
 */
export function sanitizeDisplayName(raw: string | null | undefined): string {
  if (!raw) return '';
  const stripped = stripBidiAndC1(raw).replace(/\s+/g, ' ').trim();
  if (!stripped) return '';
  const chars = [...stripped];
  if (chars.length <= DISPLAY_NAME_MAX_CHARS) return stripped;
  return chars.slice(0, DISPLAY_NAME_MAX_CHARS).join('');
}

export function initialsFromDisplayName(name: string): string {
  const sanitized = sanitizeDisplayName(name);
  if (!sanitized) return '?';
  const parts = sanitized.split(' ').filter(Boolean);
  if (parts.length >= 2) {
    const a = parts[0]![0] ?? '';
    const b = parts[1]![0] ?? '';
    return `${a}${b}`.toUpperCase();
  }
  return sanitized.slice(0, 2).toUpperCase();
}
