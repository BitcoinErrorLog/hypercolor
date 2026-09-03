import React from 'react';
import { act, create } from 'react-test-renderer';
import { SettingsScreenContent } from '../SettingsScreenContent';
import { sessionUiModel } from '../../../ui/sessionUi';

describe('SettingsScreenContent wiring', () => {
  it('forwards back and enable-messaging handlers', () => {
    const onBack = jest.fn();
    const onEnableMessaging = jest.fn();
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(
        <SettingsScreenContent
          pubky={null}
          homeserver={null}
          session={sessionUiModel('needs-enable')}
          meshEnabled={false}
          telemetryEnabled={false}
          backupBusy={false}
          recoveryCode={null}
          recoveryConfirmed={false}
          recoveryCopied={false}
          restoreCode=""
          restoreNote={null}
          restoreError={null}
          markedSection={null}
          onBack={onBack}
          onToggleMesh={jest.fn()}
          onToggleTelemetry={jest.fn()}
          onBackup={jest.fn()}
          onCopyRecovery={jest.fn()}
          onToggleRecoveryConfirmed={jest.fn()}
          onRecoveryDone={jest.fn()}
          onChangeRestoreCode={jest.fn()}
          onRestore={jest.fn()}
          onEnableMessaging={onEnableMessaging}
          onCopyPubky={jest.fn()}
        />,
      );
    });
    act(() => {
      tree.root.findByProps({ testID: 'settingsBack' }).props.onPress();
      tree.root.findByProps({ testID: 'settingsEnableMessaging' }).props.onPress();
    });
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onEnableMessaging).toHaveBeenCalledTimes(1);
  });
});
