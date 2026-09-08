import { describe, expect, it } from 'bun:test';
import { installLayoutFromJsonObservation } from '../src/layout-from-json-observation';

describe('layout-from-JSON observation', () => {
  it('forwards original events and balances idempotent disposal', () => {
    let listener: ((event: { revision: number }) => void) | undefined;
    let disposals = 0;
    const received: Array<{ revision: number }> = [];
    const dispose = installLayoutFromJsonObservation<{ revision: number }>({
      subscribe: (next) => {
        listener = next;
        return { dispose: () => { disposals++; } };
      },
      onHydrated: (event) => { received.push(event); },
    });
    const event = { revision: 1 };

    listener?.(event);
    dispose();
    dispose();
    listener?.({ revision: 2 });

    expect(received).toEqual([event]);
    expect(disposals).toBe(1);
  });

  it('isolates callback and cleanup failures while fencing retained listeners', () => {
    let listener: ((event: string) => void) | undefined;
    const calls: string[] = [];
    const dispose = installLayoutFromJsonObservation<string>({
      subscribe: (next) => {
        listener = next;
        return { dispose: () => { throw new Error('cleanup failed'); } };
      },
      onHydrated: (event) => {
        calls.push(event);
        throw new Error('callback failed');
      },
    });

    expect(() => listener?.('hydrated')).not.toThrow();
    expect(() => dispose()).not.toThrow();
    expect(() => listener?.('stale')).not.toThrow();
    expect(calls).toEqual(['hydrated']);
  });

  it('rolls back the lifecycle and fences a listener retained by subscribe-then-throw', () => {
    let listener: ((event: number) => void) | undefined;
    let calls = 0;
    const dispose = installLayoutFromJsonObservation<number>({
      subscribe: (next) => {
        listener = next;
        throw new Error('subscribed then failed');
      },
      onHydrated: () => { calls++; },
    });

    listener?.(1);
    dispose();

    expect(calls).toBe(0);
  });
});
