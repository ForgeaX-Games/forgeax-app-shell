import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  DockTabAction,
  DockTabFrame,
  DockTabIcon,
  DockTabTitle,
} from '../src/react';

describe('DockTabFrame', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    GlobalRegistrator.register();
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.replaceChildren();
    GlobalRegistrator.unregister();
  });

  it('owns the stable root/content/action frame while preserving caller slots', () => {
    const actionRef = createRef<HTMLDivElement>();
    act(() => root.render(
      <DockTabFrame
        className="product-tab"
        data-tab="console"
        leading={<span data-leading>icon</span>}
        action={(
          <DockTabAction ref={actionRef} className="product-action" data-action>
            close
          </DockTabAction>
        )}
      >
        <span data-title>Console</span>
        <span data-status>2</span>
      </DockTabFrame>,
    ));

    const frame = host.querySelector<HTMLElement>('[data-tab="console"]')!;
    expect(frame.className).toBe('dv-default-tab product-tab');
    expect(Array.from(frame.children).map((node) => node.getAttribute('data-leading') !== null
      ? 'leading'
      : node.classList.contains('dv-default-tab-content')
        ? 'content'
        : 'action')).toEqual(['leading', 'content', 'action']);
    expect(frame.querySelector('.dv-default-tab-content')?.textContent).toBe('Console2');
    expect(actionRef.current?.className).toBe('dv-default-tab-action product-action');
  });

  it('forwards root interactions and omits absent optional slots without product policy', () => {
    let pointerDowns = 0;
    act(() => root.render(
      <DockTabFrame onPointerDown={() => { pointerDowns++; }}>
        Untitled
      </DockTabFrame>,
    ));

    const frame = host.querySelector<HTMLElement>('.dv-default-tab')!;
    act(() => frame.dispatchEvent(new Event('pointerdown', { bubbles: true })));
    expect(pointerDowns).toBe(1);
    expect(frame.children).toHaveLength(1);
    expect(frame.firstElementChild?.className).toBe('dv-default-tab-content');
    expect(frame.querySelector('[role], [aria-label], [aria-pressed]')).toBeNull();
  });

  it('owns stable icon and title hooks while preserving caller presentation', () => {
    const iconRef = createRef<HTMLSpanElement>();
    const titleRef = createRef<HTMLSpanElement>();
    act(() => root.render(
      <DockTabFrame
        leading={(
          <DockTabIcon ref={iconRef} className="product-icon" data-icon>
            <svg aria-label="Console icon" />
          </DockTabIcon>
        )}
      >
        <DockTabTitle ref={titleRef} className="product-title" data-title>
          Console
        </DockTabTitle>
      </DockTabFrame>,
    ));

    expect(iconRef.current?.className).toBe('fx-dock-tab-icon product-icon');
    expect(iconRef.current?.querySelector('svg')?.getAttribute('aria-label'))
      .toBe('Console icon');
    expect(titleRef.current?.className).toBe('fx-dock-tab-title product-title');
    expect(titleRef.current?.textContent).toBe('Console');
  });
});
