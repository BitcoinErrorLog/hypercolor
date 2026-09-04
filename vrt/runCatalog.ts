import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import { PNG } from 'pngjs';
import { VRT_CATALOG_META } from './catalogMeta';
import { installCatalogClock, restoreCatalogClock } from './fixtures/clock';
import { installCatalogNetworkGuard, restoreCatalogNetworkGuard } from './fixtures/network';
import { tokenSwatchSvg } from './headless/renderSwatch';
import { diffPng } from './pixel/diff';
import { scanPrivacy } from './privacy/scan';
import { maestroFlow, writeReport, type ReportRow } from './report/buildReport';
import { expandEntry, VRT_VIEWPORTS } from './types';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = path.join(ROOT, 'vrt/output');
const BASELINE_ROOT = path.join(ROOT, '.maestro/vrt/baselines');
const CANDIDATE_ROOT = path.join(OUTPUT, 'candidates');
const DIFF_ROOT = path.join(OUTPUT, 'diffs');
const REPORT_ROOT = path.join(OUTPUT, 'report');
const REPORT_ASSETS = path.join(REPORT_ROOT, 'assets');
const MAESTRO_GENERATED = path.join(ROOT, '.maestro/vrt/generated');

function gitSha(rev: string): string {
  try {
    return execFileSync('git', ['rev-parse', '--short', rev], {
      cwd: ROOT,
      encoding: 'utf8',
    }).trim();
  } catch {
    return 'unknown';
  }
}

function renderHeadlessPng(): PNG {
  const svg = tokenSwatchSvg();
  const png = new Resvg(svg, {
    fitTo: { mode: 'width', value: VRT_VIEWPORTS.headless.width },
  })
    .render()
    .asPng();
  return PNG.sync.read(png);
}

async function writePng(filePath: string, png: PNG): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, PNG.sync.write(png));
}

async function maybeReadPng(filePath: string): Promise<PNG | null> {
  try {
    return PNG.sync.read(await readFile(filePath));
  } catch {
    return null;
  }
}

function assetName(kind: string, captureName: string): string {
  return `${kind}-${captureName.replaceAll('/', '__')}`;
}

async function copyAsset(src: string, kind: string, captureName: string): Promise<string> {
  await mkdir(REPORT_ASSETS, { recursive: true });
  const name = assetName(kind, captureName);
  const dest = path.join(REPORT_ASSETS, name);
  await copyFile(src, dest);
  return `assets/${name}`;
}

async function main(): Promise<void> {
  process.env.E2E_VRT = '1';
  const seed = process.argv.includes('--seed-baseline');
  installCatalogClock();
  installCatalogNetworkGuard();
  try {
    const candidateSha = gitSha('HEAD');
    const rows: ReportRow[] = [];

    for (const entry of VRT_CATALOG_META) {
      const targets = [
        ...expandEntry(entry),
        {
          entry,
          platform: 'headless' as const,
          viewport: 'headless' as const,
          device: VRT_VIEWPORTS.headless.device,
          captureName: `${entry.journey}/${entry.screen}/${entry.state}/headless/${VRT_VIEWPORTS.headless.device}.png`,
        },
      ];

      for (const target of targets) {
        if (target.platform !== 'headless') {
          await mkdir(MAESTRO_GENERATED, { recursive: true });
          const appId = target.platform === 'ios' ? 'org.name.hypercolor' : 'com.hypercolor';
          const yamlPath = path.join(
            MAESTRO_GENERATED,
            `${entry.id}_${target.platform}_${target.device}.yaml`,
          );
          await writeFile(yamlPath, maestroFlow(target, appId));
          continue;
        }

        const png = renderHeadlessPng();
        const candidatePath = path.join(CANDIDATE_ROOT, target.captureName);
        await writePng(candidatePath, png);
        const baselinePath = path.join(BASELINE_ROOT, target.captureName);
        let baseline = await maybeReadPng(baselinePath);
        if (!baseline && seed) {
          await writePng(baselinePath, png);
          baseline = png;
        }
        const diffPath = path.join(DIFF_ROOT, target.captureName);
        let status: ReportRow['status'] = 'candidate-only';
        let changedPercent: number | null = null;
        let mismatched: number | null = null;
        let dimensionMismatch = false;
        let diffRel: string | null = null;
        if (!baseline) {
          status = 'missing-baseline';
        } else {
          const diff = diffPng(baseline, png);
          changedPercent = diff.changedPercent;
          mismatched = Number.isFinite(diff.mismatched) ? diff.mismatched : null;
          dimensionMismatch = diff.dimensionMismatch;
          status = diff.pass ? 'pass' : 'fail';
          if (diff.diff) {
            await writePng(diffPath, diff.diff);
            diffRel = await copyAsset(diffPath, 'diff', target.captureName);
          }
        }
        rows.push({
          captureName: target.captureName,
          platform: target.platform,
          viewport: target.viewport,
          device: target.device,
          journey: entry.journey,
          screen: entry.screen,
          state: entry.state,
          status,
          changedPercent,
          mismatched,
          dimensionMismatch,
          mask: entry.mask.map(rule => `${rule.testID}:${rule.reason}`),
          candidateRel: await copyAsset(candidatePath, 'candidate', target.captureName),
          baselineRel: baseline
            ? await copyAsset(baselinePath, 'baseline', target.captureName)
            : null,
          diffRel,
        });
      }
    }

    const reportFile = await writeReport(
      REPORT_ROOT,
      {
        baselineSha: gitSha('HEAD'),
        candidateSha,
        runner: 'hypercolor-vrt-catalog@maestro+pixelmatch+headless-resvg',
        generatedAt: new Date().toISOString(),
        approvalStatus: 'pending-named-human',
      },
      rows,
    );

    const hits = await scanPrivacy(REPORT_ROOT);
    if (hits.length > 0) {
      throw new Error(
        `Privacy scan failed:\n${hits.map(hit => `${hit.file} ${hit.rule}`).join('\n')}`,
      );
    }

    const failed = rows.filter(row => row.status === 'fail');
    console.log(`VRT catalog: ${rows.length} captured, ${failed.length} failed`);
    console.log(`Report: ${path.relative(ROOT, reportFile)}`);
    console.log(
      'On-device Maestro flows written under .maestro/vrt/generated (not executed here).',
    );
    if (failed.length > 0) {
      process.exitCode = 1;
    }
  } finally {
    restoreCatalogClock();
    restoreCatalogNetworkGuard();
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
