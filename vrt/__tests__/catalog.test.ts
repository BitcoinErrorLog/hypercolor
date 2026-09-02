import { createElement } from 'react';
import { act, create } from 'react-test-renderer';
import { catalogById, VRT_CATALOG } from '../catalog';
import { VRT_CATALOG_META } from '../catalogMeta';
import { SYNTHETIC_IDENTITIES, SYNTHETIC_PUBKY_ALLOWLIST } from '../fixtures/identities';
import { TOKEN_SWATCH_READY_ID, TokenSwatchScreen } from '../scenes/TokenSwatchScreen';
import { expandEntry } from '../types';
import { isValidPubky } from '../../src/utils/pubkyId';
import { textOnSurfacePairs } from '../../src/theme';

describe('VRT catalog', () => {
  it('registers the token swatch proof entry with unique capture names', () => {
    const names = new Set<string>();
    for (const entry of VRT_CATALOG_META) {
      expect(entry.id).toMatch(/^[a-z0-9.-]+$/);
      for (const target of expandEntry(entry)) {
        expect(names.has(target.captureName)).toBe(false);
        names.add(target.captureName);
        expect(target.captureName).toMatch(
          /^[a-z0-9-]+\/[a-z0-9-]+\/[a-z0-9-]+\/(android|ios)\/[a-z0-9-]+\.png$/,
        );
      }
    }
    expect(names.size).toBe(4);
    expect(VRT_CATALOG).toHaveLength(VRT_CATALOG_META.length);
  });

  it('renders the token swatch with vrtSceneReady and every contrast pair', async () => {
    let tree!: ReturnType<typeof create>;
    await act(async () => {
      tree = create(catalogById('design-system.token-swatch.default').render());
    });
    expect(tree.root.findByProps({ testID: TOKEN_SWATCH_READY_ID })).toBeTruthy();
    const json = JSON.stringify(tree.toJSON());
    expect(json).toContain('Token swatch');
    for (const pair of textOnSurfacePairs) {
      expect(json).toContain(pair.name);
    }
    await act(async () => {
      tree.unmount();
    });
  });

  it('exposes a presentational TokenSwatchScreen', async () => {
    let tree!: ReturnType<typeof create>;
    await act(async () => {
      tree = create(createElement(TokenSwatchScreen));
    });
    expect(tree.root.findByProps({ testID: TOKEN_SWATCH_READY_ID })).toBeTruthy();
    await act(async () => {
      tree.unmount();
    });
  });
});

describe('VRT fixtures', () => {
  it('uses valid synthetic z32 identities that are obviously repeating', () => {
    for (const identity of Object.values(SYNTHETIC_IDENTITIES)) {
      expect(identity.synthetic).toBe(true);
      expect(isValidPubky(identity.pubky)).toBe(true);
      expect(identity.pubky).toMatch(/nretnret|c3ugc3ug/);
      expect(SYNTHETIC_PUBKY_ALLOWLIST).toContain(identity.pubky);
    }
    expect(SYNTHETIC_IDENTITIES.aster.name).toBe('Aster Example');
  });
});
