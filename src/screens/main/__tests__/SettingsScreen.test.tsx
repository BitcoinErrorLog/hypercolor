import React from 'react';
import { Alert, BackHandler } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import SettingsScreen from '../SettingsScreen';
import { BackupService } from '../../../services/backup/BackupService';
import { setLastBackupAt } from '../../../stores/backupMetaStore';
import { COPY } from '../../../copy/uxCopy';
import { scrollSettingsToSection, focusSettingsSection } from '../../../ui/settingsSectionFocus';

const mockGoBack = jest.fn();
const mockDispatch = jest.fn();
const mockSetOptions = jest.fn();
const mockSetParams = jest.fn();
const mockRoute = { params: {} as { section?: 'backup' | 'payments' } };
let preventRemoveEnabled = false;
let preventRemoveCallback: ((args: { data: { action: { type: string } } }) => void) | undefined;
let mockVisitedActions = new WeakSet<object>();

function mockAttemptAction(action: { type: string }): void {
  if (preventRemoveEnabled && !mockVisitedActions.has(action)) {
    mockVisitedActions.add(action);
    preventRemoveCallback?.({ data: { action } });
    return;
  }
  mockDispatch(action);
  if (action.type === 'GO_BACK') mockGoBack();
}

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    goBack: () => mockAttemptAction({ type: 'GO_BACK' }),
    dispatch: (action: { type: string }) => mockAttemptAction(action),
    setOptions: mockSetOptions,
    setParams: (params: { section?: 'backup' | 'payments' }) => {
      mockSetParams(params);
      mockRoute.params = { ...mockRoute.params, ...params };
    },
  }),
  usePreventRemove: (
    enabled: boolean,
    cb: (args: { data: { action: { type: string } } }) => void,
  ) => {
    preventRemoveEnabled = enabled;
    preventRemoveCallback = cb;
  },
  useRoute: () => mockRoute,
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

type AlertButton = { text?: string; onPress?: () => void };
type AlertOptions = { cancelable?: boolean; onDismiss?: () => void };

async function exportRecovery(tree: ReactTestRenderer): Promise<void> {
  await act(async () => {
    tree.root.findByProps({ accessibilityLabel: 'Backup now' }).props.onPress();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function mockLeaveAlert(): {
  captured: { buttons: AlertButton[]; options?: AlertOptions };
  spy: jest.SpyInstance;
} {
  const captured: { buttons: AlertButton[]; options?: AlertOptions } = { buttons: [] };
  const spy = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, next, options) => {
    captured.buttons = (next ?? []) as AlertButton[];
    if (options) {
      captured.options = options as AlertOptions;
    }
  });
  return { captured, spy };
}
jest.mock('../../../ui/settingsSectionFocus', () => ({
  scrollSettingsToSection: jest.fn(),
  focusSettingsSection: jest.fn(),
}));

describe('SettingsScreen recovery gate', () => {
  beforeEach(() => {
    mockGoBack.mockReset();
    mockDispatch.mockReset();
    mockSetOptions.mockReset();
    mockSetParams.mockReset();
    preventRemoveEnabled = false;
    preventRemoveCallback = undefined;
    mockVisitedActions = new WeakSet<object>();
    mockRoute.params = {};
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

    await exportRecovery(tree);

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
    await exportRecovery(tree);

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
      expect.objectContaining({ cancelable: true, onDismiss: expect.any(Function) }),
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
    await exportRecovery(tree);

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
      expect.objectContaining({ cancelable: true, onDismiss: expect.any(Function) }),
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
    await exportRecovery(tree);
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
    await exportRecovery(tree);
    expect(backPress?.()).toBe(true);
    expect(Alert.alert).toHaveBeenCalledWith(
      COPY.leaveRecoveryTitle,
      COPY.leaveRecoveryBody,
      expect.any(Array),
      expect.objectContaining({ cancelable: true, onDismiss: expect.any(Function) }),
    );
    expect(mockGoBack).not.toHaveBeenCalled();
    addSpy.mockRestore();
    alertSpy.mockRestore();
    await act(async () => {
      tree.unmount();
    });
  });

  it('header Back Leave anyway removes once without a second prompt', async () => {
    const alert = mockLeaveAlert();
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(<SettingsScreen />);
    });
    await exportRecovery(tree);
    await act(async () => {
      tree.root.findByProps({ testID: 'settingsBack' }).props.onPress();
    });
    expect(alert.spy).toHaveBeenCalledTimes(1);
    await act(async () => {
      alert.captured.buttons.find(button => button.text === COPY.leaveAnyway)?.onPress?.();
    });
    expect(alert.spy).toHaveBeenCalledTimes(1);
    expect(mockDispatch).toHaveBeenCalledTimes(1);
    expect(mockDispatch.mock.calls[0][0]).toEqual(expect.objectContaining({ type: 'GO_BACK' }));
    expect(mockGoBack).toHaveBeenCalledTimes(1);
    expect(preventRemoveEnabled).toBe(false);
    alert.spy.mockRestore();
    await act(async () => {
      tree.unmount();
    });
  });

  it('header Back Go back leaves the gate armed for the next removal', async () => {
    const alert = mockLeaveAlert();
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(<SettingsScreen />);
    });
    await exportRecovery(tree);
    await act(async () => {
      tree.root.findByProps({ testID: 'settingsBack' }).props.onPress();
    });
    expect(alert.spy).toHaveBeenCalledTimes(1);
    await act(async () => {
      alert.captured.buttons.find(button => button.text === COPY.goBack)?.onPress?.();
    });
    expect(preventRemoveEnabled).toBe(true);
    expect(mockDispatch).not.toHaveBeenCalled();
    expect(mockGoBack).not.toHaveBeenCalled();
    await act(async () => {
      tree.root.findByProps({ testID: 'settingsBack' }).props.onPress();
    });
    expect(alert.spy).toHaveBeenCalledTimes(2);
    expect(mockDispatch).not.toHaveBeenCalled();
    expect(preventRemoveEnabled).toBe(true);
    alert.spy.mockRestore();
    await act(async () => {
      tree.unmount();
    });
  });

  it('hardware Back Leave anyway removes once without a second prompt', async () => {
    const alert = mockLeaveAlert();
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
    await exportRecovery(tree);
    expect(backPress?.()).toBe(true);
    expect(alert.spy).toHaveBeenCalledTimes(1);
    await act(async () => {
      alert.captured.buttons.find(button => button.text === COPY.leaveAnyway)?.onPress?.();
    });
    expect(alert.spy).toHaveBeenCalledTimes(1);
    expect(mockDispatch).toHaveBeenCalledTimes(1);
    expect(mockDispatch.mock.calls[0][0]).toEqual(expect.objectContaining({ type: 'GO_BACK' }));
    expect(mockGoBack).toHaveBeenCalledTimes(1);
    expect(preventRemoveEnabled).toBe(false);
    addSpy.mockRestore();
    alert.spy.mockRestore();
    await act(async () => {
      tree.unmount();
    });
  });

  it('hardware Back Go back leaves the gate armed for the next removal', async () => {
    const alert = mockLeaveAlert();
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
    await exportRecovery(tree);
    expect(backPress?.()).toBe(true);
    expect(alert.spy).toHaveBeenCalledTimes(1);
    await act(async () => {
      alert.captured.buttons.find(button => button.text === COPY.goBack)?.onPress?.();
    });
    expect(preventRemoveEnabled).toBe(true);
    expect(mockDispatch).not.toHaveBeenCalled();
    expect(backPress?.()).toBe(true);
    expect(alert.spy).toHaveBeenCalledTimes(2);
    expect(mockDispatch).not.toHaveBeenCalled();
    expect(preventRemoveEnabled).toBe(true);
    addSpy.mockRestore();
    alert.spy.mockRestore();
    await act(async () => {
      tree.unmount();
    });
  });

  it('prompts again after Leave anyway then a second Backup now', async () => {
    const alert = mockLeaveAlert();
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(<SettingsScreen />);
    });
    await exportRecovery(tree);
    await act(async () => {
      tree.root.findByProps({ testID: 'settingsBack' }).props.onPress();
    });
    await act(async () => {
      alert.captured.buttons.find(button => button.text === COPY.leaveAnyway)?.onPress?.();
    });
    expect(alert.spy).toHaveBeenCalledTimes(1);
    await exportRecovery(tree);
    await act(async () => {
      tree.root.findByProps({ testID: 'settingsBack' }).props.onPress();
    });
    expect(alert.spy).toHaveBeenCalledTimes(2);
    alert.spy.mockRestore();
    await act(async () => {
      tree.unmount();
    });
  });

  it('drops a second removal while the leave prompt is already visible', async () => {
    const alert = mockLeaveAlert();
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(<SettingsScreen />);
    });
    await exportRecovery(tree);
    await act(async () => {
      tree.root.findByProps({ testID: 'settingsBack' }).props.onPress();
    });
    expect(alert.spy).toHaveBeenCalledTimes(1);
    const resetAction = { type: 'RESET' };
    await act(async () => {
      preventRemoveCallback?.({ data: { action: resetAction } });
    });
    expect(alert.spy).toHaveBeenCalledTimes(1);
    expect(mockDispatch).not.toHaveBeenCalled();
    alert.spy.mockRestore();
    await act(async () => {
      tree.unmount();
    });
  });

  it('prompts again after the leave alert is dismissed without a button', async () => {
    const alert = mockLeaveAlert();
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(<SettingsScreen />);
    });
    await exportRecovery(tree);
    await act(async () => {
      tree.root.findByProps({ testID: 'settingsBack' }).props.onPress();
    });
    expect(alert.spy).toHaveBeenCalledTimes(1);
    expect(alert.spy.mock.calls[0]?.[3]).toEqual(
      expect.objectContaining({ cancelable: true, onDismiss: expect.any(Function) }),
    );
    await act(async () => {
      alert.captured.options?.onDismiss?.();
    });
    await act(async () => {
      tree.root.findByProps({ testID: 'settingsBack' }).props.onPress();
    });
    expect(alert.spy).toHaveBeenCalledTimes(2);
    expect(mockDispatch).not.toHaveBeenCalled();
    alert.spy.mockRestore();
    await act(async () => {
      tree.unmount();
    });
  });
});

describe('SettingsScreen backup KeyStoreNotReady', () => {
  beforeEach(() => {
    mockGoBack.mockReset();
    mockDispatch.mockReset();
    mockSetOptions.mockReset();
    preventRemoveEnabled = false;
    preventRemoveCallback = undefined;
    mockVisitedActions = new WeakSet<object>();
  });

  it('sanitizes KeyStoreNotReady on backup export', async () => {
    (BackupService.exportBackup as jest.Mock).mockRejectedValueOnce(
      Object.assign(new Error('KeyStore.getPubky: encrypted store is not ready'), {
        name: 'KeyStoreNotReady',
        code: 'KeyStoreNotReady',
      }),
    );
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(<SettingsScreen />);
    });
    await exportRecovery(tree);
    expect(tree.root.findByProps({ children: 'Could not create a backup.' })).toBeTruthy();
    await act(async () => {
      tree.root.findByProps({ accessibilityLabel: 'Show details' }).props.onPress();
    });
    expect(tree.root.findByProps({ testID: 'errorDetailsBody' }).props.children).toBe(
      '[host]: encrypted store is not ready',
    );
    await act(async () => {
      tree.unmount();
    });
  });

  it('sanitizes KeyStoreNotReady on backup restore', async () => {
    (BackupService.restoreBackup as jest.Mock).mockRejectedValueOnce(
      Object.assign(new Error('KeyStore.getPubky: encrypted store is not ready'), {
        name: 'KeyStoreNotReady',
        code: 'KeyStoreNotReady',
      }),
    );
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(<SettingsScreen />);
    });
    await act(async () => {
      tree.root
        .findByProps({ placeholder: 'Paste recovery code to restore' })
        .props.onChangeText('recovery-code');
    });
    await act(async () => {
      tree.root.findByProps({ accessibilityLabel: 'Restore from backup' }).props.onPress();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(tree.root.findByProps({ children: 'That recovery code did not work.' })).toBeTruthy();
    await act(async () => {
      tree.root.findByProps({ accessibilityLabel: 'Show details' }).props.onPress();
    });
    expect(tree.root.findByProps({ testID: 'errorDetailsBody' }).props.children).toBe(
      '[host]: encrypted store is not ready',
    );
    await act(async () => {
      tree.unmount();
    });
  });
});

describe('SettingsScreen section routes', () => {
  beforeEach(() => {
    mockRoute.params = {};
    mockSetParams.mockReset();
    jest.mocked(scrollSettingsToSection).mockClear();
    jest.mocked(focusSettingsSection).mockClear();
    (BackupService.exportBackup as jest.Mock).mockResolvedValue({
      recoveryCode: 'alpha-bravo-charlie',
    });
  });

  it('scrolls and marks Encrypted backup when opened with section=backup', async () => {
    mockRoute.params = { section: 'backup' };
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(<SettingsScreen />);
    });
    await act(async () => {
      tree.root
        .findByProps({ testID: 'settingsFocusBackup' })
        .props.onLayout({ nativeEvent: { layout: { y: 240, x: 0, width: 320, height: 400 } } });
    });
    expect(
      tree.root.findByProps({ testID: 'settingsFocusBackup' }).props.accessibilityState.selected,
    ).toBe(true);
    expect(
      tree.root.findByProps({ testID: 'settingsFocusPayments' }).props.accessibilityState.selected,
    ).toBe(false);
    expect(scrollSettingsToSection).toHaveBeenCalledWith(expect.anything(), 240, false);
    expect(focusSettingsSection).toHaveBeenCalled();
    expect(mockSetParams).toHaveBeenCalledWith({ section: undefined });
    await act(async () => {
      tree.unmount();
    });
  });

  it('scrolls and marks tip endpoints when opened with section=payments', async () => {
    mockRoute.params = { section: 'payments' };
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(<SettingsScreen />);
    });
    await act(async () => {
      tree.root
        .findByProps({ testID: 'settingsFocusPayments' })
        .props.onLayout({ nativeEvent: { layout: { y: 720, x: 0, width: 320, height: 200 } } });
    });
    expect(
      tree.root.findByProps({ testID: 'settingsFocusPayments' }).props.accessibilityState.selected,
    ).toBe(true);
    expect(
      tree.root.findByProps({ testID: 'settingsFocusBackup' }).props.accessibilityState.selected,
    ).toBe(false);
    expect(scrollSettingsToSection).toHaveBeenCalledWith(expect.anything(), 720, false);
    expect(focusSettingsSection).toHaveBeenCalled();
    expect(mockSetParams).toHaveBeenCalledWith({ section: undefined });
    await act(async () => {
      tree.unmount();
    });
  });

  it('does not steal focus after Backup now opens the recovery gate', async () => {
    mockRoute.params = { section: 'backup' };
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(<SettingsScreen />);
    });
    await act(async () => {
      tree.root
        .findByProps({ testID: 'settingsFocusBackup' })
        .props.onLayout({ nativeEvent: { layout: { y: 240, x: 0, width: 320, height: 400 } } });
    });
    expect(focusSettingsSection).toHaveBeenCalled();
    jest.mocked(focusSettingsSection).mockClear();
    jest.mocked(scrollSettingsToSection).mockClear();

    await act(async () => {
      tree.root.findByProps({ accessibilityLabel: 'Backup now' }).props.onPress();
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      tree.root
        .findByProps({ testID: 'settingsFocusBackup' })
        .props.onLayout({ nativeEvent: { layout: { y: 240, x: 0, width: 320, height: 640 } } });
    });
    expect(focusSettingsSection).not.toHaveBeenCalled();
    expect(scrollSettingsToSection).not.toHaveBeenCalled();
    await act(async () => {
      tree.unmount();
    });
  });
});
