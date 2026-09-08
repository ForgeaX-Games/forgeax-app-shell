import { describe, expect, it } from 'bun:test';
import * as shell from '../src/react';

describe('fixed interval-task lifecycle', () => {
  it('is available from the public React entry', () => {
    expect(typeof shell.createIntervalTaskLifecycle).toBe('function');
  });

  it('starts explicitly once, preserves cadence and clears handle zero once', () => {
    let callback!: () => void;
    const delays: number[] = [];
    const cleared: unknown[] = [];
    let runs = 0;
    const task = shell.createIntervalTaskLifecycle({
      task: () => { runs++; }, intervalMs: 4000,
      setInterval: (tick, delay) => { callback = tick; delays.push(delay); return 0; },
      clearInterval: (handle) => { cleared.push(handle); },
    });
    expect(delays).toEqual([]);
    expect(runs).toBe(0);
    task.start();
    task.start();
    expect(delays).toEqual([4000]);
    expect(runs).toBe(0);
    callback();
    callback();
    expect(runs).toBe(2);
    task.dispose();
    task.dispose();
    task.start();
    callback();
    expect(runs).toBe(2);
    expect(cleared).toEqual([0]);
    expect(delays).toEqual([4000]);
  });

  it('supports opaque and undefined handles without truthiness checks', () => {
    for (const handle of [{}, undefined]) {
      const cleared: unknown[] = [];
      const task = shell.createIntervalTaskLifecycle({
        task: () => {}, intervalMs: 250,
        setInterval: () => handle,
        clearInterval: (value) => { cleared.push(value); },
      });
      task.start();
      task.dispose();
      expect(cleared).toEqual([handle]);
    }
  });

  it('keeps later ticks alive after a caller callback throws', () => {
    let callback!: () => void;
    let runs = 0;
    const task = shell.createIntervalTaskLifecycle({
      task: () => { runs++; throw new Error('caller'); }, intervalMs: 10,
      setInterval: (tick) => { callback = tick; return 3; }, clearInterval: () => {},
    });
    task.start();
    expect(() => callback()).not.toThrow();
    expect(() => callback()).not.toThrow();
    expect(runs).toBe(2);
    task.dispose();
  });

  it('clears a late handle when a synchronous registration tick disposes the task', () => {
    const cleared: unknown[] = [];
    let runs = 0;
    const task = shell.createIntervalTaskLifecycle({
      task: () => { runs++; task.dispose(); }, intervalMs: 250,
      setInterval: (tick) => { tick(); tick(); return 7; },
      clearInterval: (handle) => { cleared.push(handle); },
    });
    task.start();
    task.dispose();
    expect(runs).toBe(1);
    expect(cleared).toEqual([7]);
  });

  it('fences a callback retained by a registration that throws without returning a handle', () => {
    let callback!: () => void;
    let runs = 0;
    let registrations = 0;
    const task = shell.createIntervalTaskLifecycle({
      task: () => { runs++; }, intervalMs: 250,
      setInterval: (tick) => { registrations++; callback = tick; throw new Error('register'); },
      clearInterval: () => { throw new Error('no handle was returned'); },
    });
    expect(() => task.start()).not.toThrow();
    callback();
    task.start();
    task.dispose();
    expect(runs).toBe(0);
    expect(registrations).toBe(1);
  });

  it('fences reentrant and retained callbacks even when cleanup throws', () => {
    let callback!: () => void;
    let runs = 0;
    let clears = 0;
    const task = shell.createIntervalTaskLifecycle({
      task: () => { runs++; }, intervalMs: 250,
      setInterval: (tick) => { callback = tick; return 1; },
      clearInterval: () => { clears++; callback(); task.start(); throw new Error('clear'); },
    });
    task.start();
    expect(() => task.dispose()).not.toThrow();
    task.dispose();
    callback();
    expect(runs).toBe(0);
    expect(clears).toBe(1);
  });

  it('can be disposed before start without registering any interval', () => {
    let registrations = 0;
    const task = shell.createIntervalTaskLifecycle({
      task: () => {}, intervalMs: 250,
      setInterval: () => { registrations++; return 1; }, clearInterval: () => {},
    });
    task.dispose();
    task.start();
    expect(registrations).toBe(0);
  });
});
