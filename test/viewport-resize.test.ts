import { describe, expect, it } from 'bun:test';
import { installViewportResizeObservation } from '../src/viewport-resize';

class ListenerHost {
  readonly listeners = new Set<EventListener>();

  addEventListener(type: string, listener: EventListener): void {
    expect(type).toBe('resize');
    this.listeners.add(listener);
  }

  removeEventListener(type: string, listener: EventListener): void {
    expect(type).toBe('resize');
    this.listeners.delete(listener);
  }

  emit(): void {
    for (const listener of [...this.listeners]) listener(new Event('resize'));
  }
}

describe('viewport resize observation', () => {
  it('forwards resize events and balances idempotent disposal', () => {
    const target = new ListenerHost();
    let calls = 0;
    const dispose = installViewportResizeObservation({
      target,
      onResize: () => { calls++; },
    });

    target.emit();
    target.emit();
    expect(calls).toBe(2);
    expect(target.listeners.size).toBe(1);

    dispose();
    dispose();
    target.emit();
    expect(calls).toBe(2);
    expect(target.listeners.size).toBe(0);
  });

  it('isolates callback and cleanup failures', () => {
    let retained: EventListener | undefined;
    const target = {
      addEventListener(_type: string, listener: EventListener): void { retained = listener; },
      removeEventListener(): void { throw new Error('cleanup failed'); },
    };
    let calls = 0;
    const dispose = installViewportResizeObservation({
      target,
      onResize: () => {
        calls++;
        throw new Error('callback failed');
      },
    });

    expect(() => retained?.(new Event('resize'))).not.toThrow();
    expect(() => dispose()).not.toThrow();
    expect(() => retained?.(new Event('resize'))).not.toThrow();
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

    const dispose = installViewportResizeObservation({
      target,
      onResize: () => { calls++; },
    });
    retained?.(new Event('resize'));
    dispose();

    expect(removals).toBe(1);
    expect(calls).toBe(0);
  });
});
