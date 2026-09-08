import { describe, expect, it } from 'bun:test';
import { installActivePanelObservation } from '../src/active-panel-observation';

describe('active-panel observation', () => {
  it('forwards original events and balances idempotent disposal', () => {
    let listener: ((event: { id: string }) => void) | undefined;
    let disposals = 0;
    const received: Array<{ id: string }> = [];
    const dispose = installActivePanelObservation<{ id: string }>({
      subscribe: (next) => {
        listener = next;
        return { dispose: () => { disposals++; } };
      },
      onChange: (event) => { received.push(event); },
    });
    const event = { id: 'active' };

    listener?.(event);
    dispose();
    dispose();
    listener?.({ id: 'stale' });

    expect(received).toEqual([event]);
    expect(disposals).toBe(1);
  });

  it('isolates callback and cleanup failures while fencing retained listeners', () => {
    let listener: ((event: string) => void) | undefined;
    const calls: string[] = [];
    const dispose = installActivePanelObservation<string>({
      subscribe: (next) => {
        listener = next;
        return { dispose: () => { throw new Error('cleanup failed'); } };
      },
      onChange: (event) => {
        calls.push(event);
        throw new Error('callback failed');
      },
    });

    expect(() => listener?.('active')).not.toThrow();
    expect(() => dispose()).not.toThrow();
    expect(() => listener?.('stale')).not.toThrow();
    expect(calls).toEqual(['active']);
  });

  it('rolls back the lifecycle and fences a listener retained by subscribe-then-throw', () => {
    let listener: ((event: number) => void) | undefined;
    let calls = 0;
    const dispose = installActivePanelObservation<number>({
      subscribe: (next) => {
        listener = next;
        throw new Error('subscribed then failed');
      },
      onChange: () => { calls++; },
    });

    listener?.(1);
    dispose();

    expect(calls).toBe(0);
  });
});
