import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import WelcomeScreen from '../WelcomeScreen';
import { PubkyRingAuthService } from '../../../services/PubkyRingAuthService';

const PAYKIT_CONNECT_URL =
  'pubkyring://paykit-connect?deviceId=hypercolor-sim&callback=hypercolor%3A%2F%2Fring-callback&ephemeralPk=aabbcc&caps=%2Fpub%2Fpaykit%2F%3Arw%2C%2Fpub%2Fhypercolor.app%2Fv1%2F%3Arw';

const mockNavigate = jest.fn();

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
}));

jest.mock('../../../services/PubkyRingAuthService', () => ({
  PubkyRingAuthService: {
    requestDelegation: jest.fn(),
  },
}));

jest.mock('../DebugSignupPanel', () => ({
  DebugSignupPanel: () => null,
}));

describe('WelcomeScreen', () => {
  it('navigates to AwaitingRingAuth with the paykit-connect URL', async () => {
    (PubkyRingAuthService.requestDelegation as jest.Mock).mockResolvedValue({
      url: PAYKIT_CONNECT_URL,
    });

    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(<WelcomeScreen />);
    });
    await act(async () => {
      tree.root.findByProps({ testID: 'welcomeConnectRing' }).props.onPress();
    });

    expect(PubkyRingAuthService.requestDelegation).toHaveBeenCalledWith(
      expect.stringMatching(/^hypercolor-[0-9a-f]+$/),
    );
    expect(mockNavigate).toHaveBeenCalledWith('AwaitingRingAuth', {
      ringAuthUrl: PAYKIT_CONNECT_URL,
    });
    await act(async () => {
      tree.unmount();
    });
  });
});
