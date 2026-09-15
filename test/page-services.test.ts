import { beforeEach, afterEach, describe, expect, test } from 'bun:test';
import { qualifyContributionId } from '@forgeax/types/page';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { createCommandsRegistry } from '@forgeax/extension-platform/platform';
import { ExtensionCleanupDeferredError } from '@forgeax/extension-platform/extensions';
import { PageClosePreparationDeferredError as ApplicationCloseError, PagePlatformError as ApplicationPageError } from '../src/application';
import { createPageServices, PageClosePreparationDeferredError, PagePlatformError, type PageProjectContext } from '../src/pages';

beforeEach(() => GlobalRegistrator.register());
afterEach(() => GlobalRegistrator.unregister());

function projectContext() {
  let current = 'alpha';
  const listeners = new Set<(id: string) => void>();
  const project: PageProjectContext = {
    getCurrentProject: () => current,
    subscribeCurrentProject(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
  return { project, listeners, change(id: string) { current = id; for (const listener of [...listeners]) listener(id); } };
}
const owner = '@forgeax-plugin/pages-test';
const pageId = qualifyContributionId(owner, 'page', 'project');
const panelId = qualifyContributionId(owner, 'panel', 'main');

describe('page service assembly', () => {
  test('retains the owner until dirty close succeeds and shares error identity', async () => {
    expect(ApplicationCloseError).toBe(PageClosePreparationDeferredError);
    expect(ApplicationPageError).toBe(PagePlatformError);
    const scope = projectContext();
    const services = createPageServices(createCommandsRegistry(), scope.project);
    let dirty = true;
    let disposed = 0;
    const remove = services.contributePagePlatform(owner, {
      panelTypes: [{ id: panelId, runtime: { kind: 'inline', render: () => null } }],
      pageTypes: [{ id: pageId, title: 'Project', cardinality: 'singleton', panels: [{ id: 'main', panelTypeId: panelId }],
        layout: { version: 1, root: { kind: 'tabs', placements: ['main'] } },
        createController: () => ({ prepareClose: () => dirty ? { status: 'dirty' } : { status: 'ready' }, dispose() { disposed++; } }),
      }],
    });
    await services.pages.open({ typeId: pageId });
    await expect(remove()).rejects.toBeInstanceOf(ExtensionCleanupDeferredError);
    expect(services.pageRegistry.ownerOf(pageId)).toBe(owner);
    expect(disposed).toBe(0);
    dirty = false;
    await remove();
    await remove();
    expect(disposed).toBe(1);
    expect(services.pageRegistry.get(pageId)).toBeUndefined();
    await services.dispose();
    expect(scope.listeners.size).toBe(0);
  });

  test('uses the injected project for recent-page restore and releases its subscription', async () => {
    const scope = projectContext();
    const services = createPageServices(createCommandsRegistry(), scope.project);
    services.contributePagePlatform(owner, {
      panelTypes: [{ id: panelId, runtime: { kind: 'inline', render: () => null } }],
      pageTypes: [{ id: pageId, title: 'Project', cardinality: 'singleton', restorePolicy: 'project',
        panels: [{ id: 'main', panelTypeId: panelId }], layout: { version: 1, root: { kind: 'tabs', placements: ['main'] } },
      }],
    });
    const alpha = await services.pages.open({ typeId: pageId, context: { project: 'alpha' } });
    expect(JSON.parse(localStorage.getItem('forgeax:project:alpha:recent-page')!).context.project).toBe('alpha');
    await services.pages.close(alpha);
    localStorage.setItem('forgeax:project:beta:recent-page', JSON.stringify({ typeId: pageId, context: { project: 'beta' } }));
    const restored = new Promise<void>(resolve => {
      const remove = services.pages.subscribe(() => {
        if (services.pages.getSnapshot().instances[0]?.context.project === 'beta') { remove(); resolve(); }
      });
    });
    scope.change('beta');
    await restored;
    expect(services.pages.getSnapshot().instances[0]?.context.project).toBe('beta');
    await services.dispose();
    expect(scope.listeners.size).toBe(0);
  });
});
