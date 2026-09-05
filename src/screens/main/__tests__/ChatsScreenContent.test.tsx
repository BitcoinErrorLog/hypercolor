import React from 'react';
import { act, create } from 'react-test-renderer';
import { ChatsScreenContent } from '../ChatsScreenContent';

jest.mock('../../../services/link/LinkService', () => ({
  LinkService: { takeoverReceiver: jest.fn() },
}));

const noop = () => undefined;

describe('ChatsScreenContent wiring', () => {
  it('forwards new-chat press from the header control', () => {
    const onNewChat = jest.fn();
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(
        <ChatsScreenContent
          conversations={[]}
          contacts={{}}
          pendingRequests={0}
          ownerPubky={null}
          needsEnable={false}
          showEnableCta={false}
          listError={null}
          onOpenThread={noop}
          onOpenRequests={noop}
          onNewChat={onNewChat}
          onEnableMessaging={noop}
          onRetry={noop}
          onCopyMyPubky={noop}
          onShareMyPubky={noop}
        />,
      );
    });
    expect(tree.root.findByProps({ testID: 'chatsScreen' })).toBeTruthy();
    act(() => {
      tree.root.findByProps({ testID: 'chatsNew' }).props.onPress();
    });
    expect(onNewChat).toHaveBeenCalledTimes(1);
  });
});
