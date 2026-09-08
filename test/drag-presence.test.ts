import { describe, expect, it } from 'bun:test';
import { installDragPresenceLifecycle } from '../src/drag-presence';

class ListenerHost {
  readonly listeners = new Map<string, Set<EventListener>>();
  addEventListener(type: string, listener: EventListener): void {
    const set = this.listeners.get(type) ?? new Set<EventListener>();
    set.add(listener);
    this.listeners.set(type, set);
  }
  removeEventListener(type: string, listener: EventListener): void {
    this.listeners.get(type)?.delete(listener);
  }
  emit(type: string, target: EventTarget | null = null): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener({ target } as Event);
  }
  count(type: string): number { return this.listeners.get(type)?.size ?? 0; }
}

describe('drag-presence lifecycle', () => {
  it('enters once for an accepted start and settles once on end or drop', () => {
    const target = new ListenerHost();
    const changes: boolean[] = [];
    const observed: Array<EventTarget | null> = [];
    const accepted = new EventTarget();
    const external = new EventTarget();
    const dispose = installDragPresenceLifecycle({
      target,
      isStartTarget: (candidate) => candidate === accepted,
      onActiveChange: (active) => { changes.push(active); },
      onDragOver: (candidate) => { observed.push(candidate); },
    });

    target.emit('dragover', external);
    target.emit('dragstart', new EventTarget());
    target.emit('dragstart', accepted);
    target.emit('dragover', accepted);
    target.emit('dragstart', accepted);
    target.emit('dragend');
    target.emit('drop');

    expect(changes).toEqual([true, false]);
    expect(observed).toEqual([external, accepted]);
    expect(target.count('dragstart')).toBe(1);
    dispose();
    expect(target.count('dragstart')).toBe(0);
  });

  it('settles an active drag on idempotent disposal and fences retained listeners', () => {
    const target = new ListenerHost();
    const changes: boolean[] = [];
    const dispose = installDragPresenceLifecycle({
      target,
      isStartTarget: () => true,
      onActiveChange: (active) => { changes.push(active); },
    });
    const retained = [...target.listeners.get('dragstart')!][0]!;

    target.emit('dragstart');
    dispose();
    dispose();
    retained({ target: null } as Event);

    expect(changes).toEqual([true, false]);
    expect(target.count('dragstart')).toBe(0);
    expect(target.count('dragover')).toBe(0);
    expect(target.count('dragend')).toBe(0);
    expect(target.count('drop')).toBe(0);
  });

  it('rolls back partial registration and fences a register-then-throw listener', () => {
    const retained: EventListener[] = [];
    const removed: string[] = [];
    const target = {
      addEventListener(type: string, listener: EventListener) {
        retained.push(listener);
        if (type === 'dragend') throw new Error('registered then failed');
      },
      removeEventListener(type: string) { removed.push(type); },
    };
    const changes: boolean[] = [];

    const dispose = installDragPresenceLifecycle({
      target,
      isStartTarget: () => true,
      onActiveChange: (active) => { changes.push(active); },
    });
    retained.forEach((listener) => listener({ target: null } as Event));
    dispose();

    expect(removed).toEqual(['dragend', 'dragover', 'dragstart']);
    expect(changes).toEqual([]);
  });

  it('isolates predicate, active, dragover, and removal failures', () => {
    const target = new ListenerHost();
    let predicateCalls = 0;
    let notifications = 0;
    let dragOverNotifications = 0;
    const dispose = installDragPresenceLifecycle({
      target,
      isStartTarget: () => {
        if (++predicateCalls === 1) throw new Error('predicate failed');
        return true;
      },
      onActiveChange: () => {
        notifications++;
        throw new Error('notification failed');
      },
      onDragOver: () => {
        dragOverNotifications++;
        throw new Error('dragover notification failed');
      },
    });

    expect(() => target.emit('dragover')).not.toThrow();
    expect(() => target.emit('dragstart')).not.toThrow();
    expect(() => target.emit('dragstart')).not.toThrow();
    expect(() => target.emit('drop')).not.toThrow();
    expect(() => dispose()).not.toThrow();
    expect(notifications).toBe(2);
    expect(dragOverNotifications).toBe(1);
  });
});
