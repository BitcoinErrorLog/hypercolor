import { createMMKV, type MMKV } from 'react-native-mmkv';
import { FeatureFlags } from '../flags';

/**
 * Telemetry — privacy-preserving event counters.
 *
 * No message content, no pubky keys, no user-identifiable data is ever
 * recorded. Only integer counters of aggregate events.
 *
 * All recording is gated on the `telemetry` feature flag. The flag defaults
 * to false and must be explicitly enabled by the user.
 *
 * Counter keys are reset weekly (a rolling 7-day window).
 */

export type TelemetryEvent =
  | 'delivery_mesh_success'
  | 'delivery_pubky_success'
  | 'delivery_queued'
  | 'delivery_failed_permanent'
  | 'auth_signup_success'
  | 'auth_signin_success'
  | 'auth_signup_failure'
  | 'inbox_catchup_count'
  | 'ble_peer_discovered';

const PREFIX = 'telemetry:';
const WEEK_KEY = 'telemetry:week';

let _storage: MMKV | null = null;

function storage(): MMKV {
  if (!_storage) {
    _storage = createMMKV({ id: 'telemetry' });
  }
  return _storage;
}

function currentWeek(): number {
  return Math.floor(Date.now() / (7 * 24 * 60 * 60 * 1000));
}

function maybeRollWeek(): void {
  const s = storage();
  const stored = s.getNumber(WEEK_KEY) ?? 0;
  const week = currentWeek();
  if (stored !== week) {
    s.clearAll();
    s.set(WEEK_KEY, week);
  }
}

export const Telemetry = {
  record(event: TelemetryEvent, count = 1): void {
    if (!FeatureFlags.get('telemetry')) return;
    maybeRollWeek();
    const s = storage();
    const key = `${PREFIX}${event}`;
    const prev = s.getNumber(key) ?? 0;
    s.set(key, prev + count);
  },

  snapshot(): Record<TelemetryEvent, number> {
    if (!FeatureFlags.get('telemetry')) return {} as Record<TelemetryEvent, number>;
    maybeRollWeek();
    const s = storage();
    const events: TelemetryEvent[] = [
      'delivery_mesh_success',
      'delivery_pubky_success',
      'delivery_queued',
      'delivery_failed_permanent',
      'auth_signup_success',
      'auth_signin_success',
      'auth_signup_failure',
      'inbox_catchup_count',
      'ble_peer_discovered',
    ];
    return events.reduce(
      (acc, ev) => {
        acc[ev] = s.getNumber(`${PREFIX}${ev}`) ?? 0;
        return acc;
      },
      {} as Record<TelemetryEvent, number>,
    );
  },

  clear(): void {
    storage().clearAll();
  },
};
