import React from 'react';
import { Alert, BackHandler } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import SettingsScreen from '../SettingsScreen';
import { BackupService } from '../../../services/backup/BackupService';
import { setLastBackupAt } from '../../../stores/backupMetaStore';
import { COPY } from '../../../copy/uxCopy';

const mockGoBack = jest.fn();
const mockDispatch = jest.fn();
const mockSetOptions = jest.fn();
let preventRemoveEnabled = false;
let preventRemoveCallback: ((args: { data: { action: { type: string } } }) => void) | undefined;

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    goBack: mockGoBack,
    dispatch: mockDispatch,
    setOptions: mockSetOptions,
  }),
  usePreventRemove: (
    enabled: boolean,
    cb: (args: { data: { action: { type: string } } }) => void,
  ) => {
    preventRemoveEnabled = enabled;
    preventRemoveCallback = cb;
  },
  useRoute: () => ({ params: {} }),
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
    mockDispatch.mockReset();
    mockSetOptions.mockReset();
    preventRemoveEnabled = false;
    preventRemoveCallback = undefined;
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

  it('intercepts a parent reset while the recovery gate is active', async () => {
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

    expect(preventRemoveEnabled).toBe(true);
    expect(mockSetOptions).toHaveBeenCalledWith({ gestureEnabled: false });

    const resetAction = { type: 'RESET' };
    await act(async () => {
      preventRemoveCallback?.({ data: { action: resetAction } });
    });
    expect(Alert.alert).toHaveBeenCalledWith(
      COPY.leaveRecoveryTitle,
      COPY.leaveRecoveryBody,
      expect.arrayContaining([
        expect.objectContaining({ text: COPY.goBack }),
        expect.objectContaining({ text: COPY.leaveAnyway }),
      ]),
    );
    expect(mockDispatch).not.toHaveBeenCalled();
    expect(mockGoBack).not.toHaveBeenCalled();
    alertSpy.mockRestore();
    await act(async () => {
      tree.unmount();
    });
  });

  it('dispatches the intercepted action when Leave anyway is confirmed', async () => {
    type AlertButton = { text?: string; onPress?: () => void };
    let buttons: AlertButton[] = [];
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, next) => {
      buttons = (next ?? []) as AlertButton[];
    });
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(<SettingsScreen />);
    });
    await act(async () => {
      tree.root.findByProps({ accessibilityLabel: 'Backup now' }).props.onPress();
      await Promise.resolve();
      await Promise.resolve();
    });
    const resetAction = { type: 'RESET' };
    await act(async () => {
      preventRemoveCallback?.({ data: { action: resetAction } });
    });
    await act(async () => {
      buttons.find(button => button.text === COPY.leaveAnyway)?.onPress?.();
    });
    expect(mockDispatch).toHaveBeenCalledWith(resetAction);
    expect(mockGoBack).not.toHaveBeenCalled();
    alertSpy.mockRestore();
    await act(async () => {
      tree.unmount();
    });
  });

  it('intercepts hardware Back while the recovery gate is active', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(jest.fn());
    let backPress: (() => boolean) | undefined;
    const addSpy = jest
      .spyOn(BackHandler, 'addEventListener')
      .mockImplementation((event, handler) => {
        if (event === 'hardwareBackPress') backPress = handler as () => boolean;
        return { remove: jest.fn() };
      });
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(<SettingsScreen />);
    });
    await act(async () => {
      tree.root.findByProps({ accessibilityLabel: 'Backup now' }).props.onPress();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(backPress?.()).toBe(true);
    expect(Alert.alert).toHaveBeenCalledWith(
      COPY.leaveRecoveryTitle,
      COPY.leaveRecoveryBody,
      expect.any(Array),
    );
    expect(mockGoBack).not.toHaveBeenCalled();
    addSpy.mockRestore();
    alertSpy.mockRestore();
    await act(async () => {
      tree.unmount();
    });
  });
});
