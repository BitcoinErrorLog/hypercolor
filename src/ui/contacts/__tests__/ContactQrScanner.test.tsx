import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { COPY } from '../../../copy/uxCopy';
import {
  decideScannedContact,
  submitManualContact,
} from '../../../screens/main/contacts/contactsActions';
import { ContactQrScanner } from '../ContactQrScanner';

const OWNER = 'operrr8wsbpr3ue9d4qj41ge1kcc6r7fdiy6o3ugjrrhi4y77rdo';
const PEER = 'pxnu33x7jtpx9ar1ytsi4yxbp6a5o36gwhffs8zoxmbuptici1jy';

async function render(
  permission: 'granted' | 'denied',
  error: string | null = null,
  onBarcode: (raw: string) => void = () => undefined,
  onManualFallback: () => void = () => undefined,
): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <ContactQrScanner
        visible
        permission={permission}
        error={error}
        onClose={() => undefined}
        onBarcode={onBarcode}
        onManualFallback={onManualFallback}
      />,
    );
  });
  return tree;
}

describe('ContactQrScanner', () => {
  it('shows camera permission denied copy and a manual-entry fallback', async () => {
    const onManualFallback = jest.fn();
    const tree = await render('denied', null, () => undefined, onManualFallback);
    expect(tree.root.findByProps({ testID: 'contactScanner' })).toBeTruthy();
    expect(JSON.stringify(tree.toJSON())).toContain(COPY.cameraPermissionDenied);
    expect(JSON.stringify(tree.toJSON())).toContain(COPY.enterPubkyManually);
    expect(tree.root.findByProps({ testID: 'contactScanError' })).toBeTruthy();
    await act(async () => {
      tree.root.findByProps({ accessibilityLabel: COPY.enterPubkyManually }).props.onPress();
    });
    expect(onManualFallback).toHaveBeenCalled();
    await act(async () => {
      tree.unmount();
    });
  });

  it('surfaces an inline scan error on the granted camera surface', async () => {
    const tree = await render('granted', COPY.notAPubkyQr);
    expect(tree.root.findByProps({ testID: 'contactScanError' }).props.accessibilityLabel).toBe(
      COPY.notAPubkyQr,
    );
    await act(async () => {
      tree.unmount();
    });
  });

  it('delivers a scanned pubky:// payload into addManualContact', async () => {
    const addManualContact = jest.fn(async () => ({
      ok: true as const,
      contact: {
        pubky: PEER,
        ownerPubky: OWNER,
        trustScore: 0,
        isFollowing: false,
        isFollower: false,
        isMutual: false,
        addedManually: true,
        firstSeenAt: 1,
      },
    }));
    const tree = await render('granted', null, raw => {
      const decision = decideScannedContact(raw, OWNER);
      if (decision.kind === 'add') {
        void submitManualContact({
          ownerPubky: OWNER,
          pubky: decision.pubky,
          addManualContact,
        });
      }
    });
    await act(async () => {
      tree.root.findByProps({ testID: 'contactScannerCamera' }).props.onBarcodeScanned({
        data: `pubky://${PEER}`,
      });
    });
    await Promise.resolve();
    expect(addManualContact).toHaveBeenCalledWith(OWNER, PEER);
    await act(async () => {
      tree.unmount();
    });
  });

  it('keeps the camera open and reports an invalid payload kind', async () => {
    let scanError: string | null = null;
    const tree = await render('granted', scanError, raw => {
      const decision = decideScannedContact(raw, OWNER);
      if (decision.kind === 'error') scanError = decision.message;
    });
    await act(async () => {
      tree.root.findByProps({ testID: 'contactScannerCamera' }).props.onBarcodeScanned({
        data: 'https://example.com/not-a-pubky',
      });
    });
    expect(scanError).toBe(COPY.notAPubkyQr);
    expect(tree.root.findByProps({ testID: 'contactScannerCamera' })).toBeTruthy();
    await act(async () => {
      tree.unmount();
    });
  });

  it('still exposes onDeliverScan only as a test hook', async () => {
    const onBarcode = jest.fn();
    const tree = await render('granted', null, onBarcode);
    expect(tree.root.findByProps({ testID: 'contactScanner' }).props.onDeliverScan).toBeTruthy();
    await act(async () => {
      tree.root.findByProps({ testID: 'contactScanner' }).props.onDeliverScan(`pubky://${PEER}`);
    });
    expect(onBarcode).toHaveBeenCalledWith(`pubky://${PEER}`);
    await act(async () => {
      tree.unmount();
    });
  });
});
