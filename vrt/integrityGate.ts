import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { PNG } from 'pngjs';
import { INTEGRITY_WAIVER_MAP, integrityWaiverKey } from './integrityWaivers';

/**
 * Fail when two DIFFERENT scenes share ≥ this identical ratio of
 * non-canvas (content) pixels. Full-frame 99% is too loose on tall dark UIs
 * where most pixels are `#0A0A0A`; content-aware comparison catches the
 * fake-screenshot case (same scene copied under many names) without false
 * positives across sparse list screens.
 */
export const INTEGRITY_IDENTICAL_RATIO = 0.99;
/** Near-byte-identical full frame still fails even if sparse. */
export const INTEGRITY_FULL_IDENTICAL_RATIO = 0.9995;
const CANVAS_RGB = [0x0a, 0x0a, 0x0a] as const;
const CANVAS_SLOP = 12;
const QUICK_SAMPLE_STEP = 8;

export type IntegrityPairFailure = {
  readonly a: string;
  readonly b: string;
  readonly identicalRatio: number;
  readonly contentIdenticalRatio: number;
  readonly platform: string;
  readonly viewport: string;
};

export type IntegrityPairWaiver = IntegrityPairFailure & {
  readonly reason: string;
};

export type IntegrityResult = {
  readonly ok: boolean;
  readonly comparedPairs: number;
  readonly failures: readonly IntegrityPairFailure[];
  readonly waivedPairs: readonly IntegrityPairWaiver[];
  readonly markerAssertMissing: readonly string[];
  readonly fileCount: number;
};

function parseCaptureName(file: string): {
  sceneKey: string;
  platform: string;
  viewport: string;
} | null {
  // auth_welcome_idle_android_pixel-4a.png
  const m = file.match(
    /^(.+)_(android|ios)_(pixel-4a|pixel-8-pro|iphone-se-3|iphone-16-pro-max)\.png$/,
  );
  if (!m) return null;
  return { sceneKey: m[1]!, platform: m[2]!, viewport: m[3]! };
}

function sceneIdFromCaptureKey(sceneKey: string): string {
  return sceneKey.replaceAll('_', '.');
}

function isCanvasPixel(data: Buffer, i: number): boolean {
  return (
    Math.abs(data[i]! - CANVAS_RGB[0]) <= CANVAS_SLOP &&
    Math.abs(data[i + 1]! - CANVAS_RGB[1]) <= CANVAS_SLOP &&
    Math.abs(data[i + 2]! - CANVAS_RGB[2]) <= CANVAS_SLOP
  );
}

function compareScenes(a: PNG, b: PNG): { fullIdentical: number; contentIdentical: number } | null {
  return compareScenesWithStep(a, b, 1);
}

function quickCompareScenes(
  a: PNG,
  b: PNG,
): { fullIdentical: number; contentIdentical: number } | null {
  return compareScenesWithStep(a, b, QUICK_SAMPLE_STEP);
}

function compareScenesWithStep(
  a: PNG,
  b: PNG,
  step: number,
): { fullIdentical: number; contentIdentical: number } | null {
  if (a.width !== b.width || a.height !== b.height) return null;
  let fullMismatch = 0;
  let total = 0;
  let contentPixels = 0;
  let contentMismatch = 0;
  for (let y = 0; y < a.height; y += step) {
    for (let x = 0; x < a.width; x += step) {
      total += 1;
      const i = (a.width * y + x) << 2;
      const dr = Math.abs(a.data[i]! - b.data[i]!);
      const dg = Math.abs(a.data[i + 1]! - b.data[i + 1]!);
      const db = Math.abs(a.data[i + 2]! - b.data[i + 2]!);
      const different = dr > 8 || dg > 8 || db > 8;
      if (different) fullMismatch += 1;
      const bothCanvas = isCanvasPixel(a.data, i) && isCanvasPixel(b.data, i);
      if (bothCanvas) continue;
      contentPixels += 1;
      if (different) contentMismatch += 1;
    }
  }
  const fullIdentical = 1 - fullMismatch / total;
  const contentIdentical =
    contentPixels === 0 ? fullIdentical : 1 - contentMismatch / contentPixels;
  return { fullIdentical, contentIdentical };
}

function failsThreshold(cmp: { fullIdentical: number; contentIdentical: number }): boolean {
  return (
    cmp.contentIdentical >= INTEGRITY_IDENTICAL_RATIO ||
    cmp.fullIdentical >= INTEGRITY_FULL_IDENTICAL_RATIO
  );
}

/**
 * Pairwise gate: different scenes on the same platform+viewport must not be
 * ≥99% identical. Also fails when the marker-assert ledger is incomplete.
 */
export async function runIntegrityGate(opts: {
  readonly baselineDir: string;
  readonly markerLedgerPath?: string;
  readonly reportPath?: string;
}): Promise<IntegrityResult> {
  const files = (await readdir(opts.baselineDir)).filter(f => f.endsWith('.png')).sort();
  const byBucket = new Map<string, { file: string; png: PNG; sceneKey: string }[]>();

  for (const file of files) {
    const parsed = parseCaptureName(file);
    if (!parsed) continue;
    const buf = await readFile(path.join(opts.baselineDir, file));
    const png = PNG.sync.read(buf);
    const key = `${parsed.platform}|${parsed.viewport}`;
    const list = byBucket.get(key) ?? [];
    list.push({ file, png, sceneKey: parsed.sceneKey });
    byBucket.set(key, list);
  }

  const failures: IntegrityPairFailure[] = [];
  const waivedPairs: IntegrityPairWaiver[] = [];
  let comparedPairs = 0;

  for (const [bucket, items] of byBucket) {
    const [platform, viewport] = bucket.split('|') as [string, string];
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const left = items[i]!;
        const right = items[j]!;
        if (left.sceneKey === right.sceneKey) continue;
        comparedPairs += 1;
        const waiver = INTEGRITY_WAIVER_MAP.get(
          integrityWaiverKey(
            sceneIdFromCaptureKey(left.sceneKey),
            sceneIdFromCaptureKey(right.sceneKey),
          ),
        );
        const quick = quickCompareScenes(left.png, right.png);
        if (!quick || !failsThreshold(quick)) continue;
        const cmp = compareScenes(left.png, right.png);
        if (!cmp || !failsThreshold(cmp)) continue;
        if (waiver) {
          waivedPairs.push({
            a: left.file,
            b: right.file,
            identicalRatio: cmp.fullIdentical,
            contentIdenticalRatio: cmp.contentIdentical,
            platform,
            viewport,
            reason: waiver.reason,
          });
          continue;
        }
        failures.push({
          a: left.file,
          b: right.file,
          identicalRatio: cmp.fullIdentical,
          contentIdenticalRatio: cmp.contentIdentical,
          platform,
          viewport,
        });
      }
    }
  }

  let markerAssertMissing: string[] = [];
  if (opts.markerLedgerPath) {
    try {
      const raw = await readFile(opts.markerLedgerPath, 'utf8');
      const ledger = JSON.parse(raw) as { asserted?: string[]; expected?: string[] };
      const asserted = new Set(ledger.asserted ?? []);
      const expected = ledger.expected ?? [];
      markerAssertMissing = expected.filter(id => !asserted.has(id));
    } catch {
      markerAssertMissing = ['marker-ledger-missing-or-unreadable'];
    }
  }

  const result: IntegrityResult = {
    ok: failures.length === 0 && markerAssertMissing.length === 0,
    comparedPairs,
    failures,
    waivedPairs,
    markerAssertMissing,
    fileCount: files.length,
  };

  if (opts.reportPath) {
    await mkdir(path.dirname(opts.reportPath), { recursive: true });
    await writeFile(opts.reportPath, `${JSON.stringify(result, null, 2)}\n`);
  }

  return result;
}

export function sha256FileSync(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

async function main(): Promise<void> {
  const dir = process.argv[2];
  const ledger = process.argv[3];
  const report = process.argv[4];
  if (!dir) {
    console.error('usage: tsx vrt/integrityGate.ts <baselineDir> [markerLedger] [reportJson]');
    process.exit(2);
  }
  const r = await runIntegrityGate({
    baselineDir: dir,
    ...(ledger ? { markerLedgerPath: ledger } : {}),
    ...(report ? { reportPath: report } : {}),
  });
  console.log(JSON.stringify(r, null, 2));
  if (!r.ok) {
    for (const f of r.failures) {
      console.error(
        `INTEGRITY FAIL ${f.platform}/${f.viewport}: ${f.a} ≈ ${f.b} (full ${(f.identicalRatio * 100).toFixed(2)}% / content ${(f.contentIdenticalRatio * 100).toFixed(2)}%)`,
      );
    }
    for (const m of r.markerAssertMissing) {
      console.error(`MARKER ASSERT MISSING: ${m}`);
    }
    process.exit(1);
  }
  console.log(
    `integrity_ok files=${r.fileCount} pairs=${r.comparedPairs} failures=0 marker_gaps=0`,
  );
}

const invokedDirectly =
  typeof process.argv[1] === 'string' &&
  process.argv[1].includes(`${path.sep}integrityGate`) &&
  Boolean(process.argv[2]);
if (invokedDirectly) {
  void main();
}
