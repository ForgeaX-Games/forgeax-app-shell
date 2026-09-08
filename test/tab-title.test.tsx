import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  stabilizeLiveTabTitleSource,
  useLiveTabTitle,
  type LiveTabTitleSource,
} from '../src/tab-title';

function createSource(initial: string | undefined) {
  let current = initial;
  let listener: (() => void) | undefined;
  let disposals = 0;
  const source: LiveTabTitleSource = {
    getTitle: () => current,
    subscribe: (next) => {
      listener = next;
      return () => {
        disposals++;
      };
    },
  };
  return {
    source,
    set(next: string | undefined) {
      current = next;
      listener?.();
    },
    setSilently(next: string | undefined) {
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
  source: LiveTabTitleSource;
  onRender?: (title: string | undefined) => void;
}): ReactElement {
  const title = useLiveTabTitle(source);
  onRender?.(title);
  return <span data-title>{title ?? 'absent'}</span>;
}

describe('live tab title observation', () => {
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
    const fixture = createSource('initial');
    const source: LiveTabTitleSource = {
      getTitle: fixture.source.getTitle,
      subscribe: (listener) => {
        const dispose = fixture.source.subscribe(listener);
        fixture.setSilently('reconciled');
        return dispose;
      },
    };

    act(() => root.render(<Probe source={source} />));
    expect(host.textContent).toBe('reconciled');

    act(() => fixture.set('updated'));
    expect(host.textContent).toBe('updated');
  });

  it('disposes one product subscription at most once', () => {
    const fixture = createSource('title');
    const stable = stabilizeLiveTabTitleSource(fixture.source);
    const dispose = stable.subscribe(() => {});

    dispose();
    dispose();
    expect(fixture.disposals).toBe(1);
  });

  it('balances replacement and disposal while fencing a retained old listener', () => {
    const first = createSource('first');
    const second = createSource('second');
    const secondRenders: Array<string | undefined> = [];
    act(() => root.render(<Probe source={first.source} />));

    act(() => root.render(
      <Probe source={second.source} onRender={(title) => secondRenders.push(title)} />,
    ));
    expect(first.disposals).toBe(1);
    expect(host.textContent).toBe('second');
    expect(secondRenders).toEqual(['second']);

    act(() => {
      first.setSilently('stale');
      first.emitRetained();
    });
    expect(host.textContent).toBe('second');

    act(() => root.unmount());
    expect(second.disposals).toBe(1);
  });

  it('isolates read, subscription, notification, and disposer failures', () => {
    let throwRead = false;
    let listener: (() => void) | undefined;
    const source: LiveTabTitleSource = {
      getTitle: () => {
        if (throwRead) throw new Error('read');
        return 'stable';
      },
      subscribe: (next) => {
        listener = next;
        return () => {
          throw new Error('dispose');
        };
      },
    };
    act(() => root.render(<Probe source={source} />));
    expect(host.textContent).toBe('stable');

    throwRead = true;
    expect(() => act(() => listener?.())).not.toThrow();
    expect(host.textContent).toBe('stable');

    const broken: LiveTabTitleSource = {
      getTitle: () => undefined,
      subscribe: () => {
        throw new Error('subscribe');
      },
    };
    expect(() => act(() => root.render(<Probe source={broken} />))).not.toThrow();
    expect(host.textContent).toBe('absent');
    expect(() => act(() => root.unmount())).not.toThrow();
  });
});
