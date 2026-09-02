import { FollowsImportSettings } from '../followsImportSettings';
import { StorageService } from '../../StorageService';

type MmState = {
  data: Map<string, string>;
  getThrows: boolean;
  setThrows: boolean;
  unavailable: boolean;
};

const mmkvState: MmState = ((globalThis as unknown as { __hcMmkv?: MmState }).__hcMmkv ??= {
  data: new Map<string, string>(),
  getThrows: false,
  setThrows: false,
  unavailable: false,
});

jest.mock('react-native-mmkv', () => ({
  createMMKV: () => {
    const state = (globalThis as unknown as { __hcMmkv: MmState }).__hcMmkv;
    if (state.unavailable) throw new Error('mmkv unavailable');
    return {
      getString(key: string) {
        if (state.getThrows) throw new Error('mmkv read failed');
        return state.data.get(key);
      },
      set(key: string, value: string) {
        if (state.setThrows) throw new Error('mmkv write failed');
        state.data.set(key, value);
      },
      remove(key: string) {
        state.data.delete(key);
      },
    };
  },
}));

jest.mock('../../StorageService', () => ({
  StorageService: {
    insertBlockedPeer: jest.fn(),
    insertBlockedPeers: jest.fn(),
    deleteBlockedPeer: jest.fn(),
    listBlockedPeers: jest.fn(),
  },
}));

const mockedStorage = jest.mocked(StorageService);

const OWNER = 'operrr8wsbpr3ue9d4qj41ge1kcc6r7fdiy6o3ugjrrhi4y77rdo';
const OWNER_B = 'gcumbhd7sqit6nn457jxmrwqx9pyymqwamnarekgo3xppqo6a19o';
const PEER = 'pxnu33x7jtpx9ar1ytsi4yxbp6a5o36gwhffs8zoxmbuptici1jy';
const PEER_B = 'kyp7qac797z86bngq9g3ajqbrsgsb3tibayndqi6fe4cqi3gb6ry';

function wireSql(rows: Map<string, Set<string>>): void {
  mockedStorage.insertBlockedPeer.mockImplementation(async (owner, peer) => {
    const set = rows.get(owner) ?? new Set<string>();
    set.add(peer);
    rows.set(owner, set);
  });
  mockedStorage.insertBlockedPeers.mockImplementation(async (owner, peers) => {
    const set = rows.get(owner) ?? new Set<string>();
    for (const peer of peers) set.add(peer);
    rows.set(owner, set);
  });
  mockedStorage.deleteBlockedPeer.mockImplementation(async (owner, peer) => {
    rows.get(owner)?.delete(peer);
  });
  mockedStorage.listBlockedPeers.mockImplementation(async owner => [...(rows.get(owner) ?? [])]);
}

describe('FollowsImportSettings', () => {
  let rows: Map<string, Set<string>>;

  beforeEach(() => {
    FollowsImportSettings.resetForTests();
    mmkvState.data = new Map();
    mmkvState.getThrows = false;
    mmkvState.setThrows = false;
    mmkvState.unavailable = false;
    rows = new Map();
    wireSql(rows);
  });

  it('defaults follows import off', () => {
    expect(FollowsImportSettings.getFollowsImportEnabled(OWNER)).toBe(false);
  });

  it('persists an opt-in and can turn it off again', () => {
    FollowsImportSettings.setFollowsImportEnabled(OWNER, true);
    expect(FollowsImportSettings.getFollowsImportEnabled(OWNER)).toBe(true);
    FollowsImportSettings.setFollowsImportEnabled(OWNER, false);
    expect(FollowsImportSettings.getFollowsImportEnabled(OWNER)).toBe(false);
  });

  it('scopes consent per owner', () => {
    FollowsImportSettings.setFollowsImportEnabled(OWNER, true);
    expect(FollowsImportSettings.getFollowsImportEnabled(OWNER_B)).toBe(false);
  });

  it('stores a local block list per owner', async () => {
    expect(FollowsImportSettings.isBlocked(OWNER, PEER)).toBe(false);
    await FollowsImportSettings.block(OWNER, PEER);
    expect(FollowsImportSettings.isBlocked(OWNER, PEER)).toBe(true);
    expect(FollowsImportSettings.isPeerDenied(OWNER, PEER)).toBe(true);
    expect(FollowsImportSettings.isBlocked(OWNER_B, PEER)).toBe(false);
    await FollowsImportSettings.unblock(OWNER, PEER);
    expect(FollowsImportSettings.isBlocked(OWNER, PEER)).toBe(false);
    expect(FollowsImportSettings.getDenyState(OWNER, PEER)).toBe('clear');
  });

  it('throws and does not cache a deny when the durable write fails', async () => {
    mockedStorage.insertBlockedPeer.mockRejectedValue(new Error('sqlite locked'));
    await expect(FollowsImportSettings.block(OWNER, PEER)).rejects.toThrow('sqlite locked');
    expect(FollowsImportSettings.isBlocked(OWNER, PEER)).toBe(false);
    expect(FollowsImportSettings.isPeerDenied(OWNER, PEER)).toBe(true);
    expect(FollowsImportSettings.getDenyState(OWNER, PEER)).toBe('unavailable');
  });

  it('treats a throwing SQL read as unavailable, never an empty set', async () => {
    mockedStorage.listBlockedPeers.mockRejectedValue(new Error('sqlite locked'));
    expect(await FollowsImportSettings.hydrate(OWNER)).toBe('unavailable');
    expect(FollowsImportSettings.getDenyState(OWNER, PEER)).toBe('unavailable');
    expect(FollowsImportSettings.isBlocked(OWNER, PEER)).toBe(false);
    expect(FollowsImportSettings.isPeerDenied(OWNER, PEER)).toBe(true);
  });

  it('treats malformed leftover MMKV deny JSON as unavailable', async () => {
    mmkvState.data.set(`blocked:${OWNER}`, '{not-json');
    expect(await FollowsImportSettings.hydrate(OWNER)).toBe('unavailable');
    expect(FollowsImportSettings.isPeerDenied(OWNER, PEER)).toBe(true);
    expect(FollowsImportSettings.isBlocked(OWNER, PEER)).toBe(false);
    expect(mockedStorage.insertBlockedPeers).not.toHaveBeenCalled();
  });

  it('treats a throwing MMKV deny read as unavailable', async () => {
    mmkvState.getThrows = true;
    expect(await FollowsImportSettings.hydrate(OWNER)).toBe('unavailable');
    expect(FollowsImportSettings.isPeerDenied(OWNER, PEER)).toBe(true);
  });

  it('still persists a deny when MMKV is unavailable', async () => {
    mmkvState.unavailable = true;
    await FollowsImportSettings.block(OWNER, PEER);
    expect(rows.get(OWNER)?.has(PEER)).toBe(true);
    expect(FollowsImportSettings.isBlocked(OWNER, PEER)).toBe(true);
  });

  it('migrates leftover MMKV deny entries into SQL once, then deletes the key', async () => {
    mmkvState.data.set(`blocked:${OWNER}`, JSON.stringify([PEER, PEER_B]));
    expect(await FollowsImportSettings.resolveDenyState(OWNER, PEER)).toBe('denied');
    expect(await FollowsImportSettings.resolveDenyState(OWNER, PEER_B)).toBe('denied');
    expect(mockedStorage.insertBlockedPeers).toHaveBeenCalledWith(OWNER, [PEER, PEER_B]);
    expect(mmkvState.data.has(`blocked:${OWNER}`)).toBe(false);
  });

  it('does not delete the MMKV key when SQL migrate insert throws', async () => {
    mmkvState.data.set(`blocked:${OWNER}`, JSON.stringify([PEER]));
    mockedStorage.insertBlockedPeers.mockRejectedValue(new Error('sqlite locked'));
    expect(await FollowsImportSettings.hydrate(OWNER)).toBe('unavailable');
    expect(mmkvState.data.get(`blocked:${OWNER}`)).toBe(JSON.stringify([PEER]));
  });

  it('reloads deny rows after a cache clear (fresh module memory, same SQL)', async () => {
    await FollowsImportSettings.block(OWNER, PEER);
    FollowsImportSettings.clearSessionMemory();
    expect(FollowsImportSettings.isBlocked(OWNER, PEER)).toBe(false);
    expect(FollowsImportSettings.isPeerDenied(OWNER, PEER)).toBe(true);
    expect(await FollowsImportSettings.resolveDenyState(OWNER, PEER)).toBe('denied');
    expect(FollowsImportSettings.isBlocked(OWNER, PEER)).toBe(true);
  });

  it('survives relaunch: resetForTests then hydrate the same SQL rows', async () => {
    await FollowsImportSettings.block(OWNER, PEER);
    FollowsImportSettings.resetForTests();
    expect(FollowsImportSettings.isBlocked(OWNER, PEER)).toBe(false);
    expect(FollowsImportSettings.getDenyState(OWNER, PEER)).toBe('unavailable');
    expect(await FollowsImportSettings.hydrate(OWNER)).toBe('clear');
    expect(FollowsImportSettings.isBlocked(OWNER, PEER)).toBe(true);
    expect(FollowsImportSettings.getDenyState(OWNER, PEER)).toBe('denied');
  });

  it('persists cleanup-pending per owner until cleared', () => {
    expect(FollowsImportSettings.isBlockCleanupPending(OWNER, PEER)).toBe(false);
    FollowsImportSettings.markBlockCleanupPending(OWNER, PEER);
    expect(FollowsImportSettings.isBlockCleanupPending(OWNER, PEER)).toBe(true);
    expect(FollowsImportSettings.isBlockCleanupPending(OWNER_B, PEER)).toBe(false);
    FollowsImportSettings.clearBlockCleanupPending(OWNER, PEER);
    expect(FollowsImportSettings.isBlockCleanupPending(OWNER, PEER)).toBe(false);
  });

  it('re-reads durable MMKV consent after session memory is cleared', () => {
    FollowsImportSettings.setFollowsImportEnabled(OWNER, true);
    FollowsImportSettings.clearSessionMemory();
    expect(FollowsImportSettings.getFollowsImportEnabled(OWNER)).toBe(true);
    expect(FollowsImportSettings.getFollowsImportEnabled(OWNER_B)).toBe(false);
  });

  it('fail-closes consent lookups after session memory is cleared when MMKV is gone', () => {
    FollowsImportSettings.setFollowsImportEnabled(OWNER, true);
    FollowsImportSettings.clearSessionMemory();
    mmkvState.unavailable = true;
    FollowsImportSettings.resetForTests();
    mmkvState.unavailable = true;
    expect(FollowsImportSettings.getFollowsImportEnabled(OWNER)).toBe(false);
    expect(FollowsImportSettings.getFollowsImportEnabled(OWNER_B)).toBe(false);
  });
});
