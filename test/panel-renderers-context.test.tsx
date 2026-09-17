import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  DEFAULT_EDITOR_PANEL_IDS,
  DEFAULT_PANEL_RENDERERS,
  PanelRenderersProvider,
  usePanelRenderers,
  type PanelRenderers,
} from '../src/application';

describe('shared panel renderer context', () => {
  let container: HTMLDivElement;
  let root: Root;
  const seen = new Map<string, PanelRenderers>();
  function Reader({ name }: { name: string }) {
    const renderers = usePanelRenderers();
    seen.set(name, renderers);
    return <span data-reader={name}>{renderers.editorPanelIds.join(',')}</span>;
  }
  beforeEach(() => {
    GlobalRegistrator.register();
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    seen.clear();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    document.body.replaceChildren();
    GlobalRegistrator.unregister();
  });

  it('returns the same empty default and editor panel list outside a provider', () => {
    act(() => root.render(<Reader name="default" />));
    expect(seen.get('default')).toBe(DEFAULT_PANEL_RENDERERS);
    expect(DEFAULT_PANEL_RENDERERS.editorPanelIds).toBe(DEFAULT_EDITOR_PANEL_IDS);
    expect(DEFAULT_EDITOR_PANEL_IDS).toEqual([]);
  });

  it('publishes exact caller values and updates mounted readers', () => {
    const first: PanelRenderers = { editorPanelIds: ['first'] };
    const second: PanelRenderers = { editorPanelIds: ['second'] };
    act(() => root.render(<PanelRenderersProvider value={first}><Reader name="live" /></PanelRenderersProvider>));
    expect(seen.get('live')).toBe(first);
    expect(container.textContent).toBe('first');
    act(() => root.render(<PanelRenderersProvider value={second}><Reader name="live" /></PanelRenderersProvider>));
    expect(seen.get('live')).toBe(second);
    expect(container.textContent).toBe('second');
  });

  it('scopes nested providers and restores the outer value after nested removal', () => {
    const outer: PanelRenderers = { editorPanelIds: ['outer'] };
    const inner: PanelRenderers = { editorPanelIds: ['inner'] };
    act(() => root.render(<PanelRenderersProvider value={outer}>
      <Reader name="outer" />
      <PanelRenderersProvider value={inner}><Reader name="inner" /></PanelRenderersProvider>
    </PanelRenderersProvider>));
    expect(seen.get('outer')).toBe(outer);
    expect(seen.get('inner')).toBe(inner);
    act(() => root.render(<PanelRenderersProvider value={outer}><Reader name="inner" /></PanelRenderersProvider>));
    expect(seen.get('inner')).toBe(outer);
  });

  it('keeps separate render roots scoped and restores the default after unmount', () => {
    const panels: PanelRenderers = { editorPanelIds: ['detached'] };
    const other = document.createElement('div');
    document.body.append(other);
    const detached = createRoot(other);
    try {
      act(() => {
        root.render(<Reader name="main" />);
        detached.render(<PanelRenderersProvider value={panels}><Reader name="detached" /></PanelRenderersProvider>);
      });
      expect(seen.get('main')).toBe(DEFAULT_PANEL_RENDERERS);
      expect(seen.get('detached')).toBe(panels);
      act(() => detached.render(<Reader name="detached" />));
      expect(seen.get('detached')).toBe(DEFAULT_PANEL_RENDERERS);
      expect(DEFAULT_EDITOR_PANEL_IDS).toEqual([]);
    } finally { act(() => detached.unmount()); }
  });
});
