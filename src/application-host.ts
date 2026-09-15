import { EventBus, type Cleanup } from '@forgeax/extension-platform/base';
import {
  createCapabilityRegistry,
  createCommandsRegistry,
  createContextKeys,
  createContributionRegistry,
  createStorageApi,
  ExtensionConflictError,
  type CommandsRegistry,
  type ContextKeysApi,
  type StorageApi,
} from '@forgeax/extension-platform/platform';
import { createApplicationMenuRegistry } from './application-menus';
import { createApplicationShortcutRegistry } from './application-shortcuts';
import { createContextualKeybindings } from './contextual-keybindings';
import { createPanelActionRegistry } from './panel-action-registry';
import { createPanelControlRegistry } from './panel-control-registry';
import {
  installPageNavigation,
  type AppHost,
  type AppBusEventMap,
  type HostCapability,
  type PanelRenderers,
  type PanelActionContribution,
  type PanelControlContribution,
  type StatusItemContribution,
} from './application';
import { deriveShellSnapshot } from './index';

function derivePanels<Panels extends PanelRenderers>(
  base: Panels,
  patches: readonly Partial<Panels>[],
): Panels {
  return deriveShellSnapshot(
    base as unknown as Record<string, unknown>,
    patches as readonly Record<string, unknown>[],
  ) as unknown as Panels;
}

const BUILT_IN_CAPS: readonly HostCapability[] = [
  'commands',
  'keybindings',
  'shortcuts',
  'menus',
  'bus',
  'storage',
  'panels',
  'panelActions',
  'panelControls',
  'contextKeys',
  'pages',
  'activities',
  'resourceEditors',
];

interface ExtensionRecord {
  capability: HostCapability;
  owner: string;
}

/** These two events are emitted by the host and cannot be redefined by a product. */
type ApplicationCapabilityEvents = Pick<
  AppBusEventMap,
  'capability:added' | 'capability:removed'
>;

export interface ApplicationPageServices {
  readonly pages: AppHost['pages'];
  readonly pageRegistry: AppHost['pageRegistry'];
  readonly activities: AppHost['activities'];
  readonly resourceEditors: AppHost['resourceEditors'];
  contributePagePlatform(owner: string, contribution: unknown): Cleanup;
  dispose(): Promise<void>;
}

export interface CreateApplicationHostOptions<
  Panels extends PanelRenderers,
  Pages extends ApplicationPageServices,
> {
  readonly log: ApplicationHostLogger;
  readonly defaultPanels: Panels;
  readonly initialPanels?: Panels;
  /** Product page authority and its close barrier remain owned by the caller. */
  readonly createPageServices: (commands: CommandsRegistry) => Pages;
}

export interface ApplicationHostLogger {
  debug(message: string, ...rest: unknown[]): void;
  info(message: string, ...rest: unknown[]): void;
  warn(message: string, ...rest: unknown[]): void;
  error(message: string, ...rest: unknown[]): void;
}

export function createApplicationHost<
  Panels extends PanelRenderers,
  Pages extends ApplicationPageServices,
  Events extends Record<string, unknown> &
    ApplicationCapabilityEvents = AppBusEventMap,
  Action extends PanelActionContribution = PanelActionContribution,
>(
  deps: CreateApplicationHostOptions<Panels, Pages> &
    (ApplicationCapabilityEvents extends Pick<
      Events,
      keyof ApplicationCapabilityEvents
    >
      ? unknown
      : never),
) {
  const log = deps.log;
  const caps = createCapabilityRegistry<HostCapability>();
  for (const c of BUILT_IN_CAPS) caps.add(c);

  const commands: CommandsRegistry = createCommandsRegistry();
  const shortcuts = createApplicationShortcutRegistry();
  const menus = createApplicationMenuRegistry();
  const keybindings = createContextualKeybindings(commands, {
    onCommandError(error, commandId) {
      log.error(`[app-shell] keybinding command "${commandId}" failed`, error);
    },
  });
  const bus = new EventBus<Events>();
  const storage: StorageApi = createStorageApi(log);
  const contextKeys: ContextKeysApi = createContextKeys();
  const panelActions = createPanelActionRegistry<Action>();
  const panelControls = createPanelControlRegistry();
  const pageServices = deps.createPageServices(commands);
  // One snapshot per contribution version keeps external-store reads stable.
  // Initial panels are a host-owned contribution above the supplied defaults.
  const panelsRegistry = createContributionRegistry<Partial<Panels>>();
  if (deps.initialPanels)
    panelsRegistry.contribute('(host)', deps.initialPanels);
  let panelsCache: { v: number; snap: Panels } | null = null;
  const panelsSnapshot = (): Panels => {
    const v = panelsRegistry.version();
    if (panelsCache?.v === v) return panelsCache.snap;
    const snap = derivePanels(
      deps.defaultPanels,
      panelsRegistry.entries().map((e) => e.item),
    );
    panelsCache = { v, snap };
    return snap;
  };

  const extensions: ExtensionRecord[] = [];
  const extensionFields: Record<string, unknown> = {};

  let activeSetup: {
    readonly id: string;
    readonly provides?: readonly string[];
  } | null = null;

  const base = {
    commands,
    keybindings,
    shortcuts,
    menus,
    bus,
    storage,
    contextKeys,
    get panels() {
      return panelsSnapshot();
    },
    panelActions,
    panelControls,
    pages: pageServices.pages as Pages['pages'],
    pageRegistry: pageServices.pageRegistry as Pages['pageRegistry'],
    activities: pageServices.activities as Pages['activities'],
    resourceEditors: pageServices.resourceEditors as Pages['resourceEditors'],
    get capabilities() {
      return caps.snapshot();
    },
    extend(capability: string, api: unknown) {
      if (activeSetup === null) {
        throw new Error(
          `[app-shell] host.extend("${String(capability)}") called outside plugin setup`,
        );
      }
      if (!activeSetup.provides?.includes(capability)) {
        throw new ExtensionConflictError({
          id: String(capability),
          subRegistryName: 'host.extend',
          existingOwner: '(none)',
          newOwner: activeSetup.id,
        });
      }
      if (extensionFields[capability as string] !== undefined) {
        const orig = extensions.find((e) => e.capability === capability);
        throw new ExtensionConflictError({
          id: String(capability),
          subRegistryName: 'host.extend',
          existingOwner: orig?.owner ?? '(unknown)',
          newOwner: activeSetup.id,
        });
      }
      if (BUILT_IN_CAPS.includes(capability)) {
        throw new ExtensionConflictError({
          id: String(capability),
          subRegistryName: 'host.extend',
          existingOwner: '(built-in)',
          newOwner: activeSetup.id,
        });
      }
      extensionFields[capability as string] = api;
      extensions.push({ capability, owner: activeSetup.id });
      caps.add(capability);
      bus.emit('capability:added', {
        capability: String(capability),
        provider: activeSetup.id,
      } as Events['capability:added']);
    },
    contributeStatusItem(item: StatusItemContribution) {
      // Runtime contributions use the same snapshot and their own cleanup.
      return panelsRegistry.contribute('(runtime)', {
        stripItems: { [item.id]: item },
      } as Partial<Panels>);
    },
  };

  const host = new Proxy(
    base as Readonly<typeof base> & Readonly<Record<string, unknown>>,
    {
      get(target, prop, receiver): unknown {
        if (prop in target) return Reflect.get(target, prop, receiver);
        if (typeof prop === 'string' && prop in extensionFields)
          return extensionFields[prop];
        return undefined;
      },
      has(target, prop): boolean {
        return (
          prop in target ||
          (typeof prop === 'string' && prop in extensionFields)
        );
      },
      set() {
        throw new TypeError('[app-shell] host is read-only; use host.extend');
      },
      defineProperty() {
        throw new TypeError('[app-shell] host is read-only; use host.extend');
      },
      deleteProperty() {
        throw new TypeError(
          '[app-shell] host is read-only; use control.removeExtensionsByOwner',
        );
      },
      ownKeys(target): ArrayLike<string | symbol> {
        return Reflect.ownKeys(target).concat(
          Object.keys(extensionFields).filter((k) => !Reflect.has(target, k)),
        );
      },
      getOwnPropertyDescriptor(target, prop): PropertyDescriptor | undefined {
        const own = Reflect.getOwnPropertyDescriptor(target, prop);
        if (own) return own;
        if (typeof prop === 'string' && prop in extensionFields) {
          return {
            value: extensionFields[prop],
            enumerable: true,
            configurable: true,
            writable: false,
          };
        }
        return undefined;
      },
    },
  );
  const removePageNavigation = installPageNavigation(
    host as unknown as AppHost,
  );

  const control = {
    beginSetup(m: {
      readonly id: string;
      readonly provides?: readonly string[];
    }) {
      if (activeSetup !== null) {
        throw new Error(
          `[app-shell] beginSetup("${m.id}") while "${activeSetup.id}" still active`,
        );
      }
      activeSetup = m;
    },
    endSetup() {
      activeSetup = null;
    },
    capabilities: caps,
    contributePanels(owner: string, patch: Partial<Panels>) {
      return panelsRegistry.contribute(owner, patch);
    },
    contributePanelActions(
      owner: string,
      actions: readonly Action[],
    ) {
      return panelActions.contribute(owner, actions);
    },
    contributePanelControls(
      owner: string,
      controls: readonly PanelControlContribution[],
    ) {
      return panelControls.contribute(owner, controls);
    },
    contributePagePlatform(
      owner: string,
      contribution: Parameters<Pages['contributePagePlatform']>[1],
    ): Cleanup {
      return pageServices.contributePagePlatform(owner, contribution);
    },
    onPanelsChange(listener: () => void) {
      return panelsRegistry.onChange(listener);
    },
    removeExtensionsByOwner(ownerId: string) {
      const indices: number[] = [];
      for (let i = extensions.length - 1; i >= 0; i--) {
        if (extensions[i]?.owner === ownerId) indices.push(i);
      }
      for (const i of indices) {
        const rec = extensions[i];
        if (!rec) continue;
        bus.emit('capability:removed', {
          capability: String(rec.capability),
          provider: rec.owner,
        } as Events['capability:removed']);
        delete extensionFields[rec.capability as string];
        caps.remove(rec.capability);
        extensions.splice(i, 1);
      }
    },
    async dispose() {
      await pageServices.dispose();
      removePageNavigation();
      keybindings.dispose();
      shortcuts.dispose();
      menus.dispose();
      bus.destroy();
    },
  };

  return { host, control };
}
