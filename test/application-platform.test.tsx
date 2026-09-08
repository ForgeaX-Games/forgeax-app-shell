import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  AppKitError,
  ApplicationRuntimeRoot,
  HostProvider,
  defineApp,
  extensionPageMatches,
  installPageNavigation,
  isPageDirty,
  mountComposition,
  openExtensionPage,
  openPageType,
  openResource,
  resolveRegisteredOverlayId,
  registerPageDirtyProbe,
  subscribePageDirty,
  useHost,
  type AppHost,
  type PageDirtyProbeTarget,
  type PageKey,
  type PanelRenderers,
} from '../src/application';

describe('application platform public contract', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    GlobalRegistrator.register();
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.replaceChildren();
    GlobalRegistrator.unregister();
  });

  it('shares one HostProvider context with application consumers', () => {
    const host = { marker: 'shared-host' } as unknown as AppHost;
    function Reader() {
      const current = useHost() as AppHost & { marker?: string };
      return <span>{current.marker}</span>;
    }

    act(() => root.render(<HostProvider value={host}><Reader /></HostProvider>));

    expect(container.textContent).toBe('shared-host');
  });

  it('owns one async application runtime and exposes it through the shared host context', async () => {
    const host = { marker: 'runtime-host' } as unknown as AppHost;
    let disposed = 0;
    const start = async () => ({
      host,
      dispose: () => { disposed += 1; },
    });
    function Reader() {
      const current = useHost() as AppHost & { marker?: string };
      return <span>{current.marker}</span>;
    }

    await act(async () => {
      root.render(
        <ApplicationRuntimeRoot start={start} fallback={<span>booting</span>}>
          {() => <Reader />}
        </ApplicationRuntimeRoot>,
      );
    });

    expect(container.textContent).toBe('runtime-host');
    act(() => root.unmount());
    expect(disposed).toBe(1);
    root = createRoot(container);
  });

  it('disposes a runtime that resolves after its owner unmounts without rendering stale children', async () => {
    const host = {} as AppHost;
    let resolveStart!: (runtime: { host: AppHost; dispose(): void }) => void;
    let disposed = 0;
    const start = () => new Promise<{ host: AppHost; dispose(): void }>((resolve) => {
      resolveStart = resolve;
    });

    await act(async () => {
      root.render(
        <ApplicationRuntimeRoot start={start}>
          {() => <span>ready</span>}
        </ApplicationRuntimeRoot>,
      );
      await Promise.resolve();
    });
    act(() => root.unmount());
    root = createRoot(container);
    await act(async () => {
      resolveStart({ host, dispose: () => { disposed += 1; } });
      await Promise.resolve();
    });

    expect(disposed).toBe(1);
    expect(container.textContent).toBe('');
  });

  it('publishes the contract from one explicit npm subpath', () => {
    const packageJson = JSON.parse(
      readFileSync(join(import.meta.dir, '..', 'package.json'), 'utf8'),
    ) as { exports?: Record<string, unknown>; scripts?: Record<string, string> };

    expect(packageJson.exports?.['./application']).toEqual({
      types: './dist/application.d.ts',
      import: './dist/application.js',
    });
    expect(packageJson.scripts?.build).toContain('src/application.tsx');
  });

  it('owns the process-wide page dirty probe used by hosts and applications', () => {
    const dispose = registerPageDirtyProbe({
      isDirty: (page) => page.encodedKey === 'material:dirty',
      subscribe: () => () => {},
    });

    expect(isPageDirty({ encodedKey: 'material:dirty', typeId: 'material' })).toBe(true);
    expect(isPageDirty({ encodedKey: 'material:clean', typeId: 'material' })).toBe(false);
    dispose();
    expect(isPageDirty({ encodedKey: 'material:dirty', typeId: 'material' })).toBe(false);
  });

  it('accepts existing resource descriptors and exposes synchronous React-safe cleanup', () => {
    const target: PageDirtyProbeTarget = {
      encodedKey: 'material:resource',
      typeId: 'material',
      resource: {
        canonicalId: 'material:resource',
        uri: 'forgeax://material/resource',
        mime: 'application/x-forgeax-material',
        revision: '7',
      },
    };
    const cleanup: () => void = subscribePageDirty(() => {});

    expect(isPageDirty(target)).toBe(false);
    expect(cleanup()).toBeUndefined();
  });

  it('preserves application page, panel, and action shapes without product imports', () => {
    const key: PageKey = {
      cardinality: 'resource',
      typeId: 'editor.material',
      resourceId: 'material:resource',
    };
    const renderers: PanelRenderers = {
      editorPanelIds: ['material'],
      panels: {
        material: {
          title: 'Material',
          actions: [{
            id: 'material.save',
            panelId: 'material',
            command: 'material.save',
            testId: 'material-save',
            overflowPriority: 100,
          }],
          render: () => null,
        },
      },
    };

    expect(key.resourceId).toBe('material:resource');
    expect(renderers.panels?.material.actions?.[0]?.testId).toBe('material-save');
  });

  it('keeps the structured AppKit manifest and mount failure contract', () => {
    const app = defineApp({ id: 'editor', entryUrl: '/editor' });
    expect(app.manifest.id).toBe('editor');
    expect(() => mountComposition({})).toThrow(AppKitError);
    try {
      mountComposition({});
    } catch (error) {
      expect(error).toMatchObject({
        code: 'MISSING_ENTRY_URL',
        hint: 'Provide entryUrl in mountComposition({ entryUrl })',
        expected: 'string url',
      });
    }
  });

  it('owns page navigation through the exact installed application host', async () => {
    const openedPages: unknown[] = [];
    const openedResources: unknown[] = [];
    const host = {
      pageRegistry: {
        getSnapshot: () => ({
          pageTypes: new Map([
            ['tools.inspect', {
              status: 'available',
              owner: '@forgeax-extension/inspect',
              definition: { cardinality: 'singleton' },
            }],
          ]),
        }),
      },
      pages: { open: async (request: unknown) => { openedPages.push(request); } },
      resourceEditors: { open: async (resource: unknown) => { openedResources.push(resource); } },
    } as unknown as AppHost;
    const dispose = installPageNavigation(host);

    await openExtensionPage('inspect');
    await openPageType('tools.inspect');
    await openResource({
      canonicalId: 'asset:tree',
      uri: 'forgeax://asset/tree',
      displayPath: 'assets/tree.glb',
    });

    expect(extensionPageMatches('inspect', '@forgeax-extension/inspect', 'tools.inspect')).toBe(true);
    expect(openedPages).toEqual([{ typeId: 'tools.inspect' }, { typeId: 'tools.inspect' }]);
    expect(openedResources).toEqual([{
      canonicalId: 'asset:tree',
      uri: 'forgeax://asset/tree',
      displayPath: 'assets/tree.glb',
    }]);
    dispose();
    await expect(openExtensionPage('inspect')).rejects.toThrow('Page host is not ready');
  });

  it('keeps a replacement host authoritative after stale cleanup', async () => {
    const opened: string[] = [];
    const createHost = (marker: string) => ({
      pageRegistry: { getSnapshot: () => ({ pageTypes: new Map() }) },
      pages: { open: async () => { opened.push(marker); } },
    }) as unknown as AppHost;
    const disposeFirst = installPageNavigation(createHost('first'));
    const disposeSecond = installPageNavigation(createHost('second'));

    disposeFirst();
    await openPageType('dashboard');
    expect(opened).toEqual(['second']);

    disposeSecond();
    disposeSecond();
    await expect(openPageType('dashboard')).rejects.toThrow('Page host is not ready');
  });

  it('keeps overlay and singleton availability policy exact', async () => {
    const host = {
      panels: {
        editorPanelIds: [],
        overlays: { Settings: () => null, Hidden: undefined },
      },
      pageRegistry: {
        getSnapshot: () => ({
          pageTypes: new Map([
            ['unavailable', {
              status: 'unavailable',
              owner: '@forgeax-extension/unavailable',
              definition: { cardinality: 'singleton' },
            }],
            ['multi', {
              status: 'available',
              owner: '@forgeax-extension/multi',
              definition: { cardinality: 'multi-instance' },
            }],
          ]),
        }),
      },
      pages: { open: async () => {} },
    } as unknown as AppHost;
    const dispose = installPageNavigation(host);

    expect(resolveRegisteredOverlayId(' SETTINGS ')).toBe('settings');
    expect(resolveRegisteredOverlayId('hidden')).toBeNull();
    await expect(openExtensionPage('unavailable')).rejects.toThrow(
      'extension "unavailable" contributes no available singleton page',
    );
    await expect(openExtensionPage('multi')).rejects.toThrow(
      'extension "multi" has no default singleton page',
    );

    dispose();
    expect(resolveRegisteredOverlayId('settings')).toBeNull();
  });
});
