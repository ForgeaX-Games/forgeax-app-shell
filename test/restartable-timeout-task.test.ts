import { describe, expect, it } from 'bun:test';
import * as shell from '../src/react';

describe('restartable timeout-task lifecycle', () => {
  it('is available from the public React entry', () => {
    expect(typeof shell.createRestartableTimeoutTaskLifecycle).toBe('function');
  });

  it('restarts the exact delay, cancels handle zero, and fences replaced callbacks', () => {
    const callbacks: (() => void)[] = [];
    const delays: number[] = [];
    const cleared: unknown[] = [];
    let runs = 0;
    const task = shell.createRestartableTimeoutTaskLifecycle({
      task: () => { runs++; }, delayMs: 180,
      setTimeout: (callback, delay) => { delays.push(delay); callbacks.push(callback); return callbacks.length - 1; },
      clearTimeout: (handle) => { cleared.push(handle); },
    });
    task.schedule();
    task.schedule();
    expect(cleared).toEqual([0]);
    expect(delays).toEqual([180, 180]);
    callbacks[0]!();
    expect(runs).toBe(0);
    callbacks[1]!();
    callbacks[1]!();
    expect(runs).toBe(1);
    task.dispose();
    expect(cleared).toEqual([0]);
  });

  it('supports reusable cancellation and terminal idempotent disposal', () => {
    const callbacks: (() => void)[] = [];
    const cleared: unknown[] = [];
    const handles = [{}, {}];
    let runs = 0;
    const task = shell.createRestartableTimeoutTaskLifecycle({
      task: () => { runs++; }, delayMs: 1100,
      setTimeout: (callback) => { callbacks.push(callback); return handles[callbacks.length - 1]; },
      clearTimeout: (handle) => { cleared.push(handle); },
    });
    task.schedule();
    task.cancel();
    task.cancel();
    callbacks[0]!();
    task.schedule();
    task.dispose();
    task.dispose();
    task.cancel();
    task.schedule();
    callbacks[1]!();
    expect(runs).toBe(0);
    expect(callbacks).toHaveLength(2);
    expect(cleared).toEqual(handles);
  });

  it('releases pending state before product work schedules a successor', () => {
    const callbacks: (() => void)[] = [];
    const cleared: unknown[] = [];
    let runs = 0;
    const task = shell.createRestartableTimeoutTaskLifecycle({
      task: () => { if (++runs === 1) task.schedule(); }, delayMs: 10,
      setTimeout: (callback) => { callbacks.push(callback); return callbacks.length; },
      clearTimeout: (handle) => { cleared.push(handle); },
    });
    task.schedule();
    callbacks[0]!();
    expect(callbacks).toHaveLength(2);
    task.cancel();
    callbacks[1]!();
    expect(runs).toBe(1);
    expect(cleared).toEqual([2]);
  });

  it('supports synchronous scheduling without ghost pending state', () => {
    let runs = 0;
    const cleared: unknown[] = [];
    const task = shell.createRestartableTimeoutTaskLifecycle({
      task: () => { if (++runs === 1) task.schedule(); }, delayMs: 0,
      setTimeout: (callback) => { callback(); return 0; },
      clearTimeout: (handle) => { cleared.push(handle); },
    });
    task.schedule();
    task.schedule();
    task.dispose();
    expect(runs).toBe(3);
    expect(cleared).toEqual([]);
  });

  it('fences register-then-throw callbacks and remains reusable', () => {
    const callbacks: (() => void)[] = [];
    let runs = 0;
    const task = shell.createRestartableTimeoutTaskLifecycle({
      task: () => { runs++; }, delayMs: 1,
      setTimeout: (callback) => {
        callbacks.push(callback);
        if (callbacks.length === 1) throw new Error('registration failed');
        return callbacks.length;
      },
    });
    expect(() => task.schedule()).not.toThrow();
    callbacks[0]!();
    task.schedule();
    callbacks[1]!();
    expect(runs).toBe(1);
  });

  it('isolates product and cleanup failures while retaining stale fencing', () => {
    const callbacks: (() => void)[] = [];
    let runs = 0;
    const task = shell.createRestartableTimeoutTaskLifecycle({
      task: () => { runs++; throw new Error('product failed'); }, delayMs: 1,
      setTimeout: (callback) => { callbacks.push(callback); return callbacks.length; },
      clearTimeout: () => { throw new Error('cleanup failed'); },
    });
    task.schedule();
    expect(() => callbacks[0]!()).not.toThrow();
    task.schedule();
    expect(() => task.schedule()).not.toThrow();
    callbacks[1]!();
    expect(() => task.dispose()).not.toThrow();
    callbacks[2]!();
    expect(runs).toBe(1);
  });

  it('cancels a handle returned after disposal during registration', () => {
    const cleared: unknown[] = [];
    let retained: () => void = () => {};
    let runs = 0;
    const task = shell.createRestartableTimeoutTaskLifecycle({
      task: () => { runs++; }, delayMs: 1,
      setTimeout: (callback) => { retained = callback; task.dispose(); return 31; },
      clearTimeout: (handle) => { cleared.push(handle); },
    });
    task.schedule();
    retained();
    expect(cleared).toEqual([31]);
    expect(runs).toBe(0);
  });

  it('does not overwrite a successor scheduled reentrantly during cancellation', () => {
    const callbacks: (() => void)[] = [];
    const cleared: unknown[] = [];
    let runs = 0;
    const task = shell.createRestartableTimeoutTaskLifecycle({
      task: () => { runs++; }, delayMs: 1,
      setTimeout: (callback) => { callbacks.push(callback); return callbacks.length; },
      clearTimeout: (handle) => { cleared.push(handle); if (handle === 1) task.schedule(); },
    });
    task.schedule();
    task.schedule();
    expect(callbacks).toHaveLength(2);
    callbacks[0]!();
    callbacks[1]!();
    task.dispose();
    expect(runs).toBe(1);
    expect(cleared).toEqual([1]);
  });
});
