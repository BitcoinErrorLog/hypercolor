import { Alert } from 'react-native';
import { COPY } from '../../copy/uxCopy';
import { copyText } from '../../utils/copyText';
import {
  COPY_MESSAGE_A11Y_ACTION,
  handleCopyAccessibilityAction,
  presentMessageCopySheet,
} from '../messageCopyActions';

jest.mock('../../utils/copyText', () => ({
  copyText: jest.fn(),
}));

describe('messageCopyActions', () => {
  beforeEach(() => {
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    jest.mocked(copyText).mockReset();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('copies from the long-press sheet action, not a permanent link', () => {
    presentMessageCopySheet('hello bubble');
    expect(Alert.alert).toHaveBeenCalledWith(
      COPY.copyMessage,
      undefined,
      expect.arrayContaining([
        expect.objectContaining({ text: COPY.cancel, style: 'cancel' }),
        expect.objectContaining({ text: COPY.copyMessage }),
      ]),
    );
    const buttons = jest.mocked(Alert.alert).mock.calls[0]?.[2] as Array<{
      text: string;
      onPress?: () => void;
    }>;
    buttons.find(btn => btn.text === COPY.copyMessage)?.onPress?.();
    expect(copyText).toHaveBeenCalledWith('hello bubble');
  });

  it('honours the copy accessibilityAction', () => {
    expect(COPY_MESSAGE_A11Y_ACTION).toEqual({ name: 'copy', label: COPY.copyMessage });
    handleCopyAccessibilityAction('copy', 'from a11y');
    expect(copyText).toHaveBeenCalledWith('from a11y');
    handleCopyAccessibilityAction('activate', 'from a11y');
    expect(copyText).toHaveBeenCalledTimes(1);
  });
});
