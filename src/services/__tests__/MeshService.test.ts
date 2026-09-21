const mockGetFlag = jest.fn((key: string) => key !== 'mesh_transport');
const mockGetTransportKeypair = jest.fn();
const mockSetTransportKeypair = jest.fn();
const mockX25519 = jest.fn();
const mockDeriveNoiseSeed = jest.fn();
const mockDeriveX25519 = jest.fn();
const mockStartAdvertising = jest.fn();
const mockStopAll = jest.fn();

jest.mock('../../flags', () => ({
  FeatureFlags: {
    get: (key: string) => mockGetFlag(key),
  },
}));

jest.mock('../KeyStore', () => ({
  KeyStore: {
    getTransportKeypair: (...args: unknown[]) => mockGetTransportKeypair(...args),
    setTransportKeypair: (...args: unknown[]) => mockSetTransportKeypair(...args),
  },
}));

jest.mock('../../utils/PubkyNoiseModule', () => ({
  createClientManager: jest.fn(),
  createServerManager: jest.fn(),
  initiateConnection: jest.fn(),
  acceptConnection: jest.fn(),
  completeConnection: jest.fn(),
  encrypt: jest.fn(),
  decrypt: jest.fn(),
  destroyManager: jest.fn(),
  x25519GenerateKeypair: (...args: unknown[]) => mockX25519(...args),
  deriveNoiseSeed: (...args: unknown[]) => mockDeriveNoiseSeed(...args),
  deriveX25519ForDeviceEpoch: (...args: unknown[]) => mockDeriveX25519(...args),
}));

jest.mock('../../../modules/mesh-transport/src', () => ({
  MeshTransport: {
    addPeerDiscoveredListener: jest.fn(() => ({ remove: jest.fn() })),
    addPeerLostListener: jest.fn(() => ({ remove: jest.fn() })),
    addMessageReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
    startAdvertising: (...args: unknown[]) => mockStartAdvertising(...args),
    stopAll: (...args: unknown[]) => mockStopAll(...args),
  },
}));

jest.mock('../StorageService', () => ({ StorageService: {} }));
jest.mock('../contacts/followsImportSettings', () => ({ FollowsImportSettings: {} }));

import { MeshService } from '../MeshService';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const OWNER = 'gcumbhd7sqit6nn457jxmrwqx9pyymqwamnarekgo3xppqo6a19o';

describe('MeshService local key', () => {
  afterEach(async () => {
    await MeshService.stop();
    jest.clearAllMocks();
    mockGetFlag.mockImplementation((key: string) => key !== 'mesh_transport');
  });

  it('no-ops when mesh_transport is off without reading KeyStore', async () => {
    await MeshService.start(OWNER);
    expect(mockGetTransportKeypair).not.toHaveBeenCalled();
    expect(mockX25519).not.toHaveBeenCalled();
    expect(mockStartAdvertising).not.toHaveBeenCalled();
  });

  it('mints a local x25519 when the flag is on and does not call device-epoch derivation', async () => {
    mockGetFlag.mockImplementation((key: string) => key === 'mesh_transport');
    mockGetTransportKeypair.mockResolvedValue(null);
    mockX25519.mockResolvedValue({ secretKey: 'local-sk', publicKey: 'local-pk' });
    mockSetTransportKeypair.mockResolvedValue(undefined);
    mockStartAdvertising.mockResolvedValue(undefined);
    await MeshService.start(OWNER);
    expect(mockX25519).toHaveBeenCalled();
    expect(mockSetTransportKeypair).toHaveBeenCalledWith({
      secretKey: 'local-sk',
      publicKey: 'local-pk',
    });
    expect(mockDeriveNoiseSeed).not.toHaveBeenCalled();
    expect(mockDeriveX25519).not.toHaveBeenCalled();
    expect(mockStartAdvertising).toHaveBeenCalled();
  });

  it('reuses a persisted local key on the second start', async () => {
    mockGetFlag.mockImplementation((key: string) => key === 'mesh_transport');
    mockGetTransportKeypair.mockResolvedValue({ secretKey: 'kept-sk', publicKey: 'kept-pk' });
    mockStartAdvertising.mockResolvedValue(undefined);
    await MeshService.start(OWNER);
    expect(mockX25519).not.toHaveBeenCalled();
    expect(mockSetTransportKeypair).not.toHaveBeenCalled();
  });

  it('does not import deriveNoiseSeed from MeshService source', () => {
    const source = readFileSync(join(__dirname, '../MeshService.ts'), 'utf8');
    expect(source).not.toMatch(/deriveNoiseSeed|deriveX25519ForDeviceEpoch/);
  });
});
