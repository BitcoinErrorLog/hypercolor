import { Alert, type AlertButton } from 'react-native';
import { COPY } from '../../copy/uxCopy';
import { LinkService } from '../../services/link/LinkService';
import {
  confirmReceiverTakeover,
  resetReceiverTakeoverLatchForTests,
} from '../confirmReceiverTakeover';

jest.mock('../../services/link/LinkService', () => ({
  LinkService: {
    takeoverReceiver: jest.fn(),
  },
}));

describe('confirmReceiverTakeover', () => {
  beforeEach(() => {
    resetReceiverTakeoverLatchForTests();
    jest.restoreAllMocks();
    (LinkService.takeoverReceiver as jest.Mock).mockReset();
  });

  afterEach(() => {
    resetReceiverTakeoverLatchForTests();
  });

  it('does not PUT twice when confirm is pressed twice', async () => {
    let resolveTakeover!: () => void;
    const hung = new Promise<void>(resolve => {
      resolveTakeover = resolve;
    });
    (LinkService.takeoverReceiver as jest.Mock).mockReturnValue(hung);

    const alerts: AlertButton[][] = [];
    jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, next) => {
      alerts.push(next ?? []);
    });

    confirmReceiverTakeover({ mode: 'takeover' });
    confirmReceiverTakeover({ mode: 'takeover' });
    expect(alerts).toHaveLength(1);

    const primary = alerts[0]!.find(button => button.text === COPY.standbyPrimary);
    primary?.onPress?.();
    primary?.onPress?.();

    expect(LinkService.takeoverReceiver).toHaveBeenCalledTimes(1);
    resolveTakeover();
    await hung;
    await Promise.resolve();
  });
});
