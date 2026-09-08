import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  useTabPinnedState,
  type TabPinnedStateSource,
} from '../src/react';
import { stabilizeTabPinnedStateSource } from '../src/tab-pinned-state';

function createSource(initial: Readonly<Record<string, string>>) {
  let current = initial;
  const listeners: Array<() => void> = [];
  let disposals = 0;
  const source: TabPinnedStateSource = {
    pinnedIn: (groupId) => current[groupId],
    subscribe: (next) => {
      listeners.push(next);
      return () => {
        disposals++;
      };
    },
  };
  return {
    source,
    set(next: Readonly<Record<string, string>>) {
      current = next;
      listeners.at(-1)?.();
    },
    setSilently(next: Readonly<Record<string, string>>) {
      current = next;
    },
    emitRetained(index = 0) {
      listeners[index]?.();
    },
    get disposals() {
      return disposals;
    },
  };
}

function Probe({
  source,
  groupId,
  panelId,
  onRender,
}: {
  source: TabPinnedStateSource;
  groupId: string;
  panelId: string;
  onRender?: (pinned: boolean) => void;
}): ReactElement {
  const pinned = useTabPinnedState(source, groupId, panelId);
  onRender?.(pinned);
  return <span data-pinned>{String(pinned)}</span>;
}

describe('tab pinned-state observation', () => {
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
    const fixture = createSource({});
    const source: TabPinnedStateSource = {
      pinnedIn: fixture.source.pinnedIn,
      subscribe: (listener) => {
        const dispose = fixture.source.subscribe(listener);
        fixture.setSilently({ edge: 'console' });
        return dispose;
      },
    };

    act(() => root.render(<Probe source={source} groupId="edge" panelId="console" />));
    expect(host.textContent).toBe('true');

    act(() => fixture.set({ edge: 'problems' }));
    expect(host.textContent).toBe('false');
  });

  it('suppresses equal boolean projections and disposes at most once', () => {
    const fixture = createSource({ edge: 'console' });
    const stable = stabilizeTabPinnedStateSource(fixture.source, 'edge', 'console');
    let notifications = 0;
    const dispose = stable.subscribe(() => notifications++);

    fixture.set({ edge: 'console', other: 'problems' });
    expect(notifications).toBe(0);

    dispose();
    dispose();
    expect(fixture.disposals).toBe(1);
  });

  it('renders identity replacement immediately and fences a retained old listener', () => {
    const fixture = createSource({ edge: 'console' });
    const replacementRenders: boolean[] = [];
    act(() => root.render(
      <Probe source={fixture.source} groupId="edge" panelId="console" />,
    ));

    act(() => root.render(
      <Probe
        source={fixture.source}
        groupId="edge"
        panelId="problems"
        onRender={(pinned) => replacementRenders.push(pinned)}
      />,
    ));
    expect(fixture.disposals).toBe(1);
    expect(host.textContent).toBe('false');
    expect(replacementRenders).toEqual([false]);

    act(() => {
      fixture.setSilently({ edge: 'console', other: 'problems' });
      fixture.emitRetained();
    });
    expect(host.textContent).toBe('false');
  });

  it('isolates read, subscription, notification, and disposer failures', () => {
    let throwRead = false;
    let listener: (() => void) | undefined;
    const source: TabPinnedStateSource = {
      pinnedIn: () => {
        if (throwRead) throw new Error('read');
        return 'console';
      },
      subscribe: (next) => {
        listener = next;
        return () => {
          throw new Error('dispose');
        };
      },
    };
    act(() => root.render(<Probe source={source} groupId="edge" panelId="console" />));
    expect(host.textContent).toBe('true');

    throwRead = true;
    expect(() => act(() => listener?.())).not.toThrow();
    expect(host.textContent).toBe('true');

    const broken: TabPinnedStateSource = {
      pinnedIn: () => {
        throw new Error('initial read');
      },
      subscribe: () => {
        throw new Error('subscribe');
      },
    };
    expect(() => act(() => root.render(
      <Probe source={broken} groupId="edge" panelId="console" />,
    ))).not.toThrow();
    expect(host.textContent).toBe('false');
    expect(() => act(() => root.unmount())).not.toThrow();
  });
});
