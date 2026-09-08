import { describe, expect, it } from 'bun:test';
import * as shell from '../src/react';

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('settled polling lifecycle', () => {
  it('is available from the public React entry', () => {
    expect(typeof shell.createSettledPollingLifecycle).toBe('function');
  });

  it('runs immediately, never overlaps unsettled work, and disposes idempotently', async () => {
    const callbacks: Array<() => void> = [];
    const delays: number[] = [];
    const cleared: unknown[] = [];
    const releases: Array<() => void> = [];
    const signals: AbortSignal[] = [];
    let calls = 0;
    const poll = shell.createSettledPollingLifecycle({
      task: (signal) => {
        calls += 1;
        signals.push(signal);
        return new Promise<void>((resolve) => { releases.push(resolve); });
      },
      intervalMs: 100,
      timeoutMs: 50,
      setTimeout: (callback, delay) => {
        callbacks.push(callback);
        delays.push(delay);
        return callbacks.length - 1;
      },
      clearTimeout: (handle) => { cleared.push(handle); },
    });

    poll.start();
    poll.start();
    expect(calls).toBe(1);
    expect(delays).toEqual([50]);

    releases[0]!();
    await flush();
    expect(delays).toEqual([50, 100]);
    expect(cleared).toEqual([0]);

    callbacks[1]!();
    expect(calls).toBe(2);
    expect(delays).toEqual([50, 100, 50]);
    poll.dispose();
    poll.dispose();
    expect(signals[1]!.aborted).toBe(true);
    expect(cleared).toEqual([0, 2]);

    callbacks[1]!();
    callbacks[2]!();
    releases[1]!();
    await flush();
    expect(calls).toBe(2);
    expect(delays).toEqual([50, 100, 50]);
  });

  it('pauses while hidden and applies bounded failure backoff after settlement', async () => {
    const callbacks: Array<() => void> = [];
    const delays: number[] = [];
    let visible = false;
    let calls = 0;
    const poll = shell.createSettledPollingLifecycle({
      task: async () => {
        calls += 1;
        throw new Error('offline');
      },
      intervalMs: 100,
      timeoutMs: 25,
      maxBackoffMs: 150,
      isVisible: () => visible,
      setTimeout: (callback, delay) => {
        callbacks.push(callback);
        delays.push(delay);
        return callbacks.length;
      },
      clearTimeout: () => {},
    });

    poll.start();
    expect(calls).toBe(0);
    expect(delays).toEqual([100]);
    visible = true;
    callbacks[0]!();
    await flush();
    expect(calls).toBe(1);
    expect(delays).toEqual([100, 25, 100]);
    callbacks[2]!();
    await flush();
    expect(calls).toBe(2);
    expect(delays).toEqual([100, 25, 100, 25, 150]);
    poll.dispose();
  });

  it('aborts at the deadline without overlapping a task that has not settled', async () => {
    const callbacks: Array<() => void> = [];
    const delays: number[] = [];
    let release!: () => void;
    let calls = 0;
    let signal!: AbortSignal;
    const poll = shell.createSettledPollingLifecycle({
      task: (currentSignal) => {
        calls += 1;
        signal = currentSignal;
        return new Promise<void>((resolve) => { release = resolve; });
      },
      intervalMs: 80,
      timeoutMs: 20,
      isVisible: () => true,
      setTimeout: (callback, delay) => {
        callbacks.push(callback);
        delays.push(delay);
        return callbacks.length;
      },
      clearTimeout: () => {},
    });

    poll.start();
    expect(calls).toBe(1);
    callbacks[0]!();
    callbacks[0]!();
    expect(signal.aborted).toBe(true);
    expect(calls).toBe(1);
    expect(delays).toEqual([20]);
    release();
    await flush();
    expect(delays).toEqual([20, 80]);
    poll.dispose();
  });

  it('isolates scheduler, visibility, task, and cleanup failures while fencing retained callbacks', async () => {
    const callbacks: Array<() => void> = [];
    let taskCalls = 0;
    let registrations = 0;
    const poll = shell.createSettledPollingLifecycle({
      task: async () => { taskCalls += 1; throw new Error('task'); },
      intervalMs: 10,
      isVisible: () => { throw new Error('visibility'); },
      setTimeout: (callback) => {
        callbacks.push(callback);
        registrations += 1;
        throw new Error('register');
      },
      clearTimeout: () => { throw new Error('cleanup'); },
    });

    expect(() => poll.start()).not.toThrow();
    await flush();
    for (const callback of callbacks) expect(() => callback()).not.toThrow();
    expect(() => poll.dispose()).not.toThrow();
    expect(() => poll.start()).not.toThrow();
    expect(taskCalls).toBe(0);
    expect(registrations).toBe(1);
  });
});
