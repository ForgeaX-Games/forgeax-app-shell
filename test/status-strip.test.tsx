import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act, StrictMode, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import type { StatusItemContribution } from '../src/application';
import { StatusStrip } from '../src/react';

describe('StatusStrip contribution presentation', () => {
  let container: HTMLDivElement;
  let root: Root;
  let intervals: { callback: () => void; handle: number; cleared: boolean }[];
  let restoreTimers: () => void;
  let failClear: boolean;

  beforeEach(() => {
    GlobalRegistrator.register();
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    intervals = [];
    failClear = false;
    const originalSet = globalThis.setInterval;
    const originalClear = globalThis.clearInterval;
    const set = spyOn(globalThis, 'setInterval').mockImplementation(((callback: () => void, delay?: number, ...args: unknown[]) => {
      if (delay !== 4000) return originalSet(callback, delay, ...args);
      const handle = 940000 + intervals.length;
      intervals.push({ callback, handle, cleared: false });
      return handle;
    }) as typeof setInterval);
    const clear = spyOn(globalThis, 'clearInterval').mockImplementation((handle) => {
      const interval = intervals.find((value) => value.handle === Number(handle));
      if (!interval) return (originalClear as (value: typeof handle) => void)(handle);
      interval.cleared = true;
      if (failClear) throw new Error('native clear failed');
    });
    restoreTimers = () => { set.mockRestore(); clear.mockRestore(); };
  });

  afterEach(() => {
    act(() => root.unmount());
    restoreTimers();
    document.body.replaceChildren();
    GlobalRegistrator.unregister();
  });

  function show(items: Readonly<Record<string, StatusItemContribution>>, executeCommand = (_id: string, _args?: unknown): unknown => undefined) {
    act(() => root.render(
      <StrictMode>
        <StatusStrip
          items={items}
          capacity={{ left: 4, center: 2, right: 6 }}
          visualOrder={{ left: 4, center: 2, right: 3 }}
          intervalMs={4000}
          executeCommand={executeCommand}
          renderIcon={(name) => <i data-icon={name} />}
          overflowDescription={(count) => ({ label: `${count} hidden`, title: `${count} rotating` })}
          aria-label="Product status"
          data-tour-id="footer"
        >
          <div data-fx-dock-bottom-host />
        </StatusStrip>
      </StrictMode>,
    ));
  }

  const ids = (slot: string) => Array.from(container.querySelectorAll(`.sb-slot-${slot} [data-item-id]`)).map((item) => item.getAttribute('data-item-id'));

  it.each([0, -1, 1.5, NaN, Infinity])('rejects invalid visible capacity %s at the public boundary', (capacity) => {
    expect(() => renderToString(
      <StatusStrip items={items()} capacity={{ left: capacity, center: 2, right: 6 }} visualOrder={{ left: 4, center: 2, right: 3 }} intervalMs={4000} executeCommand={() => undefined} overflowDescription={() => ({ label: 'Hidden', title: 'Hidden' })} />,
    )).toThrow('StatusStrip left capacity must be a positive integer');
  });

  function items(): Record<string, StatusItemContribution> {
    const values: Record<string, StatusItemContribution> = {};
    for (const [slot, count] of [['left', 6], ['center', 3], ['right', 7]] as const) {
      for (let index = count; index > 0; index--) {
        const id = `${slot}${index}`;
        values[id] = { id, location: `statusbar.${slot}`, priority: count - index, item: { type: 'text', text: id } };
      }
    }
    values.hidden = { id: 'hidden', location: 'statusbar.left', priority: 100, when: () => false, item: { type: 'text', text: 'hidden' } };
    return values;
  }

  it('filters and orders contributions, anchors capacity minus one, and rotates the surplus', () => {
    show(items());
    expect(ids('left')).toEqual(['left1', 'left2', 'left3', 'left4']);
    expect(ids('center')).toEqual(['center1', 'center2']);
    expect(ids('right')).toEqual(['right1', 'right2', 'right3', 'right4', 'right5', 'right6']);
    const anchor = container.querySelector('[data-item-id="left1"]');
    expect(container.querySelector('[data-item-id="hidden"]')).toBeNull();
    expect(container.querySelector('[aria-label="2 hidden"]')?.getAttribute('title')).toBe('2 rotating');
    expect(container.querySelector('[aria-label="Product status"]')?.getAttribute('aria-live')).toBe('polite');
    expect(container.querySelector('.sb-slot-left')?.getAttribute('data-slot-order')).toBe('4');
    expect(container.querySelector('[data-tour-id="footer"]')?.firstElementChild?.hasAttribute('data-fx-dock-bottom-host')).toBe(true);
    act(() => intervals[1]!.callback());
    expect(ids('left')).toEqual(['left1', 'left2', 'left3', 'left5']);
    expect(ids('center')).toEqual(['center1', 'center3']);
    expect(ids('right')).toEqual(['right1', 'right2', 'right3', 'right4', 'right5', 'right7']);
    expect(container.querySelector('[data-item-id="left1"]')).toBe(anchor);
    act(() => { intervals[1]!.callback(); intervals[1]!.callback(); });
    expect(ids('left')).toEqual(['left1', 'left2', 'left3', 'left4']);
  });

  it('fences StrictMode callbacks and cleans up even when native clear throws', () => {
    show(items());
    expect(intervals.map((value) => value.cleared)).toEqual([true, false]);
    act(() => intervals[0]!.callback());
    expect(ids('left')).toEqual(['left1', 'left2', 'left3', 'left4']);
    failClear = true;
    expect(() => act(() => root.render(null))).not.toThrow();
    expect(intervals.every((value) => value.cleared)).toBe(true);
    act(() => intervals.forEach((value) => value.callback()));
    expect(intervals).toHaveLength(2);
    expect(container.children).toHaveLength(0);
  });

  it('uses current command arguments and removes contributions without remounting retained custom content', () => {
    const calls: unknown[][] = [];
    let mounts = 0;
    let unmounts = 0;
    function Custom() {
      useEffect(() => { mounts++; return () => { unmounts++; }; }, []);
      return <span data-custom>Live</span>;
    }
    const custom: StatusItemContribution = { id: 'live', location: 'statusbar.center', item: { type: 'custom', render: () => <Custom /> } };
    const command: StatusItemContribution = { id: 'command', location: 'statusbar.right', item: { type: 'button', command: 'open', args: { id: 1 }, label: 'Open', icon: 'Folder', tooltip: 'Open item' } };
    const execute = (id: string, args?: unknown) => { calls.push([id, args]); };
    show({ custom, command }, execute);
    const live = container.querySelector('[data-custom]');
    act(() => container.querySelector('button')!.click());
    expect(calls).toEqual([['open', { id: 1 }]]);
    expect(container.querySelector('[data-icon="Folder"]')).not.toBeNull();
    expect(container.querySelector('button')?.title).toBe('Open item');
    show({ custom, command: { ...command, item: { type: 'button', command: 'reveal', args: { id: 2 }, label: 'Reveal' } } }, execute);
    act(() => container.querySelector('button')!.click());
    expect(calls).toEqual([['open', { id: 1 }], ['reveal', { id: 2 }]]);
    show({ custom }, execute);
    expect(container.querySelector('button')).toBeNull();
    expect(container.querySelector('[data-custom]')).toBe(live);
    expect(mounts - unmounts).toBe(1);
    expect(intervals).toHaveLength(2);
    show({}, execute);
    expect(mounts).toBe(unmounts);
  });
});
