import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  useLiveTabPlacement,
  type LiveTabPlacement,
  type LiveTabPlacementSource,
} from '../src/react';
import {
  stabilizeLiveTabPlacementSource,
} from '../src/tab-placement';

function createSource(initial: LiveTabPlacement) {
  let current = initial;
  let listener: (() => void) | undefined;
  let disposals = 0;
  const source: LiveTabPlacementSource = {
    getPlacement: () => current,
    subscribe: (next) => {
      listener = next;
      return () => {
        disposals++;
      };
    },
  };
  return {
    source,
    set(next: LiveTabPlacement) {
      current = next;
      listener?.();
    },
    setSilently(next: LiveTabPlacement) {
      current = next;
    },
    emitRetained() {
      listener?.();
    },
    get disposals() {
      return disposals;
    },
  };
}

function Probe({
  source,
  onRender,
}: {
  source: LiveTabPlacementSource;
  onRender?: (placement: LiveTabPlacement | undefined) => void;
}): ReactElement {
  const placement = useLiveTabPlacement(source);
  onRender?.(placement);
  return (
    <span data-placement>
      {placement === undefined ? 'absent' : `${placement.isEdge}:${placement.groupId}`}
    </span>
  );
}

describe('live tab placement observation', () => {
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

  it('reads initially, reconciles after subscription, and publishes later changes', () => {
    const fixture = createSource({ isEdge: false, groupId: 'grid' });
    const source: LiveTabPlacementSource = {
      getPlacement: fixture.source.getPlacement,
      subscribe: (listener) => {
        const dispose = fixture.source.subscribe(listener);
        fixture.setSilently({ isEdge: true, groupId: 'edge-left' });
        return dispose;
      },
    };

    act(() => root.render(<Probe source={source} />));
    expect(host.textContent).toBe('true:edge-left');

    act(() => fixture.set({ isEdge: true, groupId: 'edge-right' }));
    expect(host.textContent).toBe('true:edge-right');
  });

  it('suppresses structurally equal placements and disposes at most once', () => {
    const fixture = createSource({ isEdge: true, groupId: 'edge-left' });
    const stable = stabilizeLiveTabPlacementSource(fixture.source);
    let notifications = 0;
    const dispose = stable.subscribe(() => notifications++);

    fixture.set({ isEdge: true, groupId: 'edge-left' });
    expect(notifications).toBe(0);

    dispose();
    dispose();
    expect(fixture.disposals).toBe(1);
  });

  it('renders a replacement immediately and fences a retained old listener', () => {
    const first = createSource({ isEdge: false, groupId: 'grid' });
    const second = createSource({ isEdge: true, groupId: 'edge-left' });
    const secondRenders: Array<LiveTabPlacement | undefined> = [];
    act(() => root.render(<Probe source={first.source} />));

    act(() => root.render(
      <Probe source={second.source} onRender={(placement) => secondRenders.push(placement)} />,
    ));
    expect(first.disposals).toBe(1);
    expect(host.textContent).toBe('true:edge-left');
    expect(secondRenders).toEqual([{ isEdge: true, groupId: 'edge-left' }]);

    act(() => {
      first.setSilently({ isEdge: true, groupId: 'stale' });
      first.emitRetained();
    });
    expect(host.textContent).toBe('true:edge-left');
  });

  it('isolates read, subscription, notification, and disposer failures', () => {
    let throwRead = false;
    let listener: (() => void) | undefined;
    const source: LiveTabPlacementSource = {
      getPlacement: () => {
        if (throwRead) throw new Error('read');
        return { isEdge: false, groupId: 'grid' };
      },
      subscribe: (next) => {
        listener = next;
        return () => {
          throw new Error('dispose');
        };
      },
    };
    act(() => root.render(<Probe source={source} />));
    expect(host.textContent).toBe('false:grid');

    throwRead = true;
    expect(() => act(() => listener?.())).not.toThrow();
    expect(host.textContent).toBe('false:grid');

    const broken: LiveTabPlacementSource = {
      getPlacement: () => {
        throw new Error('initial read');
      },
      subscribe: () => {
        throw new Error('subscribe');
      },
    };
    expect(() => act(() => root.render(<Probe source={broken} />))).not.toThrow();
    expect(host.textContent).toBe('absent');
    expect(() => act(() => root.unmount())).not.toThrow();
  });
});
