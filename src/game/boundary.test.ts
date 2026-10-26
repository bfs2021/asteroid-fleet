import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const gameDir = dirname(fileURLToPath(import.meta.url));

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sources(path));
    else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) out.push(path);
  }
  return out;
}

describe('game layer', () => {
  it('does not import from src/ui', () => {
    const offenders: string[] = [];
    for (const file of sources(gameDir)) {
      const text = readFileSync(file, 'utf8');
      if (/^\s*(?:import|export)\b[^;]*from\s+['"](?:\.\.\/)+ui(?:\/[^'"]*)?['"]/m.test(text))
        offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});
