/**
 * Crash between deny commit and cleanup: SQL cleanup_pending survives
 * relaunch and Contact detail still shows Retry.
 */
jest.mock('@op-engineering/op-sqlite', () => ({
  open: () => {
    throw new Error('op-sqlite must not be used in the SQL integration test');
  },
}));

jest.mock('../../../../services/KeyStore', () => ({
  KeyStore: {
    deleteAttachmentSecrets: jest.fn().mockResolvedValue([]),
    clearAttachmentSecretsForOwner: jest.fn().mockResolvedValue([]),
    deleteAttachmentSecretByService: jest.fn().mockResolvedValue(true),
  },
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 12, left: 0, right: 0 }),
}));

import React from 'react';
import { act, create } from 'react-test-renderer';
import { setDbForTests } from '../../../../db';
import { runMigrations } from '../../../../db/migrations';
import { openMemoryDb } from '../../../../db/__tests__/betterSqliteAdapter';
import { StorageService } from '../../../../services/StorageService';
import { paintOwner } from '../../../../services/paintedOwner';
import { FollowsImportSettings } from '../../../../services/contacts/followsImportSettings';
import { CONTACTS_COPY } from '../../../../ui/contacts/contactsCopy';
import { ContactDetailView } from '../ContactDetailView';

const OWNER = 'operrr8wsbpr3ue9d4qj41ge1kcc6r7fdiy6o3ugjrrhi4y77rdo';
const PEER = 'pxnu33x7jtpx9ar1ytsi4yxbp6a5o36gwhffs8zoxmbuptici1jy';
const noop = () => undefined;

describe('cleanup-pending relaunch', () => {
  let db: ReturnType<typeof openMemoryDb> | null = null;

  beforeEach(async () => {
    FollowsImportSettings.resetForTests();
    db = openMemoryDb();
    setDbForTests(db);
    await runMigrations(db);
    paintOwner(OWNER);
  });

  afterEach(() => {
    FollowsImportSettings.resetForTests();
    db?.close();
    db = null;
    setDbForTests(null);
  });

  it('shows Blocked · cleanup pending and Retry after a crash-shaped relaunch', async () => {
    await StorageService.insertBlockedPeer(OWNER, PEER);
    expect(await StorageService.listBlockedPeerCleanupPending(OWNER)).toEqual([PEER]);

    FollowsImportSettings.resetForTests();
    expect(FollowsImportSettings.isBlockCleanupPending(OWNER, PEER)).toBe(false);

    expect(await FollowsImportSettings.hydrate(OWNER)).toBe('clear');
    expect(FollowsImportSettings.isBlocked(OWNER, PEER)).toBe(true);
    expect(FollowsImportSettings.isBlockCleanupPending(OWNER, PEER)).toBe(true);

    let tree: ReturnType<typeof create> | undefined;
    await act(async () => {
      tree = create(
        <ContactDetailView
          pubky={PEER}
          contact={null}
          loading={false}
          loadError={null}
          loadErrorDetails={null}
          trust={null}
          linkLabel="No encrypted link yet"
          paymentIdentifiers={[]}
          paymentsUnavailableOffline={false}
          followsImportEnabled={false}
          blocked
          cleanupPending={FollowsImportSettings.isBlockCleanupPending(OWNER, PEER)}
          onBack={noop}
          onMessage={noop}
          onCopy={noop}
          onShare={noop}
          onRetry={noop}
          onBlock={noop}
          onUnblock={noop}
          onRemove={noop}
        />,
      );
    });
    const json = JSON.stringify(tree!.toJSON());
    expect(json).toContain(CONTACTS_COPY.blockedCleanupPending);
    expect(tree!.root.findByProps({ testID: 'contactErrorRetry' })).toBeTruthy();
    await act(async () => {
      tree!.unmount();
    });
  });
});
