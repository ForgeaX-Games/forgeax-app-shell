import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';

const workflow = readFileSync(join(import.meta.dir, '../.github/workflows/ci.yml'), 'utf8');
const steps = workflow.split(/(?=^      - )/m).filter((step) => step.startsWith('      - '));

describe('CI runtime ownership', () => {
  test('provides Node and npm before packing without relying on the runner image', () => {
    const setup = steps.findIndex((step) => step.includes('uses: actions/setup-node@'));
    const pack = steps.findIndex((step) => step.includes('run: npm pack --dry-run'));

    expect(setup).toBeGreaterThanOrEqual(0);
    expect(pack).toBeGreaterThan(setup);
    // Match the maintained Node runtime and pinned action used by the existing
    // forgeax-ci npm-publish@v2.0.1 release workflow.
    expect(steps[setup]).toContain('actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38');
    expect(steps[setup]).toMatch(/^          node-version: '22'$/m);
    expect(steps[setup]).not.toMatch(/^\s+if:/m);
  });

  test('retains the runner, frozen Bun runtime, and every ordered quality gate', () => {
    expect(workflow).toContain('runs-on: [self-hosted, Linux, X64, standard]');
    const setupBun = steps.find((step) => step.includes('uses: oven-sh/setup-bun@v2'));
    expect(setupBun).toMatch(/^          bun-version: '1\.3\.14'$/m);
    const commands = [...workflow.matchAll(/^      - run: (.+)$/gm)].map((match) => match[1]);
    expect(commands).toEqual([
      'bun install --frozen-lockfile',
      'bun run check',
      'bun run release:preflight',
      'npm pack --dry-run',
    ]);
  });
});
