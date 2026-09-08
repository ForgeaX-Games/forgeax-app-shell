import { describe, expect, it } from 'bun:test';
import { installWillDropObservation } from '../src/will-drop-observation';

describe('will-drop observation', () => {
  it('forwards original events and balances idempotent disposal', () => {
    let listener: ((event: { kind: string }) => void) | undefined;
    let disposals = 0;
    const received: Array<{ kind: string }> = [];
    const dispose = installWillDropObservation<{ kind: string }>({
      subscribe: (next) => {
        listener = next;
        return { dispose: () => { disposals++; } };
      },
      onWillDrop: (event) => { received.push(event); },
    });
    const event = { kind: 'edge' };

    listener?.(event);
    dispose();
    dispose();
    listener?.({ kind: 'stale' });

    expect(received).toEqual([event]);
    expect(disposals).toBe(1);
  });

  it('isolates callback and cleanup failures while fencing retained listeners', () => {
    let listener: ((event: string) => void) | undefined;
    const calls: string[] = [];
    const dispose = installWillDropObservation<string>({
      subscribe: (next) => {
        listener = next;
        return { dispose: () => { throw new Error('cleanup failed'); } };
      },
      onWillDrop: (event) => {
        calls.push(event);
        throw new Error('callback failed');
      },
    });

    expect(() => listener?.('drop')).not.toThrow();
    expect(() => dispose()).not.toThrow();
    expect(() => listener?.('stale')).not.toThrow();
    expect(calls).toEqual(['drop']);
  });

  it('rolls back the lifecycle and fences a listener retained by subscribe-then-throw', () => {
    let listener: ((event: number) => void) | undefined;
    let calls = 0;
    const dispose = installWillDropObservation<number>({
      subscribe: (next) => {
        listener = next;
        throw new Error('subscribed then failed');
      },
      onWillDrop: () => { calls++; },
    });

    listener?.(1);
    dispose();

    expect(calls).toBe(0);
  });
});
