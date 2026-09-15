import {
  createExtensionLoader,
  ExtensionCleanupDeferredError,
  ExtensionSetupRollbackDeferredError,
  type ExtensionManifest,
} from '@forgeax/extension-platform/extensions';
import type { Cleanup } from '@forgeax/extension-platform/base';
import type { CapabilityRegistry } from '@forgeax/extension-platform/platform';
import type {
  AppExtensionContributes,
  AppExtensionContext,
  ApplicationMenuRegistry,
  HostCapability,
} from './application';

/** Retains a caller's concrete host context and contribution types. */
export type ApplicationExtensionManifest<
  Context = AppExtensionContext,
  Contributions extends AppExtensionContributes<unknown> = AppExtensionContributes,
> = Omit<ExtensionManifest<HostCapability, Context>, 'setup'> & {
  readonly setup?: ExtensionManifest<HostCapability, Context>['setup'];
  readonly contributes?: Contributions;
};

/** The existing host's owner-scoped contribution channel. */
export interface ApplicationExtensionControl<
  Context = AppExtensionContext,
  Contributions extends AppExtensionContributes<unknown> = AppExtensionContributes,
> {
  readonly capabilities: CapabilityRegistry<HostCapability>;
  readonly beginSetup: (manifest: ApplicationExtensionManifest<Context, Contributions>) => void;
  readonly endSetup: () => void;
  readonly contributePanels: (owner: string, patch: NonNullable<Contributions['panels']>) => Cleanup;
  readonly contributePanelActions: (owner: string, actions: NonNullable<Contributions['panelActions']>) => Cleanup;
  readonly contributePanelControls: (owner: string, controls: NonNullable<Contributions['panelControls']>) => Cleanup;
  readonly contributePagePlatform: (owner: string, contribution: {
    readonly pageTypes?: Contributions['pages'];
    readonly panelTypes?: Contributions['panelTypes'];
    readonly activities?: Contributions['activities'];
    readonly resourceEditors?: Contributions['resourceEditors'];
  }) => Cleanup;
}

export interface ApplicationExtensionLoader<
  Context = AppExtensionContext,
  Contributions extends AppExtensionContributes<unknown> = AppExtensionContributes,
> {
  readonly load: (extensions: readonly ApplicationExtensionManifest<Context, Contributions>[]) => Promise<void>;
  flush(): Promise<void>;
  unload(): Promise<void>;
}

/** Adapts application contributions to the platform loader. Products retain
 * extension selection, context creation, catalog activation and host disposal. */
export function createApplicationExtensionLoader<
  Context = AppExtensionContext,
  Contributions extends AppExtensionContributes<unknown> = AppExtensionContributes,
>({ menus, control, contextFactory, log }: {
  readonly menus: ApplicationMenuRegistry;
  readonly control: ApplicationExtensionControl<Context, Contributions>;
  readonly contextFactory: (manifest: ExtensionManifest<HostCapability, Context>) => Context;
  readonly log: Pick<AppExtensionContext['log'], 'error'>;
}): ApplicationExtensionLoader<Context, Contributions> {
  const loader = createExtensionLoader<Context, HostCapability>({
    capabilities: control.capabilities,
    contextFactory,
    onError: (error, manifest, phase) => log.error(`extension "${manifest.id}" ${phase} error`, error),
  });

  const wrap = (manifest: ApplicationExtensionManifest<Context, Contributions>): ExtensionManifest<HostCapability, Context> => ({
    ...manifest,
    async setup(context) {
      control.beginSetup(manifest);
      const cleanups: Cleanup[] = [];
      let pageCleanup: Cleanup | undefined;
      const rollback = async (): Promise<void> => {
        // Page close preparation is the barrier before destructive teardown.
        await pageCleanup?.();
        for (const cleanup of cleanups.slice().reverse()) await cleanup();
      };
      try {
        for (const menu of manifest.contributes?.menus ?? []) {
          cleanups.push(menus.register(menu));
        }
        if (manifest.contributes?.panels) {
          cleanups.push(control.contributePanels(manifest.id, manifest.contributes.panels));
        }
        if (manifest.contributes?.panelActions) {
          cleanups.push(control.contributePanelActions(manifest.id, manifest.contributes.panelActions));
        }
        if (manifest.contributes?.panelControls) {
          cleanups.push(control.contributePanelControls(manifest.id, manifest.contributes.panelControls));
        }
        if (manifest.contributes?.pages || manifest.contributes?.panelTypes
          || manifest.contributes?.activities || manifest.contributes?.resourceEditors) {
          pageCleanup = control.contributePagePlatform(manifest.id, {
            pageTypes: manifest.contributes.pages,
            panelTypes: manifest.contributes.panelTypes,
            activities: manifest.contributes.activities,
            resourceEditors: manifest.contributes.resourceEditors,
          });
        }
        const cleanup = await manifest.setup?.(context);
        if (typeof cleanup === 'function') cleanups.push(cleanup);
        return cleanups.length === 0 && !pageCleanup ? undefined : rollback;
      } catch (error) {
        try {
          await rollback();
        } catch (rollbackError) {
          if (rollbackError instanceof ExtensionCleanupDeferredError) {
            throw new ExtensionSetupRollbackDeferredError({ cause: error, rollback });
          }
          throw rollbackError;
        }
        throw error;
      } finally {
        control.endSetup();
      }
    },
  });

  return {
    load: (extensions) => loader.load(extensions.map(wrap)),
    flush: () => loader.flush(),
    unload: () => loader.unload(),
  };
}
