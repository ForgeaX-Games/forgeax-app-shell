import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createDockLayoutControlState } from '../src/dock';
import {
  useDockLayoutControlBinding,
  type DockLayoutControlBinding,
  type DockLayoutControlBindingOptions,
} from '../src/react';

interface Anchor {
  top: number;
}

function HookProbe({
  options,
  onBinding,
}: {
  options: DockLayoutControlBindingOptions<Anchor>;
  onBinding: (binding: DockLayoutControlBinding<Anchor>) => void;
}) {
  const binding = useDockLayoutControlBinding(options);
  useEffect(() => onBinding(binding), [binding, onBinding]);
  return <output>{`${binding.snapshot.open}:${binding.snapshot.anchor?.top ?? 'none'}`}</output>;
}

describe('Dock layout-control React binding', () => {
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

  it('binds the stable snapshot, toggle source and memoized panel control', () => {
    const state = createDockLayoutControlState<Anchor>();
    let retainedToggle: ((anchor?: Anchor) => void) | undefined;
    let disposed = 0;
    const panelCalls: string[] = [];
    let panelOpen = true;
    const options: DockLayoutControlBindingOptions<Anchor> = {
      state,
      onToggle: (listener) => {
        retainedToggle = listener;
        return { dispose: () => { disposed += 1; } };
      },
      isPanelOpen: () => panelOpen,
      closePanel: (panelId) => { panelCalls.push(`close:${panelId}`); panelOpen = false; },
      reopenPanel: (panelId) => { panelCalls.push(`reopen:${panelId}`); panelOpen = true; },
    };
    let latest: DockLayoutControlBinding<Anchor> | undefined;
    const onBinding = (binding: DockLayoutControlBinding<Anchor>) => { latest = binding; };

    act(() => root.render(<HookProbe options={options} onBinding={onBinding} />));
    expect(host.textContent).toBe('false:none');
    const initialPanelControl = latest?.panelControl;

    act(() => retainedToggle?.({ top: 8 }));
    expect(host.textContent).toBe('true:8');
    expect(latest?.panelControl).toBe(initialPanelControl);

    expect(latest?.panelControl.toggle('chat')).toBe(true);
    expect(latest?.panelControl.toggle('chat')).toBe(true);
    expect(panelCalls).toEqual(['close:chat', 'reopen:chat']);

    act(() => root.render(<HookProbe options={options} onBinding={onBinding} />));
    expect(latest?.panelControl).toBe(initialPanelControl);

    act(() => root.unmount());
    expect(disposed).toBe(1);
    retainedToggle?.({ top: 16 });
    expect(state.getSnapshot()).toEqual({ open: true, anchor: { top: 8 } });
  });

  it('replaces the toggle source once and fences the retained old listener', () => {
    const state = createDockLayoutControlState<Anchor>();
    const retained: Array<(anchor?: Anchor) => void> = [];
    const disposed: string[] = [];
    const panelAdapter = {
      isPanelOpen: () => false,
      closePanel: () => {},
      reopenPanel: () => {},
    };
    const source = (label: string) => (listener: (anchor?: Anchor) => void) => {
      retained.push(listener);
      return { dispose: () => { disposed.push(label); } };
    };
    const first = { state, onToggle: source('first'), ...panelAdapter };
    const second = { state, onToggle: source('second'), ...panelAdapter };

    act(() => root.render(<HookProbe options={first} onBinding={() => {}} />));
    act(() => root.render(<HookProbe options={second} onBinding={() => {}} />));
    expect(disposed).toEqual(['first']);

    act(() => retained[0]?.({ top: 4 }));
    expect(state.getSnapshot()).toEqual({ open: false, anchor: null });
    act(() => retained[1]?.({ top: 12 }));
    expect(state.getSnapshot()).toEqual({ open: true, anchor: { top: 12 } });
  });
});
