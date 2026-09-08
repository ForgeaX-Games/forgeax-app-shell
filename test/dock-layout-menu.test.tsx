import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createDockLayoutControlState } from '../src/dock';
import { DockLayoutMenu } from '../src/react';

describe('DockLayoutMenu', () => {
  let root: Root;
  let container: HTMLDivElement;

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

  test('owns reset, section, empty and checkable panel-row presentation', () => {
    const state = createDockLayoutControlState<DOMRectReadOnly>();
    const openPanels = new Set(['files']);
    const toggles: string[] = [];
    let reset = 0;
    let toggleListener: ((anchor?: DOMRectReadOnly) => void) | undefined;

    act(() => {
      root.render(
        <DockLayoutMenu
          state={state}
          onToggle={(listener) => {
            toggleListener = listener;
            return { dispose() {} };
          }}
          isPanelOpen={(id) => openPanels.has(id)}
          closePanel={(id) => { toggles.push(`close:${id}`); }}
          reopenPanel={(id) => { toggles.push(`reopen:${id}`); }}
          onReset={() => { reset += 1; }}
          resetLabel="Reset layout"
          sectionLabel="Main panels"
          emptyLabel="No panels"
          resetIcon={<span data-reset-icon="" />}
          panels={[
            { id: 'files', title: 'Files', icon: <span data-panel-icon="files" /> },
            { id: 'output', title: 'Output', icon: <span data-panel-icon="output" /> },
          ]}
        />,
      );
    });
    act(() => toggleListener?.(new DOMRectReadOnly(10, 10, 20, 20)));

    const menu = document.querySelector<HTMLElement>('[data-app-shell-floating-menu].fx-dl-menu');
    expect(menu).not.toBeNull();
    expect(menu?.classList.contains('fx-dl-menu')).toBe(true);
    expect(menu?.textContent).toContain('Reset layout');
    expect(menu?.textContent).toContain('Main panels');
    const resetIcon = menu?.querySelector('[data-reset-icon]');
    expect(resetIcon).not.toBeNull();
    expect(resetIcon?.closest('.fx-dl-icon')).toBeNull();
    expect(menu?.querySelector('[data-panel-icon="files"]')).not.toBeNull();

    const rows = Array.from(menu?.querySelectorAll<HTMLButtonElement>('[role="menuitemcheckbox"]') ?? []);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.getAttribute('aria-checked')).toBe('true');
    expect(rows[0]?.classList.contains('on')).toBe(true);
    expect(rows[1]?.getAttribute('aria-checked')).toBe('false');

    act(() => rows[0]?.click());
    act(() => rows[1]?.click());
    expect(toggles).toEqual(['close:files', 'reopen:output']);

    const resetButton = menu?.querySelector<HTMLButtonElement>('[data-app-shell-dock-layout-reset]');
    act(() => resetButton?.click());
    expect(reset).toBe(1);
    expect(document.querySelector('[data-app-shell-floating-menu].fx-dl-menu')).toBeNull();
  });

  test('renders the injected empty label when there are no panels', () => {
    const state = createDockLayoutControlState<DOMRectReadOnly>();
    let toggleListener: (() => void) | undefined;

    act(() => {
      root.render(
        <DockLayoutMenu
          state={state}
          onToggle={(listener) => {
            toggleListener = listener;
            return { dispose() {} };
          }}
          isPanelOpen={() => false}
          closePanel={() => {}}
          reopenPanel={() => {}}
          onReset={() => {}}
          resetLabel="Reset layout"
          sectionLabel="Main panels"
          emptyLabel="No panels"
          panels={[]}
        />,
      );
    });
    act(() => toggleListener?.());

    expect(document.querySelector('[data-app-shell-dock-layout-empty]')?.textContent).toBe('No panels');
    expect(document.querySelectorAll('[role="menuitemcheckbox"]')).toHaveLength(0);
  });
});
