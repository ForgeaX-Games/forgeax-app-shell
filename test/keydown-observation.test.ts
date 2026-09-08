import { describe, expect, it } from 'bun:test';
import { installKeydownObservation } from '../src/react';

type KeyListener = (event: KeyboardEvent) => void;

class ListenerHost {
  readonly listeners = new Set<KeyListener>();
  readonly registrations: boolean[] = [];
  readonly removals: boolean[] = [];

  addEventListener(_type: 'keydown', listener: KeyListener, capture = false): void {
    this.registrations.push(capture);
    this.listeners.add(listener);
  }

  removeEventListener(_type: 'keydown', listener: KeyListener, capture = false): void {
    this.removals.push(capture);
    this.listeners.delete(listener);
  }

  emit(event: KeyboardEvent): void {
    for (const listener of [...this.listeners]) listener(event);
  }
}

describe('keydown observation', () => {
  it('forwards original events with caller-selected capture and balanced disposal', () => {
    const target = new ListenerHost();
    const received: KeyboardEvent[] = [];
    const dispose = installKeydownObservation({
      target,
      capture: true,
      onKeyDown: (event) => { received.push(event); },
    });
    const event = { key: 'Escape' } as KeyboardEvent;

    target.emit(event);
    expect(received).toEqual([event]);
    expect(target.registrations).toEqual([true]);

    dispose();
    dispose();
    target.emit(event);
    expect(received).toEqual([event]);
    expect(target.removals).toEqual([true]);
  });

  it('defaults to bubble registration and isolates callback and cleanup failures', () => {
    let retained: KeyListener | undefined;
    const target = {
      addEventListener(_type: 'keydown', listener: KeyListener, capture?: boolean): void {
        expect(capture).toBe(false);
        retained = listener;
      },
      removeEventListener(_type: 'keydown', _listener: KeyListener, capture?: boolean): void {
        expect(capture).toBe(false);
        throw new Error('cleanup failed');
      },
    };
    let calls = 0;
    const dispose = installKeydownObservation({
      target,
      onKeyDown: () => {
        calls++;
        throw new Error('callback failed');
      },
    });

    const event = { key: 'Escape' } as KeyboardEvent;
    expect(() => retained?.(event)).not.toThrow();
    expect(() => dispose()).not.toThrow();
    expect(() => retained?.(event)).not.toThrow();
    expect(calls).toBe(1);
  });

  it('rolls back and fences a listener retained by register-then-throw', () => {
    let retained: KeyListener | undefined;
    let removals = 0;
    const target = {
      addEventListener(_type: 'keydown', listener: KeyListener): void {
        retained = listener;
        throw new Error('registered then failed');
      },
      removeEventListener(): void { removals++; },
    };
    let calls = 0;

    const dispose = installKeydownObservation({
      target,
      onKeyDown: () => { calls++; },
    });
    retained?.({ key: 'Escape' } as KeyboardEvent);
    dispose();

    expect(removals).toBe(1);
    expect(calls).toBe(0);
  });
});
