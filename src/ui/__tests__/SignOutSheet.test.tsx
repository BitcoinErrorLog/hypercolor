import React from 'react';
import { act, create } from 'react-test-renderer';
import { SignOutSheet } from '../SignOutSheet';
import { COPY, lastBackupLine } from '../../copy/uxCopy';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 12, left: 0, right: 0 }),
}));

describe('SignOutSheet', () => {
  it('states what is wiped locally versus what Ring holds', async () => {
    let tree!: ReturnType<typeof create>;
    await act(async () => {
      tree = create(
        <SignOutSheet
          visible
          lastBackupRelative={null}
          onCancel={jest.fn()}
          onConfirm={jest.fn()}
        />,
      );
    });
    const json = JSON.stringify(tree.toJSON());
    expect(json).toContain(COPY.signOutTitle);
    expect(json).toContain(COPY.signOutBodyLocal);
    expect(json).toContain(COPY.signOutBodyRing);
    expect(json).toContain(COPY.signOutNoBackup);
    expect(json).not.toMatch(/pubky-ring/);
    await act(async () => {
      tree.unmount();
    });
  });

  it('names the last backup when one exists', async () => {
    let tree!: ReturnType<typeof create>;
    await act(async () => {
      tree = create(
        <SignOutSheet
          visible
          lastBackupRelative="2 hours ago"
          onCancel={jest.fn()}
          onConfirm={jest.fn()}
        />,
      );
    });
    expect(JSON.stringify(tree.toJSON())).toContain(lastBackupLine('2 hours ago'));
    await act(async () => {
      tree.unmount();
    });
  });

  it('keeps the sheet open and shows a sanitized failure', async () => {
    let tree!: ReturnType<typeof create>;
    await act(async () => {
      tree = create(
        <SignOutSheet
          visible
          lastBackupRelative={null}
          busy={false}
          error={{ message: COPY.couldNotSignOut, details: '[url]' }}
          onCancel={jest.fn()}
          onConfirm={jest.fn()}
        />,
      );
    });
    const json = JSON.stringify(tree.toJSON());
    expect(json).toContain(COPY.couldNotSignOut);
    expect(json).toContain('Details');
    expect(json).toContain(COPY.signOutTitle);
    await act(async () => {
      tree.unmount();
    });
  });
});
