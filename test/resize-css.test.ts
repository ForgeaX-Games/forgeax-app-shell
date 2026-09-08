import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyResizeCss } from '../scripts/copy-resize-css';

const readPackageFile = (relativePath: string): string => readFileSync(
  fileURLToPath(new URL(`../${relativePath}`, import.meta.url)),
  'utf8',
);

describe('resize presentation contract', () => {
  test('exports the reusable resize CSS in the npm package', () => {
    const packageJson = JSON.parse(readPackageFile('package.json')) as {
      files?: string[];
      exports?: Record<string, unknown>;
      sideEffects?: string[];
    };

    expect(packageJson.files).toContain('dist');
    expect(packageJson.exports?.['./resize.css']).toBe('./dist/resize.css');
    expect(packageJson.sideEffects).toContain('./dist/resize.css');
  });

  test('owns the generic selectors emitted by ResizeHandle', () => {
    const css = readPackageFile('src/resize.css');

    expect(css).toContain('.resize-handle {');
    expect(css).toContain('.resize-handle-col {');
    expect(css).toContain('.resize-handle-row {');
    expect(css).toContain('.resize-handle:hover::after');
  });

  test('copies the exact source stylesheet into built output', async () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), 'app-shell-resize-'));
    const destination = join(temporaryDirectory, 'resize.css');

    try {
      await copyResizeCss(
        new URL('../src/resize.css', import.meta.url),
        destination,
      );
      expect(readFileSync(destination, 'utf8')).toBe(readPackageFile('src/resize.css'));
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });
});
