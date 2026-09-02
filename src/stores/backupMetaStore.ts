import { createMMKV } from 'react-native-mmkv';

const LAST_BACKUP_AT = 'last_backup_at';

let store: ReturnType<typeof createMMKV> | null = null;

function meta() {
  if (!store) store = createMMKV({ id: 'hypercolor-ux-meta' });
  return store;
}

export function setLastBackupAt(ms: number): void {
  meta().set(LAST_BACKUP_AT, ms);
}

export function getLastBackupAt(): number | null {
  const value = meta().getNumber(LAST_BACKUP_AT);
  return typeof value === 'number' && value > 0 ? value : null;
}

export function clearLastBackupAt(): void {
  meta().remove(LAST_BACKUP_AT);
}

export function formatRelativeBackupTime(ms: number, now = Date.now()): string {
  const diff = Math.max(0, now - ms);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
  return new Date(ms).toLocaleDateString();
}
