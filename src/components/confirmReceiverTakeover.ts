import { Alert } from 'react-native';
import { COPY } from '../copy/uxCopy';
import { LinkService } from '../services/link/LinkService';
import { useReceiverRoleStore } from '../stores/receiverRoleStore';

export type ReceiverTakeoverMode = 'takeover' | 'reenable';

let dialogOpen = false;
let takeoverInFlight: Promise<void> | null = null;

/** Test seam: drop the in-flight latch without native work. */
export function resetReceiverTakeoverLatchForTests(): void {
  dialogOpen = false;
  takeoverInFlight = null;
}

/**
 * Same confirm Alert as {@link StandbyBanner}: title/body/primary/secondary
 * from COPY, cancel snoozes the banner, confirm publishes this device's marker.
 * A module latch prevents stacked Alerts / double-confirm from issuing two PUTs.
 */
export function confirmReceiverTakeover(input: {
  mode: ReceiverTakeoverMode;
  onBusy?: (busy: boolean) => void;
  onSuccess?: (() => void | Promise<void>) | undefined;
}): void {
  if (dialogOpen || takeoverInFlight) return;

  const title = input.mode === 'reenable' ? COPY.reenableBannerTitle : COPY.standbyBannerTitle;
  const body = input.mode === 'reenable' ? COPY.reenableBannerBody : COPY.standbyBannerBody;
  const primary = input.mode === 'reenable' ? COPY.reenablePrimary : COPY.standbyPrimary;
  const secondary = input.mode === 'reenable' ? COPY.reenableSecondary : COPY.standbySecondary;

  dialogOpen = true;
  Alert.alert(title, body, [
    {
      text: secondary,
      style: 'cancel',
      onPress: () => {
        dialogOpen = false;
        useReceiverRoleStore.getState().snoozeCurrentBanner();
      },
    },
    {
      text: primary,
      onPress: () => {
        if (takeoverInFlight) return;
        takeoverInFlight = (async () => {
          input.onBusy?.(true);
          try {
            await LinkService.takeoverReceiver(input.mode);
            await input.onSuccess?.();
          } catch {
            Alert.alert(title, COPY.couldNotStartAuthorization);
          } finally {
            input.onBusy?.(false);
            dialogOpen = false;
            takeoverInFlight = null;
          }
        })();
      },
    },
  ]);
}
