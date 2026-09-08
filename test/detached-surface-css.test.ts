import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyDetachedSurfaceCss } from '../scripts/copy-detached-surface-css';

const readPackageFile = (relativePath: string): string => readFileSync(
  fileURLToPath(new URL(`../${relativePath}`, import.meta.url)),
  'utf8',
);

describe('detached surface CSS contract', () => {
  test('exports reusable detached CSS as a side effect', () => {
    const packageJson = JSON.parse(readPackageFile('package.json')) as {
      exports?: Record<string, unknown>;
      sideEffects?: string[];
    };

    expect(packageJson.exports?.['./detached.css']).toBe('./dist/detached.css');
    expect(packageJson.sideEffects).toContain('./dist/detached.css');
  });

  test('owns the generic public frame and direct-child fill hooks', () => {
    const css = readPackageFile('src/detached.css');

    expect(css).toContain('.fx-detached-surface,');
    expect(css).toContain('.fx-detached-panel {');
    expect(css).toContain('.fx-detached-surface > *,');
    expect(css).toContain('flex: 1 1 auto;');
    expect(css).toContain('min-height: 0;');
    expect(css).toContain('height: 100%;');
    expect(css).toContain('.fx-detached-surface-status-text[data-tone="neutral"]');
    expect(css).toContain('.fx-detached-surface-status-text[data-tone="error"]');
    expect(css).toContain('color: #888;');
    expect(css).toContain('color: #c44;');
    expect(css).not.toContain('background:');
  });

  test('copies the exact source stylesheet into built output', async () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), 'app-shell-detached-'));
    const destination = join(temporaryDirectory, 'detached.css');

    try {
      await copyDetachedSurfaceCss(new URL('../src/detached.css', import.meta.url), destination);
      expect(readFileSync(destination, 'utf8')).toBe(readPackageFile('src/detached.css'));
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });
});
