import { describe, expect, it } from 'bun:test';
import { installStorageObservation } from '../src/react';

type StorageListener = (event: StorageEvent) => void;

class ListenerHost {
  readonly listeners = new Set<StorageListener>();
  readonly registrations: string[] = [];
  readonly removals: string[] = [];

  addEventListener(type: 'storage', listener: StorageListener): void {
    this.registrations.push(type);
    this.listeners.add(listener);
  }

  removeEventListener(type: 'storage', listener: StorageListener): void {
    this.removals.push(type);
    this.listeners.delete(listener);
  }

  emit(event: StorageEvent): void {
    for (const listener of [...this.listeners]) listener(event);
  }
}

describe('storage observation', () => {
  it('forwards original storage events and balances idempotent disposal', () => {
    const target = new ListenerHost();
    const received: StorageEvent[] = [];
    const dispose = installStorageObservation({
      target,
      onStorage: (event) => { received.push(event); },
    });
    const event = { key: 'forgeax.onboarding' } as StorageEvent;

    target.emit(event);
    expect(received).toEqual([event]);
    expect(target.registrations).toEqual(['storage']);

    dispose();
    dispose();
    target.emit(event);
    expect(received).toEqual([event]);
    expect(target.removals).toEqual(['storage']);
  });

  it('isolates callback and cleanup failures while fencing a retained listener', () => {
    let retained: StorageListener | undefined;
    const target = {
      addEventListener(_type: 'storage', listener: StorageListener): void { retained = listener; },
      removeEventListener(): void { throw new Error('cleanup failed'); },
    };
    let calls = 0;
    const dispose = installStorageObservation({
      target,
      onStorage: () => {
        calls++;
        throw new Error('callback failed');
      },
    });

    expect(() => retained?.({} as StorageEvent)).not.toThrow();
    expect(() => dispose()).not.toThrow();
    expect(() => retained?.({} as StorageEvent)).not.toThrow();
    expect(calls).toBe(1);
  });

  it('rolls back and fences a listener retained by register-then-throw', () => {
    let retained: StorageListener | undefined;
    let removals = 0;
    const target = {
      addEventListener(_type: 'storage', listener: StorageListener): void {
        retained = listener;
        throw new Error('registered then failed');
      },
      removeEventListener(): void { removals++; },
    };
    let calls = 0;

    const dispose = installStorageObservation({
      target,
      onStorage: () => { calls++; },
    });
    retained?.({} as StorageEvent);
    dispose();

    expect(removals).toBe(1);
    expect(calls).toBe(0);
  });
});
