import React from 'react';
import { act, create } from 'react-test-renderer';
import { SettingsScreenContent } from '../SettingsScreenContent';
import { sessionUiModel } from '../../../ui/sessionUi';
import { measure } from '../../../theme';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 24, left: 0, right: 0 }),
}));

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
          receiptsEnabled={true}
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
          onToggleReceipts={jest.fn()}
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

  it('keeps identity chip, BLE switch, and restore field at the hit target with names', () => {
    const onCopyPubky = jest.fn();
    const onToggleMesh = jest.fn();
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(
        <SettingsScreenContent
          pubky={'a'.repeat(52)}
          homeserver={null}
          session={sessionUiModel('needs-enable')}
          meshEnabled={false}
          telemetryEnabled={false}
          receiptsEnabled={true}
          backupBusy={false}
          recoveryCode={null}
          recoveryConfirmed={false}
          recoveryCopied={false}
          restoreCode=""
          restoreNote={null}
          restoreError={null}
          markedSection={null}
          onBack={jest.fn()}
          onToggleMesh={onToggleMesh}
          onToggleTelemetry={jest.fn()}
          onToggleReceipts={jest.fn()}
          onBackup={jest.fn()}
          onCopyRecovery={jest.fn()}
          onToggleRecoveryConfirmed={jest.fn()}
          onRecoveryDone={jest.fn()}
          onChangeRestoreCode={jest.fn()}
          onRestore={jest.fn()}
          onEnableMessaging={jest.fn()}
          onCopyPubky={onCopyPubky}
        />,
      );
    });
    const chip = tree.root
      .findAllByProps({ testID: 'mask-pubky' })
      .find(node => node.props.accessibilityRole === 'text');
    const copy = tree.root.findByProps({ testID: 'mask-pubkyCopy' });
    expect(chip?.props.accessibilityLabel).toBe('a'.repeat(52));
    expect(copy.props.accessibilityRole).toBe('button');
    expect(copy.props.style.minHeight).toBeGreaterThanOrEqual(44);
    const mesh = tree.root.findByProps({ testID: 'settingsBleMesh' });
    expect(mesh.props.accessibilityRole).toBe('switch');
    expect(mesh.props.accessibilityLabel).toBe('BLE Mesh (quarantined)');
    expect(mesh.props.style.minHeight).toBeGreaterThanOrEqual(measure.hitTarget);
    act(() => {
      mesh.props.onPress();
    });
    expect(onToggleMesh).toHaveBeenCalledWith(true);
    const restore = tree.root.findByProps({
      testID: 'settingsRestoreCode',
    });
    expect(restore.props.accessibilityLabel).toBe('Paste recovery code to restore');
    expect(restore.props.style.minHeight).toBeGreaterThanOrEqual(measure.hitTarget);
  });
});
