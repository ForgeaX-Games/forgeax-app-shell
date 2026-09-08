import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  AnchoredResizeHandle,
  ResizeHandle,
  applyAnchoredResizeDelta,
  beginAnchoredResize,
  createPersistentSizeStore,
  installThresholdPointerDragSession,
  installPointerDragSession,
  useLocalSize,
  usePersistentSizeStore,
  type PersistentSizeStore,
  type ResizeHandleProps,
} from '../src/react';

function HookProbe({
  onValue,
}: {
  onValue: (value: number, setValue: ReturnType<typeof useLocalSize>[1]) => void;
}) {
  const [value, setValue] = useLocalSize('resize-test', 140, 80, 480);
  useEffect(() => onValue(value, setValue), [onValue, setValue, value]);
  return <output>{value}</output>;
}

function PersistentStoreProbe({ store }: { store: PersistentSizeStore }) {
  return <output>{usePersistentSizeStore(store)}</output>;
}

function pointerEvent(type: string, init: { pointerId: number; clientX: number; clientY: number }): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    pointerId: { value: init.pointerId },
    clientX: { value: init.clientX },
    clientY: { value: init.clientY },
  });
  return event;
}

describe('resize primitives', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    GlobalRegistrator.register();
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    window.localStorage.clear();
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.replaceChildren();
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    GlobalRegistrator.unregister();
  });

  it('initializes from storage, clamps updates, and persists the resulting value', () => {
    window.localStorage.setItem('resize-test', '999');
    let latest: ReturnType<typeof useLocalSize> | undefined;
    const onValue = (value: number, setValue: ReturnType<typeof useLocalSize>[1]) => {
      latest = [value, setValue] as const;
    };

    act(() => root.render(<HookProbe onValue={onValue} />));
    expect(latest?.[0]).toBe(480);

    act(() => latest?.[1]((previous) => previous - 999));
    expect(latest?.[0]).toBe(80);
    expect(window.localStorage.getItem('resize-test')).toBe('80');
  });

  it('falls back without throwing when storage access is unavailable', () => {
    const storagePrototype = Object.getPrototypeOf(window.localStorage) as Storage;
    const originalGetItem = storagePrototype.getItem;
    const originalSetItem = storagePrototype.setItem;
    storagePrototype.getItem = () => { throw new Error('storage blocked'); };
    storagePrototype.setItem = () => { throw new Error('storage blocked'); };

    try {
      expect(() => {
        act(() => root.render(<HookProbe onValue={() => {}} />));
      }).not.toThrow();
      expect(host.textContent).toBe('140');
    } finally {
      storagePrototype.getItem = originalGetItem;
      storagePrototype.setItem = originalSetItem;
    }
  });

  it('owns persistent size normalization, stable snapshots, idempotent writes, and reload', () => {
    const values = new Map<string, string>([['shell-size', '999']]);
    const writes: string[] = [];
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
        writes.push(`${key}:${value}`);
      },
    };
    const store = createPersistentSizeStore({
      storageKey: 'shell-size',
      defaultSize: 360,
      minSize: 280,
      maxSize: 720,
      storage,
    });
    const snapshots: number[] = [];
    const unsubscribe = store.subscribe(() => snapshots.push(store.getSnapshot()));

    expect(store.getSnapshot()).toBe(720);
    store.setSize(640.6);
    expect(store.getSnapshot()).toBe(641);
    expect(writes).toEqual(['shell-size:641']);
    store.setSize(641);
    expect(writes).toEqual(['shell-size:641']);
    expect(snapshots).toEqual([641]);

    values.set('shell-size', '250');
    store.reload();
    expect(store.getSnapshot()).toBe(280);
    expect(snapshots).toEqual([641, 280]);
    values.set('shell-size', 'malformed');
    store.reload();
    expect(store.getSnapshot()).toBe(360);
    unsubscribe();
  });

  it('keeps in-memory state and React subscribers usable when storage throws', () => {
    const store = createPersistentSizeStore({
      storageKey: 'blocked-size',
      defaultSize: 320,
      minSize: 200,
      maxSize: 640,
      storage: {
        getItem: () => { throw new Error('read blocked'); },
        setItem: () => { throw new Error('write blocked'); },
      },
    });

    act(() => root.render(<PersistentStoreProbe store={store} />));
    expect(host.textContent).toBe('320');
    act(() => store.setSize((previous) => previous + 123.8));
    expect(host.textContent).toBe('444');
    expect(() => act(() => store.reload())).not.toThrow();
    expect(host.textContent).toBe('320');
  });

  it('owns an imperative pointer-drag session through cancel, lost capture, and disposal', () => {
    const handle = document.createElement('div');
    host.appendChild(handle);
    const captured: number[] = [];
    const released: number[] = [];
    handle.setPointerCapture = (pointerId) => { captured.push(pointerId); };
    handle.releasePointerCapture = (pointerId) => { released.push(pointerId); };
    const moves: Array<[number, number]> = [];
    const endings: string[] = [];
    const dispose = installPointerDragSession({
      element: handle,
      begin: (event) => ({ startX: event.clientX }),
      move: (session, event) => moves.push([session.startX, event.clientX]),
      end: (_session, reason) => endings.push(reason),
      preventDefault: true,
      stopPropagation: true,
      draggingClassName: 'product-dragging',
    });

    const firstDown = pointerEvent('pointerdown', { pointerId: 1, clientX: 10, clientY: 20 });
    handle.dispatchEvent(firstDown);
    expect(firstDown.defaultPrevented).toBe(true);
    expect(handle.classList.contains('product-dragging')).toBe(true);
    expect(captured).toEqual([1]);
    handle.dispatchEvent(pointerEvent('pointermove', { pointerId: 2, clientX: 99, clientY: 20 }));
    handle.dispatchEvent(pointerEvent('pointermove', { pointerId: 1, clientX: 14, clientY: 20 }));
    expect(moves).toEqual([[10, 14]]);
    handle.dispatchEvent(pointerEvent('pointercancel', { pointerId: 1, clientX: 14, clientY: 20 }));
    expect(endings).toEqual(['pointercancel']);
    expect(released).toEqual([1]);
    expect(handle.classList.contains('product-dragging')).toBe(false);

    handle.dispatchEvent(pointerEvent('pointerdown', { pointerId: 3, clientX: 30, clientY: 20 }));
    handle.dispatchEvent(pointerEvent('lostpointercapture', { pointerId: 3, clientX: 30, clientY: 20 }));
    expect(endings).toEqual(['pointercancel', 'lostpointercapture']);
    handle.dispatchEvent(pointerEvent('pointerdown', { pointerId: 4, clientX: 40, clientY: 20 }));
    dispose();
    dispose();
    expect(endings).toEqual(['pointercancel', 'lostpointercapture', 'dispose']);
    expect(handle.classList.contains('product-dragging')).toBe(false);
    handle.dispatchEvent(pointerEvent('pointerdown', { pointerId: 5, clientX: 50, clientY: 20 }));
    expect(captured).toEqual([1, 3, 4]);
  });

  it('arms a threshold pointer drag once and balances pointer, cancel, and disposal lifecycles', () => {
    const begins: number[] = [];
    const moves: number[] = [];
    const endings: string[] = [];
    const settlements: string[] = [];
    const cancellations: Array<() => void> = [];
    let unregisterCount = 0;
    const session = installThresholdPointerDragSession({
      target: window,
      pointerId: 41,
      startX: 10,
      startY: 20,
      threshold: 6,
      begin: (event) => {
        begins.push(event.clientX);
        return { origin: event.clientX };
      },
      move: (active, event) => moves.push(active.origin + event.clientX),
      end: (_active, reason) => endings.push(reason),
      onSettled: (reason, started) => settlements.push(`${reason}:${started}`),
      registerCancel: (cancel) => {
        cancellations.push(cancel);
        return () => { unregisterCount += 1; };
      },
    });

    window.dispatchEvent(pointerEvent('pointermove', { pointerId: 99, clientX: 100, clientY: 20 }));
    window.dispatchEvent(pointerEvent('pointermove', { pointerId: 41, clientX: 15, clientY: 20 }));
    expect(begins).toEqual([]);
    window.dispatchEvent(pointerEvent('pointermove', { pointerId: 41, clientX: 16, clientY: 20 }));
    window.dispatchEvent(pointerEvent('pointermove', { pointerId: 41, clientX: 19, clientY: 20 }));
    expect(begins).toEqual([16]);
    expect(moves).toEqual([32, 35]);
    cancellations[0]?.();
    cancellations[0]?.();
    expect(endings).toEqual(['cancel']);
    expect(settlements).toEqual(['cancel:true']);
    expect(unregisterCount).toBe(1);
    window.dispatchEvent(pointerEvent('pointermove', { pointerId: 41, clientX: 25, clientY: 20 }));
    session.dispose();
    expect(endings).toEqual(['cancel']);
  });

  it('drops a threshold arm below threshold and isolates callback failures without trapping later sessions', () => {
    const plainBegins: number[] = [];
    let plainUnregisters = 0;
    const plain = installThresholdPointerDragSession({
      target: window,
      pointerId: 51,
      startX: 0,
      startY: 0,
      threshold: 5,
      begin: (event) => {
        plainBegins.push(event.clientX);
        return { active: true };
      },
      move: () => {},
      registerCancel: () => () => { plainUnregisters += 1; },
    });
    window.dispatchEvent(pointerEvent('pointerup', { pointerId: 51, clientX: 2, clientY: 2 }));
    expect(plainBegins).toEqual([]);
    expect(plainUnregisters).toBe(1);
    plain.dispose();

    const endings: string[] = [];
    const failed = installThresholdPointerDragSession({
      target: window,
      pointerId: 52,
      startX: 0,
      startY: 0,
      threshold: 0,
      begin: () => ({ active: true }),
      move: () => { throw new Error('move failed'); },
      end: (_active, reason) => endings.push(reason),
    });
    expect(() => window.dispatchEvent(pointerEvent('pointermove', {
      pointerId: 52,
      clientX: 1,
      clientY: 0,
    }))).not.toThrow();
    expect(endings).toEqual(['error']);
    failed.dispose();

    const healthyMoves: number[] = [];
    const healthy = installThresholdPointerDragSession({
      target: window,
      pointerId: 53,
      startX: 0,
      startY: 0,
      threshold: 0,
      begin: () => ({ active: true }),
      move: (_active, event) => healthyMoves.push(event.clientX),
    });
    window.dispatchEvent(pointerEvent('pointermove', { pointerId: 53, clientX: 3, clientY: 0 }));
    window.dispatchEvent(pointerEvent('pointerup', { pointerId: 53, clientX: 3, clientY: 0 }));
    expect(healthyMoves).toEqual([3]);
    healthy.dispose();
  });

  it('rejects or rolls back failed imperative pointer-drag sessions without trapping the next drag', () => {
    const handle = document.createElement('div');
    host.appendChild(handle);
    handle.setPointerCapture = () => {};
    handle.releasePointerCapture = () => {};
    let mode: 'reject' | 'begin-error' | 'move-error' | 'healthy' = 'reject';
    const endings: string[] = [];
    const moves: number[] = [];
    const dispose = installPointerDragSession({
      element: handle,
      begin: () => {
        if (mode === 'reject') return null;
        if (mode === 'begin-error') throw new Error('begin failed');
        return { accepted: true };
      },
      move: (_session, event) => {
        if (mode === 'move-error') throw new Error('move failed');
        moves.push(event.clientX);
      },
      end: (_session, reason) => endings.push(reason),
      draggingClassName: 'product-dragging',
    });

    const rejected = pointerEvent('pointerdown', { pointerId: 6, clientX: 60, clientY: 20 });
    handle.dispatchEvent(rejected);
    expect(rejected.defaultPrevented).toBe(false);
    mode = 'begin-error';
    expect(() => handle.dispatchEvent(pointerEvent('pointerdown', { pointerId: 7, clientX: 70, clientY: 20 }))).not.toThrow();
    mode = 'move-error';
    handle.dispatchEvent(pointerEvent('pointerdown', { pointerId: 8, clientX: 80, clientY: 20 }));
    expect(() => handle.dispatchEvent(pointerEvent('pointermove', { pointerId: 8, clientX: 81, clientY: 20 }))).not.toThrow();
    expect(endings).toEqual(['error']);
    expect(handle.classList.contains('product-dragging')).toBe(false);
    mode = 'healthy';
    handle.dispatchEvent(pointerEvent('pointerdown', { pointerId: 9, clientX: 90, clientY: 20 }));
    handle.dispatchEvent(pointerEvent('pointermove', { pointerId: 9, clientX: 91, clientY: 20 }));
    handle.dispatchEvent(pointerEvent('pointerup', { pointerId: 9, clientX: 91, clientY: 20 }));
    expect(moves).toEqual([91]);
    expect(endings).toEqual(['error', 'pointerup']);
    dispose();
  });

  it('does not resurrect or overwrite an imperative drag when begin reenters disposal or pointerdown', () => {
    const handle = document.createElement('div');
    host.appendChild(handle);
    handle.setPointerCapture = () => {};
    handle.releasePointerCapture = () => {};
    const endings: string[] = [];
    const moves: number[] = [];
    let dispose = () => {};
    let mode: 'dispose' | 'nested' = 'dispose';
    dispose = installPointerDragSession({
      element: handle,
      begin: () => {
        if (mode === 'dispose') dispose();
        else handle.dispatchEvent(pointerEvent('pointerdown', { pointerId: 12, clientX: 120, clientY: 20 }));
        return { mode };
      },
      move: (_session, event) => moves.push(event.clientX),
      end: (session, reason) => endings.push(`${session.mode}:${reason}`),
      draggingClassName: 'product-dragging',
    });

    handle.dispatchEvent(pointerEvent('pointerdown', { pointerId: 10, clientX: 100, clientY: 20 }));
    handle.dispatchEvent(pointerEvent('pointermove', { pointerId: 10, clientX: 101, clientY: 20 }));
    expect(moves).toEqual([]);
    expect(endings).toEqual(['dispose:dispose']);
    expect(handle.classList.contains('product-dragging')).toBe(false);

    mode = 'nested';
    const nestedEndings: string[] = [];
    const nestedMoves: number[] = [];
    let nested = true;
    const disposeNested = installPointerDragSession({
      element: handle,
      begin: () => {
        if (nested) {
          nested = false;
          handle.dispatchEvent(pointerEvent('pointerdown', { pointerId: 14, clientX: 140, clientY: 20 }));
        }
        return { accepted: true };
      },
      move: (_session, event) => nestedMoves.push(event.clientX),
      end: (_session, reason) => nestedEndings.push(reason),
      draggingClassName: 'product-dragging',
    });
    handle.dispatchEvent(pointerEvent('pointerdown', { pointerId: 13, clientX: 130, clientY: 20 }));
    handle.dispatchEvent(pointerEvent('pointermove', { pointerId: 13, clientX: 131, clientY: 20 }));
    handle.dispatchEvent(pointerEvent('pointerup', { pointerId: 13, clientX: 131, clientY: 20 }));
    expect(nestedMoves).toEqual([131]);
    expect(nestedEndings).toEqual(['pointerup']);
    expect(handle.classList.contains('product-dragging')).toBe(false);
    disposeNested();
  });

  it('rolls back a failed pointer capture and remains usable for the next drag', () => {
    const handle = document.createElement('div');
    host.appendChild(handle);
    let failCapture = true;
    handle.setPointerCapture = () => {
      if (failCapture) throw new Error('capture failed');
    };
    handle.releasePointerCapture = () => {};
    const endings: string[] = [];
    const moves: number[] = [];
    const dispose = installPointerDragSession({
      element: handle,
      begin: () => ({ accepted: true }),
      move: (_session, event) => moves.push(event.clientX),
      end: (_session, reason) => endings.push(reason),
      draggingClassName: 'product-dragging',
    });

    handle.dispatchEvent(pointerEvent('pointerdown', { pointerId: 15, clientX: 150, clientY: 20 }));
    handle.dispatchEvent(pointerEvent('pointermove', { pointerId: 15, clientX: 151, clientY: 20 }));
    expect(moves).toEqual([]);
    expect(endings).toEqual(['error']);
    expect(handle.classList.contains('product-dragging')).toBe(false);

    failCapture = false;
    handle.dispatchEvent(pointerEvent('pointerdown', { pointerId: 16, clientX: 160, clientY: 20 }));
    handle.dispatchEvent(pointerEvent('pointermove', { pointerId: 16, clientX: 161, clientY: 20 }));
    handle.dispatchEvent(pointerEvent('pointerup', { pointerId: 16, clientX: 161, clientY: 20 }));
    expect(moves).toEqual([161]);
    expect(endings).toEqual(['error', 'pointerup']);
    dispose();
  });

  it('reports incremental drag deltas and releases global drag styles', () => {
    const deltas: number[] = [];
    const lifecycle: string[] = [];
    const props: ResizeHandleProps = {
      orientation: 'col',
      onDrag: (delta) => deltas.push(delta),
      onDragStart: () => lifecycle.push('start'),
      onDragEnd: () => lifecycle.push('end'),
      className: 'product-resizer',
      ariaLabel: 'Resize auxiliary bar',
      title: 'Resize panel',
    };
    act(() => root.render(<ResizeHandle {...props} />));
    const handle = host.querySelector<HTMLElement>('[role="separator"]');
    expect(handle?.getAttribute('aria-orientation')).toBe('vertical');
    expect(handle?.getAttribute('aria-label')).toBe('Resize auxiliary bar');
    expect(handle?.classList.contains('resize-handle')).toBe(true);
    expect(handle?.classList.contains('resize-handle-col')).toBe(true);
    expect(handle?.classList.contains('product-resizer')).toBe(true);
    expect(handle?.title).toBe('Resize panel');
    if (!handle) throw new Error('resize handle missing');
    handle.setPointerCapture = () => {};
    handle.releasePointerCapture = () => {};

    act(() => handle.dispatchEvent(pointerEvent('pointerdown', { pointerId: 4, clientX: 10, clientY: 20 })));
    expect(lifecycle).toEqual(['start']);
    expect(document.body.style.cursor).toBe('col-resize');
    expect(document.body.style.userSelect).toBe('none');

    act(() => handle.dispatchEvent(pointerEvent('pointermove', { pointerId: 4, clientX: 17, clientY: 99 })));
    act(() => handle.dispatchEvent(pointerEvent('pointermove', { pointerId: 4, clientX: 20, clientY: 120 })));
    expect(deltas).toEqual([7, 3]);

    act(() => handle.dispatchEvent(pointerEvent('pointercancel', { pointerId: 4, clientX: 20, clientY: 120 })));
    expect(lifecycle).toEqual(['start', 'end']);
    expect(document.body.style.cursor).toBe('');
    expect(document.body.style.userSelect).toBe('');
  });

  it('restores global drag styles when an active handle unmounts', () => {
    let ended = 0;
    act(() => root.render(
      <ResizeHandle orientation="row" onDrag={() => {}} onDragEnd={() => { ended += 1; }} />,
    ));
    const handle = host.querySelector<HTMLElement>('[role="separator"]');
    if (!handle) throw new Error('resize handle missing');
    handle.setPointerCapture = () => {};

    act(() => handle.dispatchEvent(pointerEvent('pointerdown', { pointerId: 5, clientX: 10, clientY: 20 })));
    expect(document.body.style.cursor).toBe('row-resize');

    act(() => root.render(<></>));
    expect(ended).toBe(1);
    expect(document.body.style.cursor).toBe('');
    expect(document.body.style.userSelect).toBe('');
  });

  it('keeps one active pointer and balances lifecycle callbacks exactly once', () => {
    const deltas: number[] = [];
    const lifecycle: string[] = [];
    act(() => root.render(
      <ResizeHandle
        orientation="col"
        onDrag={(delta) => deltas.push(delta)}
        onDragStart={() => lifecycle.push('start')}
        onDragEnd={() => lifecycle.push('end')}
      />,
    ));
    const handle = host.querySelector<HTMLElement>('[role="separator"]');
    if (!handle) throw new Error('resize handle missing');
    handle.setPointerCapture = () => {};
    handle.releasePointerCapture = () => {};

    act(() => handle.dispatchEvent(pointerEvent('pointerdown', { pointerId: 1, clientX: 10, clientY: 20 })));
    act(() => handle.dispatchEvent(pointerEvent('pointerdown', { pointerId: 2, clientX: 100, clientY: 200 })));
    act(() => handle.dispatchEvent(pointerEvent('pointermove', { pointerId: 2, clientX: 120, clientY: 200 })));
    act(() => handle.dispatchEvent(pointerEvent('pointermove', { pointerId: 1, clientX: 14, clientY: 20 })));
    act(() => handle.dispatchEvent(pointerEvent('pointerup', { pointerId: 2, clientX: 120, clientY: 200 })));

    expect(lifecycle).toEqual(['start']);
    expect(deltas).toEqual([4]);
    expect(document.body.style.cursor).toBe('col-resize');

    act(() => handle.dispatchEvent(pointerEvent('pointercancel', { pointerId: 1, clientX: 14, clientY: 20 })));
    act(() => handle.dispatchEvent(pointerEvent('pointercancel', { pointerId: 1, clientX: 14, clientY: 20 })));
    expect(lifecycle).toEqual(['start', 'end']);
    expect(document.body.style.cursor).toBe('');
  });

  it('keeps anchored size pinned through clamp overshoot until cumulative pointer travel returns', () => {
    const clamp = (value: number): number => Math.min(720, Math.max(280, value));
    const session = beginAnchoredResize(600);

    expect(clamp(applyAnchoredResizeDelta(session, -200))).toBe(720);
    expect(clamp(applyAnchoredResizeDelta(session, 1))).toBe(720);
    expect(clamp(applyAnchoredResizeDelta(session, 79))).toBe(720);
    expect(clamp(applyAnchoredResizeDelta(session, 1))).toBe(719);
  });

  it('owns anchored drag session and balances the injected body class on finish and unmount', () => {
    let size = 600;
    const writes: number[] = [];
    const writeSize = (next: number): void => {
      size = Math.min(720, Math.max(280, next));
      writes.push(size);
    };
    act(() => root.render(
      <AnchoredResizeHandle
        orientation="col"
        readSize={() => size}
        writeSize={writeSize}
        resizingBodyClassName="product-resizing"
        ariaLabel="Resize product panel"
      />,
    ));
    const handle = host.querySelector<HTMLElement>('[role="separator"]');
    if (!handle) throw new Error('anchored resize handle missing');
    handle.setPointerCapture = () => {};
    handle.releasePointerCapture = () => {};

    act(() => handle.dispatchEvent(pointerEvent('pointerdown', { pointerId: 8, clientX: 100, clientY: 20 })));
    expect(document.body.classList.contains('product-resizing')).toBe(true);
    act(() => handle.dispatchEvent(pointerEvent('pointermove', { pointerId: 8, clientX: -100, clientY: 20 })));
    act(() => handle.dispatchEvent(pointerEvent('pointermove', { pointerId: 8, clientX: -99, clientY: 20 })));
    act(() => handle.dispatchEvent(pointerEvent('pointermove', { pointerId: 8, clientX: -20, clientY: 20 })));
    act(() => handle.dispatchEvent(pointerEvent('pointermove', { pointerId: 8, clientX: -19, clientY: 20 })));
    expect(writes).toEqual([720, 720, 720, 719]);

    act(() => handle.dispatchEvent(pointerEvent('pointerup', { pointerId: 8, clientX: -19, clientY: 20 })));
    expect(document.body.classList.contains('product-resizing')).toBe(false);

    act(() => handle.dispatchEvent(pointerEvent('pointerdown', { pointerId: 9, clientX: 100, clientY: 20 })));
    expect(document.body.classList.contains('product-resizing')).toBe(true);
    act(() => root.render(<></>));
    expect(document.body.classList.contains('product-resizing')).toBe(false);
  });

  it('leases a shared body class without removing pre-existing or overlapping ownership', () => {
    document.body.classList.add('shared-resizing');
    act(() => root.render(
      <AnchoredResizeHandle
        orientation="col"
        readSize={() => 400}
        writeSize={() => {}}
        resizingBodyClassName="shared-resizing"
      />,
    ));
    const preExistingHandle = host.querySelector<HTMLElement>('[role="separator"]');
    if (!preExistingHandle) throw new Error('pre-existing lease handle missing');
    preExistingHandle.setPointerCapture = () => {};
    preExistingHandle.releasePointerCapture = () => {};
    act(() => preExistingHandle.dispatchEvent(pointerEvent('pointerdown', { pointerId: 10, clientX: 100, clientY: 20 })));
    act(() => preExistingHandle.dispatchEvent(pointerEvent('pointerup', { pointerId: 10, clientX: 100, clientY: 20 })));
    expect(document.body.classList.contains('shared-resizing')).toBe(true);

    document.body.classList.remove('shared-resizing');
    act(() => root.render(
      <>
        <AnchoredResizeHandle
          orientation="col"
          readSize={() => 400}
          writeSize={() => {}}
          resizingBodyClassName="shared-resizing"
        />
        <AnchoredResizeHandle
          orientation="col"
          readSize={() => 500}
          writeSize={() => {}}
          resizingBodyClassName="shared-resizing"
        />
      </>,
    ));
    const [first, second] = [...host.querySelectorAll<HTMLElement>('[role="separator"]')];
    if (!first || !second) throw new Error('overlapping lease handles missing');
    first.setPointerCapture = () => {};
    first.releasePointerCapture = () => {};
    second.setPointerCapture = () => {};
    second.releasePointerCapture = () => {};
    act(() => first.dispatchEvent(pointerEvent('pointerdown', { pointerId: 11, clientX: 100, clientY: 20 })));
    act(() => second.dispatchEvent(pointerEvent('pointerdown', { pointerId: 12, clientX: 100, clientY: 20 })));
    act(() => first.dispatchEvent(pointerEvent('pointerup', { pointerId: 11, clientX: 100, clientY: 20 })));
    expect(document.body.classList.contains('shared-resizing')).toBe(true);
    act(() => second.dispatchEvent(pointerEvent('pointerup', { pointerId: 12, clientX: 100, clientY: 20 })));
    expect(document.body.classList.contains('shared-resizing')).toBe(false);
  });

  it('rolls back failed read and write adapters without trapping the next drag session', () => {
    let failRead = true;
    let failWrite = false;
    const writes: number[] = [];
    act(() => root.render(
      <AnchoredResizeHandle
        orientation="col"
        readSize={() => {
          if (failRead) throw new Error('read failed');
          return 400;
        }}
        writeSize={(next) => {
          if (failWrite) throw new Error('write failed');
          writes.push(next);
        }}
        resizingBodyClassName="failing-resize"
      />,
    ));
    const handle = host.querySelector<HTMLElement>('[role="separator"]');
    if (!handle) throw new Error('failing adapter handle missing');
    handle.setPointerCapture = () => {};
    handle.releasePointerCapture = () => {};

    expect(() => {
      act(() => handle.dispatchEvent(pointerEvent('pointerdown', { pointerId: 13, clientX: 100, clientY: 20 })));
    }).not.toThrow();
    expect(document.body.style.cursor).toBe('');
    expect(document.body.style.userSelect).toBe('');
    expect(document.body.classList.contains('failing-resize')).toBe(false);

    failRead = false;
    failWrite = true;
    act(() => handle.dispatchEvent(pointerEvent('pointerdown', { pointerId: 14, clientX: 100, clientY: 20 })));
    expect(document.body.classList.contains('failing-resize')).toBe(true);
    expect(() => {
      act(() => handle.dispatchEvent(pointerEvent('pointermove', { pointerId: 14, clientX: 110, clientY: 20 })));
    }).not.toThrow();
    expect(document.body.style.cursor).toBe('');
    expect(document.body.style.userSelect).toBe('');
    expect(document.body.classList.contains('failing-resize')).toBe(false);

    failWrite = false;
    act(() => handle.dispatchEvent(pointerEvent('pointerdown', { pointerId: 15, clientX: 100, clientY: 20 })));
    act(() => handle.dispatchEvent(pointerEvent('pointermove', { pointerId: 15, clientX: 110, clientY: 20 })));
    act(() => handle.dispatchEvent(pointerEvent('pointerup', { pointerId: 15, clientX: 110, clientY: 20 })));
    expect(writes).toEqual([390]);
  });
});
