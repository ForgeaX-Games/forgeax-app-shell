import { describe, expect, it } from 'bun:test';
import { createCoalescedFrameTaskLifecycle } from '../src/coalesced-frame-task';

describe('coalesced frame-task lifecycle', () => {
  it('coalesces duplicate schedules and releases pending state before product work', () => {
    const callbacks: FrameRequestCallback[] = [];
    let runs = 0;
    let lifecycle: ReturnType<typeof createCoalescedFrameTaskLifecycle>;
    lifecycle = createCoalescedFrameTaskLifecycle({
      task: () => {
        runs++;
        if (runs === 1) lifecycle.schedule();
      },
      requestFrame: (callback) => {
        callbacks.push(callback);
        return callbacks.length;
      },
    });

    lifecycle.schedule();
    lifecycle.schedule();
    expect(callbacks).toHaveLength(1);

    callbacks.shift()?.(0);
    expect(runs).toBe(1);
    expect(callbacks).toHaveLength(1);

    callbacks.shift()?.(16);
    expect(runs).toBe(2);
  });

  it('cancels disposal and fences a retained callback', () => {
    const callbacks: FrameRequestCallback[] = [];
    const cancelled: number[] = [];
    let runs = 0;
    const lifecycle = createCoalescedFrameTaskLifecycle({
      task: () => { runs++; },
      requestFrame: (callback) => {
        callbacks.push(callback);
        return 41;
      },
      cancelFrame: (handle) => { cancelled.push(handle); },
    });

    lifecycle.schedule();
    lifecycle.dispose();
    lifecycle.dispose();
    callbacks[0]?.(0);
    lifecycle.schedule();

    expect(cancelled).toEqual([41]);
    expect(runs).toBe(0);
    expect(callbacks).toHaveLength(1);
  });

  it('supports a synchronous scheduler and same-task reentry without ghost pending state', () => {
    let runs = 0;
    let lifecycle: ReturnType<typeof createCoalescedFrameTaskLifecycle>;
    lifecycle = createCoalescedFrameTaskLifecycle({
      task: () => {
        runs++;
        if (runs === 1) lifecycle.schedule();
      },
      requestFrame: (callback) => {
        callback(0);
        return 7;
      },
    });

    lifecycle.schedule();
    lifecycle.schedule();

    expect(runs).toBe(3);
  });

  it('fences a retained callback when the scheduler throws after registration', () => {
    const callbacks: FrameRequestCallback[] = [];
    let attempts = 0;
    let runs = 0;
    const lifecycle = createCoalescedFrameTaskLifecycle({
      task: () => { runs++; },
      requestFrame: (callback) => {
        callbacks.push(callback);
        if (++attempts === 1) throw new Error('registered then failed');
        return 52;
      },
    });

    lifecycle.schedule();
    callbacks[0]?.(0);
    lifecycle.schedule();
    callbacks[1]?.(16);

    expect(runs).toBe(1);
  });

  it('isolates product-task failures and remains reusable', () => {
    const callbacks: FrameRequestCallback[] = [];
    let attempts = 0;
    const lifecycle = createCoalescedFrameTaskLifecycle({
      task: () => {
        if (++attempts === 1) throw new Error('product task failed');
      },
      requestFrame: (callback) => {
        callbacks.push(callback);
        return callbacks.length;
      },
    });

    lifecycle.schedule();
    callbacks.shift()?.(0);
    lifecycle.schedule();
    callbacks.shift()?.(16);

    expect(attempts).toBe(2);
  });
});
