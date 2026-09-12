import { expect, test } from 'bun:test';

test('broadcast contracts do not depend on subprocess startup or relaxed timeouts', async () => {
  const source = await Bun.file(new URL('./broadcast-stream.test.ts', import.meta.url)).text();
  expect(source).not.toContain('spawnSync');
  expect(source).not.toContain('process.execPath');
  expect(source).not.toContain('setDefaultTimeout');
});
