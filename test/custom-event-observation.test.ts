import { describe, expect, it } from 'bun:test';
import { installCustomEventObservation } from '../src/custom-event-observation';

class ListenerHost {
  readonly listeners = new Map<string, Set<EventListener>>();

  addEventListener(type: string, listener: EventListener): void {
    const listeners = this.listeners.get(type) ?? new Set<EventListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: EventListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type: string, event: Event): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event);
  }
}

describe('custom event observation', () => {
  it('forwards the injected event type and balances idempotent disposal', () => {
    const target = new ListenerHost();
    const received: Event[] = [];
    const dispose = installCustomEventObservation({
      target,
      eventType: 'app:command',
      onEvent: (event) => { received.push(event); },
    });
    const event = new CustomEvent('app:command', { detail: { action: 'open' } });

    target.emit('unrelated', new Event('unrelated'));
    target.emit('app:command', event);
    expect(received).toEqual([event]);
    expect(target.listeners.get('app:command')?.size).toBe(1);

    dispose();
    dispose();
    target.emit('app:command', event);
    expect(received).toEqual([event]);
    expect(target.listeners.get('app:command')?.size).toBe(0);
  });

  it('isolates callback and cleanup failures', () => {
    let retained: EventListener | undefined;
    const target = {
      addEventListener(_type: string, listener: EventListener): void { retained = listener; },
      removeEventListener(): void { throw new Error('cleanup failed'); },
    };
    let calls = 0;
    const dispose = installCustomEventObservation({
      target,
      eventType: 'app:command',
      onEvent: () => {
        calls++;
        throw new Error('callback failed');
      },
    });

    expect(() => retained?.(new Event('app:command'))).not.toThrow();
    expect(() => dispose()).not.toThrow();
    expect(() => retained?.(new Event('app:command'))).not.toThrow();
    expect(calls).toBe(1);
  });

  it('rolls back and fences a listener retained by register-then-throw', () => {
    let retained: EventListener | undefined;
    let removals = 0;
    const target = {
      addEventListener(_type: string, listener: EventListener): void {
        retained = listener;
        throw new Error('registered then failed');
      },
      removeEventListener(): void { removals++; },
    };
    let calls = 0;

    const dispose = installCustomEventObservation({
      target,
      eventType: 'app:command',
      onEvent: () => { calls++; },
    });
    retained?.(new Event('app:command'));
    dispose();

    expect(removals).toBe(1);
    expect(calls).toBe(0);
  });
});
