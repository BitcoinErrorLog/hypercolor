import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

const OWNER = 'a'.repeat(52);
const mockClearSession = jest.fn();
const mockNavigate = jest.fn();

jest.mock('react-native-mmkv', () => ({
  createMMKV: () => {
    const data = new Map<string, string>();
    return {
      set: (key: string, value: string) => {
        data.set(key, value);
      },
      getString: (key: string) => data.get(key),
      contains: (key: string) => data.has(key),
      remove: (key: string) => {
        data.delete(key);
      },
    };
  },
}));

jest.mock('react-native-keychain', () => ({
  getGenericPassword: jest.fn(),
  setGenericPassword: jest.fn(),
  resetGenericPassword: jest.fn(),
  ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY' },
}));

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
  useFocusEffect: () => undefined,
}));

jest.mock('../../../stores/authStore', () => ({
  useAuthStore: Object.assign(
    () => ({
      profile: { pubky: 'a'.repeat(52), displayName: 'Me', updatedAt: 1 },
      pubky: 'a'.repeat(52),
      setProfile: jest.fn(),
      clearSession: () => mockClearSession(),
    }),
    { getState: () => ({ pubky: 'a'.repeat(52) }) },
  ),
}));

jest.mock('../../../stores/sessionStatusStore', () => ({
  useSessionStatusStore: (sel: (s: { kind: string }) => unknown) => sel({ kind: 'enabled' }),
}));

jest.mock('../../../services/PubkyService', () => ({
  PubkyService: {
    signOut: jest.fn().mockResolvedValue(undefined),
    getProfile: jest.fn().mockResolvedValue(null),
  },
}));

jest.mock('../../../stores/backupMetaStore', () => ({
  getLastBackupAt: jest.fn(() => null),
  formatRelativeBackupTime: jest.fn(() => 'just now'),
  clearLastBackupAt: jest.fn(),
}));

jest.mock('../../auth/DebugSignupPanel', () => ({
  DebugSignupPanel: () => null,
}));

jest.mock('../../../ui/CustodyLine', () => ({
  CustodyLine: () => null,
}));

jest.mock('../../../navigation/e2eSignupResult', () => ({
  getE2eIdentity: () => null,
}));

jest.mock('../../../navigation/e2eDeepLinks', () => ({
  switchE2eSavedSlotFromUi: jest.fn(),
}));

jest.mock('../../../utils/copyText', () => ({
  copyText: jest.fn(),
}));

import ProfileScreen from '../ProfileScreen';
import { PubkyService } from '../../../services/PubkyService';
import { activeOwnerAtCommit, paintOwner, SIGNING_OUT } from '../../../services/paintedOwner';
import { clearLastBackupAt } from '../../../stores/backupMetaStore';

describe('ProfileScreen sign-out', () => {
  let tree: ReactTestRenderer | null = null;

  beforeEach(() => {
    mockClearSession.mockReset();
    mockNavigate.mockReset();
    jest.mocked(PubkyService.signOut).mockResolvedValue(undefined);
    jest.mocked(clearLastBackupAt).mockReset();
    paintOwner(OWNER);
  });

  afterEach(() => {
    if (tree) {
      act(() => {
        tree!.unmount();
      });
      tree = null;
    }
    jest.clearAllTimers();
  });

  it('does not repaint the owner when post-sign-out housekeeping throws', async () => {
    jest.mocked(clearLastBackupAt).mockImplementation(() => {
      throw new Error('mmkv delete');
    });
    await act(async () => {
      tree = create(<ProfileScreen />);
    });
    await act(async () => {
      tree!.root.findByProps({ testID: 'profileSignOut' }).props.onPress();
    });
    await act(async () => {
      tree!.root.findByProps({ testID: 'signOutConfirm' }).props.onPress();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(PubkyService.signOut).toHaveBeenCalled();
    expect(activeOwnerAtCommit()).toBe(SIGNING_OUT);
    expect(mockClearSession).not.toHaveBeenCalled();
  });
});
