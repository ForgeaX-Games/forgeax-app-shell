import { describe, expect, it } from 'bun:test';
import {
  installOutsideDismissLifecycle,
  type OutsideDismissReason,
} from '../src/react';

class ListenerHost {
  readonly listeners = new Map<string, Set<(event: Event) => void>>();

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    const callback = listener as (event: Event) => void;
    const bucket = this.listeners.get(type) ?? new Set();
    bucket.add(callback);
    this.listeners.set(type, bucket);
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    this.listeners.get(type)?.delete(listener as (event: Event) => void);
  }

  emit(type: string, target: Element | null = null): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) {
      listener({ type, target } as unknown as Event);
    }
  }

  count(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }
}

class RetainingListenerHost extends ListenerHost {
  override removeEventListener(): void {
    throw new Error('removal retained the listener');
  }
}

class RegisterThenThrowHost extends ListenerHost {
  override addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
  ): void {
    super.addEventListener(type, listener);
    throw new Error('registration retained the listener');
  }
}

function element(tagName = 'DIV'): Element {
  return { tagName } as unknown as Element;
}

describe('outside-dismiss lifecycle', () => {
  it('balances pointer/focus listeners and injects containment, exemption, pin, and close policy', () => {
    const documentTarget = new ListenerHost();
    const windowTarget = new ListenerHost();
    const inside = element();
    const exempt = element();
    const outside = element();
    const contained: Element[] = [];
    const dismissed: OutsideDismissReason[] = [];
    let open = true;
    let pinned = false;

    const dispose = installOutsideDismissLifecycle({
      documentTarget,
      windowTarget,
      isOpen: () => open,
      isPinned: () => pinned,
      containsTarget: (target) => target === inside,
      isDismissExempt: (target) => target === exempt,
      onContainedPointerDown: (target) => contained.push(target),
      dismiss: (reason) => dismissed.push(reason),
      getActiveElement: () => null,
      requestFrame: () => 1,
      cancelFrame: () => {},
    });

    expect(documentTarget.count('pointerdown')).toBe(1);
    expect(documentTarget.count('focusin')).toBe(1);
    expect(windowTarget.count('blur')).toBe(1);
    documentTarget.emit('pointerdown', inside);
    documentTarget.emit('pointerdown', exempt);
    documentTarget.emit('focusin', inside);
    expect(contained).toEqual([inside]);
    expect(dismissed).toEqual([]);

    pinned = true;
    documentTarget.emit('pointerdown', outside);
    pinned = false;
    documentTarget.emit('pointerdown', outside);
    documentTarget.emit('focusin', outside);
    expect(dismissed).toEqual(['pointer']);

    open = false;
    documentTarget.emit('focusin', outside);
    open = true;
    documentTarget.emit('focusin', outside);
    expect(dismissed).toEqual(['pointer', 'focus']);

    dispose();
    dispose();
    expect(documentTarget.count('pointerdown')).toBe(0);
    expect(documentTarget.count('focusin')).toBe(0);
    expect(windowTarget.count('blur')).toBe(0);
  });

  it('defers iframe-focus dismissal and fences a disposed callback', () => {
    const documentTarget = new ListenerHost();
    const windowTarget = new ListenerHost();
    const iframe = element('IFRAME');
    const callbacks = new Map<number, FrameRequestCallback>();
    const cancelled: number[] = [];
    const dismissed: OutsideDismissReason[] = [];
    let nextFrame = 0;

    const dispose = installOutsideDismissLifecycle({
      documentTarget,
      windowTarget,
      isOpen: () => true,
      isPinned: () => false,
      containsTarget: () => false,
      isDismissExempt: () => false,
      dismiss: (reason) => dismissed.push(reason),
      getActiveElement: () => iframe,
      requestFrame: (callback) => {
        const id = ++nextFrame;
        callbacks.set(id, callback);
        return id;
      },
      cancelFrame: (id) => cancelled.push(id),
    });

    windowTarget.emit('blur');
    expect(callbacks.size).toBe(1);
    dispose();
    expect(cancelled).toEqual([1]);
    callbacks.get(1)?.(0);
    expect(dismissed).toEqual([]);

    const disposeLive = installOutsideDismissLifecycle({
      documentTarget,
      windowTarget,
      isOpen: () => true,
      isPinned: () => false,
      containsTarget: () => false,
      isDismissExempt: () => false,
      dismiss: (reason) => dismissed.push(reason),
      getActiveElement: () => iframe,
      requestFrame: (callback) => {
        const id = ++nextFrame;
        callbacks.set(id, callback);
        return id;
      },
      cancelFrame: () => {},
    });
    windowTarget.emit('blur');
    callbacks.get(2)?.(0);
    expect(dismissed).toEqual(['iframe-focus']);
    disposeLive();
  });

  it('re-arms after a dismiss policy keeps the surface open', () => {
    const documentTarget = new ListenerHost();
    const windowTarget = new ListenerHost();
    const outside = element();
    const dismissed: OutsideDismissReason[] = [];
    let pinned = false;

    const dispose = installOutsideDismissLifecycle({
      documentTarget,
      windowTarget,
      isOpen: () => true,
      isPinned: () => pinned,
      containsTarget: () => false,
      isDismissExempt: () => false,
      dismiss: (reason) => {
        dismissed.push(reason);
        pinned = true;
      },
      getActiveElement: () => null,
      requestFrame: () => 1,
      cancelFrame: () => {},
    });

    documentTarget.emit('pointerdown', outside);
    documentTarget.emit('focusin', outside);
    expect(dismissed).toEqual(['pointer']);

    pinned = false;
    documentTarget.emit('pointerdown', outside);
    expect(dismissed).toEqual(['pointer', 'pointer']);
    dispose();
  });

  it('isolates injected failures and rolls back partial listener registration', () => {
    const documentTarget = new ListenerHost();
    const windowTarget = new ListenerHost();
    const outside = element();
    let dismissCalls = 0;
    const dispose = installOutsideDismissLifecycle({
      documentTarget,
      windowTarget,
      isOpen: () => true,
      isPinned: () => { throw new Error('stale pin source'); },
      containsTarget: () => false,
      isDismissExempt: () => false,
      dismiss: () => { dismissCalls++; },
      getActiveElement: () => null,
      requestFrame: () => 1,
      cancelFrame: () => {},
    });
    documentTarget.emit('pointerdown', outside);
    expect(dismissCalls).toBe(0);
    dispose();

    const failingWindow = {
      addEventListener: () => { throw new Error('registration failed'); },
      removeEventListener: () => {},
    };
    const rollback = installOutsideDismissLifecycle({
      documentTarget,
      windowTarget: failingWindow,
      isOpen: () => true,
      isPinned: () => false,
      containsTarget: () => false,
      isDismissExempt: () => false,
      dismiss: () => {},
      getActiveElement: () => null,
      requestFrame: () => 1,
      cancelFrame: () => {},
    });
    expect(documentTarget.count('pointerdown')).toBe(0);
    expect(documentTarget.count('focusin')).toBe(0);
    rollback();
  });

  it('fences retained listeners after disposal and register-then-throw rollback', () => {
    const inside = element();
    let productHookCalls = 0;
    const options = {
      isOpen: () => { productHookCalls++; return true; },
      isPinned: () => false,
      containsTarget: () => true,
      isDismissExempt: () => false,
      onContainedPointerDown: () => { productHookCalls++; },
      dismiss: () => { productHookCalls++; },
      getActiveElement: () => null,
      requestFrame: () => 1,
      cancelFrame: () => {},
    };

    const retainedAfterDispose = new RetainingListenerHost();
    const dispose = installOutsideDismissLifecycle({
      ...options,
      documentTarget: retainedAfterDispose,
      windowTarget: new ListenerHost(),
    });
    dispose();
    retainedAfterDispose.emit('pointerdown', inside);
    retainedAfterDispose.emit('focusin', inside);
    expect(productHookCalls).toBe(0);

    const retainedAfterRollback = new RegisterThenThrowHost();
    installOutsideDismissLifecycle({
      ...options,
      documentTarget: retainedAfterRollback,
      windowTarget: new ListenerHost(),
    });
    retainedAfterRollback.emit('pointerdown', inside);
    expect(productHookCalls).toBe(0);
  });
});
