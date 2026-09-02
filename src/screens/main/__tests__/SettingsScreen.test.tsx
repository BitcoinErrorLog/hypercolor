import React from 'react';
import { Alert } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import SettingsScreen from '../SettingsScreen';
import { BackupService } from '../../../services/backup/BackupService';
import { setLastBackupAt } from '../../../stores/backupMetaStore';
import { COPY } from '../../../copy/uxCopy';

const mockGoBack = jest.fn();

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: mockGoBack }),
}));

jest.mock('../../../flags', () => ({
  FeatureFlags: {
    get: jest.fn().mockReturnValue(false),
    set: jest.fn(),
  },
}));

jest.mock('../../../stores/authStore', () => ({
  useAuthStore: (sel: (s: { pubky: string; homeserver: string }) => unknown) =>
    sel({ pubky: 'a'.repeat(52), homeserver: 'homeserver.example' }),
}));

jest.mock('../../../stores/sessionStatusStore', () => ({
  useSessionStatusStore: (sel: (s: { kind: string }) => unknown) => sel({ kind: 'enabled' }),
}));

jest.mock('../../../stores/backupMetaStore', () => ({
  setLastBackupAt: jest.fn(),
}));

jest.mock('../../../services/backup/BackupService', () => ({
  BackupService: {
    exportBackup: jest.fn(),
    restoreBackup: jest.fn(),
  },
}));

jest.mock('../../../components/TipEndpointsSettings', () => ({
  TipEndpointsSettings: () => null,
}));

jest.mock('../../../services/link/liveProof', () => ({
  parseLiveProofTokens: () => [],
  runLinkLiveProof: jest.fn(),
}));

jest.mock('../../../utils/copyText', () => ({
  copyText: jest.fn(),
}));

describe('SettingsScreen recovery gate', () => {
  beforeEach(() => {
    mockGoBack.mockReset();
    (setLastBackupAt as jest.Mock).mockReset();
    (BackupService.exportBackup as jest.Mock).mockResolvedValue({
      recoveryCode: 'alpha-bravo-charlie',
    });
  });

  it('does not record a backup until the recovery code is confirmed and Done', async () => {
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(<SettingsScreen />);
    });

    await act(async () => {
      tree.root.findByProps({ accessibilityLabel: 'Backup now' }).props.onPress();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(setLastBackupAt).not.toHaveBeenCalled();
    const done = tree.root.findByProps({ testID: 'settingsRecoveryDone' });
    expect(done.props.disabled).toBe(true);

    await act(async () => {
      tree.root.findByProps({ testID: 'settingsRecoveryConfirm' }).props.onPress();
    });
    expect(setLastBackupAt).not.toHaveBeenCalled();

    await act(async () => {
      tree.root.findByProps({ testID: 'settingsRecoveryDone' }).props.onPress();
    });
    expect(setLastBackupAt).toHaveBeenCalledTimes(1);
    await act(async () => {
      tree.unmount();
    });
  });

  it('intercepts Back while the recovery code is unsaved', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(jest.fn());
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(<SettingsScreen />);
    });
    await act(async () => {
      tree.root.findByProps({ accessibilityLabel: 'Backup now' }).props.onPress();
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      tree.root.findByProps({ testID: 'settingsBack' }).props.onPress();
    });

    expect(Alert.alert).toHaveBeenCalledWith(
      COPY.leaveRecoveryTitle,
      COPY.leaveRecoveryBody,
      expect.arrayContaining([
        expect.objectContaining({ text: COPY.goBack }),
        expect.objectContaining({ text: COPY.leaveAnyway }),
      ]),
    );
    expect(mockGoBack).not.toHaveBeenCalled();
    alertSpy.mockRestore();
    await act(async () => {
      tree.unmount();
    });
  });
});
