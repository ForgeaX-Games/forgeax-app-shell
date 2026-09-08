import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { installPointerReorderSession } from '../src/react';

function pointerEvent(
  type: string,
  init: { pointerId: number; button?: number; buttons?: number; isPrimary?: boolean },
): PointerEvent {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    pointerId: { value: init.pointerId },
    button: { value: init.button ?? 0 },
    buttons: { value: init.buttons ?? (type === 'pointerup' || type === 'pointercancel' ? 0 : 1) },
    isPrimary: { value: init.isPrimary ?? true },
  });
  return event as PointerEvent;
}

describe('pointer reorder session', () => {
  let list: HTMLDivElement;
  let first: HTMLButtonElement;
  let second: HTMLButtonElement;
  let third: HTMLButtonElement;

  beforeEach(() => {
    GlobalRegistrator.register();
    list = document.createElement('div');
    first = document.createElement('button');
    second = document.createElement('button');
    third = document.createElement('button');
    first.dataset.key = 'first';
    second.dataset.key = 'second';
    third.dataset.key = 'third';
    list.append(first, second, third);
    document.body.appendChild(list);
  });

  afterEach(() => {
    document.body.replaceChildren();
    GlobalRegistrator.unregister();
  });

  it('owns one primary-pointer reorder and publishes dragging only after a distinct target', () => {
    const reorders: string[] = [];
    const dragging: Array<string | null> = [];
    const session = installPointerReorderSession({
      element: list,
      target: window,
      resolveItem: (target) => (target as HTMLElement | null)?.closest<HTMLElement>('[data-key]')?.dataset.key ?? null,
      reorder: (dragged, over) => reorders.push(`${dragged}->${over}`),
      onDraggingChange: (item) => dragging.push(item),
    });

    first.dispatchEvent(pointerEvent('pointerdown', { pointerId: 1 }));
    third.dispatchEvent(pointerEvent('pointerdown', { pointerId: 2, isPrimary: false }));
    second.dispatchEvent(pointerEvent('pointermove', { pointerId: 2 }));
    first.dispatchEvent(pointerEvent('pointermove', { pointerId: 1 }));
    second.dispatchEvent(pointerEvent('pointermove', { pointerId: 1 }));
    second.dispatchEvent(pointerEvent('pointermove', { pointerId: 1 }));
    third.dispatchEvent(pointerEvent('pointermove', { pointerId: 1 }));
    window.dispatchEvent(pointerEvent('pointerup', { pointerId: 2 }));

    expect(reorders).toEqual(['first->second', 'first->third']);
    expect(dragging).toEqual(['first']);

    window.dispatchEvent(pointerEvent('pointerup', { pointerId: 1 }));
    expect(dragging).toEqual(['first', null]);
    session.dispose();
  });

  it('rejects excluded starts and balances cancel, replacement, released-button, and disposal cleanup', () => {
    const close = document.createElement('span');
    close.dataset.close = 'true';
    first.appendChild(close);
    const dragging: Array<string | null> = [];
    const session = installPointerReorderSession({
      element: list,
      target: window,
      resolveItem: (target) => (target as HTMLElement | null)?.closest<HTMLElement>('[data-key]')?.dataset.key ?? null,
      canStart: (event) => !(event.target as HTMLElement).closest('[data-close]'),
      reorder: () => {},
      onDraggingChange: (item) => dragging.push(item),
    });

    close.dispatchEvent(pointerEvent('pointerdown', { pointerId: 1 }));
    second.dispatchEvent(pointerEvent('pointermove', { pointerId: 1 }));
    expect(dragging).toEqual([]);

    first.dispatchEvent(pointerEvent('pointerdown', { pointerId: 2 }));
    second.dispatchEvent(pointerEvent('pointermove', { pointerId: 2 }));
    third.dispatchEvent(pointerEvent('pointerdown', { pointerId: 3 }));
    second.dispatchEvent(pointerEvent('pointermove', { pointerId: 3 }));
    second.dispatchEvent(pointerEvent('pointermove', { pointerId: 3, buttons: 0 }));
    first.dispatchEvent(pointerEvent('pointerdown', { pointerId: 4 }));
    third.dispatchEvent(pointerEvent('pointermove', { pointerId: 4 }));
    window.dispatchEvent(pointerEvent('pointercancel', { pointerId: 4 }));
    first.dispatchEvent(pointerEvent('pointerdown', { pointerId: 5 }));
    second.dispatchEvent(pointerEvent('pointermove', { pointerId: 5 }));
    session.dispose();
    session.dispose();

    expect(dragging).toEqual([
      'first', null,
      'third', null,
      'first', null,
      'first', null,
    ]);
    first.dispatchEvent(pointerEvent('pointerdown', { pointerId: 6 }));
    second.dispatchEvent(pointerEvent('pointermove', { pointerId: 6 }));
    expect(dragging.at(-1)).toBeNull();
  });

  it('isolates adapter failures and fences a reorder cancelled synchronously during publication', () => {
    const reorders: string[] = [];
    const dragging: Array<string | null> = [];
    let cancelDuringPublish = true;
    let resolveFailure = false;
    let reorderFailure = false;
    let session!: ReturnType<typeof installPointerReorderSession<string>>;
    session = installPointerReorderSession({
      element: list,
      target: window,
      resolveItem: (target) => {
        const key = (target as HTMLElement | null)?.closest<HTMLElement>('[data-key]')?.dataset.key ?? null;
        if (key === 'third' && resolveFailure) throw new Error('resolve failed');
        return key;
      },
      reorder: (dragged, over) => {
        reorders.push(`${dragged}->${over}`);
        if (reorderFailure) throw new Error('reorder failed');
      },
      onDraggingChange: (item) => {
        dragging.push(item);
        if (item === 'first' && cancelDuringPublish) {
          cancelDuringPublish = false;
          session.cancel();
        }
      },
    });

    first.dispatchEvent(pointerEvent('pointerdown', { pointerId: 1 }));
    second.dispatchEvent(pointerEvent('pointermove', { pointerId: 1 }));
    third.dispatchEvent(pointerEvent('pointerdown', { pointerId: 2 }));
    second.dispatchEvent(pointerEvent('pointermove', { pointerId: 2 }));
    expect(reorders).toEqual(['third->second']);
    window.dispatchEvent(pointerEvent('pointerup', { pointerId: 2 }));

    resolveFailure = true;
    first.dispatchEvent(pointerEvent('pointerdown', { pointerId: 3 }));
    expect(() => third.dispatchEvent(pointerEvent('pointermove', { pointerId: 3 }))).not.toThrow();
    resolveFailure = false;
    reorderFailure = true;
    first.dispatchEvent(pointerEvent('pointerdown', { pointerId: 4 }));
    expect(() => third.dispatchEvent(pointerEvent('pointermove', { pointerId: 4 }))).not.toThrow();
    reorderFailure = false;
    first.dispatchEvent(pointerEvent('pointerdown', { pointerId: 5 }));
    second.dispatchEvent(pointerEvent('pointermove', { pointerId: 5 }));

    expect(reorders).toEqual(['third->second', 'first->third', 'first->second']);
    expect(dragging).toEqual(['first', null, 'third', null, 'first', null, 'first']);
    session.dispose();
  });

  it('isolates and fences injected equality failures before publishing or reordering', () => {
    const reorders: string[] = [];
    const dragging: Array<string | null> = [];
    let mode: 'throw' | 'cancel' | 'healthy' = 'throw';
    let session!: ReturnType<typeof installPointerReorderSession<string>>;
    session = installPointerReorderSession({
      element: list,
      target: window,
      resolveItem: (target) => (target as HTMLElement | null)?.closest<HTMLElement>('[data-key]')?.dataset.key ?? null,
      equals: (left, right) => {
        if (mode === 'throw') throw new Error('equals failed');
        if (mode === 'cancel') session.cancel();
        return left === right;
      },
      reorder: (dragged, over) => reorders.push(`${dragged}->${over}`),
      onDraggingChange: (item) => dragging.push(item),
    });

    first.dispatchEvent(pointerEvent('pointerdown', { pointerId: 1 }));
    expect(() => second.dispatchEvent(pointerEvent('pointermove', { pointerId: 1 }))).not.toThrow();
    mode = 'cancel';
    first.dispatchEvent(pointerEvent('pointerdown', { pointerId: 2 }));
    second.dispatchEvent(pointerEvent('pointermove', { pointerId: 2 }));
    expect(reorders).toEqual([]);
    expect(dragging).toEqual([]);

    mode = 'healthy';
    first.dispatchEvent(pointerEvent('pointerdown', { pointerId: 3 }));
    second.dispatchEvent(pointerEvent('pointermove', { pointerId: 3 }));
    expect(reorders).toEqual(['first->second']);
    expect(dragging).toEqual(['first']);
    session.dispose();
    expect(dragging).toEqual(['first', null]);
  });
});
