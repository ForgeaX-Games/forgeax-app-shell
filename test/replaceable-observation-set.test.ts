import { describe, expect, it } from 'bun:test';
import { createReplaceableObservationSetLifecycle } from '../src/replaceable-observation-set';

class ObservationItem {
  readonly listeners = new Set<(value: string) => void>();
  disposals = 0;

  constructor(readonly id: string) {}

  subscribe(listener: (value: string) => void): { dispose: () => void } {
    this.listeners.add(listener);
    return {
      dispose: () => {
        this.disposals++;
        this.listeners.delete(listener);
      },
    };
  }

  emit(value: string): void {
    for (const listener of [...this.listeners]) listener(value);
  }
}

describe('replaceable observation-set lifecycle', () => {
  it('replaces subscriptions, forwards current observations, and disposes in reverse', () => {
    const first = new ObservationItem('first');
    const second = new ObservationItem('second');
    const replacement = new ObservationItem('replacement');
    const received: string[] = [];
    const disposalOrder: string[] = [];
    const lifecycle = createReplaceableObservationSetLifecycle<ObservationItem, string>({
      subscribe: (item, listener) => {
        const subscription = item.subscribe(listener);
        return {
          dispose: () => {
            disposalOrder.push(item.id);
            subscription.dispose();
          },
        };
      },
      onObservation: (item, value) => { received.push(`${item.id}:${value}`); },
    });

    lifecycle.replace([first, second]);
    first.emit('a');
    second.emit('b');
    lifecycle.replace([replacement]);
    first.emit('stale');
    second.emit('stale');
    replacement.emit('c');

    expect(received).toEqual(['first:a', 'second:b', 'replacement:c']);
    expect(disposalOrder).toEqual(['second', 'first']);

    lifecycle.dispose();
    lifecycle.dispose();
    expect(disposalOrder).toEqual(['second', 'first', 'replacement']);
    replacement.emit('stale');
    expect(received).toEqual(['first:a', 'second:b', 'replacement:c']);
  });

  it('rolls back partial registration and fences a retained listener after subscribe throws', () => {
    const first = new ObservationItem('first');
    const retained = new ObservationItem('retained');
    const received: string[] = [];
    const lifecycle = createReplaceableObservationSetLifecycle<ObservationItem, string>({
      subscribe: (item, listener) => {
        if (item === retained) {
          item.listeners.add(listener);
          throw new Error('registered then failed');
        }
        return item.subscribe(listener);
      },
      onObservation: (item, value) => { received.push(`${item.id}:${value}`); },
    });

    expect(() => lifecycle.replace([first, retained])).not.toThrow();
    first.emit('stale');
    retained.emit('stale');

    expect(first.disposals).toBe(1);
    expect(received).toEqual([]);
    expect(() => lifecycle.dispose()).not.toThrow();
  });

  it('isolates observation, subscription, and cleanup failures while remaining reusable', () => {
    const throwingCleanup = new ObservationItem('throwing-cleanup');
    const replacement = new ObservationItem('replacement');
    let observations = 0;
    const lifecycle = createReplaceableObservationSetLifecycle<ObservationItem, string>({
      subscribe: (item, listener) => {
        const subscription = item.subscribe(listener);
        if (item === throwingCleanup) {
          return { dispose: () => { subscription.dispose(); throw new Error('cleanup failed'); } };
        }
        return subscription;
      },
      onObservation: () => {
        observations++;
        throw new Error('observation failed');
      },
    });

    lifecycle.replace([throwingCleanup]);
    expect(() => throwingCleanup.emit('current')).not.toThrow();
    expect(() => lifecycle.replace([replacement])).not.toThrow();
    expect(() => replacement.emit('current')).not.toThrow();
    expect(observations).toBe(2);
    expect(() => lifecycle.dispose()).not.toThrow();
  });

  it('keeps a cleanup-reentrant replacement current and abandons the stale outer request', () => {
    const first = new ObservationItem('first');
    const staleRequest = new ObservationItem('stale-request');
    const replacement = new ObservationItem('replacement');
    const received: string[] = [];
    let reentered = false;
    let lifecycle: ReturnType<typeof createReplaceableObservationSetLifecycle<ObservationItem, string>>;
    lifecycle = createReplaceableObservationSetLifecycle<ObservationItem, string>({
      subscribe: (item, listener) => {
        const subscription = item.subscribe(listener);
        return {
          dispose: () => {
            subscription.dispose();
            if (item === first && !reentered) {
              reentered = true;
              lifecycle.replace([replacement]);
            }
          },
        };
      },
      onObservation: (item, value) => { received.push(`${item.id}:${value}`); },
    });

    lifecycle.replace([first]);
    lifecycle.replace([staleRequest]);
    staleRequest.emit('stale');
    replacement.emit('current');

    expect(staleRequest.listeners.size).toBe(0);
    expect(received).toEqual(['replacement:current']);
    lifecycle.dispose();
  });
});
