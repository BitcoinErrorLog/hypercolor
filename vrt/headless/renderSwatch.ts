import { contrastRatio, textOnSurfacePairs, wcagThreshold } from '../../src/theme';
import { color } from '../../src/theme/tokens';
import { VRT_VIEWPORTS } from '../types';

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function tokenSwatchSvg(): string {
  const viewport = VRT_VIEWPORTS.headless;
  const rowH = 44;
  const pad = 20;
  const titleH = 72;
  const height = pad * 2 + titleH + textOnSurfacePairs.length * (rowH + 8);
  const rows = textOnSurfacePairs
    .map((pair, index) => {
      const y = pad + titleH + index * (rowH + 8);
      const ratio = contrastRatio(pair.fg, pair.bg);
      const pass = ratio >= wcagThreshold[pair.usage] ? 'pass' : 'fail';
      const label = `${pair.name}  ${ratio.toFixed(2)}:1 ${pair.usage} ${pass}`;
      return `
      <g>
        <rect x="${pad}" y="${y}" width="${viewport.width - pad * 2}" height="${rowH}" fill="${pair.bg}"/>
        <rect x="${pad + 8}" y="${y + 8}" width="28" height="28" fill="${pair.fg}"/>
        <text x="${pad + 44}" y="${y + 28}" font-size="12" font-family="ui-sans-serif, system-ui, sans-serif" fill="${pair.fg}">${escapeXml(label)}</text>
      </g>`;
    })
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${viewport.width}" height="${height}" viewBox="0 0 ${viewport.width} ${height}">
  <rect width="100%" height="100%" fill="${color.canvas}"/>
  <text x="${pad}" y="36" font-size="24" font-weight="600" fill="${color.textPrimary}" font-family="ui-sans-serif, system-ui, sans-serif">Token swatch</text>
  <text x="${pad}" y="58" font-size="16" fill="${color.textSecondary}" font-family="ui-sans-serif, system-ui, sans-serif">Hypercolor semantic tokens. Dark-violet identity.</text>
  ${rows}
</svg>
`;
}
