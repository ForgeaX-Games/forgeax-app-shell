import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { copySurfaceCss } from '../scripts/copy-surface-css';

const readPackageFile = (relativePath: string): string => readFileSync(
  fileURLToPath(new URL(`../${relativePath}`, import.meta.url)),
  'utf8',
);

describe('surface CSS contract', () => {
  test('exports reusable surface CSS as a side effect', () => {
    const packageJson = JSON.parse(readPackageFile('package.json')) as {
      exports?: Record<string, unknown>;
      sideEffects?: string[];
    };

    expect(packageJson.exports?.['./surface.css']).toBe('./dist/surface.css');
    expect(packageJson.sideEffects).toContain('./dist/surface.css');
  });

  test('owns generic full-size region and explicit body-fill hooks', () => {
    const css = readPackageFile('src/surface.css');

    expect(css).toContain('.fx-surface-region {');
    expect(css).toContain('.fx-surface-region-body {');
    expect(css).toContain('.fx-surface-region-overlay {');
    expect(css).toContain('position: relative;');
    expect(css).toContain('width: 100%;');
    expect(css).toContain('height: 100%;');
    expect(css).toContain('flex: 1 1 auto;');
    expect(css).toContain('min-height: 0;');
    expect(css).toContain('display: contents;');
    expect(css).not.toContain('preview-fatal-banner');
  });

  test('copies the exact source stylesheet into built output', async () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), 'app-shell-surface-'));
    const destination = join(temporaryDirectory, 'surface.css');

    try {
      await copySurfaceCss(new URL('../src/surface.css', import.meta.url), destination);
      expect(readFileSync(destination, 'utf8')).toBe(readPackageFile('src/surface.css'));
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });
});
