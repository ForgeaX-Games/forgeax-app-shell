import { describe, expect, test } from 'bun:test';
import {
  canOpenPanelWindow,
  createBrowserWindowManager,
  createExternalWindowManager,
  createEdgePinStore,
  createPanelWindowingController,
  createSurfaceWindowingController,
  decodeSurfaceFromLocation,
  encodeSurfaceQuery,
  surfaceKey,
  surfaceWindowLabel,
  shouldShowDetachedPlaceholder,
  type DetachedWindowCapability,
} from '../src/window';

describe('edge pin state', () => {
  test('publishes one pinned panel per group with stable snapshots', () => {
    const store = createEdgePinStore();
    const initial = store.snapshot();
    const snapshots: Array<Readonly<Record<string, string>>> = [];
    store.onChange(() => snapshots.push(store.snapshot()));

    store.setPinned('left', 'assets');
    expect(store.pinnedIn('left')).toBe('assets');
    expect(store.snapshot()).toEqual({ left: 'assets' });
    store.setPinned('left', 'outline');
    expect(store.snapshot()).toEqual({ left: 'outline' });
    store.setPinned('right', 'properties');
    expect(store.snapshot()).toEqual({ left: 'outline', right: 'properties' });

    const stable = store.snapshot();
    store.setPinned('right', 'properties');
    expect(store.snapshot()).toBe(stable);
    expect(snapshots).toHaveLength(3);
    expect(initial).not.toBe(store.snapshot());
  });

  test('unpins one group and clears idempotently', () => {
    const store = createEdgePinStore();
    let changes = 0;
    store.onChange(() => { changes += 1; });
    store.setPinned('left', 'assets');
    store.setPinned('right', 'properties');

    store.setPinned('left', undefined);
    expect(store.snapshot()).toEqual({ right: 'properties' });
    store.setPinned('left', undefined);
    expect(changes).toBe(3);

    store.clear();
    expect(store.snapshot()).toEqual({});
    const empty = store.snapshot();
    store.clear();
    expect(store.snapshot()).toBe(empty);
    expect(changes).toBe(4);
  });
});

describe('surface windowing state orchestration', () => {
  const chat = { kind: 'panel' as const, id: 'chat' };

  test('publishes a stable floating snapshot before opening and rolls it back on rejection', async () => {
    let accept = false;
    const snapshots: Array<Readonly<Record<string, true>>> = [];
    const manager = {
      canDetach: () => true,
      openSurfaceWindow: async () => accept,
      closeSurfaceWindow: async () => {},
      isSurfaceWindowOpen: async () => false,
      onSurfaceWindowClosed: () => () => {},
    };
    const controller = createSurfaceWindowingController({ manager });
    const initial = controller.snapshot();
    controller.onChange(() => snapshots.push(controller.snapshot()));

    expect(await controller.detachSurface(chat)).toBe(false);
    expect(initial).toBe(controller.snapshot());
    expect(snapshots.map((value) => value['panel:chat'] === true)).toEqual([true, false]);

    accept = true;
    expect(await controller.detachSurface(chat, { width: 480 })).toBe(true);
    expect(controller.snapshot()).toEqual({ 'panel:chat': true });
  });

  test('owns redock and external-close transitions while injecting product pre-detach policy', async () => {
    const events: string[] = [];
    const manager = {
      canDetach: () => true,
      async openSurfaceWindow() { events.push('open'); return true; },
      async closeSurfaceWindow() { events.push('close'); },
      isSurfaceWindowOpen: async () => false,
      onSurfaceWindowClosed: () => () => {},
    };
    const controller = createSurfaceWindowingController({
      manager,
      beforeDetach: (surface) => events.push(`before:${surfaceKey(surface)}`),
    });

    await controller.detachSurface(chat);
    expect(events).toEqual(['before:panel:chat', 'open']);
    await controller.redockSurface(chat);
    expect(events).toEqual(['before:panel:chat', 'open', 'close']);
    expect(controller.snapshot()).toEqual({});

    await controller.detachSurface(chat);
    controller.markSurfaceDocked(chat);
    const stable = controller.snapshot();
    controller.markSurfaceDocked(chat);
    expect(controller.snapshot()).toBe(stable);
  });

  test('fails closed without publishing state when the carrier is unavailable', async () => {
    let opened = 0;
    const controller = createSurfaceWindowingController({
      manager: {
        canDetach: () => false,
        async openSurfaceWindow() { opened += 1; return true; },
        async closeSurfaceWindow() {},
        isSurfaceWindowOpen: async () => false,
        onSurfaceWindowClosed: () => () => {},
      },
    });
    expect(await controller.detachSurface(chat)).toBe(false);
    expect(opened).toBe(0);
    expect(controller.snapshot()).toEqual({});
  });
});

function externalWindowHarness() {
  const handles = new Map<string, ReturnType<typeof makeHandle>>();
  const created: Array<{ label: string; surface: { kind: 'panel' | 'plugin'; id: string }; options: unknown }> = [];
  let available = true;
  let nextHandle: ReturnType<typeof makeHandle> | undefined;

  function makeHandle() {
    return {
      shown: 0,
      focused: 0,
      closed: 0,
      async show() { this.shown += 1; },
      async focus() { this.focused += 1; },
      async close() { this.closed += 1; },
    };
  }

  let lifecycle: { created(): void; error(): void; destroyed(): void } | undefined;

  const host = {
    async getByLabel(label: string) { return handles.get(label) ?? null; },
    async create(
      label: string,
      surface: { kind: 'panel' | 'plugin'; id: string },
      options: unknown,
      callbacks: { created(): void; error(): void; destroyed(): void },
    ) {
      const handle = nextHandle ?? makeHandle();
      nextHandle = undefined;
      lifecycle = callbacks;
      handles.set(label, handle);
      created.push({ label, surface, options });
      return handle;
    },
  };

  return {
    host,
    handles,
    created,
    canDetach: () => available,
    loadHost: async () => available ? host : undefined,
    makeHandle,
    emit(event: 'created' | 'error' | 'destroyed') { lifecycle?.[event](); },
    useNextHandle(handle: ReturnType<typeof makeHandle>) { nextHandle = handle; },
    setAvailable(value: boolean) { available = value; },
  };
}

function browserHarness() {
  let nextTimer = 1;
  const timers = new Map<number, () => void>();
  const opened: Array<{ url: string; target: string; features: string }> = [];
  const popups: Array<{ closed: boolean; focused: number; closedCalls: number; focus(): void; close(): void }> = [];
  let rejectOpen = false;
  const host = {
    screen: { width: 1440, height: 900 },
    open(url: string, target: string, features: string) {
      opened.push({ url, target, features });
      if (rejectOpen) return null;
      const popup = {
        closed: false,
        focused: 0,
        closedCalls: 0,
        focus() { this.focused += 1; },
        close() { this.closedCalls += 1; this.closed = true; },
      };
      popups.push(popup);
      return popup;
    },
    setInterval(callback: () => void) {
      const handle = nextTimer++;
      timers.set(handle, callback);
      return handle;
    },
    clearInterval(handle: unknown) { timers.delete(handle as number); },
  };
  return {
    host,
    opened,
    popups,
    timers,
    rejectNextOpen() { rejectOpen = true; },
    tick() { [...timers.values()].forEach((callback) => callback()); },
  };
}

function decodeWindowLabel(label: string): string {
  const encoded = label.slice('fx-surface-'.length).replace(/-/g, '+').replace(/_/g, '/');
  const padded = encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '=');
  return new TextDecoder().decode(Uint8Array.from(atob(padded), (char) => char.charCodeAt(0)));
}

describe('detached surface contract', () => {
  test('round-trips the complete structural descriptor through the base query', () => {
    const surface = {
      kind: 'plugin' as const,
      id: '@demo/tool',
      pane: 'left' as const,
      instance: 'page:v1:s:%40demo%2Ftool%23page%2Fmain::preview',
    };
    expect(decodeSurfaceFromLocation(`?${encodeSurfaceQuery(surface)}`)).toEqual(surface);
  });

  test('rejects missing or unknown surface identities', () => {
    expect(decodeSurfaceFromLocation('')).toBeNull();
    expect(decodeSurfaceFromLocation('?surface=unknown&id=chat')).toBeNull();
    expect(decodeSurfaceFromLocation('?surface=panel')).toBeNull();
  });

  test('isolates otherwise-identical surfaces by instance identity', () => {
    const base = { kind: 'plugin' as const, id: '@demo/tool', pane: 'left' as const };
    expect(surfaceKey({ ...base, instance: 'page-a::main' }))
      .not.toBe(surfaceKey({ ...base, instance: 'page-b::main' }));
  });

  test('keeps delimiters inside ids distinct from optional descriptor fields', () => {
    expect(surfaceKey({ kind: 'plugin', id: 'x:left' }))
      .not.toBe(surfaceKey({ kind: 'plugin', id: 'x', pane: 'left' }));
    expect(surfaceKey({ kind: 'panel', id: 'x:instance=y' }))
      .not.toBe(surfaceKey({ kind: 'panel', id: 'x', instance: 'y' }));
    expect(surfaceKey({ kind: 'plugin', id: 'x:left' }))
      .not.toBe(surfaceKey({ kind: 'plugin', id: '~x%3Aleft' }));
  });

  test('normalizes an explicitly empty instance to the established absent identity', () => {
    const surface = { kind: 'panel' as const, id: 'chat', instance: '' };
    expect(decodeSurfaceFromLocation(`?${encodeSurfaceQuery(surface)}`))
      .toEqual({ kind: 'panel', id: 'chat', instance: undefined, pane: undefined });
    expect(surfaceKey(surface)).toBe(surfaceKey({ kind: 'panel', id: 'chat' }));
  });

  test('encodes labels injectively with stable carrier-safe base64url', () => {
    const colon = { kind: 'plugin' as const, id: '@demo/tool', instance: 'a:b' };
    const escapedLookalike = { kind: 'plugin' as const, id: '@demo/tool', instance: 'a_3Ab' };
    const colonLabel = surfaceWindowLabel(colon);

    expect(colonLabel).toBe(surfaceWindowLabel(colon));
    expect(colonLabel).not.toBe(surfaceWindowLabel(escapedLookalike));
    expect(colonLabel).toMatch(/^fx-surface-[A-Za-z0-9_-]+$/);
    expect(surfaceKey({ kind: 'panel', id: 'chat' })).toBe('panel:chat');
    expect(surfaceWindowLabel({ kind: 'panel', id: 'chat' }))
      .toBe('fx-surface-cGFuZWw6Y2hhdA');
    const unicode = { kind: 'plugin' as const, id: '@demo/工具', instance: '页面：一' };
    expect(decodeWindowLabel(surfaceWindowLabel(unicode))).toBe(surfaceKey(unicode));
  });

  test('keeps declaration context typed without owning a physical carrier', () => {
    const capability: DetachedWindowCapability<{ title: string }> = {
      createTarget: ({ title }) => ({
        surface: { kind: 'panel', id: 'chat' },
        title,
        width: 480,
        height: 680,
        dockBehavior: 'close',
      }),
    };
    expect(capability.createTarget({ title: 'Chat' }).title).toBe('Chat');
  });
});

describe('browser detached-window carrier', () => {
  const surface = { kind: 'panel' as const, id: 'chat' };

  test('reports availability only when a browser host exists', () => {
    expect(createBrowserWindowManager({ surfaceUrl: () => '/surface', host: undefined }).canDetach())
      .toBe(typeof window !== 'undefined');
    const harness = browserHarness();
    expect(createBrowserWindowManager({ surfaceUrl: () => '/surface', host: harness.host }).canDetach())
      .toBe(true);
  });

  test('opens with explicit geometry and reuses the live popup by focusing it', async () => {
    const harness = browserHarness();
    const manager = createBrowserWindowManager({
      surfaceUrl: (value) => `/surface?${encodeSurfaceQuery(value)}`,
      host: harness.host,
    });

    expect(await manager.openSurfaceWindow(surface, { width: 480, height: 680, x: 12, y: 34 }))
      .toBe(true);
    expect(harness.opened).toEqual([{
      url: '/surface?surface=panel&id=chat',
      target: surfaceWindowLabel(surface),
      features: 'popup=yes,width=480,height=680,left=12,top=34,resizable=yes',
    }]);
    expect(await manager.openSurfaceWindow(surface)).toBe(true);
    expect(harness.opened).toHaveLength(1);
    expect(harness.popups[0]?.focused).toBe(1);
  });

  test('centers default geometry and reports popup rejection', async () => {
    const harness = browserHarness();
    const manager = createBrowserWindowManager({ surfaceUrl: () => '/surface', host: harness.host });
    expect(await manager.openSurfaceWindow(surface)).toBe(true);
    expect(harness.opened[0]?.features)
      .toBe('popup=yes,width=960,height=720,left=240,top=90,resizable=yes');

    const rejected = browserHarness();
    rejected.rejectNextOpen();
    expect(await createBrowserWindowManager({ surfaceUrl: () => '/surface', host: rejected.host })
      .openSurfaceWindow(surface)).toBe(false);
  });

  test('polls user closure once, forgets the popup and balances subscriptions', async () => {
    const harness = browserHarness();
    const manager = createBrowserWindowManager({ surfaceUrl: () => '/surface', host: harness.host });
    const closed: string[] = [];
    const release = manager.onSurfaceWindowClosed((value) => closed.push(surfaceKey(value)));
    await manager.openSurfaceWindow(surface);
    harness.popups[0]!.closed = true;
    harness.tick();
    harness.tick();
    expect(closed).toEqual(['panel:chat']);
    expect(harness.timers.size).toBe(0);
    release();
    await manager.openSurfaceWindow(surface);
    harness.popups[1]!.closed = true;
    harness.tick();
    expect(closed).toEqual(['panel:chat']);
  });

  test('replaces an already-closed popup without letting its old poll forget the replacement', async () => {
    const harness = browserHarness();
    const manager = createBrowserWindowManager({ surfaceUrl: () => '/surface', host: harness.host });
    await manager.openSurfaceWindow(surface);
    harness.popups[0]!.closed = true;
    await manager.openSurfaceWindow(surface);
    expect(harness.popups).toHaveLength(2);
    expect(harness.timers.size).toBe(1);
    harness.tick();
    expect(await manager.isSurfaceWindowOpen(surface)).toBe(true);
  });

  test('programmatic close clears polling without emitting a user-close event', async () => {
    const harness = browserHarness();
    const manager = createBrowserWindowManager({ surfaceUrl: () => '/surface', host: harness.host });
    let closed = 0;
    manager.onSurfaceWindowClosed(() => { closed += 1; });
    await manager.openSurfaceWindow(surface);
    expect(await manager.isSurfaceWindowOpen(surface)).toBe(true);
    await manager.closeSurfaceWindow(surface);
    expect(harness.popups[0]?.closedCalls).toBe(1);
    expect(await manager.isSurfaceWindowOpen(surface)).toBe(false);
    expect(harness.timers.size).toBe(0);
    expect(closed).toBe(0);
  });

  test('a retained old poll cannot forget a replacement popup or announce it closed', async () => {
    const harness = browserHarness();
    const manager = createBrowserWindowManager({ surfaceUrl: () => '/surface', host: harness.host });
    let closed = 0;
    manager.onSurfaceWindowClosed(() => { closed++; });
    await manager.openSurfaceWindow(surface);
    const retained = [...harness.timers.values()][0]!;
    harness.popups[0]!.closed = true;
    await manager.openSurfaceWindow(surface);
    retained();
    expect(await manager.isSurfaceWindowOpen(surface)).toBe(true);
    expect(harness.timers.size).toBe(1);
    expect(closed).toBe(0);
    await manager.closeSurfaceWindow(surface);
  });

  test('a retained poll after programmatic close cannot emit a user-close event', async () => {
    const harness = browserHarness();
    const manager = createBrowserWindowManager({ surfaceUrl: () => '/surface', host: harness.host });
    let closed = 0;
    manager.onSurfaceWindowClosed(() => { closed++; });
    await manager.openSurfaceWindow(surface);
    const retained = [...harness.timers.values()][0]!;
    await manager.closeSurfaceWindow(surface);
    retained();
    expect(closed).toBe(0);
    expect(harness.timers.size).toBe(0);
  });

  test('stores poll ownership before a synchronous close tick and preserves the custom interval', async () => {
    const harness = browserHarness();
    const cleared: unknown[] = [];
    const delays: number[] = [];
    const manager = createBrowserWindowManager({
      surfaceUrl: () => '/surface', closePollIntervalMs: 120,
      host: {
        ...harness.host,
        setInterval(callback, delay) {
          delays.push(delay);
          harness.popups[0]!.closed = true;
          callback();
          callback();
          return 0;
        },
        clearInterval(handle) { cleared.push(handle); },
      },
    });
    let closed = 0;
    manager.onSurfaceWindowClosed(() => { closed++; });
    expect(await manager.openSurfaceWindow(surface)).toBe(true);
    expect(await manager.isSurfaceWindowOpen(surface)).toBe(false);
    expect(closed).toBe(1);
    expect(delays).toEqual([120]);
    expect(cleared).toEqual([0]);
    await manager.closeSurfaceWindow(surface);
    expect(cleared).toEqual([0]);
  });

  test('releases the old identity before host cleanup reopens the surface', async () => {
    const harness = browserHarness();
    let reopen = false;
    const manager = createBrowserWindowManager({
      surfaceUrl: () => '/surface',
      host: {
        ...harness.host,
        clearInterval(handle) {
          harness.host.clearInterval(handle);
          if (reopen) { reopen = false; void manager.openSurfaceWindow(surface); }
        },
      },
    });
    await manager.openSurfaceWindow(surface);
    reopen = true;
    await manager.closeSurfaceWindow(surface);
    expect(await manager.isSurfaceWindowOpen(surface)).toBe(true);
    expect(harness.timers.size).toBe(1);
    expect(harness.popups).toHaveLength(2);
    await manager.closeSurfaceWindow(surface);
  });

  test('reuses a replacement opened reentrantly while forgetting a closed popup', async () => {
    const harness = browserHarness();
    let reopen = false;
    const manager = createBrowserWindowManager({
      surfaceUrl: () => '/surface',
      host: {
        ...harness.host,
        clearInterval(handle) {
          harness.host.clearInterval(handle);
          if (reopen) { reopen = false; void manager.openSurfaceWindow(surface); }
        },
      },
    });
    await manager.openSurfaceWindow(surface);
    harness.popups[0]!.closed = true;
    reopen = true;
    await manager.openSurfaceWindow(surface);
    expect(harness.popups).toHaveLength(2);
    expect(harness.popups[1]!.focused).toBe(1);
    expect(harness.timers.size).toBe(1);
    await manager.closeSurfaceWindow(surface);
    expect(harness.timers.size).toBe(0);
    expect(harness.popups.every((popup) => popup.closed)).toBe(true);
  });
});

describe('event-driven external-window carrier', () => {
  const surface = { kind: 'panel' as const, id: 'chat' };

  test('reports injected availability and fails soft when the host cannot load', async () => {
    const harness = externalWindowHarness();
    const manager = createExternalWindowManager({
      canDetach: harness.canDetach,
      loadHost: harness.loadHost,
    });
    expect(manager.canDetach()).toBe(true);
    harness.setAvailable(false);
    expect(manager.canDetach()).toBe(false);
    expect(await manager.openSurfaceWindow(surface)).toBe(false);
  });

  test('shows and focuses an existing window without creating a replacement', async () => {
    const harness = externalWindowHarness();
    const existing = harness.makeHandle();
    harness.handles.set(surfaceWindowLabel(surface), existing);
    const manager = createExternalWindowManager({ canDetach: harness.canDetach, loadHost: harness.loadHost });
    expect(await manager.openSurfaceWindow(surface)).toBe(true);
    expect(existing.shown).toBe(1);
    expect(existing.focused).toBe(1);
    expect(harness.created).toHaveLength(0);
  });

  test('replaces a stale existing window when show or focus fails', async () => {
    const harness = externalWindowHarness();
    const stale = harness.makeHandle();
    stale.show = async () => { throw new Error('window vanished'); };
    harness.handles.set(surfaceWindowLabel(surface), stale);
    const replacement = harness.makeHandle();
    harness.useNextHandle(replacement);
    const manager = createExternalWindowManager({ canDetach: harness.canDetach, loadHost: harness.loadHost });
    const opened = manager.openSurfaceWindow(surface);
    await Bun.sleep(0);
    harness.emit('created');
    expect(await opened).toBe(true);
    expect(harness.created).toHaveLength(1);
    expect(harness.handles.get(surfaceWindowLabel(surface))).toBe(replacement);
  });

  test('passes exact surface/options to the host and resolves created/error/timeout outcomes', async () => {
    const harness = externalWindowHarness();
    const options = { title: 'Chat', width: 480, height: 680, x: 12, y: 34 };
    const manager = createExternalWindowManager({
      canDetach: harness.canDetach,
      loadHost: harness.loadHost,
      createdTimeoutMs: 5,
    });
    const createdHandle = harness.makeHandle();
    harness.useNextHandle(createdHandle);
    const opened = manager.openSurfaceWindow(surface, options);
    await Bun.sleep(0);
    harness.emit('created');
    expect(await opened).toBe(true);
    expect(harness.created[0]).toEqual({ label: surfaceWindowLabel(surface), surface, options });

    const failedSurface = { kind: 'panel' as const, id: 'files' };
    const failedHandle = harness.makeHandle();
    harness.useNextHandle(failedHandle);
    const failed = manager.openSurfaceWindow(failedSurface);
    await Bun.sleep(0);
    harness.emit('error');
    expect(await failed).toBe(false);

    expect(await manager.openSurfaceWindow({ kind: 'panel', id: 'timeout' })).toBe(true);
  });

  test('notifies destroyed listeners once per event and isolates listener exceptions', async () => {
    const harness = externalWindowHarness();
    const handle = harness.makeHandle();
    harness.useNextHandle(handle);
    const manager = createExternalWindowManager({ canDetach: harness.canDetach, loadHost: harness.loadHost });
    const closed: string[] = [];
    manager.onSurfaceWindowClosed(() => { throw new Error('listener failure'); });
    const release = manager.onSurfaceWindowClosed((value) => closed.push(surfaceKey(value)));
    const opened = manager.openSurfaceWindow(surface);
    await Bun.sleep(0);
    harness.emit('created');
    await opened;
    harness.emit('destroyed');
    expect(closed).toEqual(['panel:chat']);
    release();
    harness.emit('destroyed');
    expect(closed).toEqual(['panel:chat']);
  });

  test('queries and closes through the injected host while tolerating a vanished window', async () => {
    const harness = externalWindowHarness();
    const handle = harness.makeHandle();
    harness.handles.set(surfaceWindowLabel(surface), handle);
    const manager = createExternalWindowManager({ canDetach: harness.canDetach, loadHost: harness.loadHost });
    expect(await manager.isSurfaceWindowOpen(surface)).toBe(true);
    await manager.closeSurfaceWindow(surface);
    expect(handle.closed).toBe(1);
    harness.handles.delete(surfaceWindowLabel(surface));
    expect(await manager.isSurfaceWindowOpen(surface)).toBe(false);
    await manager.closeSurfaceWindow(surface);
  });

  test('reports a host create rejection without an unhandled promise', async () => {
    const harness = externalWindowHarness();
    const manager = createExternalWindowManager({
      canDetach: harness.canDetach,
      loadHost: async () => ({
        getByLabel: harness.host.getByLabel,
        create: async () => { throw new Error('registration failed'); },
      }),
    });
    expect(await manager.openSurfaceWindow(surface)).toBe(false);
  });
});

describe('dock-panel windowing orchestration', () => {
  const surface = { kind: 'panel' as const, id: 'chat' };
  const capability: DetachedWindowCapability = {
    createTarget: () => ({
      surface,
      title: 'Chat',
      width: 480,
      height: 680,
      dockBehavior: 'close',
    }),
  };

  test('closes a dock placement only after the carrier accepts the exact target', async () => {
    const controller = createPanelWindowingController();
    const order: string[] = [];
    const opened = await controller.openPanelWindow('chat-placement', capability, {
      position: { x: 12, y: 34 },
      detachSurface: async (value, options) => {
        order.push('open');
        expect(value).toEqual(surface);
        expect(options).toEqual({ title: 'Chat', width: 480, height: 680, x: 12, y: 34 });
        return true;
      },
      closeDockPanel: () => { order.push('close'); },
    });

    expect(opened).toBe(true);
    expect(order).toEqual(['open', 'close']);
    expect(controller.panelForClosedSurface(surface)).toBe('chat-placement');
    expect(controller.panelForClosedSurface(surface)).toBe('chat-placement');
    await Bun.sleep(0);
    expect(controller.panelForClosedSurface(surface)).toBeUndefined();
  });

  test('fails soft before mutating placement when target creation or carrier open fails', async () => {
    const controller = createPanelWindowingController();
    let closed = 0;
    const throwingTarget: DetachedWindowCapability = { createTarget: () => { throw new Error('bad target'); } };
    expect(await controller.openPanelWindow('chat', throwingTarget, {
      detachSurface: async () => true,
      closeDockPanel: () => { closed += 1; },
    })).toBe(false);
    expect(await controller.openPanelWindow('chat', capability, {
      detachSurface: async () => { throw new Error('carrier failed'); },
      closeDockPanel: () => { closed += 1; },
    })).toBe(false);
    expect(closed).toBe(0);
    expect(controller.panelForClosedSurface(surface)).toBeUndefined();
  });

  test('does not open or lease a close target without a successful close operation', async () => {
    const controller = createPanelWindowingController();
    let opened = 0;
    expect(await controller.openPanelWindow('chat', capability, {
      detachSurface: async () => { opened += 1; return true; },
    })).toBe(false);
    expect(opened).toBe(0);
    expect(controller.panelForClosedSurface(surface)).toBeUndefined();

    expect(await controller.openPanelWindow('chat', capability, {
      detachSurface: async () => true,
      closeDockPanel: () => { throw new Error('dock close rejected'); },
    })).toBe(false);
    expect(controller.panelForClosedSurface(surface)).toBeUndefined();
  });

  test('serializes one surface transaction and rejects reopen until its lease expires', async () => {
    const controller = createPanelWindowingController();
    let acceptFirst!: (value: boolean) => void;
    const firstCarrier = new Promise<boolean>((resolve) => { acceptFirst = resolve; });
    const closed: string[] = [];
    const first = controller.openPanelWindow('first-placement', capability, {
      detachSurface: async () => firstCarrier,
      closeDockPanel: () => { closed.push('first'); },
    });
    expect(await controller.openPanelWindow('second-placement', capability, {
      detachSurface: async () => true,
      closeDockPanel: () => { closed.push('second'); },
    })).toBe(false);
    acceptFirst(true);
    expect(await first).toBe(true);
    expect(closed).toEqual(['first']);
    expect(await controller.openPanelWindow('third-placement', capability, {
      detachSurface: async () => true,
      closeDockPanel: () => { closed.push('third'); },
    })).toBe(false);
    expect(controller.panelForClosedSurface(surface)).toBe('first-placement');
    await Bun.sleep(0);
    expect(await controller.openPanelWindow('third-placement', capability, {
      detachSurface: async () => true,
      closeDockPanel: () => { closed.push('third'); },
    })).toBe(true);
    expect(closed).toEqual(['first', 'third']);
  });

  test('cancels a pending transaction when carrier close arrives before open settles', async () => {
    const controller = createPanelWindowingController();
    let acceptCarrier!: (value: boolean) => void;
    const carrier = new Promise<boolean>((resolve) => { acceptCarrier = resolve; });
    let closed = 0;
    const opening = controller.openPanelWindow('first-placement', capability, {
      detachSurface: async () => carrier,
      closeDockPanel: () => { closed += 1; },
    });

    expect(controller.panelForClosedSurface(surface)).toBeUndefined();
    acceptCarrier(true);
    expect(await opening).toBe(false);
    expect(closed).toBe(0);
    expect(await controller.openPanelWindow('second-placement', capability, {
      detachSurface: async () => true,
      closeDockPanel: () => { closed += 1; },
    })).toBe(true);
    expect(closed).toBe(1);
  });

  test('keeps anchored targets docked and isolates placement leases per controller', async () => {
    const first = createPanelWindowingController();
    const second = createPanelWindowingController();
    const anchored: DetachedWindowCapability = {
      createTarget: () => ({ ...capability.createTarget(), dockBehavior: 'keep-anchor' }),
    };
    let closed = 0;
    expect(await first.openPanelWindow('chat', anchored, {
      detachSurface: async () => true,
      closeDockPanel: () => { closed += 1; },
    })).toBe(true);
    expect(closed).toBe(0);
    expect(first.panelForClosedSurface(surface)).toBeUndefined();

    await first.openPanelWindow('chat-placement', capability, {
      detachSurface: async () => true,
      closeDockPanel: () => {},
    });
    expect(second.panelForClosedSurface(surface)).toBeUndefined();
  });

  test('provides product-neutral availability and placeholder predicates', () => {
    expect(canOpenPanelWindow(capability, true)).toBe(true);
    expect(canOpenPanelWindow(capability, false)).toBe(false);
    expect(canOpenPanelWindow(undefined, true)).toBe(false);
    expect(shouldShowDetachedPlaceholder({ [surfaceKey(surface)]: true }, surface)).toBe(true);
    expect(shouldShowDetachedPlaceholder({}, surface)).toBe(false);
  });
});
