import { describe, expect, it } from 'bun:test';
import { installCaptureInteractionObservation } from '../src/capture-interaction-observation';

class CaptureListenerHost {
  readonly listeners = new Map<string, Set<EventListener>>();
  readonly registrations: Array<{ type: string; capture: boolean | undefined }> = [];

  addEventListener(type: string, listener: EventListener, capture?: boolean): void {
    this.registrations.push({ type, capture });
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

describe('capture interaction observation', () => {
  it('forwards pointerdown and click through exact capture registrations', () => {
    const target = new CaptureListenerHost();
    const received: Event[] = [];
    const dispose = installCaptureInteractionObservation({
      target,
      onPointerDown: (event) => { received.push(event); },
      onClick: (event) => { received.push(event); },
    });
    const pointer = new Event('pointerdown') as PointerEvent;
    const click = new Event('click') as MouseEvent;

    target.emit('pointerdown', pointer);
    target.emit('click', click);

    expect(received).toEqual([pointer, click]);
    expect(target.registrations).toEqual([
      { type: 'pointerdown', capture: true },
      { type: 'click', capture: true },
    ]);

    dispose();
    dispose();
    target.emit('pointerdown', pointer);
    target.emit('click', click);
    expect(received).toEqual([pointer, click]);
  });

  it('isolates callback and cleanup failures while fencing retained listeners', () => {
    const retained = new Map<string, EventListener>();
    const target = {
      addEventListener(type: string, listener: EventListener): void { retained.set(type, listener); },
      removeEventListener(): void { throw new Error('cleanup failed'); },
    };
    const calls: string[] = [];
    const dispose = installCaptureInteractionObservation({
      target,
      onPointerDown: () => {
        calls.push('pointerdown');
        throw new Error('pointer callback failed');
      },
      onClick: () => {
        calls.push('click');
        throw new Error('click callback failed');
      },
    });

    expect(() => retained.get('pointerdown')?.(new Event('pointerdown'))).not.toThrow();
    expect(() => retained.get('click')?.(new Event('click'))).not.toThrow();
    expect(() => dispose()).not.toThrow();
    retained.get('pointerdown')?.(new Event('pointerdown'));
    retained.get('click')?.(new Event('click'));

    expect(calls).toEqual(['pointerdown', 'click']);
  });

  it('rolls back the first registration and fences a retained second listener', () => {
    const retained = new Map<string, EventListener>();
    const removals: string[] = [];
    const target = {
      addEventListener(type: string, listener: EventListener): void {
        retained.set(type, listener);
        if (type === 'click') throw new Error('registered then failed');
      },
      removeEventListener(type: string): void { removals.push(type); },
    };
    let calls = 0;

    const dispose = installCaptureInteractionObservation({
      target,
      onPointerDown: () => { calls++; },
      onClick: () => { calls++; },
    });
    retained.get('pointerdown')?.(new Event('pointerdown'));
    retained.get('click')?.(new Event('click'));
    dispose();

    expect(removals).toEqual(['click', 'pointerdown']);
    expect(calls).toBe(0);
  });
});
