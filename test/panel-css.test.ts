import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyPanelCss } from '../scripts/copy-panel-css';

const readPackageFile = (relativePath: string): string => readFileSync(
  fileURLToPath(new URL(`../${relativePath}`, import.meta.url)),
  'utf8',
);

describe('panel presentation contract', () => {
  test('exports reusable panel CSS as a side effect', () => {
    const packageJson = JSON.parse(readPackageFile('package.json')) as {
      exports?: Record<string, unknown>;
      sideEffects?: string[];
    };

    expect(packageJson.exports?.['./panel.css']).toBe('./dist/panel.css');
    expect(packageJson.sideEffects).toContain('./dist/panel.css');
  });

  test('owns only generic surface, content and empty-state selectors', () => {
    const css = readPackageFile('src/panel.css');

    expect(css).toContain('.fx-panel {');
    expect(css).toContain('.fx-panel-content {');
    expect(css).toContain('.fx-panel-empty {');
    expect(css).toContain('.fx-panel-empty-title {');
    expect(css).toContain('.fx-panel-empty-detail {');
    expect(css).toContain('min-height: 120px;');
    expect(css).toContain('justify-content: center;');
    expect(css).not.toContain('.fx-panel-header');
    expect(css).not.toContain('.fx-panel-action');
  });

  test('copies the exact source stylesheet into built output', async () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), 'app-shell-panel-'));
    const destination = join(temporaryDirectory, 'panel.css');

    try {
      await copyPanelCss(new URL('../src/panel.css', import.meta.url), destination);
      expect(readFileSync(destination, 'utf8')).toBe(readPackageFile('src/panel.css'));
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });
});
