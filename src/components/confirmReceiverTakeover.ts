import { Alert } from 'react-native';
import { COPY } from '../copy/uxCopy';
import { LinkService } from '../services/link/LinkService';
import { useReceiverRoleStore } from '../stores/receiverRoleStore';

export type ReceiverTakeoverMode = 'takeover' | 'reenable';

/**
 * Same confirm Alert as {@link StandbyBanner}: title/body/primary/secondary
 * from COPY, cancel snoozes the banner, confirm publishes this device's marker.
 */
export function confirmReceiverTakeover(input: {
  mode: ReceiverTakeoverMode;
  onBusy?: (busy: boolean) => void;
  onSuccess?: (() => void | Promise<void>) | undefined;
}): void {
  const title = input.mode === 'reenable' ? COPY.reenableBannerTitle : COPY.standbyBannerTitle;
  const body = input.mode === 'reenable' ? COPY.reenableBannerBody : COPY.standbyBannerBody;
  const primary = input.mode === 'reenable' ? COPY.reenablePrimary : COPY.standbyPrimary;
  const secondary = input.mode === 'reenable' ? COPY.reenableSecondary : COPY.standbySecondary;

  Alert.alert(title, body, [
    {
      text: secondary,
      style: 'cancel',
      onPress: () => useReceiverRoleStore.getState().snoozeCurrentBanner(),
    },
    {
      text: primary,
      onPress: () => {
        void (async () => {
          input.onBusy?.(true);
          try {
            await LinkService.takeoverReceiver(input.mode);
            await input.onSuccess?.();
          } catch {
            Alert.alert(title, COPY.couldNotStartAuthorization);
          } finally {
            input.onBusy?.(false);
          }
        })();
      },
    },
  ]);
}
