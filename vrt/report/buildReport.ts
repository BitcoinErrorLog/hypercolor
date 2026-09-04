import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { CaptureTarget } from '../types';
import { vrtMaestroAssertIds } from '../sceneReady';

export type ReportRow = {
  readonly captureName: string;
  readonly platform: string;
  readonly viewport: string;
  readonly device: string;
  readonly journey: string;
  readonly screen: string;
  readonly state: string;
  readonly status: 'pass' | 'fail' | 'missing-baseline' | 'candidate-only';
  readonly changedPercent: number | null;
  readonly mismatched: number | null;
  readonly dimensionMismatch: boolean;
  readonly mask: readonly string[];
  readonly candidateRel: string;
  readonly baselineRel: string | null;
  readonly diffRel: string | null;
};

export type ReportMeta = {
  readonly baselineSha: string;
  readonly candidateSha: string;
  readonly runner: string;
  readonly generatedAt: string;
  readonly approvalStatus: string;
};

function rowHtml(row: ReportRow): string {
  const baseline = row.baselineRel
    ? `<img src="${row.baselineRel}" alt="baseline ${row.captureName}"/>`
    : '<p class="empty">No baseline</p>';
  const candidate = `<img src="${row.candidateRel}" alt="candidate ${row.captureName}"/>`;
  const overlay = row.diffRel
    ? `<img src="${row.diffRel}" alt="overlay ${row.captureName}"/>`
    : '<p class="empty">No overlay</p>';
  return `<article class="card" data-status="${row.status}" data-platform="${row.platform}" data-journey="${row.journey}" id="${row.captureName}">
  <h3>${row.captureName}</h3>
  <p>${row.journey} / ${row.screen} / ${row.state} · ${row.platform} · ${row.viewport} · ${row.device}</p>
  <p>status ${row.status}${row.changedPercent === null ? '' : ` · ${row.changedPercent.toFixed(3)}% changed (${row.mismatched} px)`}</p>
  <p>masks: ${row.mask.length ? row.mask.join(', ') : 'none'}</p>
  <div class="triple">
    <figure><figcaption>Baseline</figcaption>${baseline}</figure>
    <figure><figcaption>Candidate</figcaption>${candidate}</figure>
    <figure><figcaption>Overlay</figcaption>${overlay}</figure>
  </div>
</article>`;
}

export function renderReportHtml(meta: ReportMeta, rows: readonly ReportRow[]): string {
  const groups = new Map<string, ReportRow[]>();
  for (const row of rows) {
    const key = `${row.journey}/${row.platform}/${row.viewport}/${row.state}`;
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }
  const nav = [...groups.keys()]
    .map(key => `<a href="#${groups.get(key)?.[0]?.captureName ?? ''}">${key}</a>`)
    .join('');
  const body = [...groups.values()].flat().map(rowHtml).join('\n');
  const failed = rows.filter(row => row.status === 'fail').length;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>Hypercolor VRT report</title>
  <style>
    body { font-family: ui-sans-serif, system-ui, sans-serif; background: #0a0a0a; color: #f9fafb; margin: 0; }
    header, nav, main { padding: 16px 20px; }
    a { color: #c4b5fd; }
    .card { border: 1px solid #1a1a1a; margin: 16px 0; padding: 16px; background: #111; }
    .triple { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; }
    img { width: 100%; background: #1a1a1a; }
    .empty { color: #808692; }
    nav { display: flex; flex-wrap: wrap; gap: 12px; }
  </style>
</head>
<body>
  <header>
    <h1>Hypercolor VRT</h1>
    <p>baseline ${meta.baselineSha} · candidate ${meta.candidateSha} · ${meta.runner}</p>
    <p>${meta.generatedAt} · approval ${meta.approvalStatus} · ${rows.length} captures · ${failed} failed</p>
  </header>
  <nav>${nav}</nav>
  <main>
    ${body}
  </main>
</body>
</html>
`;
}

export async function writeReport(
  outDir: string,
  meta: ReportMeta,
  rows: readonly ReportRow[],
): Promise<string> {
  await mkdir(outDir, { recursive: true });
  const html = renderReportHtml(meta, rows);
  const file = path.join(outDir, 'index.html');
  await writeFile(file, html);
  return file;
}

export function maestroFlow(target: CaptureTarget, appId: string): string {
  const scene = target.entry.id;
  const shot = `${scene.replace(/\./g, '_')}_${target.platform}_${target.device}`;
  const assertedIds = vrtMaestroAssertIds(scene, target.platform);
  const readyAssertions = assertedIds
    .map(id => {
      const exactSceneMarker = id.startsWith('vrt-scene:');
      const selector = exactSceneMarker
        ? `id: ${JSON.stringify(id)}`
        : id.startsWith('text:')
          ? `text: ${JSON.stringify(id.slice('text:'.length))}`
          : `id: ${JSON.stringify(id)}`;
      return `- extendedWaitUntil:
    visible:
      ${selector}
    timeout: 20000
- assertVisible:
    ${selector}`;
    })
    .join('\n');
  // Neither platform launches here. Capture scripts launch once, inject the
  // scene (Android HC_E2E file / iOS Documents sidecar), then this flow
  // asserts the exact catalog-id marker and any scene-owned sheet marker
  // before screenshot.
  // iOS must NOT use openLink — it surfaces an "Open in hypercolor?" sheet.
  return `appId: ${appId}
name: VRT ${scene} ${target.platform} ${target.device}
---
${readyAssertions}
${
  scene === 'a11y.font-scale.two'
    ? `- scrollUntilVisible:
    element:
      id: welcomeConnectRing
    direction: DOWN
    timeout: 30000
- assertVisible:
    id: welcomeConnectRing
`
    : ''
}
- takeScreenshot: ${shot}
`;
}
