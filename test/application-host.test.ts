import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { describe, expect, it } from 'bun:test';
import { ExtensionCleanupDeferredError } from '@forgeax/extension-platform/extensions';
import { ExtensionConflictError } from '@forgeax/extension-platform/platform';
import {
  createApplicationHost,
  installApplicationKeyboardRouter,
  openPageType,
  type AppHost,
  type PanelRenderers,
} from '../src/application';

function fixture() {
  const events: string[] = [];
  const barrier = new ExtensionCleanupDeferredError('close is blocked');
  let blocked = false;
  const pages: AppHost['pages'] = {
    async open(request) {
      events.push(`open:${request.typeId}`);
      return { cardinality: 'singleton', typeId: request.typeId };
    },
    async focus() {},
    async close() {},
    reorder() {},
    getContextMenuItems: () => [],
    getSnapshot: () => ({ generation: 0, instances: [] }),
    subscribe: () => () => {},
  };
  const result = createApplicationHost({
    defaultPanels: {
      editorPanelIds: [],
      overlays: { Default: () => null },
    } as PanelRenderers,
    initialPanels: { editorPanelIds: ['initial'] },
    log: { debug() {}, info() {}, warn() {}, error() {} },
    createPageServices(commands) {
      commands.register({
        id: 'page-command',
        execute: () => events.push('command'),
      });
      return {
        pages,
        pageRegistry: {
          get: () => undefined,
          ownerOf: () => undefined,
          getSnapshot: () => ({ generation: 0, pageTypes: new Map(), panelTypes: new Map() }),
          subscribe: () => () => {},
          validateContribution() {},
        },
        activities: {
          getSnapshot: () => ({ generation: 0, activities: [] }),
          subscribe: () => () => {},
          async launch() {},
        },
        resourceEditors: {
          list: () => [],
          resolve: () => undefined,
          async open() {
            throw new Error('not configured');
          },
          setUserAssociation() {},
        },
        contributePagePlatform(owner: string, contribution: { id: string }) {
          events.push(`contribute:${owner}:${contribution.id}`);
          return () => {
            events.push(`remove:${owner}:${contribution.id}`);
          };
        },
        async dispose() {
          events.push('pages:dispose');
          if (blocked) throw barrier;
        },
      };
    },
  });
  return {
    ...result,
    events,
    barrier,
    setBlocked: (value: boolean) => {
      blocked = value;
    },
  };
}

describe('application host', () => {
  it('keeps one memoized panel snapshot and reverses individual owner contributions', async () => {
    const { host, control } = fixture();
    const original = host.panels;
    expect(host.panels).toBe(original);
    expect(original.editorPanelIds).toEqual(['initial']);
    const Overlay = () => null;
    const remove = control.contributePanels('one', {
      overlays: { Added: Overlay },
      editorPanelIds: ['new'],
    });
    expect(host.panels).not.toBe(original);
    expect(host.panels.overlays?.Default).toBe(original.overlays?.Default);
    expect(host.panels.overlays?.Added).toBe(Overlay);
    expect(host.panels.editorPanelIds).toEqual(['new']);
    remove();
    expect(host.panels.overlays?.Added).toBeUndefined();
    expect(host.panels.editorPanelIds).toEqual(['initial']);
    const removeStatus = host.contributeStatusItem({
      id: 'status',
      location: 'statusbar.left',
      item: { type: 'text', text: 'Ready' },
    });
    expect(host.panels.stripItems?.status?.id).toBe('status');
    control.removeExtensionsByOwner('(runtime)');
    expect(host.panels.stripItems?.status?.id).toBe('status');
    removeStatus();
    expect(host.panels.stripItems?.status).toBeUndefined();
    await control.dispose();
  });

  it('enforces setup declarations, readonly reflection and reverse owner removal', async () => {
    const { host, control } = fixture();
    expect(() => host.extend('x', 1)).toThrow('outside plugin setup');
    control.beginSetup({ id: 'one', provides: ['a', 'b', 'commands'] });
    expect(() => control.beginSetup({ id: 'nested' })).toThrow('still active');
    expect(() => host.extend('undeclared', 1)).toThrow(ExtensionConflictError);
    expect(() => host.extend('commands', {})).toThrow(ExtensionConflictError);
    host.extend('a', 1);
    host.extend('b', 2);
    expect(() => host.extend('a', 3)).toThrow(ExtensionConflictError);
    control.endSetup();
    control.beginSetup({ id: 'two', provides: ['c'] });
    host.extend('c', 3);
    control.endSetup();
    expect('a' in host).toBe(true);
    expect(Object.keys(host)).toContain('a');
    expect(Object.getOwnPropertyDescriptor(host, 'a')).toEqual({
      value: 1,
      enumerable: true,
      writable: false,
      configurable: true,
    });
    expect(() => Reflect.set(host, 'a', 4)).toThrow(TypeError);
    expect(() => Object.defineProperty(host, 'a', { value: 4 })).toThrow(
      TypeError,
    );
    expect(() => Reflect.deleteProperty(host, 'a')).toThrow(TypeError);
    const removed: string[] = [];
    host.bus.on('capability:removed', ({ capability }) => {
      expect(host.capabilities.has(capability)).toBe(true);
      removed.push(capability);
    });
    control.removeExtensionsByOwner('one');
    expect(removed).toEqual(['b', 'a']);
    expect('a' in host).toBe(false);
    expect(host.c).toBe(3);
    await control.dispose();
  });

  it('passes concrete page contributions and preserves host services across a close barrier', async () => {
    const { host, control, events, barrier, setBlocked } = fixture();
    const remove = control.contributePagePlatform('extension', { id: 'page' });
    expect(events).toContain('contribute:extension:page');
    await remove();
    expect(events).toContain('remove:extension:page');
    host.bus.on('panel:open', ({ id }) => events.push(`panel:${id}`));
    setBlocked(true);
    await expect(control.dispose()).rejects.toBe(barrier);
    await host.commands.execute('page-command');
    await openPageType('extension#page:one');
    expect(events).toContain('command');
    expect(events).toContain('open:extension#page:one');
    expect(() =>
      host.bus.emit('panel:open', { id: 'still-live' }),
    ).not.toThrow();
    setBlocked(false);
    await control.dispose();
    await expect(openPageType('extension#page:one')).rejects.toThrow(
      'Page host is not ready',
    );
    expect(events).toContain('panel:still-live');
    expect(host.bus.listenerCount()).toBe(0);
    host.bus.emit('panel:open', { id: 'closed' });
    expect(events).not.toContain('panel:closed');
  });
});

// Compile-time consumer contracts: the factory retains concrete service and contribution shapes.
function checkPublicTypes(result: ReturnType<typeof fixture>) {
  result.host.pageRegistry.getSnapshot().generation satisfies number;
  result.control.contributePagePlatform('owner', { id: 'page' });
  // @ts-expect-error concrete page contribution is not widened to unknown
  result.control.contributePagePlatform('owner', { missing: 'id' });
  // @ts-expect-error host services are readonly even before the proxy enforces it
  result.host.pages = result.host.pages;
  type Options = Parameters<typeof createApplicationHost>[0];
  type InvalidEvents = Record<string, unknown> & {
    'capability:added': number;
    'capability:removed': number;
  };
  createApplicationHost<
    PanelRenderers,
    ReturnType<Options['createPageServices']>,
    // @ts-expect-error the host owns capability event payloads
    InvalidEvents
  >({} as Options);
  type NarrowEvents = Record<string, unknown> & {
    'capability:added': { capability: 'restricted'; provider: string };
    'capability:removed': { capability: string; provider: string };
  };
  createApplicationHost<
    PanelRenderers,
    ReturnType<Options['createPageServices']>,
    NarrowEvents
  >(
    // @ts-expect-error a product cannot restrict events that the host must emit
    {} as Options
  );
}


it('the public AppHost contract supplies contextual handling to the keyboard router', async () => {
  GlobalRegistrator.register();
  try {
  const { host, control } = fixture();
  const publicHost: AppHost = host;
  let listener: ((event: KeyboardEvent) => void) | undefined;
  let calls = 0;
  const removeCommand = host.commands.register({ id: 'keyboard-contract', execute() { calls++; } });
  const removeBinding = host.keybindings.register({ commandId: 'keyboard-contract', keys: 'Escape', scope: 'application' });
  const dispose = installApplicationKeyboardRouter({
    target: { addEventListener(_type, callback) { listener = callback; }, removeEventListener() {} },
    keybindings: publicHost.keybindings,
    contributions: publicHost.shortcuts,
    shortcuts: [], isTypingTarget: () => false, shouldSkipShortcut: () => false,
  });
  listener?.({ key: 'Escape', target: null, composedPath: () => [], preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} } as unknown as KeyboardEvent);
  await Promise.resolve();
  expect(calls).toBe(1);
  dispose(); removeBinding(); removeCommand(); await control.dispose();
  } finally { await GlobalRegistrator.unregister(); }
});
