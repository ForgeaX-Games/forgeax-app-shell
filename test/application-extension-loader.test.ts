import { describe, expect, it } from 'bun:test';
import { createCapabilityRegistry, createCommandsRegistry } from '@forgeax/extension-platform/platform';
import { ExtensionCleanupDeferredError, ExtensionUnloadDeferredError } from '@forgeax/extension-platform/extensions';
import {
  createApplicationExtensionLoader,
  createApplicationMenuRegistry,
  type AppExtension,
  type AppHost,
  type ApplicationExtensionControl,
  type HostCapability,
} from '../src/application';

function fixture() {
  const capabilities = createCapabilityRegistry<HostCapability>();
  const events: string[] = [];
  const errors: unknown[] = [];
  const active = new Set<string>();
  let owner: string | null = null;
  let pageBlocked = false;
  const register = (id: string, kind: string) => {
    expect(owner).toBe(id);
    const key = `${id}:${kind}`;
    active.add(key);
    events.push(`add:${key}`);
    return () => {
      events.push(`remove:${key}`);
      if (kind === 'pages' && pageBlocked) throw new ExtensionCleanupDeferredError('page is dirty');
      active.delete(key);
    };
  };
  const menus = createApplicationMenuRegistry();
  const commands = createCommandsRegistry();
  const host = {
    menus, commands,
    bus: {}, storage: {},
    extend(capability: string, value: unknown) {
      if (!owner) throw new Error('no setup owner');
      events.push(`extend:${owner}:${capability}:${value}`);
    },
  } as unknown as AppHost;
  const control: ApplicationExtensionControl = {
    capabilities,
    beginSetup(manifest) {
      expect(owner).toBeNull();
      owner = manifest.id;
      events.push(`begin:${owner}`);
    },
    endSetup() { events.push(`end:${owner}`); owner = null; },
    contributePanels: (id) => register(id, 'panels'),
    contributePanelActions: (id) => register(id, 'actions'),
    contributePanelControls: (id) => register(id, 'controls'),
    contributePagePlatform: (id) => register(id, 'pages'),
  };
  const log = { debug() {}, info() {}, warn() {}, error(_message: string, error: unknown) { errors.push(error); } };
  const loader = createApplicationExtensionLoader({ menus, control, log,
    contextFactory: (manifest) => ({
      host, bus: host.bus, storage: host.storage, log,
      registerCommand: (command) => host.commands.register(command),
      contributePanels: (patch) => control.contributePanels(manifest.id, patch),
      contributePanelActions: (actions) => control.contributePanelActions(manifest.id, actions),
      contributePanelControls: (controls) => control.contributePanelControls(manifest.id, controls),
      contributePagePlatform: (contribution) => control.contributePagePlatform(manifest.id, contribution),
    }),
  });
  return { loader, host, control, capabilities, events, errors, active,
    get owner() { return owner; },
    blockPages(value: boolean) { pageBlocked = value; },
  };
}

const contributes: NonNullable<AppExtension['contributes']> = {
  menus: [{ id: 'test.menu', menu: 'edit', group: 'test', groupOrder: 1, order: 1, label: 'Test' }],
  panels: { overlays: { Test: () => null } },
  panelActions: [{ id: 'action', panelId: 'panel', command: 'test.command', title: 'Test' }],
  panelControls: [{ id: 'control', render: () => null }],
  pages: [], panelTypes: [], activities: [], resourceEditors: [],
};

describe('application extension lifecycle', () => {
  it('installs declarative contributions before setup and retains the real host/context', async () => {
    const f = fixture();
    await f.loader.load([{ id: 'one', version: '1', contributes, setup(context) {
      expect(context.host).toBe(f.host);
      expect(context.bus).toBe(f.host.bus);
      expect(context.storage).toBe(f.host.storage);
      expect([...f.active]).toEqual(['one:panels', 'one:actions', 'one:controls', 'one:pages']);
      expect(f.host.menus.snapshot().map(menu => menu.id)).toEqual(['test.menu']);
      context.host.extend('example', 42);
      return () => { f.events.push('cleanup:one'); };
    } }]);
    expect(f.owner).toBeNull();
    expect(f.events).toContain('extend:one:example:42');
    await f.loader.unload();
    expect(f.events.slice(-5)).toEqual([
      'remove:one:pages', 'cleanup:one', 'remove:one:controls', 'remove:one:actions', 'remove:one:panels',
    ]);
    expect(f.host.menus.snapshot()).toEqual([]);
    expect(f.active.size).toBe(0);
  });

  it('supports contributes-only extensions and routes imperative registrations to their owner', async () => {
    const f = fixture();
    await f.loader.load([
      { id: 'declarative', version: '1', contributes: { panels: {} } },
      { id: 'imperative', version: '1', setup(context) {
        const removers = [
          context.registerCommand({ id: 'test.command', title: 'Test', execute: () => 42 }),
          context.contributePanels({}), context.contributePanelActions([]),
          context.contributePanelControls([]), context.contributePagePlatform({}),
        ];
        return async () => { for (const remove of removers.reverse()) await remove(); };
      } },
    ]);
    expect(await f.host.commands.execute<number>('test.command')).toBe(42);
    expect(f.active.size).toBe(5);
    await f.loader.unload();
    expect(f.active.size).toBe(0);
    await expect(f.host.commands.execute('test.command')).rejects.toThrow();
  });

  it('waits for async setup and cleans owners in reverse activation order', async () => {
    const f = fixture();
    let finish!: () => void;
    const ready = new Promise<void>(resolve => { finish = resolve; });
    const loading = f.loader.load([
      { id: 'one', version: '1', setup: async () => { await ready; return () => { f.events.push('cleanup:one'); }; } },
      { id: 'two', version: '1', setup: () => () => { f.events.push('cleanup:two'); } },
    ]);
    await Promise.resolve();
    expect(f.events).not.toContain('begin:two');
    finish();
    await loading;
    await f.loader.flush();
    expect(f.owner).toBeNull();
    await f.loader.unload();
    expect(f.events.slice(-2)).toEqual(['cleanup:two', 'cleanup:one']);
  });

  it('activates and deactivates contributions through the platform capability registry', async () => {
    const f = fixture();
    await f.loader.load([{ id: 'dependent', version: '1', requires: ['example'], contributes: { panels: {} } }]);
    expect(f.active.size).toBe(0);
    f.capabilities.add('example');
    await f.loader.flush();
    expect(f.active.has('dependent:panels')).toBe(true);
    f.capabilities.remove('example');
    await f.loader.flush();
    expect(f.active.size).toBe(0);
    f.capabilities.add('example');
    await f.loader.flush();
    expect(f.active.has('dependent:panels')).toBe(true);
    await f.loader.unload();
    expect(f.active.size).toBe(0);
  });

  it('rolls back partial setup and always releases the setup owner', async () => {
    const f = fixture();
    await f.loader.load([{ id: 'failed', version: '1', contributes, setup() { throw new Error('setup failed'); } }]);
    expect(f.errors.length).toBe(1);
    expect(f.owner).toBeNull();
    expect(f.active.size).toBe(0);
    expect(f.host.menus.snapshot()).toEqual([]);
    await f.loader.unload();
  });

  it('keeps all contributions when page preparation blocks setup rollback', async () => {
    const f = fixture();
    f.blockPages(true);
    await f.loader.load([{ id: 'failed', version: '1', contributes, setup() { throw new Error('setup failed'); } }]);
    expect(f.owner).toBeNull();
    expect(f.active.size).toBe(4);
    expect(f.host.menus.snapshot()).toHaveLength(1);
    await expect(f.loader.unload()).rejects.toBeInstanceOf(ExtensionUnloadDeferredError);
    expect(f.active.size).toBe(4);
    f.blockPages(false);
    await f.loader.unload();
    expect(f.active.size).toBe(0);
    expect(f.host.menus.snapshot()).toEqual([]);
  });

  it('retains a blocked owner without replaying already retired owners', async () => {
    const f = fixture();
    let retired = 0;
    await f.loader.load([
      { id: 'blocked', version: '1', contributes },
      { id: 'retired', version: '1', setup: () => () => { retired++; } },
    ]);
    f.blockPages(true);
    await expect(f.loader.unload()).rejects.toBeInstanceOf(ExtensionUnloadDeferredError);
    expect(retired).toBe(1);
    expect(f.active.size).toBe(4);
    f.blockPages(false);
    await f.loader.unload();
    expect(retired).toBe(1);
    expect(f.active.size).toBe(0);
  });
});
