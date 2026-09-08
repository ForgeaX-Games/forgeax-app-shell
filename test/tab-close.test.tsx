import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useTabCloseInteractions } from '../src/react';

function pointerEvent(
  type: string,
  init: { pointerId: number; button?: number; isPrimary?: boolean },
): PointerEvent {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    pointerId: { value: init.pointerId },
    button: { value: init.button ?? 0 },
    isPrimary: { value: init.isPrimary ?? true },
  });
  return event as PointerEvent;
}

interface HarnessProps {
  close(): void;
  disabled?: boolean;
  replacement?: boolean;
  onForwarded(type: string): void;
}

function Harness({ close, disabled, replacement, onForwarded }: HarnessProps): ReactElement {
  const interactions = useTabCloseInteractions<HTMLDivElement>({
    close,
    disabled,
    onPointerDown: () => onForwarded('down'),
    onPointerUp: () => onForwarded('up'),
    onPointerLeave: () => onForwarded('leave'),
  });

  return (
    <div
      data-tab
      onPointerDown={interactions.onPointerDown}
      onPointerUp={interactions.onPointerUp}
      onPointerLeave={interactions.onPointerLeave}
    >
      <button key={replacement ? 'replacement' : 'initial'} ref={interactions.closeRef} data-close />
    </div>
  );
}

describe('tab close interactions', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    GlobalRegistrator.register();
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.replaceChildren();
    GlobalRegistrator.unregister();
  });

  it('owns native close pointerdown and matching middle-button settlement', () => {
    let closes = 0;
    const forwarded: string[] = [];
    act(() => root.render(<Harness close={() => { closes++; }} onForwarded={(type) => forwarded.push(type)} />));
    const tab = container.querySelector<HTMLElement>('[data-tab]')!;
    const close = container.querySelector<HTMLElement>('[data-close]')!;
    let bubbled = 0;
    tab.addEventListener('pointerdown', () => { bubbled++; });

    const nativeClose = pointerEvent('pointerdown', { pointerId: 1 });
    close.dispatchEvent(nativeClose);
    expect(nativeClose.defaultPrevented).toBe(true);
    expect(bubbled).toBe(0);
    expect(closes).toBe(1);

    tab.dispatchEvent(pointerEvent('pointerdown', { pointerId: 2, button: 1 }));
    tab.dispatchEvent(pointerEvent('pointerup', { pointerId: 3, button: 1 }));
    expect(closes).toBe(1);
    tab.dispatchEvent(pointerEvent('pointerup', { pointerId: 2, button: 1 }));
    expect(closes).toBe(2);

    tab.dispatchEvent(pointerEvent('pointerdown', { pointerId: 4, button: 1 }));
    tab.dispatchEvent(pointerEvent('pointerout', { pointerId: 5, button: 1 }));
    tab.dispatchEvent(pointerEvent('pointerup', { pointerId: 4, button: 1 }));
    expect(closes).toBe(3);

    tab.dispatchEvent(pointerEvent('pointerdown', { pointerId: 6, button: 1 }));
    tab.dispatchEvent(pointerEvent('pointerout', { pointerId: 6, button: 1 }));
    tab.dispatchEvent(pointerEvent('pointerup', { pointerId: 6, button: 1 }));
    expect(closes).toBe(3);
    expect(forwarded).toEqual([
      'down', 'up', 'up',
      'down', 'leave', 'up',
      'down', 'leave', 'up',
    ]);
  });

  it('balances replacement, disabled state, callback failures, and unmount cleanup', () => {
    let closes = 0;
    let throwClose = true;
    const close = (): void => {
      closes++;
      if (throwClose) throw new Error('close failed');
    };
    const forwarded: string[] = [];
    const onForwarded = (type: string): void => {
      forwarded.push(type);
      if (type === 'down' && forwarded.length === 1) throw new Error('forward failed');
    };
    act(() => root.render(<Harness close={close} onForwarded={onForwarded} />));
    const initial = container.querySelector<HTMLElement>('[data-close]')!;
    const tab = container.querySelector<HTMLElement>('[data-tab]')!;

    expect(() => initial.dispatchEvent(pointerEvent('pointerdown', { pointerId: 1 }))).not.toThrow();
    expect(closes).toBe(1);
    expect(() => tab.dispatchEvent(pointerEvent('pointerdown', { pointerId: 2, button: 1 }))).not.toThrow();
    expect(() => tab.dispatchEvent(pointerEvent('pointerup', { pointerId: 2, button: 1 }))).not.toThrow();
    expect(closes).toBe(2);

    throwClose = false;
    act(() => root.render(
      <Harness close={close} disabled replacement onForwarded={onForwarded} />,
    ));
    const replacement = container.querySelector<HTMLElement>('[data-close]')!;
    initial.dispatchEvent(pointerEvent('pointerdown', { pointerId: 3 }));
    replacement.dispatchEvent(pointerEvent('pointerdown', { pointerId: 4 }));
    tab.dispatchEvent(pointerEvent('pointerdown', { pointerId: 5, button: 1 }));
    tab.dispatchEvent(pointerEvent('pointerup', { pointerId: 5, button: 1 }));
    expect(closes).toBe(2);

    act(() => root.render(<Harness close={close} replacement onForwarded={onForwarded} />));
    replacement.dispatchEvent(pointerEvent('pointerdown', { pointerId: 6 }));
    expect(closes).toBe(3);
    act(() => root.unmount());
    replacement.dispatchEvent(pointerEvent('pointerdown', { pointerId: 7 }));
    expect(closes).toBe(3);
  });
});
