import * as fs from 'fs';
import * as path from 'path';

const ROOTS = [
  path.resolve(__dirname, '../../screens'),
  path.resolve(__dirname, '../../components'),
  path.resolve(__dirname, '..'),
];

const HEX = /#[0-9A-Fa-f]{3,8}\b/;
const RGBA = /rgba?\([^)]*\)/;
const FONT = /fontSize:\s*\d+/;
const RADIUS = /borderRadius:\s*\d+/;

function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '__tests__' || entry.name === 'primitives') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

describe('no raw style literals outside theme', () => {
  const files = ROOTS.flatMap(root => walk(root));

  it('scans screens, components, and ui for hex/rgba/fontSize/radius literals', () => {
    const hits: string[] = [];
    for (const file of files) {
      // contacts/tokens.ts re-exports theme — allow no raw there after rewrite
      const text = fs.readFileSync(file, 'utf8');
      const rel = path.relative(path.resolve(__dirname, '../..'), file);
      for (const [name, re] of [
        ['hex', HEX],
        ['rgba', RGBA],
        ['fontSize', FONT],
        ['borderRadius', RADIUS],
      ] as const) {
        if (re.test(text)) {
          const lines = text.split('\n');
          lines.forEach((line, i) => {
            if (re.test(line) && !line.trim().startsWith('//') && !line.includes('nativeSplash')) {
              hits.push(`${rel}:${i + 1}:${name}:${line.trim()}`);
            }
          });
        }
      }
    }
    expect(hits).toEqual([]);
  });
});
