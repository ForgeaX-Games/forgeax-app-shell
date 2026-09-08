import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyDockTabCss } from '../scripts/copy-dock-tab-css';

const readPackageFile = (relativePath: string): string => readFileSync(
  fileURLToPath(new URL(`../${relativePath}`, import.meta.url)),
  'utf8',
);

describe('Dock tab CSS contract', () => {
  test('exports reusable Dock-tab CSS as a side effect', () => {
    const packageJson = JSON.parse(readPackageFile('package.json')) as {
      exports?: Record<string, unknown>;
      sideEffects?: string[];
    };

    expect(packageJson.exports?.['./dock-tab.css']).toBe('./dist/dock-tab.css');
    expect(packageJson.sideEffects).toContain('./dist/dock-tab.css');
  });

  test('owns only generic status-summary layout and numeric presentation', () => {
    const css = readPackageFile('src/dock-tab.css');

    expect(css).toContain('.fx-dock-tab-status-summary {');
    expect(css).toContain('.fx-dock-tab-status-item {');
    expect(css).toContain('.fx-dock-tab-status-icon {');
    expect(css).toContain('.fx-dock-tab-status-value {');
    expect(css).toContain('font-variant-numeric: tabular-nums;');
    expect(css).not.toContain('.dv-default-tab');
    expect(css).not.toContain('color:');
    expect(css).not.toContain('--error');
    expect(css).not.toContain('--warning');
  });

  test('copies the exact source stylesheet into built output', async () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), 'app-shell-dock-tab-'));
    const destination = join(temporaryDirectory, 'dock-tab.css');

    try {
      await copyDockTabCss(new URL('../src/dock-tab.css', import.meta.url), destination);
      expect(readFileSync(destination, 'utf8')).toBe(readPackageFile('src/dock-tab.css'));
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });
});
