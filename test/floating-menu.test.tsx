import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { FloatingMenu } from '../src/react';

describe('FloatingMenu', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    GlobalRegistrator.register();
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 200 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 100 });
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => 80 });
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => 40 });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.replaceChildren();
    GlobalRegistrator.unregister();
  });

  it('portals an end-aligned anchor menu and clamps it inside the viewport', () => {
    act(() => root.render(
      <FloatingMenu
        open
        onClose={() => {}}
        anchor={{ top: 10, bottom: 90, left: 170, right: 195 }}
        align="end"
        className="consumer-menu"
      >
        content
      </FloatingMenu>,
    ));

    const menu = document.querySelector<HTMLElement>('[data-app-shell-floating-menu]');
    expect(menu?.parentElement).toBe(document.body);
    expect(menu?.className).toBe('consumer-menu');
    expect(menu?.getAttribute('role')).toBe('menu');
    expect(menu?.style.position).toBe('fixed');
    expect(menu?.style.right).toBe('8px');
    expect(menu?.style.top).toBe('52px');
    expect(menu?.textContent).toBe('content');
  });

  it('clamps an end-aligned menu against the left viewport edge', () => {
    act(() => root.render(
      <FloatingMenu
        open
        onClose={() => {}}
        anchor={{ top: 10, bottom: 20, left: 5, right: 20 }}
        align="end"
      >
        content
      </FloatingMenu>,
    ));

    const menu = document.querySelector<HTMLElement>('[data-app-shell-floating-menu]');
    expect(menu?.style.right).toBe('112px');
  });

  it('positions point menus and closes through outside gestures or an external-focus Escape', () => {
    let closed = 0;
    act(() => root.render(
      <FloatingMenu open onClose={() => { closed += 1; }} point={{ x: 190, y: 95 }}>
        actions
      </FloatingMenu>,
    ));

    const menu = document.querySelector<HTMLElement>('[data-app-shell-floating-menu]');
    const backdrop = document.querySelector<HTMLElement>('[data-app-shell-floating-menu-backdrop]');
    expect(menu?.style.left).toBe('112px');
    expect(menu?.style.top).toBe('52px');

    act(() => backdrop?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    const outsideContext = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    act(() => backdrop?.dispatchEvent(outsideContext));
    expect(outsideContext.defaultPrevented).toBe(true);
    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(closed).toBe(3);

    act(() => root.render(
      <FloatingMenu open={false} onClose={() => { closed += 1; }}>hidden</FloatingMenu>,
    ));
    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(closed).toBe(3);
  });

  it('renders nothing while closed', () => {
    act(() => root.render(
      <FloatingMenu open={false} onClose={() => {}}>hidden</FloatingMenu>,
    ));

    expect(document.querySelector('[data-app-shell-floating-menu]')).toBeNull();
    expect(document.querySelector('[data-app-shell-floating-menu-backdrop]')).toBeNull();
  });
});
