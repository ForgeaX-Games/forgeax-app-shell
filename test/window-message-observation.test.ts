import { describe, expect, it } from 'bun:test';
import { installWindowMessageObservation } from '../src/react';

type MessageListener = (event: MessageEvent) => void;

class ListenerHost {
  readonly listeners = new Set<MessageListener>();
  readonly registrations: string[] = [];
  readonly removals: string[] = [];

  addEventListener(type: 'message', listener: MessageListener): void {
    this.registrations.push(type);
    this.listeners.add(listener);
  }

  removeEventListener(type: 'message', listener: MessageListener): void {
    this.removals.push(type);
    this.listeners.delete(listener);
  }

  emit(event: MessageEvent): void {
    for (const listener of [...this.listeners]) listener(event);
  }
}

describe('window message observation', () => {
  it('forwards original message events and balances idempotent disposal', () => {
    const target = new ListenerHost();
    const received: MessageEvent[] = [];
    const dispose = installWindowMessageObservation({
      target,
      onMessage: (event) => { received.push(event); },
    });
    const event = new MessageEvent('message', { data: { type: 'extension:ready' } });

    target.emit(event);
    expect(received).toEqual([event]);
    expect(target.registrations).toEqual(['message']);

    dispose();
    dispose();
    target.emit(event);
    expect(received).toEqual([event]);
    expect(target.removals).toEqual(['message']);
  });

  it('isolates callback and cleanup failures while fencing a retained listener', () => {
    let retained: MessageListener | undefined;
    const target = {
      addEventListener(_type: 'message', listener: MessageListener): void { retained = listener; },
      removeEventListener(): void { throw new Error('cleanup failed'); },
    };
    let calls = 0;
    const dispose = installWindowMessageObservation({
      target,
      onMessage: () => {
        calls++;
        throw new Error('callback failed');
      },
    });

    expect(() => retained?.(new MessageEvent('message'))).not.toThrow();
    expect(() => dispose()).not.toThrow();
    expect(() => retained?.(new MessageEvent('message'))).not.toThrow();
    expect(calls).toBe(1);
  });

  it('rolls back and fences a listener retained by register-then-throw', () => {
    let retained: MessageListener | undefined;
    let removals = 0;
    const target = {
      addEventListener(_type: 'message', listener: MessageListener): void {
        retained = listener;
        throw new Error('registered then failed');
      },
      removeEventListener(): void { removals++; },
    };
    let calls = 0;

    const dispose = installWindowMessageObservation({
      target,
      onMessage: () => { calls++; },
    });
    retained?.(new MessageEvent('message'));
    dispose();

    expect(removals).toBe(1);
    expect(calls).toBe(0);
  });
});
