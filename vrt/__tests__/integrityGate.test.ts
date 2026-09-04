import { mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PNG } from 'pngjs';
import { runIntegrityGate } from '../integrityGate';

function solidPng(width: number, height: number, rgb: [number, number, number]): Buffer {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (width * y + x) << 2;
      png.data[i] = rgb[0];
      png.data[i + 1] = rgb[1];
      png.data[i + 2] = rgb[2];
      png.data[i + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

describe('integrityGate', () => {
  it('fails when two different scenes are ≥99% identical', async () => {
    const tmp = path.join(os.tmpdir(), `vrt-int-${process.pid}-${Date.now()}`);
    await mkdir(tmp, { recursive: true });
    const buf = solidPng(20, 20, [10, 20, 30]);
    await writeFile(path.join(tmp, 'auth_welcome_idle_android_pixel-4a.png'), buf);
    await writeFile(path.join(tmp, 'stack_thread_populated_android_pixel-4a.png'), buf);
    const other = solidPng(20, 20, [200, 10, 10]);
    await writeFile(path.join(tmp, 'tabs_chats_empty_android_pixel-4a.png'), other);

    const result = await runIntegrityGate({ baselineDir: tmp });
    expect(result.ok).toBe(false);
    expect(result.failures.length).toBeGreaterThanOrEqual(1);
    const names = `${result.failures[0]?.a} ${result.failures[0]?.b}`;
    expect(names).toContain('welcome');
    expect(names).toContain('thread');
    await rm(tmp, { recursive: true, force: true });
  });

  it('fails when marker ledger expected entries were not asserted', async () => {
    const tmp = path.join(os.tmpdir(), `vrt-ledger-${process.pid}-${Date.now()}`);
    await mkdir(tmp, { recursive: true });
    const buf = solidPng(8, 8, [1, 2, 3]);
    await writeFile(path.join(tmp, 'auth_welcome_idle_android_pixel-4a.png'), buf);
    const ledger = path.join(tmp, 'ledger.json');
    await writeFile(
      ledger,
      JSON.stringify({
        asserted: [],
        expected: ['auth.welcome.idle|android|pixel-4a'],
      }),
    );
    const result = await runIntegrityGate({ baselineDir: tmp, markerLedgerPath: ledger });
    expect(result.ok).toBe(false);
    expect(result.markerAssertMissing).toContain('auth.welcome.idle|android|pixel-4a');
    await rm(tmp, { recursive: true, force: true });
  });

  it('accepts explicit scene-pair waivers only', async () => {
    const tmp = path.join(os.tmpdir(), `vrt-waiver-${process.pid}-${Date.now()}`);
    await mkdir(tmp, { recursive: true });
    const buf = solidPng(20, 20, [10, 20, 30]);
    await writeFile(path.join(tmp, 'auth_enable_enabled_android_pixel-4a.png'), buf);
    await writeFile(path.join(tmp, 'auth_enable_success_android_pixel-4a.png'), buf);

    const result = await runIntegrityGate({ baselineDir: tmp });
    expect(result.ok).toBe(true);
    expect(result.failures).toHaveLength(0);
    expect(result.waivedPairs).toHaveLength(1);
    expect(result.waivedPairs[0]?.reason).toContain('success presenter');
    await rm(tmp, { recursive: true, force: true });
  });
});
