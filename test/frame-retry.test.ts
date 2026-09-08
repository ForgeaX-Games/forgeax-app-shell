import { describe, expect, it } from 'bun:test';
import { installBoundedFrameRetryLifecycle } from '../src/react';

describe('bounded frame-retry lifecycle', () => {
  it('attempts immediately and publishes success without scheduling', () => {
    let attempts = 0;
    let successes = 0;
    let scheduled = 0;

    const dispose = installBoundedFrameRetryLifecycle({
      attempt: () => { attempts++; return true; },
      onSuccess: () => { successes++; },
      requestFrame: () => { scheduled++; return 1; },
      cancelFrame: () => {},
    });

    expect({ attempts, successes, scheduled }).toEqual({
      attempts: 1,
      successes: 1,
      scheduled: 0,
    });
    dispose();
  });

  it('retries by frame until success and publishes once', () => {
    const callbacks = new Map<number, FrameRequestCallback>();
    const cancelled: number[] = [];
    let nextFrame = 0;
    let attempts = 0;
    let successes = 0;

    const dispose = installBoundedFrameRetryLifecycle({
      attempt: () => ++attempts === 3,
      onSuccess: () => { successes++; },
      maxFrames: 5,
      requestFrame: (callback) => {
        const id = ++nextFrame;
        callbacks.set(id, callback);
        return id;
      },
      cancelFrame: (handle) => { cancelled.push(handle); },
    });

    expect(attempts).toBe(1);
    callbacks.get(1)?.(0);
    expect(attempts).toBe(2);
    callbacks.get(2)?.(0);
    expect({ attempts, successes, nextFrame }).toEqual({
      attempts: 3,
      successes: 1,
      nextFrame: 2,
    });

    dispose();
    expect(cancelled).toEqual([]);
    callbacks.get(2)?.(0);
    expect({ attempts, successes }).toEqual({ attempts: 3, successes: 1 });
  });

  it('stops after the exact scheduled-frame budget', () => {
    const callbacks = new Map<number, FrameRequestCallback>();
    let nextFrame = 0;
    let attempts = 0;

    const dispose = installBoundedFrameRetryLifecycle({
      attempt: () => { attempts++; return false; },
      maxFrames: 2,
      requestFrame: (callback) => {
        const id = ++nextFrame;
        callbacks.set(id, callback);
        return id;
      },
      cancelFrame: () => {},
    });

    callbacks.get(1)?.(0);
    callbacks.get(2)?.(0);
    expect({ attempts, nextFrame }).toEqual({ attempts: 3, nextFrame: 2 });
    dispose();
  });

  it('cancels disposal and fences a retained scheduled callback', () => {
    const callbacks = new Map<number, FrameRequestCallback>();
    const cancelled: number[] = [];
    let attempts = 0;

    const dispose = installBoundedFrameRetryLifecycle({
      attempt: () => { attempts++; return false; },
      requestFrame: (callback) => {
        callbacks.set(7, callback);
        return 7;
      },
      cancelFrame: (handle) => { cancelled.push(handle); },
    });

    dispose();
    dispose();
    expect(cancelled).toEqual([7]);
    callbacks.get(7)?.(0);
    expect(attempts).toBe(1);
  });

  it('bounds a synchronous scheduler without retaining completed handles', () => {
    const cancelled: number[] = [];
    let nextFrame = 0;
    let attempts = 0;

    const dispose = installBoundedFrameRetryLifecycle({
      attempt: () => { attempts++; return false; },
      maxFrames: 2,
      requestFrame: (callback) => {
        const id = ++nextFrame;
        callback(0);
        return id;
      },
      cancelFrame: (handle) => { cancelled.push(handle); },
    });

    expect({ attempts, nextFrame, cancelled }).toEqual({
      attempts: 3,
      nextFrame: 2,
      cancelled: [2, 1],
    });
    dispose();
  });

  it('fences a callback retained by a scheduler that throws after registration', () => {
    let retained: FrameRequestCallback | undefined;
    let attempts = 0;

    const dispose = installBoundedFrameRetryLifecycle({
      attempt: () => { attempts++; return false; },
      requestFrame: (callback) => {
        retained = callback;
        throw new Error('registered then failed');
      },
      cancelFrame: () => {},
    });

    expect(attempts).toBe(1);
    retained?.(0);
    expect(attempts).toBe(1);
    dispose();
  });

  it('claims one callback generation before product work can reenter it', () => {
    const callbacks = new Map<number, FrameRequestCallback>();
    let nextFrame = 0;
    let attempts = 0;

    const dispose = installBoundedFrameRetryLifecycle({
      attempt: () => {
        attempts++;
        if (attempts === 2) callbacks.get(1)?.(0);
        return attempts === 3;
      },
      maxFrames: 3,
      requestFrame: (callback) => {
        const id = ++nextFrame;
        callbacks.set(id, callback);
        return id;
      },
      cancelFrame: () => {},
    });

    callbacks.get(1)?.(0);
    expect({ attempts, nextFrame }).toEqual({ attempts: 2, nextFrame: 2 });
    callbacks.get(2)?.(0);
    expect({ attempts, nextFrame }).toEqual({ attempts: 3, nextFrame: 2 });
    dispose();
  });

  it('isolates injected failures without resurrecting stale work', () => {
    const callbacks = new Map<number, FrameRequestCallback>();
    let nextFrame = 0;
    let attempts = 0;
    let successes = 0;

    const dispose = installBoundedFrameRetryLifecycle({
      attempt: () => {
        attempts++;
        if (attempts === 1) throw new Error('not ready');
        return true;
      },
      onSuccess: () => { successes++; throw new Error('notification failed'); },
      requestFrame: (callback) => {
        const id = ++nextFrame;
        callbacks.set(id, callback);
        return id;
      },
      cancelFrame: () => { throw new Error('cancellation failed'); },
    });

    callbacks.get(1)?.(0);
    expect({ attempts, successes, nextFrame }).toEqual({
      attempts: 2,
      successes: 1,
      nextFrame: 1,
    });
    dispose();

    expect(() => installBoundedFrameRetryLifecycle({
      attempt: () => false,
      requestFrame: () => { throw new Error('scheduler unavailable'); },
      cancelFrame: () => {},
    })()).not.toThrow();
  });
});
