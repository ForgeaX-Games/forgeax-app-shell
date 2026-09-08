import { describe, expect, it } from 'bun:test';
import { installViewportScrollObservation } from '../src/viewport-scroll';

class ListenerHost {
  readonly listeners = new Set<EventListener>();
  readonly registrations: Array<{ type: string; capture: boolean }> = [];
  readonly removals: Array<{ type: string; capture: boolean }> = [];

  addEventListener(type: string, listener: EventListener, capture?: boolean): void {
    this.registrations.push({ type, capture: capture === true });
    this.listeners.add(listener);
  }

  removeEventListener(type: string, listener: EventListener, capture?: boolean): void {
    this.removals.push({ type, capture: capture === true });
    this.listeners.delete(listener);
  }

  emit(): void {
    for (const listener of [...this.listeners]) listener(new Event('scroll'));
  }
}

describe('viewport scroll observation', () => {
  it('forwards scroll events through exact capture registration and balances disposal', () => {
    const target = new ListenerHost();
    let calls = 0;
    const dispose = installViewportScrollObservation({
      target,
      onScroll: () => { calls++; },
    });

    target.emit();
    target.emit();
    expect(calls).toBe(2);
    expect(target.registrations).toEqual([{ type: 'scroll', capture: true }]);

    dispose();
    dispose();
    target.emit();
    expect(calls).toBe(2);
    expect(target.removals).toEqual([{ type: 'scroll', capture: true }]);
  });

  it('isolates callback and cleanup failures while fencing a retained listener', () => {
    let retained: EventListener | undefined;
    const target = {
      addEventListener(_type: string, listener: EventListener): void { retained = listener; },
      removeEventListener(): void { throw new Error('cleanup failed'); },
    };
    let calls = 0;
    const dispose = installViewportScrollObservation({
      target,
      onScroll: () => {
        calls++;
        throw new Error('callback failed');
      },
    });

    expect(() => retained?.(new Event('scroll'))).not.toThrow();
    expect(() => dispose()).not.toThrow();
    expect(() => retained?.(new Event('scroll'))).not.toThrow();
    expect(calls).toBe(1);
  });

  it('rolls back and fences a listener retained by register-then-throw', () => {
    let retained: EventListener | undefined;
    const removals: boolean[] = [];
    const target = {
      addEventListener(_type: string, listener: EventListener, capture?: boolean): void {
        expect(capture).toBe(true);
        retained = listener;
        throw new Error('registered then failed');
      },
      removeEventListener(_type: string, _listener: EventListener, capture?: boolean): void {
        removals.push(capture === true);
      },
    };
    let calls = 0;

    const dispose = installViewportScrollObservation({
      target,
      onScroll: () => { calls++; },
    });
    retained?.(new Event('scroll'));
    dispose();

    expect(removals).toEqual([true]);
    expect(calls).toBe(0);
  });
});
