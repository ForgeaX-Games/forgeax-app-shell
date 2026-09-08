import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  SlotDebugOverlay,
  hashSlotHue,
  isSlotDebugEnabled,
} from '../src/react';

class NoopResizeObserver {
  observe(): void {}
  disconnect(): void {}
}

class NoopMutationObserver {
  observe(): void {}
  disconnect(): void {}
  takeRecords(): MutationRecord[] { return []; }
}

describe('slot diagnostics', () => {
  let host: HTMLDivElement;
  let root: Root;
  let originalGetBoundingClientRect: typeof Element.prototype.getBoundingClientRect;

  beforeEach(() => {
    GlobalRegistrator.register();
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    globalThis.ResizeObserver = NoopResizeObserver as unknown as typeof ResizeObserver;
    globalThis.MutationObserver = NoopMutationObserver as unknown as typeof MutationObserver;
    originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function (this: Element): DOMRect {
      const style = (this as HTMLElement).style;
      const number = (value: string): number => Number.parseFloat(value) || 0;
      const left = number(style.left);
      const top = number(style.top);
      const width = number(style.width);
      const height = number(style.height);
      return {
        x: left,
        y: top,
        left,
        top,
        width,
        height,
        right: left + width,
        bottom: top + height,
        toJSON: () => ({}),
      } as DOMRect;
    };
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
    document.body.replaceChildren();
    GlobalRegistrator.unregister();
  });

  it('keeps the composable URL gate and stable hue contract', () => {
    expect(isSlotDebugEnabled('?debug=other, slots')).toBe(true);
    expect(isSlotDebugEnabled('?debug=other')).toBe(false);
    expect(isSlotDebugEnabled('%%%invalid%%%')).toBe(false);
    expect(hashSlotHue('DockPanel:chat')).toBe(hashSlotHue('DockPanel:chat'));
    expect(hashSlotHue('DockPanel:chat')).toBeGreaterThanOrEqual(0);
    expect(hashSlotHue('DockPanel:chat')).toBeLessThan(360);
  });

  it('delegates capture-phase viewport scroll observation', () => {
    const source = readFileSync(fileURLToPath(new URL('../src/slot-debug.tsx', import.meta.url)), 'utf8');

    expect(source).toContain('installViewportScrollObservation,');
    expect(source).toContain('const disposeViewportScrollObservation = installViewportScrollObservation({');
    expect(source).toContain('target: window,');
    expect(source).toContain('onScroll: schedule,');
    expect(source).toContain('disposeViewportScrollObservation();');
    expect(source).not.toContain("window.addEventListener('scroll'");
    expect(source).not.toContain("window.removeEventListener('scroll'");
  });

  it('delegates balanced DOM mutation observation', () => {
    const source = readFileSync(fileURLToPath(new URL('../src/slot-debug.tsx', import.meta.url)), 'utf8');

    expect(source).toContain('installMutationObservation,');
    expect(source).toContain('subscribeElements: (onElementsChanged) => installMutationObservation({');
    expect(source).toContain('target: document.body,');
    expect(source).toContain('observerOptions: {');
    expect(source).toContain('onMutation: (records) => {');
    expect(source).toContain('disposeElementResizeObservation();');
    expect(source).not.toContain('new MutationObserver(');
    expect(source).not.toContain('mutationObserver.disconnect()');
  });

  it('delegates coalesced frame-task lifecycle ownership', () => {
    const source = readFileSync(fileURLToPath(new URL('../src/slot-debug.tsx', import.meta.url)), 'utf8');

    expect(source).toContain('createCoalescedFrameTaskLifecycle,');
    expect(source).toContain('const layoutFrameTask = createCoalescedFrameTaskLifecycle({');
    expect(source).toContain('task: () => setBoxes(measureSlots()),');
    expect(source).toContain('const schedule = layoutFrameTask.schedule;');
    expect(source).toContain('layoutFrameTask.dispose();');
    expect(source).not.toContain('requestAnimationFrame(');
    expect(source).not.toContain('cancelAnimationFrame(');
  });

  it('delegates replaceable marker resize and viewport observation ownership', () => {
    const source = readFileSync(fileURLToPath(new URL('../src/slot-debug.tsx', import.meta.url)), 'utf8');

    expect(source).toContain('installElementResizeObservation,');
    expect(source).toContain('installViewportResizeObservation,');
    expect(source).toContain("getElements: () => document.querySelectorAll<Element>('[data-fx-slot]'),");
    expect(source).toContain('subscribeElements: (onElementsChanged) => installMutationObservation({');
    expect(source).toContain('if (markerSetChanged) onElementsChanged();');
    expect(source).toContain('disposeElementResizeObservation();');
    expect(source).toContain('disposeViewportResizeObservation();');
    expect(source).not.toContain('new ResizeObserver(');
    expect(source).not.toContain('resizeObserver.disconnect(');
    expect(source).not.toContain("window.addEventListener('resize'");
    expect(source).not.toContain("window.removeEventListener('resize'");
  });

  it('keeps initial labels and mutation updates when resize construction fails', () => {
    globalThis.ResizeObserver = class {
      constructor() { throw new Error('resize unavailable'); }
    } as unknown as typeof ResizeObserver;
    let mutation!: MutationCallback;
    globalThis.MutationObserver = class extends NoopMutationObserver {
      constructor(callback: MutationCallback) { super(); mutation = callback; }
    } as unknown as typeof MutationObserver;
    const marker = document.createElement('section');
    marker.dataset.fxSlot = 'Initial';
    marker.style.cssText = 'width:100px;height:50px';
    document.body.appendChild(marker);
    const originalRequest = globalThis.requestAnimationFrame;
    const frames: FrameRequestCallback[] = [];
    globalThis.requestAnimationFrame = (callback) => frames.push(callback);
    try {
      act(() => root.render(<SlotDebugOverlay />));
      expect(host.textContent).toContain('Initial');
      marker.dataset.fxSlot = 'Renamed';
      act(() => {
        mutation([{ type: 'attributes', attributeName: 'data-fx-slot' } as MutationRecord], {} as MutationObserver);
        frames.shift()?.(0);
      });
      expect(host.textContent).toContain('Renamed');
      act(() => root.render(null));
      mutation([{ type: 'attributes', attributeName: 'data-fx-slot' } as MutationRecord], {} as MutationObserver);
      expect(frames).toHaveLength(0);
    } finally {
      globalThis.requestAnimationFrame = originalRequest;
    }
  });

  it('rebinds only marker changes and fences all resize work after unmount', () => {
    let resize!: () => void;
    let mutation!: MutationCallback;
    let observed: Element[] = [];
    let disconnects = 0;
    let mutationDisconnects = 0;
    globalThis.ResizeObserver = class {
      constructor(callback: () => void) { resize = callback; }
      observe(element: Element): void { observed.push(element); }
      disconnect(): void { disconnects++; observed = []; }
    } as unknown as typeof ResizeObserver;
    globalThis.MutationObserver = class extends NoopMutationObserver {
      constructor(callback: MutationCallback) { super(); mutation = callback; }
      disconnect(): void { mutationDisconnects++; }
    } as unknown as typeof MutationObserver;
    const first = document.createElement('section');
    first.dataset.fxSlot = 'First';
    first.style.cssText = 'width:100px;height:50px';
    document.body.appendChild(first);
    const originalRequest = globalThis.requestAnimationFrame;
    const frames: FrameRequestCallback[] = [];
    globalThis.requestAnimationFrame = (callback) => frames.push(callback);
    const change = (record: Partial<MutationRecord>): void => {
      mutation([record as MutationRecord], {} as MutationObserver);
    };
    try {
      act(() => root.render(<SlotDebugOverlay />));
      expect(observed).toEqual([first]);
      expect(host.textContent).toContain('First');
      act(() => {
        change({ type: 'childList', addedNodes: [] as unknown as NodeList, removedNodes: [] as unknown as NodeList });
        resize();
        window.dispatchEvent(new Event('resize'));
      });
      expect(disconnects).toBe(0);
      expect(frames).toHaveLength(1);
      act(() => frames.shift()?.(0));

      const second = document.createElement('section');
      second.dataset.fxSlot = 'Second';
      second.style.cssText = 'width:80px;height:40px';
      first.replaceWith(second);
      act(() => change({ type: 'childList', addedNodes: [second] as unknown as NodeList, removedNodes: [first] as unknown as NodeList }));
      expect(observed).toEqual([second]);
      expect(disconnects).toBe(1);
      act(() => frames.shift()?.(0));
      expect(host.textContent).toContain('Second');
      expect(host.textContent).not.toContain('First');

      second.removeAttribute('data-fx-slot');
      act(() => change({ type: 'attributes', attributeName: 'data-fx-slot' }));
      expect(observed).toEqual([]);
      expect(disconnects).toBe(2);
      act(() => frames.shift()?.(0));
      expect(host.textContent).toBe('');
      act(() => root.render(null));
      expect(disconnects).toBe(3);
      expect(mutationDisconnects).toBe(1);
      resize();
      change({ type: 'attributes', attributeName: 'data-fx-slot' });
      window.dispatchEvent(new Event('resize'));
      expect(frames).toHaveLength(0);
    } finally {
      globalThis.requestAnimationFrame = originalRequest;
    }
  });

  it('renders exact labels and parent breadcrumbs without intercepting input', () => {
    const outer = document.createElement('section');
    outer.dataset.fxSlot = 'DockShell';
    outer.style.cssText = 'position:fixed;left:10px;top:20px;width:200px;height:100px';
    const inner = document.createElement('section');
    inner.dataset.fxSlot = 'DockPanel:chat';
    inner.style.cssText = 'position:fixed;left:20px;top:30px;width:80px;height:40px';
    outer.appendChild(inner);
    document.body.appendChild(outer);

    act(() => root.render(<SlotDebugOverlay />));

    expect(host.textContent).toContain('DockShell');
    expect(host.textContent).toContain('DockShell → DockPanel:chat');
    expect(host.querySelector<HTMLElement>('[data-fx-slot-overlay]')?.style.pointerEvents)
      .toBe('none');
  });
});
