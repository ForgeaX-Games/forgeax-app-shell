import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';

const root = join(import.meta.dir, '..');

describe('React npm runtime boundary', () => {
  test('keeps both React runtimes external and peer-owned', () => {
    const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      scripts?: { build?: string };
      peerDependencies?: Record<string, string>;
    };

    expect(packageJson.peerDependencies?.react).toBe('^19.0.0');
    expect(packageJson.peerDependencies?.['react-dom']).toBe('^19.0.0');
    expect(packageJson.scripts?.build).toContain('--external react');
    expect(packageJson.scripts?.build).toContain('--external react-dom');
  });
});
