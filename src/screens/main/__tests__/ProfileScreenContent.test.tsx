import React from 'react';
import { act, create } from 'react-test-renderer';
import { ProfileScreenContent } from '../ProfileScreenContent';
import { sessionUiModel } from '../../../ui/sessionUi';
import { COPY } from '../../../copy/uxCopy';

describe('ProfileScreenContent wiring', () => {
  it('forwards settings and sign-out handlers', () => {
    const onOpenSettings = jest.fn();
    const onOpenSignOut = jest.fn();
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(
        <ProfileScreenContent
          displayName="Cedar"
          pubky={null}
          copied={false}
          session={sessionUiModel('enabled')}
          sessionKind="enabled"
          showEnableMessaging={false}
          signOutOpen={false}
          signOutBusy={false}
          signOutError={null}
          lastBackupRelative={null}
          onOpenSettings={onOpenSettings}
          onCopyPubky={jest.fn()}
          onEnableMessaging={jest.fn()}
          onOpenRequests={jest.fn()}
          onOpenBackup={jest.fn()}
          onOpenTipEndpoints={jest.fn()}
          onOpenSignOut={onOpenSignOut}
          onCancelSignOut={jest.fn()}
          onConfirmSignOut={jest.fn()}
        />,
      );
    });
    act(() => {
      tree.root.findByProps({ testID: 'profileSettings' }).props.onPress();
      tree.root.findByProps({ testID: 'profileSignOut' }).props.onPress();
    });
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    expect(onOpenSignOut).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(tree.toJSON())).toContain(COPY.signOut);
  });
});
