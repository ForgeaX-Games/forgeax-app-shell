import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ComponentType,
  type ReactNode,
  type RefObject,
} from 'react';
import type { DetachedWindowCapability } from './window';
export { createPanelActionRegistry, type PanelActionRegistry } from './panel-action-registry';
export { createPanelControlRegistry, type PanelControlRegistry } from './panel-control-registry';
import type { ApplicationShortcutRegistry } from './application-shortcuts';
import type { ApplicationMenuRegistry, ApplicationMenuItem } from './application-menus';
import type { ApplicationRuntimeOwner } from './application-runtime-owner';
export {
  createApplicationRuntimeOwner,
  ApplicationStartupCleanupError,
  type ApplicationRuntimeOwner,
  type ApplicationShutdownSnapshot,
} from './application-runtime-owner';

export {
  createApplicationMenuRegistry,
  type ApplicationMenuItem,
  type ApplicationMenuRegistry,
} from './application-menus';

export {
  createApplicationShortcutRegistry,
  type ApplicationShortcut,
  type ApplicationShortcutRegistry,
} from './application-shortcuts';

export {
  UI_ACTION_DISPATCH_EVENT,
  __resetRegistryForTest,
  buildManifest,
  dispatchAction,
  getAction,
  onRegistryChange,
  registerAction,
  registerStateSlice,
  snapshotActions,
  snapshotState,
  type JsonSchemaObject,
  type StateSliceSelector,
  type UiActionDef,
  type UiActionResult,
  type UiActionSummary,
  type UiCapability,
} from './action-registry';

export type Cleanup = () => void;

export interface CommandDescriptor {
  readonly id: string;
  readonly title: string;
  readonly when?: () => boolean;
  readonly execute: (args?: unknown) => unknown | Promise<unknown>;
}

export interface CommandsRegistry {
  register(command: CommandDescriptor): Cleanup;
  execute<Result = unknown>(id: string, args?: unknown): Promise<Result>;
}

export interface KeybindingRegistration {
  readonly keys: string | readonly string[];
  readonly commandId: string;
  readonly scope: string;
  readonly priority?: number;
  readonly when?: (context: KeybindingContext) => boolean;
  readonly preventDefault?: 'whenHandled' | 'always' | 'never';
  readonly allowInEditable?: boolean;
  readonly allowDuringComposition?: boolean;
}

export interface KeybindingContext {
  readonly event: KeyboardEvent;
  readonly scopes: readonly string[];
}

export interface ContextualKeybindingsApi {
  register(binding: KeybindingRegistration): Cleanup;
  registerScope(element: Element, scopeId: string): Cleanup;
  dispose(): void;
}

export interface EventBus<EventMap extends Record<string, unknown>> {
  emit<Key extends keyof EventMap & string>(topic: Key, payload: EventMap[Key]): void;
  on<Key extends keyof EventMap & string>(topic: Key, listener: (payload: EventMap[Key]) => void): Cleanup;
}

export interface StorageApi {
  get<Value = unknown>(key: string): Value | null | undefined;
  set<Value = unknown>(key: string, value: Value): void;
  remove(key: string): void;
}

export interface ContextKeysApi {
  get<Value = unknown>(key: string): Value | undefined;
  set<Value = unknown>(key: string, value: Value): void;
  onChange(key: string, listener: (value: unknown) => void): Cleanup;
}

export interface ContentBrowserRevealTarget {
  readonly guid?: string;
  readonly packPath?: string;
  readonly path?: string;
  readonly pathKind?: 'dir' | 'file';
  readonly assetKind?: string;
  readonly name?: string;
  readonly sourcePath?: string;
}

export interface AppBusEventMap extends Record<string, unknown> {
  'panel:open': { id: string; source?: string };
  'panel:focus': { id: string };
  'panel:reveal': { id: string };
  'panel:close': { id: string };
  'content-browser:reveal': { target: ContentBrowserRevealTarget };
  'resource-editor:open-file': { path: string };
  'dock:reset': Record<string, never>;
  'dock:layout-toggle': { pageId?: string; rect?: { top: number; bottom: number; left: number; right: number } };
  'anim:handoff': { fromSurface: string; toSurface: string };
  'chat:pill': { pill: unknown };
  'files:reveal': { path: string };
  'build:create': { version: string };
  'build:play': { version: string };
  'iframe:navigate': { extensionId: string; url?: string };
  'capability:added': { capability: string; provider: string };
  'capability:removed': { capability: string; provider: string };
}

export interface SerializedDockview {
  readonly grid: {
    readonly height?: number;
    readonly width?: number;
    readonly orientation: unknown;
    readonly root: unknown;
  };
  readonly panels: Readonly<Record<string, unknown>>;
  readonly activeGroup?: string;
  readonly edgeGroups?: unknown;
}

export interface PanelHeaderDefinition {
  readonly visible?: boolean;
  readonly showTitle?: boolean;
  readonly subtitle?: string;
}

export interface PanelContentDefinition {
  readonly padding?: 'none' | 'sm' | 'md';
  readonly scroll?: 'none' | 'auto';
  readonly tone?: 'default' | 'surface' | 'tool';
}

export interface PanelDescriptor {
  readonly id?: string;
  readonly title: string;
  readonly order?: number;
  readonly icon?: string;
  readonly when?: () => boolean;
  readonly defaultRegion?: string;
  readonly header?: PanelHeaderDefinition;
  readonly content?: PanelContentDefinition;
  readonly actions?: readonly PanelActionContribution[];
  readonly dockChrome?: { readonly singleTab?: 'default' | 'full' | 'hideTitle' };
  readonly windowing?: DetachedWindowCapability;
  readonly render?: () => ReactNode;
}

export type PanelActionLocation = 'header/left' | 'header/center' | 'header/right' | 'context';
export interface PanelActionContribution {
  readonly kind?: 'command' | 'menu' | 'control';
  readonly id: string;
  readonly panelId: string;
  readonly command?: string;
  readonly control?: string;
  readonly title?: string;
  readonly label?: string;
  readonly icon?: string;
  readonly testId?: string;
  readonly order?: number;
  readonly overflowPriority?: number;
  readonly pinned?: boolean;
  readonly hideOnOverflow?: boolean;
  readonly location?: PanelActionLocation;
  readonly when?: string;
  readonly enablement?: string;
  readonly activeWhen?: string;
  readonly highlightWhen?: string;
  readonly args?: unknown;
}

export interface PanelControlRenderContext {
  readonly panelId: string;
  readonly actionId: string;
}

export interface PanelControlContribution {
  readonly id: string;
  readonly render: (context: PanelControlRenderContext) => ReactNode;
}

export interface PanelActionsApi {
  contribute(owner: string, actions: readonly PanelActionContribution[]): Cleanup;
  list(panelId: string): readonly PanelActionContribution[];
  all(): readonly PanelActionContribution[];
  onChange(listener: () => void): Cleanup;
  version(): number;
}

export interface PanelControlsApi {
  contribute(owner: string, controls: readonly PanelControlContribution[]): Cleanup;
  get(id: string): PanelControlContribution | undefined;
  list(): readonly PanelControlContribution[];
  onChange(listener: () => void): Cleanup;
  version(): number;
}

export type StripLocationId = 'statusbar.left' | 'statusbar.center' | 'statusbar.right';

export type StatusItemBody =
  | { readonly type: 'text'; readonly text: string; readonly tooltip?: string }
  | { readonly type: 'button'; readonly label?: string; readonly icon?: string; readonly tooltip?: string; readonly command: string; readonly args?: unknown }
  | { readonly type: 'custom'; readonly render: () => ReactNode };

export interface StatusItemContribution {
  readonly kind?: 'status-item';
  readonly id: string;
  readonly location: StripLocationId;
  readonly priority?: number;
  readonly when?: () => boolean;
  readonly item: StatusItemBody;
}

export interface PanelRenderers {
  readonly panels?: Readonly<Record<string, PanelDescriptor>>;
  readonly overlays?: Readonly<Record<string, ComponentType | undefined>>;
  readonly surfaces?: Readonly<Record<string, ComponentType | undefined>>;
  readonly editor?: Readonly<Record<string, unknown>>;
  readonly drawerPanels?: Readonly<Record<string, unknown>>;
  readonly stripItems?: Readonly<Record<string, StatusItemContribution>>;
  readonly detached?: Readonly<Record<string, ComponentType | undefined>>;
  readonly slots?: Readonly<Record<string, ComponentType<any> | undefined>>;
  readonly extensionTransport?: Readonly<Record<string, unknown>>;
  readonly editorPanelIds: readonly string[];
  readonly builtinPageLayouts?: Readonly<Record<string, SerializedDockview>>;
  readonly extensionPanels?: Readonly<Record<string, () => ReactNode>>;
}

export interface ResourceDescriptor {
  readonly uri: string;
  readonly canonicalId: string;
  readonly kind?: string;
  readonly displayPath?: string;
  readonly mime?: string;
  readonly revision?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export type QualifiedPageTypeId = string;
export type QualifiedPanelTypeId = string;
export type QualifiedActivityId = string;
export type QualifiedResourceEditorId = string;
export type PageKey =
  | { readonly cardinality: 'singleton'; readonly typeId: string }
  | { readonly cardinality: 'resource'; readonly typeId: string; readonly resourceId: string }
  | { readonly cardinality: 'multi-instance'; readonly typeId: string; readonly instanceId: string };

export interface PanelRenderContext {
  readonly pageKey: PageKey;
  readonly placementId: string;
  readonly pageContext: Readonly<Record<string, unknown>>;
  readonly initialProps?: Readonly<Record<string, unknown>>;
}

export type PanelRuntime =
  | { readonly kind: 'inline'; readonly render: (context: PanelRenderContext) => ReactNode }
  | { readonly kind: 'iframe'; readonly src: string };

export interface PanelTypeRegistration {
  readonly id: QualifiedPanelTypeId;
  readonly runtime: PanelRuntime;
  readonly windowing?: unknown;
}

export interface PagePanelPlacement {
  readonly id: string;
  readonly panelTypeId: QualifiedPanelTypeId;
  readonly title?: string;
  readonly optional?: boolean;
  readonly initialProps?: Readonly<Record<string, unknown>>;
}

export type PageCloseReason = 'user' | 'extension-disabled' | 'workspace-change' | 'host-dispose';
export type PageCloseDecision = 'save' | 'discard' | 'cancel';
export type PageClosePreparation =
  | { readonly status: 'ready' }
  | { readonly status: 'dirty'; readonly message?: string }
  | { readonly status: 'vetoed'; readonly message?: string };

export interface PageMenuItem {
  readonly id: string;
  readonly label: string;
  readonly icon?: string;
  readonly group?: string;
  readonly disabled?: boolean;
  run(): void | Promise<void>;
}

export interface PageController {
  prepareClose(reason: PageCloseReason): PageClosePreparation | Promise<PageClosePreparation>;
  save?(): void | Promise<void>;
  discard?(): void | Promise<void>;
  dispose(): void | Promise<void>;
  getContextMenuItems?(): readonly PageMenuItem[];
  getTitle?(): string | undefined;
  subscribeTitle?(listener: () => void): Cleanup;
}

export interface PageControllerContext {
  readonly key: PageKey;
  readonly context: Readonly<Record<string, unknown>>;
  readonly resource?: ResourceDescriptor;
}

export interface PageTypeRegistration {
  readonly id: QualifiedPageTypeId;
  readonly title: string;
  readonly cardinality: 'singleton' | 'resource' | 'multi-instance';
  readonly restorePolicy?: 'never' | 'session' | 'project';
  readonly closable?: boolean;
  readonly layoutVersion?: number;
  readonly layout: unknown;
  readonly panels: readonly PagePanelPlacement[];
  readonly createController?: (context: PageControllerContext) => PageController | Promise<PageController>;
}

export interface ActivityLocalizedText { readonly zh?: string; readonly en?: string; readonly ja?: string }
export interface ActivityRegistration {
  readonly id: QualifiedActivityId;
  readonly title: string;
  readonly titleI18n?: ActivityLocalizedText;
  readonly description?: string;
  readonly descriptionI18n?: ActivityLocalizedText;
  readonly icon?: string;
  readonly category?: string;
  readonly order?: number;
  readonly sourceLayer?: 'builtin' | 'installed' | 'project' | 'user';
  readonly pageTypeId?: QualifiedPageTypeId;
  readonly commandId?: string;
}

export interface ResourceEditorRegistration {
  readonly id: QualifiedResourceEditorId;
  readonly selector: ResourceSelector;
  readonly pageTypeId: QualifiedPageTypeId;
  readonly priority?: 'default' | 'optional';
  readonly sourceLayer?: 'builtin' | 'installed' | 'project' | 'user';
}

export interface ResourceSelector {
  readonly schemes?: readonly string[];
  readonly extensions?: readonly string[];
  readonly mimeTypes?: readonly string[];
  readonly kinds?: readonly string[];
  readonly fallback?: true;
}

export interface PagePlatformContribution {
  readonly pageTypes?: readonly PageTypeRegistration[];
  readonly panelTypes?: readonly PanelTypeRegistration[];
  readonly activities?: readonly ActivityRegistration[];
  readonly resourceEditors?: readonly ResourceEditorRegistration[];
}

export interface PageInstance {
  readonly key: PageKey;
  readonly encodedKey: string;
  readonly typeId: QualifiedPageTypeId;
  readonly context: Readonly<Record<string, unknown>>;
  readonly resource?: ResourceDescriptor;
  readonly openedAt: number;
  readonly closable: boolean;
  readonly title?: string;
}

export interface PageSessionSnapshot {
  readonly generation: number;
  readonly activeKey?: string;
  readonly instances: readonly PageInstance[];
}

export interface PagePort {
  open(request: { readonly typeId: QualifiedPageTypeId; readonly resource?: ResourceDescriptor; readonly instanceId?: string; readonly context?: Readonly<Record<string, unknown>> }): Promise<PageKey>;
  focus(key: PageKey | string): Promise<void>;
  close(key: PageKey | string, request?: { readonly reason?: PageCloseReason; readonly decision?: PageCloseDecision }): Promise<void>;
  reorder(key: PageKey | string, toIndex: number): void;
  getContextMenuItems(key: PageKey | string): readonly PageMenuItem[];
  getSnapshot(): PageSessionSnapshot;
  subscribe(listener: () => void): Cleanup;
}

export interface PageRegistry {
  get(typeId: QualifiedPageTypeId): unknown;
  ownerOf(typeId: QualifiedPageTypeId): string | undefined;
  getSnapshot(): unknown;
  subscribe(listener: () => void): Cleanup;
  validateContribution(owner: string, contribution: PagePlatformContribution): void;
}

export interface ActivityRegistry {
  getSnapshot(): unknown;
  subscribe(listener: () => void): Cleanup;
  launch(id: QualifiedActivityId): Promise<void>;
}

export interface ResourceEditorResolver {
  list(resource: ResourceDescriptor): readonly ResourceEditorRegistration[];
  resolve(resource: ResourceDescriptor): ResourceEditorRegistration | undefined;
  open(resource: ResourceDescriptor): Promise<PageKey>;
  setUserAssociation(resource: ResourceDescriptor, editorId: QualifiedResourceEditorId | null): void;
}

export type HostCapability = string;

export interface AppHost {
  readonly commands: CommandsRegistry;
  readonly keybindings: ContextualKeybindingsApi;
  readonly shortcuts: ApplicationShortcutRegistry;
  readonly menus: ApplicationMenuRegistry;
  readonly bus: EventBus<AppBusEventMap>;
  readonly storage: StorageApi;
  readonly contextKeys: ContextKeysApi;
  readonly panels: PanelRenderers;
  readonly panelActions: PanelActionsApi;
  readonly panelControls: PanelControlsApi;
  readonly pages: PagePort;
  readonly pageRegistry: PageRegistry;
  readonly activities: ActivityRegistry;
  readonly resourceEditors: ResourceEditorResolver;
  readonly capabilities: ReadonlySet<HostCapability>;
  readonly [extension: string]: unknown;
  extend(capability: HostCapability, api: unknown): void;
  contributeStatusItem(item: StatusItemContribution): Cleanup;
}

let currentPageNavigationHost: AppHost | null = null;

/** Installs the application host used by imperative page-navigation adapters. */
export function installPageNavigation(host: AppHost): Cleanup {
  currentPageNavigationHost = host;
  return () => {
    if (currentPageNavigationHost === host) currentPageNavigationHost = null;
  };
}

function extensionIdSlug(id: string): string {
  return id
    .replace(/^@forgeax-extension\//, '')
    .replace(/^@forgeax\//, '');
}

interface PageNavigationRegistrySnapshot {
  readonly pageTypes: ReadonlyMap<string, {
    readonly status: 'available' | 'unavailable';
    readonly owner: string;
    readonly definition: {
      readonly cardinality: 'singleton' | 'resource' | 'multi-instance';
    };
  }>;
}

/** Match an extension id against a registered singleton page identity. */
export function extensionPageMatches(extensionId: string, owner: string, typeId: string): boolean {
  const requested = extensionId.trim();
  if (!requested) return false;
  const needle = extensionIdSlug(requested);
  return (
    owner === requested
    || extensionIdSlug(owner) === needle
    || typeId === requested
    || extensionIdSlug(typeId) === needle
  );
}

/** Resolve an overlay through the installed host's live panel registry. */
export function resolveRegisteredOverlayId(requestedId: string): string | null {
  const host = currentPageNavigationHost;
  if (host === null) return null;
  const requested = requestedId.trim().toLocaleLowerCase();
  if (!requested) return null;
  const overlays = host.panels.overlays ?? {};
  const registered = Object.entries(overlays).find(([id, renderer]) =>
    typeof renderer === 'function' && id.toLocaleLowerCase() === requested,
  );
  return registered ? registered[0].toLocaleLowerCase() : null;
}

/** Open the available singleton page contributed by an extension. */
export async function openExtensionPage(extensionId: string): Promise<void> {
  const host = currentPageNavigationHost;
  if (host === null) throw new Error('Page host is not ready');
  const snapshot = host.pageRegistry.getSnapshot() as PageNavigationRegistrySnapshot;
  const page = [...snapshot.pageTypes.entries()].find(
    ([typeId, resolved]) =>
      resolved.status === 'available' && extensionPageMatches(extensionId, resolved.owner, typeId),
  );
  if (!page) throw new Error(`extension "${extensionId}" contributes no available singleton page`);
  const [typeId, resolved] = page;
  if (resolved.definition.cardinality !== 'singleton') {
    throw new Error(`extension "${extensionId}" has no default singleton page`);
  }
  await host.pages.open({ typeId });
}

/** Open one registered page type through the installed application host. */
export async function openPageType(typeId: string): Promise<void> {
  const host = currentPageNavigationHost;
  if (host === null) throw new Error('Page host is not ready');
  await host.pages.open({ typeId: typeId as Parameters<AppHost['pages']['open']>[0]['typeId'] });
}

/** Open a resource through the installed application host's resolver. */
export async function openResource(resource: ResourceDescriptor): Promise<void> {
  const host = currentPageNavigationHost;
  if (host === null) throw new Error('Page host is not ready');
  await host.resourceEditors.open(resource);
}

export interface AppExtensionContext {
  readonly host: AppHost;
  readonly bus: EventBus<AppBusEventMap>;
  readonly storage: StorageApi;
  readonly log: {
    debug(message: string, ...rest: unknown[]): void;
    info(message: string, ...rest: unknown[]): void;
    warn(message: string, ...rest: unknown[]): void;
    error(message: string, ...rest: unknown[]): void;
  };
  registerCommand(command: CommandDescriptor): Cleanup;
  contributePanels(patch: Partial<PanelRenderers>): Cleanup;
  contributePanelActions(actions: readonly PanelActionContribution[]): Cleanup;
  contributePanelControls(controls: readonly PanelControlContribution[]): Cleanup;
  contributePagePlatform(contribution: PagePlatformContribution): Cleanup;
}

export interface AppExtensionContributes {
  readonly menus?: readonly ApplicationMenuItem[];
  readonly panels?: Partial<PanelRenderers>;
  readonly panelActions?: readonly PanelActionContribution[];
  readonly panelControls?: readonly PanelControlContribution[];
  readonly pages?: readonly PageTypeRegistration[];
  readonly panelTypes?: readonly PanelTypeRegistration[];
  readonly activities?: readonly ActivityRegistration[];
  readonly resourceEditors?: readonly ResourceEditorRegistration[];
}

export interface AppExtension {
  readonly id: string;
  readonly version: string;
  readonly requires?: readonly HostCapability[];
  readonly provides?: readonly HostCapability[];
  readonly contributes?: AppExtensionContributes;
  readonly setup?: (context: AppExtensionContext) => void | Cleanup | Promise<void | Cleanup>;
}

const HostContext = createContext<AppHost | null>(null);

export function HostProvider({ value, children }: { readonly value: AppHost; readonly children: ReactNode }) {
  return <HostContext.Provider value={value}>{children}</HostContext.Provider>;
}

export interface ApplicationRuntime<Host extends AppHost = AppHost> {
  readonly host: Host;
  dispose(): void | Promise<void>;
}

export interface ApplicationRuntimeRootProps<Runtime extends ApplicationRuntime> {
  /** Product-owned above this replaceable subtree; retains incomplete shutdown. */
  readonly owner?: ApplicationRuntimeOwner;
  readonly start: () => Promise<Runtime>;
  readonly onReady?: (runtime: Runtime) => void;
  readonly fallback?: ReactNode;
  readonly children: (runtime: Runtime) => ReactNode;
}

type ApplicationRuntimeState<Runtime> =
  | { readonly status: 'starting' }
  | { readonly status: 'ready'; readonly runtime: Runtime }
  | { readonly status: 'failed'; readonly error: unknown };

function disposeApplicationRuntime(runtime: ApplicationRuntime): void {
  try {
    void Promise.resolve(runtime.dispose()).catch(() => {});
  } catch {
    // Cleanup must never mask the next product mount or an owner unmount.
  }
}

/**
 * Owns one asynchronous application runtime without selecting product UI.
 *
 * Callers retain product bootstrap inputs, chrome, onboarding, state and error
 * boundaries. The root only balances startup/disposal, fences a startup that
 * settles after unmount, and publishes the runtime host through the shared
 * application context.
 */
export function ApplicationRuntimeRoot<Runtime extends ApplicationRuntime>({
  owner,
  start,
  onReady,
  fallback = null,
  children,
}: ApplicationRuntimeRootProps<Runtime>) {
  const [state, setState] = useState<ApplicationRuntimeState<Runtime>>({ status: 'starting' });

  useEffect(() => {
    let active = true;
    let owned: Runtime | null = null;
    setState({ status: 'starting' });

    if (owner) {
      const lease = owner.acquire(start);
      void lease.ready.then((runtime) => {
        if (!active) return;
        try {
          onReady?.(runtime);
          setState({ status: 'ready', runtime });
        } catch (error) {
          lease.release();
          setState({ status: 'failed', error });
        }
      }).catch((error: unknown) => {
        if (active) setState({ status: 'failed', error });
      });
      return () => { active = false; lease.release(); };
    }

    void Promise.resolve()
      .then(start)
      .then((runtime) => {
        if (!active) {
          disposeApplicationRuntime(runtime);
          return;
        }
        owned = runtime;
        try {
          onReady?.(runtime);
        } catch (error) {
          owned = null;
          disposeApplicationRuntime(runtime);
          if (active) setState({ status: 'failed', error });
          return;
        }
        if (active) setState({ status: 'ready', runtime });
      })
      .catch((error: unknown) => {
        if (active) setState({ status: 'failed', error });
      });

    return () => {
      active = false;
      const runtime = owned;
      owned = null;
      if (runtime !== null) disposeApplicationRuntime(runtime);
    };
  }, [onReady, owner, start]);

  if (state.status === 'failed') throw state.error;
  if (state.status === 'starting') return fallback;
  return <HostProvider value={state.runtime.host}>{children(state.runtime)}</HostProvider>;
}

export function useHost(): AppHost {
  const host = useContext(HostContext);
  if (!host) throw new Error('[app-shell] useHost() called outside <HostProvider>');
  return host;
}

export function useCommand<Args = unknown, Result = unknown>(id: string): (args?: Args) => Promise<Result> {
  const host = useHost();
  return useCallback((args?: Args) => host.commands.execute<Result>(id, args), [host, id]);
}

export function useContextKey<Value>(key: string): Value | undefined {
  const host = useHost();
  const [value, setValue] = useState<Value | undefined>(() => host.contextKeys.get<Value>(key));
  useEffect(() => {
    setValue(host.contextKeys.get<Value>(key));
    const dispose = host.contextKeys.onChange(key, (next) => setValue(next as Value));
    return () => { void dispose(); };
  }, [host, key]);
  return value;
}

export function useKeybindingScope(ref: RefObject<Element | null>, scopeId: string): void {
  const host = useHost();
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const dispose = host.keybindings.registerScope(element, scopeId);
    return () => { void dispose(); };
  }, [host, ref, scopeId]);
}

export interface PageDirtyProbeTarget {
  readonly encodedKey: string;
  readonly typeId: string;
  readonly resource?: ResourceDescriptor;
}

export interface PageDirtyProbe {
  isDirty(page: PageDirtyProbeTarget): boolean;
  subscribe(listener: () => void): Cleanup;
}

let pageDirtyProbe: PageDirtyProbe | null = null;

export function registerPageDirtyProbe(next: PageDirtyProbe | null): Cleanup {
  pageDirtyProbe = next;
  return () => {
    if (pageDirtyProbe === next) pageDirtyProbe = null;
  };
}

export function isPageDirty(page: PageDirtyProbeTarget): boolean {
  return pageDirtyProbe?.isDirty(page) === true;
}

export function subscribePageDirty(listener: () => void): Cleanup {
  return pageDirtyProbe?.subscribe(listener) ?? (() => {});
}

export interface AppManifestPanel { id: string }
export interface AppManifest {
  id: string;
  entryUrl: string;
  panels: AppManifestPanel[];
  surfaces: unknown[];
  routes: unknown[];
}
export interface DefinedApp<Spec = AppManifest> { manifest: Spec }
export interface MountOptions { entryUrl?: string }
export interface AppKitErrorInit { code: string; hint: string; expected: string | object }

export class AppKitError extends Error {
  readonly code: string;
  readonly hint: string;
  readonly expected: string | object;

  constructor(init: AppKitErrorInit) {
    super(`[${init.code}] ${init.hint}`);
    this.name = 'AppKitError';
    this.code = init.code;
    this.hint = init.hint;
    this.expected = init.expected;
  }
}

export function defineApp<Spec>(spec: Spec): DefinedApp<Spec> {
  return { manifest: spec };
}

export function mountComposition(options: MountOptions): void {
  if (!options || typeof options.entryUrl !== 'string' || options.entryUrl.length === 0) {
    throw new AppKitError({
      code: 'MISSING_ENTRY_URL',
      hint: 'Provide entryUrl in mountComposition({ entryUrl })',
      expected: 'string url',
    });
  }
}
