import { expect, test } from 'bun:test';
import { createApplicationRuntimeOwner, ApplicationStartupCleanupError } from '../src/application';

const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const host = {} as never;
const deferred = new Error('explicit safe deferral');

test('a settled failed retry can immediately be retried explicitly', async () => {
  const owner = createApplicationRuntimeOwner({ isCleanupDeferred: error => error === deferred });
  let calls = 0;
  const lease = owner.acquire(async () => ({ host, dispose() {
    if (++calls < 3) throw deferred;
  } }));
  await lease.ready;
  lease.release();
  await tick();
  let failure: unknown;
  try { await owner.retryShutdown(); } catch (error) { failure = error; }
  expect(failure).toBe(deferred);
  await owner.retryShutdown();
  expect(calls).toBe(3);
  expect(owner.getSnapshot()).toEqual({ status: 'ready' });
});

test('blocks replacement until an explicit successful retry, without replaying cleanup', async () => {
  const owner = createApplicationRuntimeOwner({ isCleanupDeferred: error => error === deferred });
  let blocked = true;
  let calls = 0;
  let starts = 0;
  const first = owner.acquire(async () => ({ host, dispose: async () => {
    calls++;
    if (blocked) throw deferred;
  } }));
  await first.ready;
  first.release();
  await tick();
  const second = owner.acquire(async () => { starts++; return { host, dispose() {} }; });
  await tick();
  expect(starts).toBe(0);
  expect(calls).toBe(1);
  expect(owner.getSnapshot()).toMatchObject({ status: 'blocked', retryable: true });
  blocked = false;
  await Promise.all([owner.retryShutdown(), owner.retryShutdown()]);
  await second.ready;
  expect(starts).toBe(1);
  expect(calls).toBe(2);
  first.release();
  second.release();
  await tick();
  expect(calls).toBe(2);
});

test('a released pending start blocks replacement until its late runtime retires', async () => {
  const owner = createApplicationRuntimeOwner({ isCleanupDeferred: error => error === deferred });
  let finish!: (value: { host: never; dispose(): void }) => void;
  let blocked = true;
  let starts = 0;
  const first = owner.acquire(() => new Promise<{ host: never; dispose(): void }>(resolve => { finish = resolve; }));
  await tick();
  first.release();
  const second = owner.acquire(async () => { starts++; return { host, dispose() {} }; });
  finish({ host, dispose() { if (blocked) throw deferred; } });
  await first.ready;
  await tick();
  expect(starts).toBe(0);
  blocked = false;
  await owner.retryShutdown();
  await second.ready;
  expect(starts).toBe(1);
  second.release();
});

test('startup failure retains its failed rollback and original error', async () => {
  const owner = createApplicationRuntimeOwner({ isCleanupDeferred: error => error === deferred });
  const original = new Error('startup failed');
  let cleanup = 0;
  const runtime = { host, dispose() { cleanup++; } };
  const lease = owner.acquire(async () => { throw new ApplicationStartupCleanupError(original, runtime, deferred); });
  await expect(lease.ready).rejects.toBe(original);
  expect(cleanup).toBe(0);
  expect(owner.getSnapshot()).toMatchObject({ status: 'blocked', error: deferred });
  lease.release();
  await tick();
  expect(cleanup).toBe(0);
  await owner.retryShutdown();
  expect(cleanup).toBe(1);
});

test('ordinary failures and classification errors remain blocked without unsafe retry', async () => {
  const failure = new Error('partially destroyed');
  const owner = createApplicationRuntimeOwner({ isCleanupDeferred() { throw new Error('classifier'); } });
  let calls = 0;
  const lease = owner.acquire(async () => ({ host, dispose() { calls++; throw failure; } }));
  await lease.ready;
  lease.release();
  await tick();
  expect(owner.getSnapshot()).toMatchObject({ status: 'blocked', retryable: false });
  await expect(owner.retryShutdown()).rejects.toBe(failure);
  expect(calls).toBe(1);
});
