import * as fs from 'fs';
import * as path from 'path';

const ROOTS = [
  path.resolve(__dirname, '../../screens'),
  path.resolve(__dirname, '../../components'),
  path.resolve(__dirname, '../../navigation'),
  path.resolve(__dirname, '../../../App.tsx'),
  path.resolve(__dirname, '..'),
];

const HEX = /#[0-9A-Fa-f]{3,8}\b/;
const RGBA = /rgba?\([^)]*\)/;
const FONT = /fontSize:\s*\d+/;
const RADIUS = /borderRadius:\s*\d+/;
const PADDING = /padding(?:Top|Right|Bottom|Left|Horizontal|Vertical)?:\s*(?!0\b|[1-3]\b)\d+/;
const MARGIN = /margin(?:Top|Right|Bottom|Left|Horizontal|Vertical)?:\s*(?!0\b|[1-3]\b)\d+/;

function walk(entryPath: string, out: string[] = []): string[] {
  if (!fs.existsSync(entryPath)) return out;
  const stat = fs.statSync(entryPath);
  if (stat.isFile()) {
    if (/\.(ts|tsx)$/.test(entryPath) && !/\.test\.(ts|tsx)$/.test(entryPath)) {
      out.push(entryPath);
    }
    return out;
  }
  for (const entry of fs.readdirSync(entryPath, { withFileTypes: true })) {
    if (entry.name === '__tests__') continue;
    const full = path.join(entryPath, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

describe('no raw style literals outside theme', () => {
  const files = ROOTS.flatMap(root => walk(root));

  it('scans screens, components, ui, navigation, and App for hex/rgba/type/space literals', () => {
    const hits: string[] = [];
    for (const file of files) {
      const text = fs.readFileSync(file, 'utf8');
      const rel = path.relative(path.resolve(__dirname, '../..'), file);
      for (const [name, re] of [
        ['hex', HEX],
        ['rgba', RGBA],
        ['fontSize', FONT],
        ['borderRadius', RADIUS],
        ['padding', PADDING],
        ['margin', MARGIN],
      ] as const) {
        if (re.test(text)) {
          const lines = text.split('\n');
          lines.forEach((line, i) => {
            const trimmed = line.trim();
            if (
              re.test(line) &&
              !trimmed.startsWith('//') &&
              !trimmed.startsWith('*') &&
              !line.includes('nativeSplash')
            ) {
              hits.push(`${rel}:${i + 1}:${name}:${trimmed}`);
            }
          });
        }
      }
    }
    expect(hits).toEqual([]);
  });
});
